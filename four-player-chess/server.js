"use strict";
const http=require("node:http");
const crypto=require("node:crypto");
const {WebSocketServer,WebSocket}=require("ws");
const engine=require("./engine.js");
const variants=require("./variants.js");
const Clock=require("./clock.js");
const {createAuth}=require("./auth.js");
const {createCommunity}=require("./community.js");
const Social=require("./room-social.js");
const {createStore,ROOM_TTL}=require("./store.js");
const PORT=Number(process.env.PORT||3001);
const WEB_ORIGIN=process.env.WEB_ORIGIN||"https://quadra-chess.onrender.com";
const MAX_ROOMS=200,MAX_BODY=2048;
const rooms=new Map(),rates=new Map(),store=createStore(),auth=createAuth(store),community=createCommunity(store),authRates=new Map();
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
  h["Access-Control-Allow-Methods"]="GET,POST,DELETE,OPTIONS";h["Access-Control-Allow-Headers"]="Content-Type,Authorization";
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
function sealedSeat(raw,ws=null,account=null){return {tokenHash:sha(raw),ws,lastSeen:now(),userId:account?.id||null,alias:account?.username||null};}
function seatSummary(r){return r.seats.map((s,i)=>({color:i,claimed:!!s,online:!!(s?.ws&&s.ws.readyState===WebSocket.OPEN),ready:!!r.seatReady[i],alias:s?.alias||null}));}
const filled=r=>r.seats.every(Boolean);
const ready=r=>!!r.started;
function snapshot(r){
 const t=now();
 return {type:"state",protocol:2,room:r.id,revision:r.rev,variant:r.variant,persistent:store.persistent,serverNow:t,
 ready:ready(r),filled:filled(r),seatReady:r.seatReady.slice(),title:r.title,
 visibility:r.visibility||"private",rated:!!r.rated,hostSeat:r.hostSeat??0,spectatorCount:r.spectators?.size||0,
 messages:Social.publicMessages(r.messages),mutedUsers:(r.mutedUsers||[]).length,
 rematch:r.rematch.slice(),drawVotes:r.drawVotes.slice(),events:r.events,gameNo:r.gameNo,
 archives:r.archives.map(a=>({gameNo:a.gameNo,winner:a.winner,endedAt:a.endedAt,moveCount:a.moves.length,clock:a.clock})),
 seats:seatSummary(r),clock:Clock.visible(r.clock,r.game.turn,t),
 game:engine.publicState(r.game)};
}
function emit(ws,data){if(ws?.readyState===WebSocket.OPEN)ws.send(JSON.stringify(data));}
function broadcast(r){
 const payload=JSON.stringify(snapshot(r));
 for(const seat of r.seats)if(seat?.ws?.readyState===WebSocket.OPEN)seat.ws.send(payload);
 for(const spectator of r.spectators||[])if(spectator.readyState===WebSocket.OPEN)spectator.send(payload);
}
function lockRoom(r,fn){
 const job=r.lock.then(fn,fn);
 r.lock=job.catch(()=>{});
 return job;
}
async function commitRoom(r,next){
 await store.save(next);
 r.rev=next.rev;r.game=next.game;r.variant=next.variant;r.seats=next.seats;r.clock=next.clock;
 r.rematch=next.rematch;r.drawVotes=next.drawVotes;r.events=next.events;r.archives=next.archives;r.gameNo=next.gameNo;
 r.started=next.started;r.seatReady=next.seatReady;r.title=next.title;r.updated=next.updated;
 r.visibility=next.visibility;r.rated=next.rated;r.hostSeat=next.hostSeat;r.spectatorHash=next.spectatorHash;
 r.messages=next.messages;r.reports=next.reports;r.mutedUsers=next.mutedUsers;
 if(r.game.winner&&r.rated){
  try{r.ratingResult=await community.record(r);}catch(e){console.error("Rating update failed for room",r.id,e.message);}
 }
 broadcast(r);
}
function chooseVariant(data){
 if(data.variant){const v=variants.byId(data.variant);if(!v)throw Error("Unknown variant.");if(data.mode&&data.mode!==v.mode)throw Error("Incompatible variant and format.");return v;}
 return variants.byMode(data.mode);
}
function preferredSeat(input,defaultSeat=null){
 if(input===undefined||input===null||input==="")return defaultSeat;
 if(!Number.isInteger(input)||input<0||input>3)throw Object.assign(Error("Invalid color selection."),{code:400});
 return input;
}
function roomTitle(input){
 if(input===undefined||input===null||input==="")return "";
 if(typeof input!=="string"||input.length>40||!(/^[a-zA-Z0-9 _.,!?'()-]+$/).test(input))throw Object.assign(Error("Room title must be under 40 characters and use ordinary text."),{code:400});
 return input.trim();
}
function clockChoice(spec){return Clock.normalize(spec??"untimed");}
async function createRoom(mode,clockSpec="untimed",variantId=null,options={}){
 const v=chooseVariant({mode,variant:variantId});
 if(!v)throw Object.assign(Error("Unknown game format."),{code:400});
 const clock=Clock.create(clockSpec);
 if(rooms.size>=MAX_ROOMS)throw Object.assign(Error("Room capacity reached."),{code:503});
 const seat=preferredSeat(options.seat,0),title=roomTitle(options.title);
 const visibility=options.visibility==="public"?"public":"private",rated=!!options.rated;
 if(rated&&!options.account)throw Object.assign(Error("Sign in to create a rated room."),{code:401});
 const roomId=id(),secret=token(),spectatorKey=token(),t=now(),seats=[null,null,null,null];
 seats[seat]=sealedSeat(secret,null,options.account);
 const r={id:roomId,rev:0,variant:v.id,game:variants.createGame(v.id,engine),
  seats,clock,rematch:[false,false,false,false],started:false,seatReady:[false,false,false,false],title,visibility,rated,hostSeat:seat,spectatorHash:sha(spectatorKey),
  spectators:new Set(),messages:[],reports:{},mutedUsers:[],
  created:t,updated:t,lock:Promise.resolve(),events:[],archives:[],gameNo:1,drawVotes:[false,false,false,false]};
 await store.save(r);rooms.set(roomId,r);
 return {room:roomId,seat,token:secret,revision:0,mode:v.mode,variant:v.id,clock:clock.preset,
 clockSettings:{preset:clock.preset,initialMs:clock.initialMs,incrementMs:clock.incrementMs},persistent:store.persistent,title,visibility,rated,spectatorKey};
}
async function joinRoom(roomId,options={}){
 const r=rooms.get(roomId);
 if(!r)throw Object.assign(Error("Room not found or expired."),{code:404});
 return lockRoom(r,async()=>{
  if(r.started)throw Object.assign(Error("This match has already started. You can watch until the next round."),{code:409});
  if(r.rated&&!options.account)throw Object.assign(Error("Sign in to join rated rooms."),{code:401});
  if(options.account&&r.seats.some(s=>s?.userId===options.account.id))throw Object.assign(Error("Your account already owns a seat in this room. Reconnect from Account."),{code:409});
  const chosen=preferredSeat(options.seat,null);
  const seat=chosen===null?r.seats.findIndex(s=>!s):chosen;
  if(seat<0||r.seats[seat])throw Object.assign(Error(chosen===null?"All four seats are taken.":"That color is already claimed."),{code:409});
  const secret=token(),t=now(),seats=r.seats.slice();
  seats[seat]=sealedSeat(secret,null,options.account);
  await commitRoom(r,{...r,seats,seatReady:r.seatReady.slice(),updated:t});
  return {room:roomId,seat,token:secret,revision:r.rev,mode:r.game.mode,variant:r.variant,clock:r.clock.preset,
  clockSettings:{preset:r.clock.preset,initialMs:r.clock.initialMs,incrementMs:r.clock.incrementMs},persistent:store.persistent,title:r.title,visibility:r.visibility,rated:r.rated};
 });
}
async function authentic(ws,msg){
 if(msg?.type!=="hello"||typeof msg.room!=="string"||!Number.isInteger(msg.seat))return false;
 const r=rooms.get(msg.room.toUpperCase());
 if(!r||msg.seat<0||msg.seat>3)return false;
 const seat=r.seats[msg.seat];if(!seat?.tokenHash)return false;
 let allowed=false;
 if(typeof msg.token==="string"&&msg.token.length>=32&&msg.token.length<=128){
  const hashed=sha(msg.token);
  allowed=hashed.length===seat.tokenHash.length&&crypto.timingSafeEqual(Buffer.from(hashed),Buffer.from(seat.tokenHash));
 }
 if(!allowed&&typeof msg.session==="string"&&seat.userId){
  const account=await auth.verify(msg.session);
  allowed=!!account&&account.id===seat.userId;
 }
 if(!allowed)return false;
 if(seat.ws&&seat.ws!==ws&&seat.ws.readyState===WebSocket.OPEN)seat.ws.close(4001,"Connected from another browser");
 seat.ws=ws;seat.lastSeen=now();ws.room=r;ws.seat=msg.seat;ws.spectator=false;
 ws.sessionUser=typeof msg.session==="string"?await auth.verify(msg.session):null;
 r.updated=now();
 emit(ws,{type:"welcome",room:r.id,seat:msg.seat,protocol:3,persistent:store.persistent});
 broadcast(r);return true;
}
async function handleReady(r,seat,ws,affirm=true){
 await lockRoom(r,async()=>{
  if(r.started)return emit(ws,snapshot(r));
  if(!r.seats[seat]||r.seats[seat].ws!==ws)return emit(ws,{type:"error",error:"This seat is not connected."});
  const seatReady=r.seatReady.slice();seatReady[seat]=!!affirm;
  const t=now(),everyone=filled(r)&&seatReady.every(Boolean)&&r.seats.every(s=>s?.ws?.readyState===WebSocket.OPEN);
  if(everyone&&r.rated&&r.seats.some(s=>!s?.userId))return emit(ws,{type:"error",error:"Every player needs a Quadra account for rated matches."});
  const next={...r,seatReady,updated:t};
  if(everyone){next.started=true;next.clock=Clock.copy(r.clock);Clock.start(next.clock,t);}
  try{await commitRoom(r,next);}catch(e){emit(ws,{type:"error",error:"Could not save readiness."});}
 });
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
   next=nextRound(r,{automatic:true});
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
  if(ready(r)&&!r.game.winner)return emit(ws,{type:"error",error:"A match is in progress. Resign or disconnect instead."});
  if(!r.seats[seat]||r.seats[seat].ws!==ws)return emit(ws,{type:"error",error:"You no longer own that seat."});
  const seats=r.seats.slice();seats[seat]=null;const seatReady=r.seatReady.slice();seatReady[seat]=false;
  const nextHost=seat===r.hostSeat?(seats.findIndex(Boolean)<0?seat:seats.findIndex(Boolean)):r.hostSeat;
  try{
   await commitRoom(r,{...r,seats,hostSeat:nextHost,seatReady,updated:now()});
   emit(ws,{type:"vacated"});ws.close(1000,"Seat released");
  }catch(e){emit(ws,{type:"error",error:"Could not release your seat. Retry when connected."});}
 });
}
const LOBBY_RECLAIM_MS=30*60*1000;
async function reclaimLobbySeats(r,t=now()){
 if(ready(r)||r.game.moves.length)return 0;
 return lockRoom(r,async()=>{
  if(ready(r))return 0;
  const seats=r.seats.slice();
  let count=0;
  for(let i=0;i<4;i++){
   const seat=seats[i];
   if(seat&&!seat.ws&&t-(seat.lastSeen||r.updated)>LOBBY_RECLAIM_MS){
    seats[i]=null;count++;
   }
  }
  if(count)await commitRoom(r,{...r,seats,hostSeat:seats[r.hostSeat]?r.hostSeat:Math.max(0,seats.findIndex(Boolean)),seatReady:seats.map((s,i)=>!!s&&r.seatReady[i]),updated:t});
  return count;
 });
}
function sendArchive(r,gameNo,ws){
 if(!Number.isInteger(gameNo))return emit(ws,{type:"error",error:"Invalid archive request."});
 const a=r.archives.find(x=>x.gameNo===gameNo);
 if(!a)return emit(ws,{type:"error",error:"Archived game not found."});
 emit(ws,{type:"archive",archive:{...a}});
}
function spectatorAuthorized(r,key){
 if(r.visibility==="public")return true;
 if(typeof key!=="string"||key.length!==43||!r.spectatorHash)return false;
 const hashed=sha(key);
 return hashed.length===r.spectatorHash.length&&crypto.timingSafeEqual(Buffer.from(hashed),Buffer.from(r.spectatorHash));
}
function watchRoom(ws,msg){
 if(msg?.type!=="watch"||typeof msg.room!=="string")return false;
 const room=rooms.get(msg.room.toUpperCase());
 if(!room||!spectatorAuthorized(room,msg.key))return false;
 if((room.spectators?.size||0)>=25){emit(ws,{type:"error",error:"The room's spectator capacity is full."});return false;}
 room.spectators??=new Set();
 room.spectators.add(ws);ws.room=room;ws.seat=-1;ws.spectator=true;
 emit(ws,{type:"welcome",room:room.id,seat:null,spectator:true,protocol:4});
 broadcast(room);return true;
}
async function handleRoomChat(r,ws,msg){
 const account=ws.sessionUser;
 if(ws.spectator||!account||r.seats[ws.seat]?.userId!==account.id)return emit(ws,{type:"error",error:"Sign in as a seated player to use room chat."});
 await lockRoom(r,async()=>{
  try{
   const messages=Social.appendMessage(r,account,msg.text,ws.seat,now());
   const validIds=new Set(messages.map(m=>m.id));
   const reports=Object.fromEntries(Object.entries(r.reports||{}).filter(([id])=>validIds.has(id)));
   await commitRoom(r,{...r,messages,reports,updated:now()});
  }catch(e){emit(ws,{type:"error",error:e.message});}
 });
}
async function handleChatReport(r,ws,msg){
 const account=ws.sessionUser;
 if(!account||ws.spectator||r.seats[ws.seat]?.userId!==account.id)return emit(ws,{type:"error",error:"Only signed-in room participants can report messages."});
 await lockRoom(r,async()=>{
  try{
   const result=Social.reportMessage(r,msg.id,account.id);
   await commitRoom(r,{...r,messages:result.messages,reports:result.reports,updated:now()});
   emit(ws,{type:"notice",message:"Report received. Thank you."});
  }catch(e){emit(ws,{type:"error",error:e.message});}
 });
}
async function handleModeration(r,ws,msg){
 const account=ws.sessionUser;
 if(!account||ws.spectator)return emit(ws,{type:"error",error:"Host account required."});
 await lockRoom(r,async()=>{
  try{
   const result=Social.moderate(r,account.id,msg.id||msg.target,msg.action);
   await commitRoom(r,{...r,messages:result.messages,mutedUsers:result.mutedUsers,updated:now()});
  }catch(e){emit(ws,{type:"error",error:e.message});}
 });
}
function nextRound(r,{automatic=false}={}){
 const game=variants.createGame(r.variant,engine);
 const clock=Clock.create(r.clock.preset==="custom"?{type:"custom",minutes:r.clock.initialMs/60000,incrementSeconds:r.clock.incrementMs/1000}:r.clock.preset);
 const archive={gameNo:r.gameNo,winner:r.game.winner,mode:r.game.mode,clock:r.clock.preset,endedAt:now(),
  moves:r.game.moves.map(m=>({...m})),events:r.events};
 const next={...r,game,clock,rev:r.rev+1,started:automatic,seatReady:automatic?[true,true,true,true]:[false,false,false,false],
  rematch:[false,false,false,false],drawVotes:[false,false,false,false],
  archives:[...r.archives,archive].slice(-8),events:[],gameNo:r.gameNo+1,updated:now()};
 if(automatic)Clock.start(next.clock,next.updated);
 return next;
}
async function handleNewRound(r,ws){
 await lockRoom(r,async()=>{
  if(!r.game.winner)return emit(ws,{type:"error",error:"Finish the current match first."});
  if(ws.spectator||ws.seat!==r.hostSeat)return emit(ws,{type:"error",error:"Only the room host can open the next round."});
  try{await commitRoom(r,nextRound(r));}
  catch(e){emit(ws,{type:"error",error:"Could not create the next round."});}
 });
}
async function rotateSpectatorKey(r,ws){
 if(ws.spectator||ws.seat!==r.hostSeat)return emit(ws,{type:"error",error:"Host permission required."});
 await lockRoom(r,async()=>{
  const key=token();
  try{
   await commitRoom(r,{...r,spectatorHash:sha(key),updated:now()});
   for(const spectator of r.spectators||[])spectator.close(4009,"Spectator link changed");
   emit(ws,{type:"spectator-key",key});
  }catch(e){emit(ws,{type:"error",error:"Could not update spectator link."});}
 });
}
function publicRoomSummary(r,ratings){
 const users=r.seats.map(s=>s?.userId).filter(Boolean);
 const numeric=users.map(id=>ratings?.get(id)?.rating||1200);
 return {room:r.id,title:r.title||"Quadra room",mode:r.game.mode,visibility:r.visibility,
 rated:!!r.rated,gameNo:r.gameNo,started:r.started,finished:!!r.game.winner,
 players:r.seats.filter(Boolean).length,connected:r.seats.filter(s=>s?.ws?.readyState===WebSocket.OPEN).length,
 spectatorCount:r.spectators?.size||0,averageRating:numeric.length?Math.round(numeric.reduce((a,b)=>a+b,0)/numeric.length):null,
 variant:r.variant,clock:r.clock.preset,updated:r.updated};
}
async function listPublicRooms(){
 const items=[...rooms.values()].filter(r=>r.visibility==="public").slice(0,100);
 const ids=[...new Set(items.flatMap(r=>r.seats.map(s=>s?.userId).filter(Boolean)))];
 const [ffa,teams]=await Promise.all([community.ratings(ids,"ffa"),community.ratings(ids,"teams")]);
 return items.map(r=>publicRoomSummary(r,r.game.mode==="teams"?teams:ffa))
  .sort((a,b)=>(b.players>0?1:0)-(a.players>0?1:0)||b.players-a.players||b.updated-a.updated);
}
function requestToken(req){
 const hdr=req.headers.authorization;
 if(!hdr)return null;
 const match=/^Bearer ([A-Za-z0-9_-]{43})$/.exec(hdr);
 if(!match)throw Object.assign(Error("Invalid account session."),{code:401});
 return match[1];
}
async function optionalAccount(req){
 const token=requestToken(req);
 if(!token)return null;
 const user=await auth.verify(token);
 if(!user)throw Object.assign(Error("Your account session has expired. Sign in again."),{code:401});
 return user;
}
function authRateLimit(req){
 const ip=req.socket.remoteAddress||"unknown",t=now(),value=authRates.get(ip)||{t,n:0};
 if(t-value.t>900000){value.t=t;value.n=0;}
 value.n++;authRates.set(ip,value);
 return value.n>12;
}
function accountRooms(user){
 return [...rooms.values()].map(r=>{
  const seat=r.seats.findIndex(s=>s?.userId===user.id);
  if(seat<0)return null;
  return {room:r.id,seat,title:r.title,variant:r.variant,mode:r.game.mode,started:r.started,
   finished:!!r.game.winner,turn:r.game.turn,clock:r.clock.preset,updated:r.updated,gameNo:r.gameNo};
 }).filter(Boolean).sort((a,b)=>b.updated-a.updated).slice(0,20);
}
const app=http.createServer(async(req,res)=>{
 const path=(req.url||"").split("?")[0];
 if(req.method==="OPTIONS"){
  if(!permitted(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});
  res.writeHead(204,headers(req));res.end();return;
 }
 if(!permitted(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});
 if(path==="/health"&&req.method==="GET")return send(res,req,200,{ok:true,rooms:rooms.size,protocol:3,accounts:auth.enabled,storage:store.persistent?"postgres":"memory"});
 if(limited(req))return send(res,req,429,{error:"Too many requests."});
 if(path==="/api/catalog"&&req.method==="GET")return send(res,req,200,{variants:variants.VARIANTS,clocks:Object.values(Clock.PRESETS),customTime:{minMinutes:1,maxMinutes:180,minIncrementSeconds:0,maxIncrementSeconds:60}});
 if(path==="/api/rooms/public"&&req.method==="GET"){
  try{return send(res,req,200,{rooms:await listPublicRooms()});}
  catch(e){return send(res,req,503,{error:"Could not load public rooms."});}
 }
 if(path==="/api/community/leaderboard"&&req.method==="GET"){
  try{const mode=new URL(req.url,"http://localhost").searchParams.get("mode")||"ffa";
   return send(res,req,200,{mode,players:await community.leaderboard(mode)});}
  catch(e){return send(res,req,503,{error:"Leaderboards are temporarily unavailable."});}
 }
 try{
  if(path.startsWith("/api/auth/")){
   if(!auth.enabled)return send(res,req,503,{error:"Accounts need persistent storage."});
   const action=path.slice("/api/auth/".length);
   if(req.method==="POST"&&["register","login","recover"].includes(action)){
    if(authRateLimit(req))return send(res,req,429,{error:"Too many sign-in attempts. Try later."});
    const body=await readBody(req),result=await auth[action](body);
    return send(res,req,action==="register"?201:200,result);
   }
   if(req.method==="GET"&&(action==="me"||action==="rooms")){
    const account=await optionalAccount(req);
    if(!account)return send(res,req,401,{error:"Sign in required."});
    return send(res,req,200,action==="rooms"?{rooms:accountRooms(account)}:{account,rooms:accountRooms(account),profile:await community.profile(account.id)});
   }
   if(req.method==="POST"&&action==="logout"){
    const token=requestToken(req);if(token)await auth.logout(token);
    return send(res,req,200,{ok:true});
   }
   if(req.method==="POST"&&action==="delete"){
    if(authRateLimit(req))return send(res,req,429,{error:"Too many attempts."});
    const token=requestToken(req),body=await readBody(req);
    const account=await auth.deleteAccount(token,body?.password);
    for(const room of rooms.values()){
     const seats=room.seats.map(seat=>seat?.userId===account.id?{...seat,userId:null,alias:null}:seat);
     if(room.seats.some(seat=>seat?.userId===account.id))await lockRoom(room,()=>commitRoom(room,{...room,seats,updated:now()}));
    }
    return send(res,req,200,{ok:true});
   }
   return send(res,req,404,{error:"Account route not found."});
  }
  if(path==="/api/rooms"&&req.method==="POST"){
   const body=await readBody(req);
   if(!body||!["ffa","teams"].includes(body.mode))return send(res,req,400,{error:"Invalid game format."});
   const account=await optionalAccount(req);
   const data=await createRoom(body.mode,body.clock??"untimed",body.variant||null,{seat:body.seat,title:body.title,visibility:body.visibility,rated:body.rated,account});
   return send(res,req,201,data);
  }
  const match=path.match(/^\/api\/rooms\/([A-F0-9]{7})(?:\/(join))?$/i);
  if(match){
   const room=match[1].toUpperCase();
   if(req.method==="GET"&&!match[2]){
    const r=rooms.get(room);
    return r?send(res,req,200,{room:r.id,variant:r.variant,mode:r.game.mode,claimed:r.seats.map(Boolean),
     revision:r.rev,ready:ready(r),filled:filled(r),title:r.title,clock:r.clock.preset,persistent:store.persistent}):send(res,req,404,{error:"Room not found."});
   }
   if(req.method==="POST"&&match[2]){
    const body=await readBody(req);
    try{return send(res,req,200,await joinRoom(room,{seat:body?.seat,account:await optionalAccount(req)}));}
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
  if(!ws.room){
   if(msg?.type==="watch"){
    if(!watchRoom(ws,msg))ws.close(4003,"Spectator access denied");else clearTimeout(timeout);
    return;
   }
   void authentic(ws,msg).then(ok=>{if(!ok)ws.close(4003,"Invalid room credentials");else clearTimeout(timeout);}).catch(()=>ws.close(4003,"Authentication error"));
   return;
  }
  const r=ws.room;r.updated=t;
  if(msg.type==="ping")return emit(ws,{type:"pong"});
  if(msg.type==="sync")return emit(ws,snapshot(r));
  if(ws.spectator){
   if(msg.type==="archive")return sendArchive(r,msg.gameNo,ws);
   return emit(ws,{type:"error",error:"Spectators have read-only access."});
  }
  if(msg.type==="chat")return void handleRoomChat(r,ws,msg).catch(()=>emit(ws,{type:"error",error:"Chat could not be saved."}));
  if(msg.type==="chat-report")return void handleChatReport(r,ws,msg).catch(()=>emit(ws,{type:"error",error:"Report failed."}));
  if(msg.type==="moderate")return void handleModeration(r,ws,msg).catch(()=>emit(ws,{type:"error",error:"Moderation failed."}));
  if(msg.type==="new-round")return void handleNewRound(r,ws).catch(()=>emit(ws,{type:"error",error:"New round could not start."}));
  if(msg.type==="spectator-key-rotate")return void rotateSpectatorKey(r,ws).catch(()=>emit(ws,{type:"error",error:"Could not update the spectator link."}));
  if(msg.type==="ready"||msg.type==="unready")return void handleReady(r,ws.seat,ws,msg.type==="ready").catch(()=>emit(ws,{type:"error",error:"Could not update readiness."}));
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
  if(ws.spectator&&r){r.spectators?.delete(ws);broadcast(r);return;}
  if(r?.seats[ws.seat]?.ws===ws){r.seats[ws.seat].ws=null;r.seats[ws.seat].lastSeen=now();
   if(!r.started&&r.seatReady[ws.seat])void lockRoom(r,async()=>{const votes=r.seatReady.slice();votes[ws.seat]=false;await commitRoom(r,{...r,seatReady:votes,updated:now()});}).catch(()=>broadcast(r));
   else broadcast(r);}
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
   for(const spectator of r.spectators||[])spectator.close(4004,"Room expired");
   rooms.delete(key);
  }
 }
 for(const r of rooms.values())if(!ready(r))reclaimLobbySeats(r,t).catch(err=>console.error("Lobby reclamation failed:",err.message));
 for(const [ip,v] of rates)if(t-v.t>120000)rates.delete(ip);
 for(const [ip,v] of authRates)if(t-v.t>900000)authRates.delete(ip);
 try{await auth.cleanup();}catch(e){console.error("Account session cleanup failed.");}
 try{await store.cleanup();}catch(e){console.error("Room cleanup failed:",e.message);}
},60000);
function shutdown(){
 clearInterval(heartbeat);clearInterval(ticker);clearInterval(cleanup);
 for(const ws of wss.clients)ws.close(1012,"Server restarting");
 app.close();store.close().catch(()=>{});
}
async function startServer(){
 await store.init();await auth.init();await community.init();
 for(const r of await store.load()){
  if(rooms.size>=MAX_ROOMS)break;
  if(!variants.byId(r.variant)||!r.game||!r.clock)continue;
  rooms.set(r.id,r);
 }
 app.listen(PORT,"0.0.0.0",()=>console.log("Quadra Chess API on",PORT,"storage:",store.persistent?"postgres":"memory","restored:",rooms.size));
}
if(require.main===module)startServer().catch(err=>{console.error("Server startup failed:",err.message);process.exitCode=1;});
process.on("SIGTERM",shutdown);
module.exports={app,wss,rooms,store,auth,community,createRoom,joinRoom,snapshot,shutdown,startServer,expireTurn,reclaimLobbySeats,LOBBY_RECLAIM_MS,handleReady,watchRoom,handleRoomChat,handleNewRound,listPublicRooms};
