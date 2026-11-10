"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const WebSocket=require("ws");

delete process.env.DATABASE_URL;
process.env.MIGRATION_READ_ONLY="1";
const {app,shutdown}=require("../server.js");
delete process.env.MIGRATION_READ_ONLY;

test("migration maintenance gate blocks API mutations and WebSocket upgrades but keeps health available",async()=>{
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+app.address().port;
 try{
  const health=await fetch(base+"/health");
  assert.equal(health.status,200);
  const info=await health.json();
  assert.equal(info.ok,true);
  assert.equal(info.maintenance,true);
  const create=await fetch(base+"/api/rooms",{
   method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({mode:"ffa"})
  });
  assert.equal(create.status,503);
  assert.equal(create.headers.get("retry-after"),"180");
  assert.equal((await create.json()).maintenance,true);
  const stats=await fetch(base+"/api/stats");
  assert.equal(stats.status,503);
  await new Promise((resolve,reject)=>{
   const ws=new WebSocket(base.replace("http","ws")+"/ws");
   const timeout=setTimeout(()=>{ws.terminate();reject(Error("Upgrade did not respond"));},5000);
   ws.on("open",()=>{clearTimeout(timeout);ws.close();reject(Error("Maintenance should reject WebSocket"));});
   ws.on("unexpected-response",(_,response)=>{
    clearTimeout(timeout);assert.equal(response.statusCode,503);resolve();
   });
   ws.on("error",error=>{clearTimeout(timeout);reject(error);});
  });
 }finally{shutdown();}
});
