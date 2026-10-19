const {test}=require('node:test');const assert=require('node:assert/strict');
const {PGlite}=require('@electric-sql/pglite');const fs=require('node:fs');const path=require('node:path');
test('shared cluster migration uses suffixed current role without creating roles',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 const server='cloudbase_postgres_postgres_fz9d2dxc',reader='cloudbase_read_only_user_postgres_fz9d2dxc';
 await db.exec(`CREATE ROLE ${server} NOLOGIN NOSUPERUSER NOCREATEROLE;
 CREATE ROLE ${reader} NOLOGIN; CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
 DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO ${server}',current_database()); END $$;
 SET ROLE ${server};`);
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/001-managed-schema.sql'),'utf8'));
 await db.exec(`GRANT USAGE ON SCHEMA bridge_private TO ${reader}; GRANT SELECT ON bridge_private.records TO ${reader};`);
 const migration=fs.readFileSync(path.join(__dirname,'../database/002-http-transactions.sql'),'utf8');
 await db.exec(migration);
 await db.query(`SELECT bridge_private.commit_records('[]','[{"entity":"meta","id":"keep","payload":{"ok":true}}]')`);
 await db.exec(migration);
 assert.equal((await db.query('SELECT count(*) FROM bridge_private.records')).rows[0].count,1);
 assert.equal((await db.query("SELECT count(*) FROM pg_roles WHERE rolname='cloudbase_postgres'")).rows[0].count,0);
 for(const role of [reader,'anon','authenticated','service_role']){
  await db.query('RESET ROLE');await db.query('SET ROLE '+role);
  await assert.rejects(()=>db.query('SELECT * FROM bridge_private.records'),{code:'42501'});
  await assert.rejects(()=>db.query("SELECT bridge_private.commit_records('[]','[]')"),{code:'42501'});
 }
});
test('managed schema works without CREATEROLE and blocks browser roles',async t=>{
 const db=new PGlite();await db.waitReady;t.after(()=>db.close());
 await db.exec(`CREATE ROLE managed_editor NOLOGIN NOSUPERUSER NOCREATEROLE;
 CREATE ROLE anon NOLOGIN; CREATE ROLE authenticated NOLOGIN; CREATE ROLE service_role NOLOGIN;
 DO $$ BEGIN EXECUTE format('GRANT CREATE ON DATABASE %I TO managed_editor',current_database()); END $$;
 SET ROLE managed_editor;
 ALTER DEFAULT PRIVILEGES GRANT SELECT ON TABLES TO anon;`);
 const script=fs.readFileSync(path.join(__dirname,'../database/001-managed-schema.sql'),'utf8');
 await db.exec(script);
 assert.equal((await db.query('SELECT rolcreaterole FROM pg_roles WHERE rolname=current_user')).rows[0].rolcreaterole,false);
 await db.query(`INSERT INTO bridge_private.records(entity,id,payload) VALUES('meta','check','{"ok":true}')`);
 await db.exec(script);
 assert.equal((await db.query('SELECT count(*) FROM bridge_private.records')).rows[0].count,1);
 await db.query('RESET ROLE');
 await db.exec('CREATE ROLE cloudbase_postgres NOLOGIN NOSUPERUSER NOCREATEROLE; CREATE ROLE cloudbase_read_only_user NOLOGIN; SET ROLE managed_editor;');
 await db.exec(fs.readFileSync(path.join(__dirname,'../database/002-http-transactions.sql'),'utf8'));
 await db.query('RESET ROLE');
 await db.query('SET ROLE cloudbase_postgres');
 assert.equal((await db.query(`SELECT bridge_private.commit_records('[]','[{"entity":"meta","id":"http-check","payload":{"ok":true}}]') AS ok`)).rows[0].ok,true);
 assert.equal((await db.query('SELECT count(*) FROM bridge_private.records')).rows[0].count,2);
 await db.query('RESET ROLE');
 for(const role of ['anon','authenticated','service_role']){
  await db.query('SET ROLE '+role);
  await assert.rejects(()=>db.query('SELECT * FROM bridge_private.records'),{code:'42501'});
  await db.query('RESET ROLE');
 }
});
