-- Run once in the same SQL editor that created bridge_private.records.
-- No API key or password belongs in this file. Existing data is preserved.
BEGIN;
CREATE OR REPLACE FUNCTION bridge_private.commit_records(expected jsonb, changes jsonb)
RETURNS boolean LANGUAGE plpgsql VOLATILE SECURITY INVOKER
SET search_path = pg_catalog
SET lock_timeout = '3s'
AS $bridge$
DECLARE item jsonb; actual jsonb;
BEGIN
 IF jsonb_typeof(expected) IS DISTINCT FROM 'array' OR jsonb_typeof(changes) IS DISTINCT FROM 'array'
    OR jsonb_array_length(expected)>100 OR jsonb_array_length(changes)>100 THEN
  RAISE EXCEPTION 'Invalid transaction' USING ERRCODE='22023';
 END IF;
 -- All writers (including pruning/direct SQL) conflict with this short-lived lock.
 -- VOLATILE queries see committed state after the lock at READ COMMITTED;
 -- higher isolation levels are rejected to avoid validating an old snapshot.
 IF current_setting('transaction_isolation') <> 'read committed' THEN
  RAISE EXCEPTION 'READ COMMITTED required' USING ERRCODE='25001';
 END IF;
 LOCK TABLE bridge_private.records IN EXCLUSIVE MODE;
 FOR item IN SELECT value FROM jsonb_array_elements(expected) LOOP
  SELECT payload INTO actual FROM bridge_private.records
   WHERE entity=item->>'entity' AND id=item->>'id';
  IF coalesce(actual,'null'::jsonb) IS DISTINCT FROM item->'payload' THEN
   RAISE EXCEPTION 'Concurrent change; retry transaction' USING ERRCODE='40001';
  END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(changes) LOOP
  IF item->'payload' = 'null'::jsonb THEN
   DELETE FROM bridge_private.records WHERE entity=item->>'entity' AND id=item->>'id';
  ELSE
   INSERT INTO bridge_private.records(entity,id,payload,created_at,expires_at,state,status)
   VALUES(item->>'entity',item->>'id',item->'payload',
     coalesce((item->'payload'->>'created_at')::bigint,0),
     (item->'payload'->>'expiresAt')::timestamptz,item->'payload'->>'state',item->'payload'->>'status')
   ON CONFLICT(entity,id) DO UPDATE SET payload=excluded.payload,
    created_at=excluded.created_at,expires_at=excluded.expires_at,state=excluded.state,status=excluded.status;
  END IF;
 END LOOP;
 RETURN true;
END
$bridge$;
REVOKE ALL ON FUNCTION bridge_private.commit_records(jsonb,jsonb) FROM PUBLIC;
-- SQL grants require the physical role, which has a suffix on shared clusters.
DO $permissions$
DECLARE r text; server_role text; readonly_role text;
BEGIN
 IF current_user ~ '^cloudbase_postgres_' THEN
  server_role := current_user;
  readonly_role := 'cloudbase_read_only_user_' || substr(current_user,20);
 ELSIF EXISTS(SELECT 1 FROM pg_roles WHERE rolname='cloudbase_postgres') THEN
  server_role := 'cloudbase_postgres';
  readonly_role := 'cloudbase_read_only_user';
 ELSE
  RAISE EXCEPTION 'Run as the CloudBase PostgreSQL administrator role';
 END IF;
 EXECUTE format('GRANT USAGE ON SCHEMA bridge_private TO %I',server_role);
 EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON bridge_private.records TO %I',server_role);
 EXECUTE format('GRANT EXECUTE ON FUNCTION bridge_private.commit_records(jsonb,jsonb) TO %I',server_role);
 DROP POLICY IF EXISTS bridge_http_server ON bridge_private.records;
 EXECUTE format('CREATE POLICY bridge_http_server ON bridge_private.records TO %I USING (true) WITH CHECK (true)',server_role);
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role',readonly_role] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA bridge_private FROM %I',r);
   EXECUTE format('REVOKE ALL ON bridge_private.records FROM %I',r);
   EXECUTE format('REVOKE ALL ON FUNCTION bridge_private.commit_records(jsonb,jsonb) FROM %I',r);
  END IF;
 END LOOP;
END $permissions$;
COMMIT;
