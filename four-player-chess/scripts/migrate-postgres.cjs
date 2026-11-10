"use strict";
// Quadra Chess — safe, verified PostgreSQL -> Supabase data migration.
// Uses the existing pg dependency. Never stores or prints database credentials.
// Invocation: QUADRA_SOURCE_DATABASE_URL=... QUADRA_TARGET_DATABASE_URL=... node scripts/migrate-postgres.cjs --plan
// After API maintenance mode is active:
// QUADRA_MIGRATION_CONFIRM=copy-frozen-source node scripts/migrate-postgres.cjs --execute
// NEVER run with a non-empty destination or while the source is accepting writes.

const crypto=require("node:crypto");
const {Client,types}=require("pg");

// Preserve PostgreSQL timestamp microseconds (default pg parser rounds to ms).
types.setTypeParser(1184,value=>value);
types.setTypeParser(1114,value=>value);

const TABLES=[
 {name:"quadra_accounts",key:"handle",cols:["id","handle","pass_salt","pass_hash","recovery_hash","created_at","role","banned_at"]},
 {name:"quadra_sessions",key:"token_hash",cols:["token_hash","user_id","created_at","expires_at"]},
 {name:"quadra_admin_bootstrap",key:"name",cols:["name"]},
 {name:"quadra_player_stats",key:"user_id,mode",cols:["user_id","mode","rating","games","wins","draws","updated_at"]},
 {name:"quadra_rated_results",key:"room_id,game_no",cols:["room_id","game_no","players_key","mode","calculated_at","status"]},
 {name:"quadra_rooms",key:"id",cols:["id","revision","data","updated_at","expires_at"]}
];
const CHUNK=50;
const fq=t=>"public."+t.name;
const err=s=>{throw Error(s);};
const sourceUrl=process.env.QUADRA_SOURCE_DATABASE_URL;
const targetUrl=process.env.QUADRA_TARGET_DATABASE_URL;
const execute=process.argv.includes("--execute");
const plan=process.argv.includes("--plan");
if(execute===plan)err("Choose exactly one of --plan and --execute.");
if(!sourceUrl||!targetUrl)err("Set QUADRA_SOURCE_DATABASE_URL and QUADRA_TARGET_DATABASE_URL privately.");
if(sourceUrl===targetUrl)err("The source and target connection URLs must not be identical.");

async function maintenanceCheck(){
 const url=process.env.QUADRA_API_HEALTH_URL||"https://quadra-chess-api.onrender.com/health";
 const response=await fetch(url,{signal:AbortSignal.timeout(20000)});
 if(!response.ok)err("Live API health check failed; do not attempt migration.");
 const health=await response.json();
 if(health.maintenance!==true||health.storage!=="postgres")
  err("API is not confirmed in PostgreSQL migration maintenance mode. Stop.");
}
async function count(client,t){
 const r=await client.query("SELECT COUNT(*)::bigint AS n FROM "+fq(t));
 return Number(r.rows[0].n);
}
async function rows(client,t,offset){
 return client.query("SELECT "+t.cols.join(",")+" FROM "+fq(t)+
  " ORDER BY "+t.key+" LIMIT $1 OFFSET $2",[CHUNK,offset]);
}
async function digests(client,t,offset){
 const r=await client.query("SELECT md5(to_jsonb(t)::text) AS digest FROM "+fq(t)+
  " AS t ORDER BY "+t.key+" LIMIT $1 OFFSET $2",[CHUNK,offset]);
 return r.rows.map(v=>v.digest);
}
async function copy(client,t,batch){
 if(!batch.length)return;
 const cols=t.cols;
 const values=[],parameters=[];
 for(let i=0;i<batch.length;i++){
  const fields=cols.map((col,j)=>{
   parameters.push(batch[i][col]);
   return "$"+(i*cols.length+j+1);
  });
  values.push("("+fields.join(",")+")");
 }
 const query="INSERT INTO "+fq(t)+" ("+cols.join(",")+") VALUES "+values.join(",");
 await client.query(query,parameters);
}
async function main(){
 if(execute){
  if(process.env.QUADRA_MIGRATION_CONFIRM!=="copy-frozen-source")
   err("Execution is locked. Set QUADRA_MIGRATION_CONFIRM=copy-frozen-source.");
  await maintenanceCheck();
 }
 const source=new Client({connectionString:sourceUrl,connectionTimeoutMillis:15000});
 const target=new Client({connectionString:targetUrl,connectionTimeoutMillis:15000});
 let sourceStarted=false,targetStarted=false;
 try{
  await source.connect();await target.connect();
  await source.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
  sourceStarted=true;
  const counts=[];
  for(const table of TABLES){
   const from=await count(source,table),to=await count(target,table);
   counts.push({table,from,to});
   console.log(table.name+": source "+from+", target "+to);
  }
  if(plan){
   console.log("Plan only: no rows were modified.");
   return;
  }
  if(counts.some(v=>v.to!==0))err("Destination has existing Quadra data. Aborting rather than merging/overwriting.");
  await target.query("BEGIN");
  targetStarted=true;
  for(const {table,from} of counts){
   for(let offset=0;offset<from;offset+=CHUNK){
    const incoming=(await rows(source,table,offset)).rows;
    if(incoming.length!==Math.min(CHUNK,from-offset))err("Source count changed during copy: "+table.name);
    await copy(target,table,incoming);
    const [a,b]=await Promise.all([digests(source,table,offset),digests(target,table,offset)]);
    if(a.length!==b.length||a.some((digest,i)=>digest!==b[i]))
     err("Row checksum mismatch in "+table.name+" starting at row "+offset+". Transaction will roll back.");
   }
   if(await count(target,table)!==from)err("Final count mismatch in "+table.name);
   console.log("Verified "+from+" rows in "+table.name);
  }
  await target.query("COMMIT");targetStarted=false;
  console.log("Migration committed. Run the Supabase RLS/role verification SQL and test the application before deleting Render Postgres.");
 }catch(e){
  if(targetStarted)try{await target.query("ROLLBACK");}catch{}
  console.error("Migration aborted: "+String(e.message||"unexpected error").slice(0,280));
  process.exitCode=1;
 }finally{
  if(sourceStarted)try{await source.query("ROLLBACK");}catch{}
  await Promise.allSettled([source.end(),target.end()]);
 }
}
main().catch(e=>{console.error("Migration initialization failed; no data copied.");process.exitCode=1;});
