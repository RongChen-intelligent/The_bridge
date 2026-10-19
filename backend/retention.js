"use strict";
const RETENTION_MS=30*86400000;
function firstReplyAt(row){
 if(Number.isFinite(row.first_reply_at))return row.first_reply_at;
 if(Array.isArray(row.messages)){const dates=row.messages.filter(m=>m.role==='staff'&&Number.isFinite(m.created_at)).map(m=>m.created_at);return dates.length?Math.min(...dates):null;}
 return row.reply&&Number.isFinite(row.updated_at)?row.updated_at:null;
}
const expiresAt=row=>{const first=firstReplyAt(row);return first===null?null:first+RETENTION_MS;};
const expired=(row,at)=>row&&expiresAt(row)!==null&&expiresAt(row)<=at;
// Match the JS fallback for legacy records that have no message history.
const firstReplySQL=`COALESCE((payload->>'first_reply_at')::bigint,
 CASE WHEN jsonb_typeof(payload->'messages')='array' THEN
 (SELECT min((m->>'created_at')::bigint) FROM jsonb_array_elements(payload->'messages') m WHERE m->>'role'='staff')
 ELSE CASE WHEN COALESCE(payload->>'reply','')<>'' THEN (payload->>'updated_at')::bigint END END)`;
const pruneLettersSQL=`WITH expired AS (
 SELECT id FROM bridge_private.records WHERE entity='feedback' AND (${firstReplySQL})<=$1
 LIMIT $2 FOR UPDATE SKIP LOCKED
) DELETE FROM bridge_private.records r USING expired e WHERE r.entity='feedback' AND r.id=e.id`;
const pruneVotesSQL=`WITH orphan AS (
 SELECT v.entity,v.id FROM bridge_private.records v WHERE v.entity IN ('votes','tickets')
 AND v.payload ? 'poll_id' AND NOT EXISTS (SELECT 1 FROM bridge_private.records p WHERE p.entity='polls' AND p.id=v.payload->>'poll_id')
 LIMIT $1 FOR UPDATE SKIP LOCKED
) DELETE FROM bridge_private.records r USING orphan o WHERE r.entity=o.entity AND r.id=o.id`;
module.exports={RETENTION_MS,firstReplyAt,expiresAt,expired,firstReplySQL,pruneLettersSQL,pruneVotesSQL};
