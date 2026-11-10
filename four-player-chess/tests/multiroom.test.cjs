"use strict";
const test=require("node:test"),assert=require("node:assert/strict");
const {once}=require("node:events"),WebSocket=require("ws");
delete process.env.DATABASE_URL;
const {app,rooms,createRoom,joinRoom,shutdown}=require("../server.js");
const SAME={id:"00000000-0000-4000-8000-000000000111",username:"multipleplayer"};
function until(ws,predicate,timeout=5000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off("message",handle);reject(Error("Timed out waiting for WebSocket state"));},timeout);
  const handle=raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return;}
   if(predicate(msg)){clearTimeout(timer);ws.off("message",handle);resolve(msg);}
  };ws.on("message",handle);
 });
}
test("same account may play in several rooms while each room retains an independent focus state",async()=>{
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 const base="http://127.0.0.1:"+app.address().port,opened=[];
 const connect=async ticket=>{
  const ws=new WebSocket(base.replace("http","ws")+"/ws");opened.push(ws);await once(ws,"open");
  const welcome=until(ws,m=>m.type==="welcome");
  const state=until(ws,m=>m.type==="state");
  ws.send(JSON.stringify({type:"hello",room:ticket.room,seat:ticket.seat,token:ticket.token}));
  await welcome;await state;return ws;
 };
 try{
  const first=await createRoom("ffa","untimed",null,{account:SAME});
  const second=await createRoom("ffa","untimed",null,{account:SAME});
  assert.notEqual(first.room,second.room);
  const ws1=await connect(first),ws2=await connect(second);
  const totals=await (await fetch(base+"/api/stats")).json();
  assert.equal(totals.connectedSeats,2);
  assert.equal(totals.uniquePlayingAccounts,1);
  assert.equal(totals.playersOnline,1,"one account must not count twice as an online person");
  const background=until(ws1,m=>m.type==="state"&&m.seats[0].viewing===false);
  ws1.send(JSON.stringify({type:"focus",active:false}));
  const away=await background;
  assert.equal(away.seats[0].claimed,true);
  assert.equal(away.seats[0].online,true,"background room must remain connected");
  assert.equal(away.seats[0].viewing,false);
  assert.equal(rooms.get(second.room).seats[0].ws?.readyState,WebSocket.OPEN);
  const foreground=until(ws1,m=>m.type==="state"&&m.seats[0].viewing===true);
  ws1.send(JSON.stringify({type:"focus",active:true}));await foreground;
  assert.equal(rooms.get(first.room).seats[0].ws?.readyState,WebSocket.OPEN);
  const rejoined=await joinRoom(first.room,{account:SAME});
  assert.equal(rejoined.rejoined,true);
  assert.equal(rejoined.seat,first.seat);
  assert.equal(rejoined.token,null);
  assert.equal(rooms.get(first.room).seats.filter(Boolean).length,1);
  rooms.get(first.room).started=true;
  assert.equal((await joinRoom(first.room,{account:SAME})).rejoined,true,"reconnecting during a match reuses its existing seat");
  rooms.get(first.room).started=false;
  assert.equal(rooms.get(second.room).seats.filter(Boolean).length,1);
  // A guest can watch one room at the same time another room is being played.
  const viewer=new WebSocket(base.replace("http","ws")+"/ws");opened.push(viewer);await once(viewer,"open");
  const welcome=until(viewer,m=>m.type==="welcome"&&m.spectator);
  const publicRoom=await createRoom("ffa","untimed",null,{account:SAME,visibility:"public"});
  viewer.send(JSON.stringify({type:"watch",room:publicRoom.room}));
  await welcome;
  const spectatorCount=await (await fetch(base+"/api/stats")).json();
  assert.equal(spectatorCount.spectatorsOnline,1);
  assert.equal(spectatorCount.playersOnline,1);
 }finally{
  for(const ws of opened)ws.terminate();
  shutdown();
 }
});
