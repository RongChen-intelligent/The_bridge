const {spawnSync}=require('node:child_process');
const r=spawnSync(process.execPath,['--test','tests/backend.test.cjs','tests/campus-upgrade.test.cjs','tests/http-store.test.cjs','tests/http-entrypoint.test.cjs','tests/managed-schema.test.cjs','tests/feedback-response.test.cjs','tests/attachments.test.cjs','tests/retention.test.cjs','tests/moderation.test.cjs','tests/resource-cost.test.cjs'],{stdio:'inherit',windowsHide:true,env:{...process.env,BRIDGE_HTTP_TEST:'1'}});
process.exit(r.status??1);
