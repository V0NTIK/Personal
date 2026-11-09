"use strict";
const http=require("node:http");
const crypto=require("node:crypto");
const {WebSocketServer,WebSocket}=require("ws");
const engine=require("./engine.js");
const variants=require("./variants.js");
const Clock=require("./clock.js");
const {createStore,ROOM_TTL}=require("./store.js");
const PORT=Number(process.env.PORT||3001);
const WEB_ORIGIN=process.env.WEB_ORIGIN||"https://quadra-chess.onrender.com";
const MAX_ROOMS=200,MAX_BODY=2048;
const rooms=new Map(),rates=new Map(),store=createStore();
const now=()=>Date.now();
const sha=token=>crypto.createHash("sha256").update(token).digest("hex");
const token=()=>crypto.randomBytes(32).toString("base64url");
function id(){
 let code;
 do{code=crypto.randomBytes(5).toString("hex").slice(0,7).toUpperCase();}while(rooms.has(code));
 return code;
}
function permitted(origin){return !origin||origin===WEB_ORIGIN||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function headers(req){
 const origin=req.headers.origin;
 const h={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};
 if(origin&&permitted(origin)){
  h["Access-Control-Allow-Origin"]=origin;h["Vary"]="Origin";
  h["Access-Control-Allow-Methods"]="GET,POST,OPTIONS";h["Access-Control-Allow-Headers"]="Content-Type";
 }
 return h;
}
function send(res,req,status,data){res.writeHead(status,headers(req));res.end(JSON.stringify(data));}
function limited(req){
 const ip=req.socket.remoteAddress||"unknown",t=now(),v=rates.get(ip)||{t,n:0};
 if(t-v.t>60000){v.t=t;v.n=0;}
 v.n++;rates.set(ip,v);return v.n>65;
}
function readBody(req){
 return new Promise((resolve,reject)=>{
  let str="",settled=false;
  req.on("data",chunk=>{
   str+=chunk;
   if(str.length>MAX_BODY&&!settled){settled=true;reject(Error("Request too large."));req.destroy();}
  });
  req.on("end",()=>{
   if(settled)return;
   try{resolve(str?JSON.parse(str):{});}catch(e){reject(Error("Invalid JSON."));}
  });
  req.on("error",e=>{if(!settled)reject(e);});
 });
}
function sealedSeat(raw,ws=null){return {tokenHash:sha(raw),ws};}
function seatSummary(r){return r.seats.map((s,i)=>({color:i,claimed:!!s,online:!!(s?.ws&&s.ws.readyState===WebSocket.OPEN)}));}
const ready=r=>r.seats.every(Boolean);
function snapshot(r){
 const t=now();
 return {type:"state",protocol:2,room:r.id,revision:r.rev,variant:r.variant,persistent:store.persistent,serverNow:t,
 ready:ready(r),rematch:r.rematch.slice(),drawVotes:r.drawVotes.slice(),events:r.events,gameNo:r.gameNo,
 archives:r.archives.map(a=>({gameNo:a.gameNo,winner:a.winner,endedAt:a.endedAt,moveCount:a.moves.length,clock:a.clock})),
 seats:seatSummary(r),clock:Clock.visible(r.clock,r.game.turn,t),
 game:engine.publicState(r.game)};
}
function emit(ws,data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function broadcast(r){
 const payload=JSON.stringify(snapshot(r));
 for(const seat of r.seats)if(seat?.ws?.readyState===WebSocket.OPEN)seat.ws.send(payload);
}
function lockRoom(r,fn){
 const job=r.lock.then(fn,fn);
 r.lock=job.catch(()=>{});
 return job;
}
async function commitRoom(r,next){
 await store.save(next);
 r.rev=next.rev;r.game=next.game;r.variant=next.variant;r.seats=next.seats;r.clock=next.clock;
 r.rematch=next.rematch;r.drawVotes=next.drawVotes;r.events=next.events;r.archives=next.archives;r.gameNo=next.gameNo;r.updated=next.updated;
 broadcast(r);
}
function chooseVariant(data){
 if(data.variant){const v=variants.byId(data.variant);if(!v)throw Error("Unknown variant.");if(data.mode&&data.mode!==v.mode)throw Error("Incompatible variant and format.");return v;}
 return variants.byMode(data.mode);
}
async function createRoom(mode,clockPreset="untimed",variantId=null){
 const v=chooseVariant({mode,variant:variantId});
 if(!v)throw Error("Unknown game format.");
 if(!Clock.preset(clockPreset))throw Error("Unknown time control.");
 if(rooms.size>=MAX_ROOMS)throw Object.assign(Error("Room capacity reached."),{code:503});
 const roomId=id(),secret=token(),t=now();
 const r={id:roomId,rev:0,variant:v.id,game:variants.createGame(v.id,engine),
  seats:[sealedSeat(secret),null,null,null],clock:Clock.create(clockPreset),rematch:[false,false,false,false],
  created:t,updated:t,lock:Promise.resolve(),events:[],archives:[],gameNo:1,drawVotes:[false,false,false,false]};
 await store.save(r);
 rooms.set(roomId,r);
 return {room:roomId,seat:0,token:secret,revision:0,mode:v.mode,variant:v.id,clock:clockPreset,persistent:store.persistent};
}
async function joinRoom(roomId){
 const r=rooms.get(roomId);
 if(!r)throw Object.assign(Error("Room not found or expired."),{code:404});
 return lockRoom(r,async()=>{
  const seat=r.seats.findIndex(s=>!s);
  if(seat<0)throw Object.assign(Error("All four seats are taken."),{code:409});
  const secret=token(),t=now(),seats=r.seats.slice();
  seats[seat]=sealedSeat(secret);
  const clock=Clock.copy(r.clock);
  if(seats.every(Boolean))Clock.start(clock,t);
  const next={...r,seats,clock,updated:t};
  await commitRoom(r,next);
  return {room:roomId,seat,token:secret,revision:r.rev,mode:r.game.mode,variant:r.variant,clock:r.clock.preset,persistent:store.persistent};
 });
}
function authentic(ws,msg){
 if(msg?.type!=="hello"||typeof msg.room!=="string"||!Number.isInteger(msg.seat)||typeof msg.token!=="string")return false;
 const r=rooms.get(msg.room.toUpperCase());
 if(!r||msg.seat<0||msg.seat>3)return false;
 const seat=r.seats[msg.seat];
 if(!seat?.tokenHash||msg.token.length<32||msg.token.length>128)return false;
 const hashed=sha(msg.token);
 if(hashed.length!==seat.tokenHash.length||!crypto.timingSafeEqual(Buffer.from(hashed),Buffer.from(seat.tokenHash)))return false;
 if(seat.ws&&seat.ws!==ws&&seat.ws.readyState===WebSocket.OPEN)seat.ws.close(4001,"Connected from another browser");
 seat.ws=ws;ws.room=r;ws.seat=msg.seat;r.updated=now();
 emit(ws,{type:"welcome",room:r.id,seat:msg.seat,protocol:2,persistent:store.persistent});
 broadcast(r);return true;
}
async function expireTurn(r,t=now()){
 if(r.game.winner||!r.clock?.started||r.clock.remaining===null)return false;
 if(Clock.visible(r.clock,r.game.turn,t).remaining[r.game.turn]>0)return false;
 const current={...r,clock:Clock.copy(r.clock),updated:t};
 const flag=Clock.settle(current.clock,r.game.turn,t);
 if(flag===null)return false;
 current.game=engine.eliminatePlayer(r.game,flag,"time");
 current.events=r.events&&[...r.events,{kind:"flag",player:flag}];
 current.drawVotes=[false,false,false,false];
 current.rev=r.rev+1;
 if(current.game.winner){current.clock.started=false;current.clock.activeSince=null;}else{current.clock.flag=null;current.clock.activeSince=t;}
 await commitRoom(r,current);
 return true;
}
async function handleMove(r,seat,msg){
 await lockRoom(r,async()=>{
  if(!ready(r))return emit(seat.ws,{type:"error",error:"Waiting for all four players."});
  if(msg.revision!==r.rev){emit(seat.ws,{type:"error",error:"Position changed; syncing.",revision:r.rev});return emit(seat.ws,snapshot(r));}
  try{
   const t=now();
   if(await expireTurn(r,t))return emit(seat.ws,{type:"error",error:"Your clock expired before that move was received."});
   const clock=Clock.copy(r.clock);
   if(clock.started)Clock.settle(clock,r.game.turn,t);
   const played=engine.acceptMove(r.game,{from:msg.from,to:msg.to,promotion:msg.promotion},seat.color);
   Clock.moved(clock,seat.color,t);
   if(played.winner){clock.started=false;clock.activeSince=null;}
   const next={...r,game:played,clock,rev:r.rev+1,updated:t,
    events:r.events&&[...r.events,{kind:"move",player:seat.color,from:msg.from,to:msg.to,...(msg.promotion?{promotion:msg.promotion}:{})}],
    drawVotes:[false,false,false,false]};
   await commitRoom(r,next);
  }catch(e){emit(seat.ws,{type:"error",error:e.message||"Move could not be saved."});emit(seat.ws,snapshot(r));}
 });
}
async function handleRematch(r,seat,ws){
 await lockRoom(r,async()=>{
  if(!ready(r)||!r.game.winner)return emit(ws,{type:"error",error:"Rematch voting is available after the game ends."});
  const votes=r.rematch.slice();
  if(votes[seat])return emit(ws,snapshot(r));
  votes[seat]=true;const t=now();
  let next={...r,rematch:votes,updated:t};
  if(votes.every(Boolean)){
   const archive={gameNo:r.gameNo,winner:r.game.winner,mode:r.game.mode,clock:r.clock.preset,
    endedAt:t,moves:r.game.moves.map(m=>({...m})),events:r.events};
   next={...next,game:variants.createGame(r.variant,engine),clock:Clock.create(r.clock.preset),
    rev:r.rev+1,rematch:[false,false,false,false],drawVotes:[false,false,false,false],
    archives:[...r.archives,archive].slice(-8),events:[],gameNo:r.gameNo+1};
   Clock.start(next.clock,t);
  }
  try{await commitRoom(r,next);}catch(e){emit(ws,{type:"error",error:"Could not save rematch vote."});}
 });
}
async function handleResign(r,seat,ws){
 await lockRoom(r,async()=>{
  if(!ready(r)||r.game.winner||!r.game.alive[seat])return emit(ws,{type:"error",error:"You cannot resign this game."});
  try{
   const t=now();
   if(await expireTurn(r,t))return emit(ws,{type:"error",error:"The turn expired before the resignation."});
   const clock=Clock.copy(r.clock),wasTurn=r.game.turn===seat;
   if(wasTurn&&clock.started)Clock.settle(clock,seat,t);
   const game=engine.eliminatePlayer(r.game,seat,"resign");
   if(game.winner){clock.started=false;clock.activeSince=null;}
   else if(wasTurn&&clock.started)clock.activeSince=t;
   const next={...r,game,clock,rev:r.rev+1,updated:t,
    events:r.events&&[...r.events,{kind:"resign",player:seat}],drawVotes:[false,false,false,false]};
   await commitRoom(r,next);
  }catch(e){emit(ws,{type:"error",error:"Resignation could not be saved."});}
 });
}
async function handleDrawVote(r,seat,ws){
 await lockRoom(r,async()=>{
  if(!ready(r)||r.game.winner||!r.game.alive[seat])return emit(ws,{type:"error",error:"Draw voting is unavailable."});
  if(r.drawVotes[seat])return emit(ws,snapshot(r));
  const t=now(),votes=r.drawVotes.slice();votes[seat]=true;
  const agreed=r.game.alive.every((alive,i)=>!alive||votes[i]);
  const next={...r,drawVotes:votes,updated:t};
  if(agreed){
   next.game=engine.concludeDraw(r.game);
   next.clock={...Clock.copy(r.clock),started:false,activeSince:null};
   next.rev=r.rev+1;next.events=r.events&&[...r.events,{kind:"draw"}];
  }
  try{await commitRoom(r,next);}catch(e){emit(ws,{type:"error",error:"Draw vote could not be saved."});}
 });
}
async function handleVacate(r,seat,ws){
 await lockRoom(r,async()=>{
  if(ready(r))return emit(ws,{type:"error",error:"The game has started. Use Resign to withdraw, or disconnect to return later."});
  if(!r.seats[seat]||r.seats[seat].ws!==ws)return emit(ws,{type:"error",error:"You no longer own that seat."});
  const seats=r.seats.slice();seats[seat]=null;
  try{
   await commitRoom(r,{...r,seats,updated:now()});
   emit(ws,{type:"vacated"});ws.close(1000,"Seat released");
  }catch(e){emit(ws,{type:"error",error:"Could not release your seat. Retry when connected."});}
 });
}
function sendArchive(r,gameNo,ws){
 if(!Number.isInteger(gameNo))return emit(ws,{type:"error",error:"Invalid archive request."});
 const a=r.archives.find(x=>x.gameNo===gameNo);
 if(!a)return emit(ws,{type:"error",error:"Archived game not found."});
 emit(ws,{type:"archive",archive:{...a}});
}
const app=http.createServer(async(req,res)=>{
 const path=(req.url||"").split("?")[0];
 if(req.method==="OPTIONS"){
  if(!permitted(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});
  res.writeHead(204,headers(req));res.end();return;
 }
 if(!permitted(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});
 if(path==="/health"&&req.method==="GET")return send(res,req,200,{ok:true,rooms:rooms.size,protocol:2,storage:store.persistent?"postgres":"memory"});
 if(limited(req))return send(res,req,429,{error:"Too many requests."});
 if(path==="/api/catalog"&&req.method==="GET")return send(res,req,200,{variants:variants.VARIANTS,clocks:Object.values(Clock.PRESETS)});
 try{
  if(path==="/api/rooms"&&req.method==="POST"){
   const body=await readBody(req);
   if(!body||!["ffa","teams"].includes(body.mode))return send(res,req,400,{error:"Invalid game format."});
   const data=await createRoom(body.mode,body.clock||"untimed",body.variant||null);
   return send(res,req,201,data);
  }
  const match=path.match(/^\/api\/rooms\/([A-F0-9]{7})(?:\/(join))?$/i);
  if(match){
   const room=match[1].toUpperCase();
   if(req.method==="GET"&&!match[2]){
    const r=rooms.get(room);
    return r?send(res,req,200,{room:r.id,variant:r.variant,mode:r.game.mode,claimed:r.seats.map(Boolean),
     revision:r.rev,ready:ready(r),clock:r.clock.preset,persistent:store.persistent}):send(res,req,404,{error:"Room not found."});
   }
   if(req.method==="POST"&&match[2]){
    await readBody(req);
    try{return send(res,req,200,await joinRoom(room));}
    catch(e){return send(res,req,e.code||400,{error:e.message});}
   }
  }
  return send(res,req,404,{error:"Not found."});
 }catch(e){return send(res,req,e.code||400,{error:e.message||"Invalid request."});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
app.on("upgrade",(req,socket,head)=>{
 if(req.url!=="/ws"||!permitted(req.headers.origin)){socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");socket.destroy();return;}
 wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));
});
wss.on("connection",ws=>{
 ws.isAlive=true;ws.received=0;ws.window=now();
 const timeout=setTimeout(()=>{if(!ws.room)ws.close(4003,"Authentication required");},10000);
 ws.on("pong",()=>{ws.isAlive=true;});
 ws.on("message",raw=>{
  let msg;try{msg=JSON.parse(raw.toString());}catch(e){return emit(ws,{type:"error",error:"Invalid message."});}
  const t=now();if(t-ws.window>10000){ws.window=t;ws.received=0;}
  if(++ws.received>40)return ws.close(4008,"Rate limit");
  if(!ws.room){if(!authentic(ws,msg))ws.close(4003,"Invalid room credentials");else clearTimeout(timeout);return;}
  const r=ws.room;r.updated=t;
  if(msg.type==="ping")return emit(ws,{type:"pong"});
  if(msg.type==="sync")return emit(ws,snapshot(r));
  if(msg.type==="rematch")return void handleRematch(r,ws.seat,ws).catch(()=>emit(ws,{type:"error",error:"Rematch failed."}));
  if(msg.type==="resign")return void handleResign(r,ws.seat,ws).catch(()=>emit(ws,{type:"error",error:"Resignation failed."}));
  if(msg.type==="draw-vote")return void handleDrawVote(r,ws.seat,ws).catch(()=>emit(ws,{type:"error",error:"Draw voting failed."}));
  if(msg.type==="vacate")return void handleVacate(r,ws.seat,ws).catch(()=>emit(ws,{type:"error",error:"Seat release failed."}));
  if(msg.type==="archive")return sendArchive(r,msg.gameNo,ws);
  if(msg.type!=="move")return emit(ws,{type:"error",error:"Unknown action."});
  return void handleMove(r,{color:ws.seat,ws},msg);
 });
 ws.on("close",()=>{
  clearTimeout(timeout);const r=ws.room;
  if(r?.seats[ws.seat]?.ws===ws){r.seats[ws.seat].ws=null;broadcast(r);}
 });
 ws.on("error",()=>{});
});
const heartbeat=setInterval(()=>{
 for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}
},30000);
const ticker=setInterval(()=>{
 const t=now();
 for(const r of rooms.values()){
  if(r.game.winner||!r.clock?.started||r.clock.remaining===null)continue;
  if(Clock.visible(r.clock,r.game.turn,t).remaining[r.game.turn]===0){
   lockRoom(r,()=>expireTurn(r,t)).catch(err=>console.error("Clock timeout persistence failed:",err.message));
  }
 }
},1000);
const cleanup=setInterval(async()=>{
 const t=now();
 for(const [key,r] of rooms){
  if(t-r.updated>ROOM_TTL){
   for(const s of r.seats)if(s?.ws)s.ws.close(4004,"Room expired");
   rooms.delete(key);
  }
 }
 for(const [ip,v] of rates)if(t-v.t>120000)rates.delete(ip);
 try{await store.cleanup();}catch(e){console.error("Room cleanup failed:",e.message);}
},60000);
function shutdown(){
 clearInterval(heartbeat);clearInterval(ticker);clearInterval(cleanup);
 for(const ws of wss.clients)ws.close(1012,"Server restarting");
 app.close();store.close().catch(()=>{});
}
async function startServer(){
 await store.init();
 for(const r of await store.load()){
  if(rooms.size>=MAX_ROOMS)break;
  if(!variants.byId(r.variant)||!r.game||!r.clock)continue;
  rooms.set(r.id,r);
 }
 app.listen(PORT,"0.0.0.0",()=>console.log("Quadra Chess API on",PORT,"storage:",store.persistent?"postgres":"memory","restored:",rooms.size));
}
if(require.main===module)startServer().catch(err=>{console.error("Server startup failed:",err.message);process.exitCode=1;});
process.on("SIGTERM",shutdown);
module.exports={app,wss,rooms,store,createRoom,joinRoom,snapshot,shutdown,startServer,expireTurn};
