"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WS=require("ws");
delete process.env.DATABASE_URL;
const {app,rooms,shutdown,createRoom,joinRoom}=require("../server.js");
const BLUE={id:"00000000-0000-4000-8000-000000000002",username:"blueplayer"};
const RED={id:"00000000-0000-4000-8000-000000000001",username:"redplayer"};
function message(ws,check,timeout=5000){
 return new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{ws.off("message",handler);reject(Error("Message not received."));},timeout);
  const handler=raw=>{let data;try{data=JSON.parse(raw.toString());}catch(e){return;}
   if(check(data)){clearTimeout(timer);ws.off("message",handler);resolve(data);}};
  ws.on("message",handler);
 });
}
test("public rooms can be discovered, spectators can watch but cannot modify games",async()=>{
 await new Promise(resolve=>app.listen(0,"127.0.0.1",resolve));
 const port=app.address().port,base="http://127.0.0.1:"+port,connections=[];
 const connect=async()=>{const ws=new WS("ws://127.0.0.1:"+port+"/ws");connections.push(ws);await once(ws,"open");return ws;};
 try{
  const privateRoom=await createRoom("ffa","untimed",null,{title:"Private study"});
  assert.equal(privateRoom.visibility,"private");
  await assert.rejects(createRoom("ffa","untimed",null,{visibility:"public"}),/Sign in/);
  const publicRoom=await createRoom("ffa","blitz5",null,{visibility:"public",title:"Open Quadra",account:RED});
  assert.equal(publicRoom.visibility,"public");
  const directory=await (await fetch(base+"/api/rooms/public")).json();
  assert.equal(directory.rooms.some(r=>r.room===publicRoom.room),true);
  assert.equal(directory.rooms.some(r=>r.room===privateRoom.room),false);
  assert.equal(directory.rooms.find(r=>r.room===publicRoom.room).players,1);
  const watcher=await connect();
  const joined=message(watcher,x=>x.type==="welcome"&&x.spectator===true);
  const snapshot=message(watcher,x=>x.type==="state");
  watcher.send(JSON.stringify({type:"watch",room:publicRoom.room}));
  assert.equal((await joined).seat,null);
  assert.equal((await snapshot).spectatorCount,1);
  const denied=message(watcher,x=>x.type==="error");
  watcher.send(JSON.stringify({type:"move",revision:0,from:0,to:1}));
  assert.match((await denied).error,/read-only/);
  assert.equal(rooms.get(publicRoom.room).game.moves.length,0);
  const blocked=await connect();
  blocked.send(JSON.stringify({type:"watch",room:privateRoom.room}));
  const [status]=await once(blocked,"close");
  assert.equal(status,4003);
  const priv=await connect();
  const privateWelcome=message(priv,x=>x.type==="welcome"&&x.spectator);
  priv.send(JSON.stringify({type:"watch",room:privateRoom.room,key:privateRoom.spectatorKey}));
  await privateWelcome;
  assert.equal(rooms.get(privateRoom.room).spectators.size,1);
 }finally{for(const ws of connections)ws.terminate();shutdown();}
});
