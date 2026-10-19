'use strict';
function options(env){
 for(const key of ['PGHOST','PGDATABASE','PGUSER','PGPASSWORD'])if(!env[key])throw Error('Missing database configuration');
 const mode=env.PGSSLMODE||'verify-full';
 if(!['verify-full','require','disable'].includes(mode))throw Error('Unsupported TLS mode');
 const port=Number(env.PGPORT||5432);if(!Number.isInteger(port)||port<1||port>65535)throw Error('Invalid database port');
 return {host:env.PGHOST,port,database:env.PGDATABASE,user:env.PGUSER,password:env.PGPASSWORD,
  ssl:mode==='disable'?false:{rejectUnauthorized:mode==='verify-full',...(env.PGSSLROOTCERT?{ca:env.PGSSLROOTCERT.replace(/\\n/g,'\n')}:{})},
  max:2,idleTimeoutMillis:30000,connectionTimeoutMillis:8000,statement_timeout:8000,
  idle_in_transaction_session_timeout:10000,application_name:'the-bridge'};
}
module.exports={options};
