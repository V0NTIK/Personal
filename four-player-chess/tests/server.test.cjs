"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {once}=require("node:events");
const WebSocket=require("ws");
const Engine=require("../engine.js");
// Integration tests use an isolated in-memory store even when Render provides DATABASE_URL.
// Never connect test cases to the live database during build or CI.
delete process.env.DATABASE_URL;
const {app,shutdown,rooms,expireTurn}=require("../server.js");
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
  const timed=await post("/api/rooms",{mode:"teams",clock:"blitz5"});
  assert.equal(timed.status,201);assert.equal(timed.json.clock,"blitz5");
  assert.equal(timed.json.variant,"quadra-teams");
  const timedRoom=rooms.get(timed.json.room);
  assert.equal(timedRoom.clock.started,false);
  for(let i=1;i<4;i++)await post("/api/rooms/"+timed.json.room+"/join",{});
  assert.equal(timedRoom.clock.started,true);
  // Draw agreements require every still-active seat; votes are persisted, then the game ends.
  const firstVote=nextMessage(red,x=>x.type==="state"&&x.drawVotes?.[0]===true);
  red.send(JSON.stringify({type:"draw-vote"}));
  const partial=await firstVote;
  assert.equal(partial.revision,2);
  assert.equal(partial.game.winner,null);
  const agreed=nextMessage(red,x=>x.type==="state"&&x.revision===3);
  for(const ws of clients.slice(1,4))ws.send(JSON.stringify({type:"draw-vote"}));
  const drawn=await agreed;
  assert.equal(drawn.game.winner,"Draw by agreement");
  assert.equal(drawn.events.at(-1).kind,"draw");
  const secondRematch=nextMessage(red,x=>x.type==="state"&&x.revision===4);
  for(const ws of clients.slice(0,4))ws.send(JSON.stringify({type:"rematch"}));
  const newGame=await secondRematch;
  assert.equal(newGame.game.winner,null);
  assert.equal(newGame.archives.length,2);
  const archiveMessage=nextMessage(red,x=>x.type==="archive"&&x.archive.gameNo===2);
  red.send(JSON.stringify({type:"archive",gameNo:2}));
  const archive=await archiveMessage;
  assert.equal(archive.archive.winner,"Draw by agreement");
  assert.equal(archive.archive.events.at(-1).kind,"draw");
  const resigned=nextMessage(red,x=>x.type==="state"&&x.revision===5);
  red.send(JSON.stringify({type:"resign"}));
  const afterResign=await resigned;
  assert.equal(afterResign.game.alive[0],false);
  assert.equal(afterResign.game.turn,1);
  assert.equal(afterResign.events.at(-1).kind,"resign");
  // Players can relinquish unused seats before a lobby fills up.
  const lobby=await post("/api/rooms",{mode:"ffa"});
  const spectator=await post("/api/rooms/"+lobby.json.room+"/join",{});
  assert.equal(spectator.json.seat,1);
  const guest=new WebSocket("ws://127.0.0.1:"+port+"/ws");
  clients.push(guest);await once(guest,"open");
  const connected=nextMessage(guest,x=>x.type==="welcome");
  guest.send(JSON.stringify({type:"hello",room:spectator.json.room,seat:1,token:spectator.json.token}));
  await connected;
  const vacated=nextMessage(guest,x=>x.type==="vacated");
  guest.send(JSON.stringify({type:"vacate"}));
  await vacated;
  assert.equal(rooms.get(lobby.json.room).seats[1],null);
  const reclaimed=await post("/api/rooms/"+lobby.json.room+"/join",{});
  assert.equal(reclaimed.json.seat,1);
  timedRoom.clock.remaining[0]=1000;
  timedRoom.clock.activeSince=Date.now()-1100;
  assert.equal(await expireTurn(timedRoom,Date.now()),true);
  assert.equal(timedRoom.game.alive[0],false);
  assert.equal(timedRoom.game.turn,1);
  assert.equal(timedRoom.clock.flag,null);
  assert.equal(timedRoom.clock.started,true);
 }finally{for(const ws of clients)ws.terminate();shutdown();}
});
