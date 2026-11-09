"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WebSocket=require("ws");
const Engine=require("../engine.js");
const {app,shutdown,rooms}=require("../server.js");
function nextMessage(ws,predicate,timeout=5000){return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{ws.off("message",onMessage);reject(Error("Timed out waiting for WebSocket message."));},timeout);const onMessage=raw=>{let v;try{v=JSON.parse(raw.toString());}catch(e){return;}if(predicate(v)){clearTimeout(timer);ws.off("message",onMessage);resolve(v);}};ws.on("message",onMessage);});}
test("private room joins and server-authoritative moves over WebSockets",async()=>{
 await new Promise((resolve,reject)=>app.listen(0,"127.0.0.1",e=>e?reject(e):resolve()));
 const port=app.address().port,base="http://127.0.0.1:"+port,clients=[];
 const post=async(path,data)=>{const res=await fetch(base+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(data)});return {status:res.status,json:await res.json()};};
 try{
  const created=await post("/api/rooms",{mode:"ffa"});
  assert.equal(created.status,201);assert.match(created.json.room,/^[0-9A-F]{7}$/);assert.equal(created.json.seat,0);
  const players=[created.json];
  for(let i=1;i<4;i++){const join=await post("/api/rooms/"+created.json.room+"/join",{});assert.equal(join.status,200);assert.equal(join.json.seat,i);players.push(join.json);}
  const full=await post("/api/rooms/"+created.json.room+"/join",{});assert.equal(full.status,409);
  for(const p of players){const ws=new WebSocket("ws://127.0.0.1:"+port+"/ws");clients.push(ws);await once(ws,"open");const welcome=nextMessage(ws,m=>m.type==="welcome");const initial=nextMessage(ws,m=>m.type==="state");ws.send(JSON.stringify({type:"hello",room:p.room,seat:p.seat,token:p.token}));assert.equal((await welcome).seat,p.seat);assert.equal((await initial).revision,0);}
  const [red,blue]=clients;
  const illegal=nextMessage(blue,m=>m.type==="error");blue.send(JSON.stringify({type:"move",revision:0,from:0,to:1}));assert.match((await illegal).error,/Not your turn/);
  const start=Engine.fresh(),m=Engine.legal(start,0)[0],updated=nextMessage(red,msg=>msg.type==="state"&&msg.revision===1);red.send(JSON.stringify({type:"move",revision:0,from:m.from,to:m.to}));const position=await updated;assert.equal(position.game.turn,1);assert.equal(position.game.moves.length,1);
  const stale=nextMessage(red,msg=>msg.type==="error");red.send(JSON.stringify({type:"move",revision:0,from:m.from,to:m.to}));assert.match((await stale).error,/Position changed/);
  // A rematch requires all four authenticated players' approval after completion.
  const room=rooms.get(created.json.room);room.game.winner="Red wins!";
  const next=nextMessage(red,msg=>msg.type==="state"&&msg.revision===2);
  for(const ws of clients)ws.send(JSON.stringify({type:"rematch"}));
  const restarted=await next;
  assert.equal(restarted.game.winner,null);
  assert.equal(restarted.game.moves.length,0);
  assert.equal(restarted.game.turn,0);
  assert.deepEqual(restarted.rematch,[false,false,false,false]);
 }finally{for(const ws of clients)ws.terminate();shutdown();}
});
