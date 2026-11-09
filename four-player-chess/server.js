"use strict";
const http=require("node:http");
const crypto=require("node:crypto");
const {WebSocketServer,WebSocket}=require("ws");
const engine=require("./engine.js");
const PORT=Number(process.env.PORT||3001);
const WEB_ORIGIN=process.env.WEB_ORIGIN||"https://quadra-chess.onrender.com";
const rooms=new Map(),rates=new Map(),MAX_ROOMS=200,ROOM_TTL=12*60*60*1000,MAX_BODY=2048;
const now=()=>Date.now();
function code(){let v;do{v=crypto.randomBytes(5).toString("hex").slice(0,7).toUpperCase();}while(rooms.has(v));return v;}
function token(){return crypto.randomBytes(32).toString("base64url");}
function allowedOrigin(origin){return !origin||origin===WEB_ORIGIN||/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);}
function headers(req){const origin=req.headers.origin;const h={"Content-Type":"application/json; charset=utf-8","Cache-Control":"no-store","X-Content-Type-Options":"nosniff"};if(allowedOrigin(origin)&&origin){h["Access-Control-Allow-Origin"]=origin;h["Vary"]="Origin";h["Access-Control-Allow-Methods"]="GET,POST,OPTIONS";h["Access-Control-Allow-Headers"]="Content-Type";}return h;}
function send(res,req,status,obj){res.writeHead(status,headers(req));res.end(JSON.stringify(obj));}
function limited(req){const ip=(req.socket.remoteAddress||"unknown"),t=now(),v=rates.get(ip)||{t,n:0};if(t-v.t>60000){v.t=t;v.n=0;}v.n++;rates.set(ip,v);return v.n>50;}
function body(req){return new Promise((resolve,reject)=>{let s="",bad=false;req.on("data",chunk=>{s+=chunk;if(s.length>MAX_BODY&&!bad){bad=true;reject(Error("Request too large."));req.destroy();}});req.on("end",()=>{if(bad)return;try{resolve(s?JSON.parse(s):{});}catch(e){reject(Error("Invalid JSON."));}});req.on("error",reject);});}
function createRoom(mode){const id=code(),secret=token();const room={id,game:engine.fresh(mode),rev:0,seats:[{token:secret,ws:null},null,null,null],created:now(),updated:now()};rooms.set(id,room);return {room:id,seat:0,token:secret,revision:0,mode};}
function joinRoom(id){const r=rooms.get(id);if(!r)throw Object.assign(Error("Room expired or not found."),{code:404});const seat=r.seats.findIndex(s=>s===null);if(seat<0)throw Object.assign(Error("All four seats are taken."),{code:409});const secret=token();r.seats[seat]={token:secret,ws:null};r.updated=now();broadcast(r);return {room:r.id,seat,token:secret,revision:r.rev,mode:r.game.mode};}
function ready(r){return r.seats.every(Boolean);}
function snapshot(r){return {type:"state",room:r.id,revision:r.rev,ready:ready(r),seats:r.seats.map((s,i)=>({color:i,claimed:!!s,online:!!(s&&s.ws&&s.ws.readyState===WebSocket.OPEN)})),game:engine.publicState(r.game)};}
function emit(ws,obj){if(ws&&ws.readyState===WebSocket.OPEN)ws.send(JSON.stringify(obj));}
function broadcast(r){const payload=JSON.stringify(snapshot(r));for(const s of r.seats)if(s&&s.ws&&s.ws.readyState===WebSocket.OPEN)s.ws.send(payload);}
function authenticate(ws,msg){if(!msg||msg.type!=="hello"||typeof msg.room!=="string"||!Number.isInteger(msg.seat)||typeof msg.token!=="string")return false;const r=rooms.get(msg.room.toUpperCase());if(!r||msg.seat<0||msg.seat>3)return false;const s=r.seats[msg.seat];if(!s||s.token.length!==msg.token.length||!crypto.timingSafeEqual(Buffer.from(s.token),Buffer.from(msg.token)))return false;if(s.ws&&s.ws!==ws&&s.ws.readyState===WebSocket.OPEN)s.ws.close(4001,"Reconnected on another device");s.ws=ws;ws.room=r;ws.seat=msg.seat;r.updated=now();emit(ws,{type:"welcome",room:r.id,seat:msg.seat});broadcast(r);return true;}
const app=http.createServer(async(req,res)=>{const path=(req.url||"").split("?")[0];if(req.method==="OPTIONS"){if(!allowedOrigin(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});res.writeHead(204,headers(req));res.end();return;}
if(!allowedOrigin(req.headers.origin))return send(res,req,403,{error:"Origin not allowed."});
if(path==="/health"&&req.method==="GET")return send(res,req,200,{ok:true,rooms:rooms.size,protocol:1});
if(limited(req))return send(res,req,429,{error:"Too many requests. Try again soon."});
try{
 if(path==="/api/rooms"&&req.method==="POST"){if(rooms.size>=MAX_ROOMS)return send(res,req,503,{error:"Room capacity reached."});const data=await body(req);if(!["ffa","teams"].includes(data.mode))return send(res,req,400,{error:"Invalid game format."});return send(res,req,201,createRoom(data.mode));}
 const m=path.match(/^\/api\/rooms\/([0-9A-Fa-f]{7})(?:\/(join))?$/);
 if(m){const id=m[1].toUpperCase();if(req.method==="GET"&&!m[2]){const r=rooms.get(id);return r?send(res,req,200,{room:id,mode:r.game.mode,claimed:r.seats.map(Boolean),revision:r.rev,ready:ready(r)}):send(res,req,404,{error:"Room not found."});}
 if(req.method==="POST"&&m[2]){await body(req);try{return send(res,req,200,joinRoom(id));}catch(e){return send(res,req,e.code||400,{error:e.message});}}}
 return send(res,req,404,{error:"Not found."});
}catch(e){return send(res,req,400,{error:e.message||"Invalid request."});}
});
const wss=new WebSocketServer({noServer:true,maxPayload:4096,perMessageDeflate:false});
app.on("upgrade",(req,socket,head)=>{if(req.url!=="/ws"||!allowedOrigin(req.headers.origin)){socket.write("HTTP/1.1 403 Forbidden\r\n\r\n");socket.destroy();return;}wss.handleUpgrade(req,socket,head,ws=>wss.emit("connection",ws,req));});
wss.on("connection",ws=>{ws.isAlive=true;ws.received=0;ws.window=now();const authTimeout=setTimeout(()=>{if(!ws.room)ws.close(4003,"Authentication required");},10000);ws.on("pong",()=>{ws.isAlive=true;});ws.on("message",raw=>{let msg;try{msg=JSON.parse(raw.toString());}catch(e){return emit(ws,{type:"error",error:"Invalid message."});}
const t=now();if(t-ws.window>10000){ws.window=t;ws.received=0;}if(++ws.received>40)return ws.close(4008,"Rate limit");if(!ws.room){if(!authenticate(ws,msg))ws.close(4003,"Invalid room credentials");else clearTimeout(authTimeout);return;}
const r=ws.room;r.updated=t;if(msg.type==="ping")return emit(ws,{type:"pong"});if(msg.type==="sync")return emit(ws,snapshot(r));if(msg.type!=="move")return emit(ws,{type:"error",error:"Unknown action."});if(!ready(r))return emit(ws,{type:"error",error:"Wait for all four players."});if(msg.revision!==r.rev)return emit(ws,{type:"error",error:"Position changed; syncing.",revision:r.rev}),emit(ws,snapshot(r));
try{r.game=engine.acceptMove(r.game,{from:msg.from,to:msg.to,promotion:msg.promotion},ws.seat);r.rev++;broadcast(r);}catch(e){emit(ws,{type:"error",error:e.message});emit(ws,snapshot(r));}
});
ws.on("close",()=>{clearTimeout(authTimeout);const r=ws.room;if(r&&r.seats[ws.seat]?.ws===ws){r.seats[ws.seat].ws=null;broadcast(r);}});ws.on("error",()=>{});
});
const pingTimer=setInterval(()=>{for(const ws of wss.clients){if(!ws.isAlive){ws.terminate();continue;}ws.isAlive=false;ws.ping();}},30000);
const cleanupTimer=setInterval(()=>{const t=now();for(const [id,r] of rooms)if(t-r.updated>ROOM_TTL){for(const s of r.seats)if(s?.ws)s.ws.close(4004,"Room expired");rooms.delete(id);}for(const [ip,v] of rates)if(t-v.t>120000)rates.delete(ip);},60000);
function shutdown(){clearInterval(pingTimer);clearInterval(cleanupTimer);for(const ws of wss.clients)ws.close(1012,"Service restarting");app.close();}
if(require.main===module)app.listen(PORT,"0.0.0.0",()=>console.log("Quadra Chess API on",PORT));
process.on("SIGTERM",shutdown);
module.exports={app,wss,rooms,createRoom,joinRoom,snapshot,shutdown};
