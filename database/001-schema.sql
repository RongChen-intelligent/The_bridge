-- THE BRIDGE PostgreSQL schema v1. Run as database administrator.
-- Safe to repeat: no DROP, TRUNCATE or deletion of existing application data.
BEGIN;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='bridge_app') THEN
  CREATE ROLE bridge_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT NOBYPASSRLS;
 END IF;
END $$;
CREATE SCHEMA IF NOT EXISTS bridge_private;
REVOKE ALL ON SCHEMA bridge_private FROM PUBLIC;
CREATE TABLE IF NOT EXISTS bridge_private.records(
 entity text NOT NULL CHECK(entity IN ('meta','accounts','sessions','audit','feedback','challenges','notices','polls','votes','tickets','limits','activity')),
 id text NOT NULL CHECK(length(id) BETWEEN 1 AND 160),
 payload jsonb NOT NULL CHECK(jsonb_typeof(payload)='object'),
 created_at bigint NOT NULL DEFAULT 0,
 expires_at timestamptz,
 state text,
 status text,
 PRIMARY KEY(entity,id)
);
CREATE INDEX IF NOT EXISTS bridge_created ON bridge_private.records(entity,created_at DESC,id ASC);
CREATE INDEX IF NOT EXISTS bridge_status ON bridge_private.records(entity,status,created_at DESC,id ASC);
CREATE INDEX IF NOT EXISTS bridge_state ON bridge_private.records(entity,state,created_at DESC,id ASC);
CREATE INDEX IF NOT EXISTS bridge_expiry ON bridge_private.records(expires_at) WHERE expires_at IS NOT NULL;
REVOKE ALL ON bridge_private.records FROM PUBLIC;
ALTER TABLE bridge_private.records ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='bridge_private' AND tablename='records' AND policyname='bridge_server_only') THEN
  CREATE POLICY bridge_server_only ON bridge_private.records TO bridge_app USING(true) WITH CHECK(true);
 END IF;
END $$;
GRANT USAGE ON SCHEMA bridge_private TO bridge_app;
GRANT SELECT,INSERT,UPDATE,DELETE ON bridge_private.records TO bridge_app;
DO $$ DECLARE r text; BEGIN
 EXECUTE format('GRANT CONNECT ON DATABASE %I TO bridge_app',current_database());
 FOREACH r IN ARRAY ARRAY['anon','authenticated','service_role'] LOOP
  IF EXISTS(SELECT 1 FROM pg_roles WHERE rolname=r) THEN
   EXECUTE format('REVOKE ALL ON SCHEMA bridge_private FROM %I',r);
   EXECUTE format('REVOKE ALL ON bridge_private.records FROM %I',r);
  END IF;
 END LOOP;
END $$;
COMMIT;
