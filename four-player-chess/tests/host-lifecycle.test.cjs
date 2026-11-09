"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WebSocket=require("ws");
delete process.env.DATABASE_URL;
const {app,rooms,shutdown}=require("../server.js");

function until(ws,predicate,timeout=5000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off("message",handler);reject(new Error("Timed out waiting for room event"));},timeout);
  const handler=raw=>{
   let packet;try{packet=JSON.parse(String(raw));}catch{return;}
   if(predicate(packet)){clearTimeout(timer);ws.off("message",handler);resolve(packet);}
  };
  ws.on("message",handler);
 });
}
test("host controls, handoff, deletion and live totals",async()=>{
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 const origin="http://127.0.0.1:"+app.address().port,connections=[];
 const post=async(path,data)=>{
  const res=await fetch(origin+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});
  return {status:res.status,body:await res.json()};
 };
 const connect=async(ticket)=>{
  const ws=new WebSocket(origin.replace("http","ws")+"/ws");connections.push(ws);
  await once(ws,"open");
  const welcome=until(ws,m=>m.type==="welcome"),state=until(ws,m=>m.type==="state");
  ws.send(JSON.stringify({type:"hello",room:ticket.room,seat:ticket.seat,token:ticket.token}));
  await welcome;await state;return ws;
 };
 try{
  const created=await post("/api/rooms",{mode:"ffa",title:"First host room"});
  assert.equal(created.status,201);
  const roomId=created.body.room;
  const first=await post("/api/rooms/"+roomId+"/join",{});
  const second=await post("/api/rooms/"+roomId+"/join",{});
  assert.equal(first.body.seat,1);
  assert.equal(second.body.seat,2);
  const host=await connect(created.body),guest1=await connect(first.body),guest2=await connect(second.body);
  const before=await (await fetch(origin+"/api/stats")).json();
  assert.equal(before.activeRooms,1);
  assert.equal(before.playersOnline,3);
  assert.equal(before.accounts,0);
  assert.equal(rooms.get(roomId).hostSeat,0);
  const blocked=until(guest1,m=>m.type==="error"&&/host/i.test(m.error));
  guest1.send(JSON.stringify({type:"room-settings",title:"Not allowed",visibility:"private",mode:"ffa",clock:"untimed"}));
  await blocked;
  const seen=until(guest2,m=>m.type==="state"&&m.title==="Updated room"&&m.game.mode==="teams");
  host.send(JSON.stringify({type:"room-settings",title:"Updated room",visibility:"private",mode:"teams",clock:"blitz3",rated:false}));
  const updated=await seen;
  assert.equal(updated.clock.preset,"blitz3");
  assert.equal(updated.hostSeat,0);
  const transfer=until(guest1,m=>m.type==="state"&&m.hostSeat===1);
  host.send(JSON.stringify({type:"vacate"}));
  const handed=await transfer;
  assert.equal(handed.seats[0].claimed,false);
  assert.equal(rooms.get(roomId).hostSeat,1);
  const deleted=until(guest2,m=>m.type==="room-closed");
  guest1.send(JSON.stringify({type:"delete-room"}));
  await deleted;
  assert.equal(rooms.has(roomId),false);
  const after=await (await fetch(origin+"/api/stats")).json();
  assert.equal(after.activeRooms,0);
  const lone=await post("/api/rooms",{mode:"ffa"});
  const loneWs=await connect(lone.body);
  const closed=until(loneWs,m=>m.type==="room-closed");
  loneWs.send(JSON.stringify({type:"vacate"}));
  await closed;
  assert.equal(rooms.has(lone.body.room),false);
  const forbidden=await (await fetch(origin+"/api/admin/accounts")).json();
  assert.match(forbidden.error,/Superuser/);
 }finally{
  for(const ws of connections)ws.terminate();
  shutdown();
 }
});
