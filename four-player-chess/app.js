(function(){
"use strict";
const E=window.QuadraCore;
if(!E)throw Error("Quadra game engine could not load.");
const {N,colors,names,glyph,score,idx,xy,valid,rotate,fresh,clone,threatened,isCheck,legal,finish,reachEnd,sqName,team,acceptMove}=E;
const $=id=>document.getElementById(id);
const boardEl=$("board"),playersEl=$("players"),historyEl=$("moves"),promotionEl=$("promotion");
const API="https://quadra-chess-api.onrender.com";
const AUTO_KEY="quadra-autosave-v3", SLOT_KEY="quadra-manual-v3", PREFS_KEY="quadra-prefs-v3", ROOM_KEY="quadra-online";
const palette={sage:["#e8ebdb","#91a5a1"],blue:["#dae6ed","#7994b1"],wood:["#f1dfbc","#a88b68"],mono:["#eaebe9","#89918f"]};
const playerColors=["#fa797e","#7fc1ff","#ffe084","#95e0b4"];
const pieceNames={k:"king",q:"queen",r:"rook",b:"bishop",n:"knight",p:"pawn"};
const initialPrefs={theme:"sage",hints:true,coords:true,follow:false};
let prefs={...initialPrefs};
let state=fresh("ffa"),stack=[],selected=-1,targets=[],pending=null,orientation=0;
let online=null,backup=null,retryTimer=null,reviewIndex=null,activePanel="play",playLocation="local",toastTimer=null;

function tell(message){
 const el=$("toast");el.textContent=message;el.classList.remove("hidden");
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>el.classList.add("hidden"),3300);
}
function onlineMessage(message){$("onlineStatus").textContent=message;}
function safeState(s){
 if(!s||!Array.isArray(s.b)||s.b.length!==N*N||!Array.isArray(s.alive)||s.alive.length!==4||!Array.isArray(s.moves)||s.moves.length>3000||!Number.isInteger(s.turn)||s.turn<0||s.turn>3||!["ffa","teams"].includes(s.mode))return false;
 return s.b.every(p=>p===null||(p&&"prnbqk".includes(p.p)&&p.p.length===1&&Number.isInteger(p.c)&&p.c>=0&&p.c<4&&typeof p.m==="boolean"));
}
function saveBundle(){return {version:3,state,stack:stack.slice(-1500),orientation,prefs,savedAt:Date.now()};}
function readBundle(value){
 if(!value||!safeState(value.state)||!Array.isArray(value.stack)||value.stack.length>1500||!value.stack.every(safeState))return false;
 state=value.state;stack=value.stack;reviewIndex=null;
 orientation=Number.isInteger(value.orientation)?((value.orientation%4)+4)%4:0;
 if(value.prefs&&typeof value.prefs==="object")prefs={...initialPrefs,...value.prefs};
 return true;
}
function saveAuto(){
 if(online)return;
 try{localStorage.setItem(AUTO_KEY,JSON.stringify(saveBundle()));}catch(e){}
}
function saveSettings(){
 try{localStorage.setItem(PREFS_KEY,JSON.stringify(prefs));}catch(e){}
 saveAuto();
}
function restoreAuto(){
 try{
  const raw=localStorage.getItem(AUTO_KEY);
  if(raw&&readBundle(JSON.parse(raw)))return true;
  const legacy=localStorage.getItem("quadra-v1");
  if(legacy&&readBundle(JSON.parse(legacy)))return true;
 }catch(e){}
 return false;
}
function reviewLength(){return online?(online.replayStates?.length?online.replayStates.length-1:0):stack.length;}
function viewState(){
 if(online&&reviewIndex!==null&&online.replayStates&&reviewIndex<online.replayStates.length-1)return online.replayStates[reviewIndex];
 if(!online&&reviewIndex!==null&&reviewIndex<stack.length)return stack[reviewIndex];
 return state;
}
function reviewing(){return reviewIndex!==null&&reviewIndex<reviewLength();}
function updateTheme(){
 const colors=palette[prefs.theme]||palette.sage;
 document.documentElement.style.setProperty("--board-light",colors[0]);
 document.documentElement.style.setProperty("--board-dark",colors[1]);
 $("boardtheme").value=palette[prefs.theme]?prefs.theme:"sage";
 $("showHints").checked=prefs.hints!==false;
 $("showCoords").checked=prefs.coords!==false;
 $("autoRotate").checked=!!prefs.follow;
}
function switchPanel(name,scroll){
 if(!["play","moves","settings","rules"].includes(name))return;
 activePanel=name;
 for(const id of ["play","moves","settings","rules"]){
  const active=id===name;
  $("panel-"+id).classList.toggle("hidden",!active);
  $("tab-"+id).setAttribute("aria-selected",String(active));
  $("tab-"+id).tabIndex=active?0:-1;
 }
 if(scroll&&window.matchMedia&&window.matchMedia("(max-width: 940px)").matches){
  $("controls").scrollIntoView({behavior:"smooth",block:"start"});
 }
}
function switchLocation(name){
 if(name==="local"&&online){tell("Leave your online room to return to local play.");return;}
 playLocation=name;
 $("localMode").setAttribute("aria-pressed",String(name==="local"));
 $("onlineMode").setAttribute("aria-pressed",String(name==="online"));
 $("localControls").classList.toggle("hidden",name!=="local");
 $("onlineControls").classList.toggle("hidden",name!=="online");
 updateRoom();
}
const CLOCK_NAMES={untimed:"Unlimited",blitz5:"5 min",rapid10:"10 min",rapid15:"15 min + 10 sec",classical30:"30 min"};
function formattedTime(ms){
 const sec=Math.ceil(Math.max(0,ms)/1000);
 const minutes=Math.floor(sec/60);
 const seconds=sec%60;
 return minutes+":"+String(seconds).padStart(2,"0");
}
function liveClockMs(color){
 const clock=online?.clock;
 if(!clock?.remaining||!Number.isFinite(clock.remaining[color]))return null;
 let value=clock.remaining[color];
 if(clock.started&&clock.flag===null&&state.turn===color&&clock.activeSince!==null&&online.connected&&online.ready){
  value-=Math.max(0,Date.now()-(online.clockReceivedAt||Date.now()));
 }
 return Math.max(0,value);
}
function updateTimers(){
 if(!online?.clock?.remaining)return;
 for(let c=0;c<4;c++){
  const item=playersEl.children[c];if(!item)continue;
  const el=item.querySelector?.(".clock-time")||item.children?.find?.(node=>node.className==="clock-time");
  if(!el)continue;
  const remaining=liveClockMs(c);
  if(remaining===null)continue;
  el.textContent=formattedTime(remaining);
  item.classList.toggle("clock-critical",remaining<=30000&&state.alive[c]);
  item.classList.toggle("clock-flagged",remaining<=0);
 }
}

function initialsMaterial(s,c){
 let n=0,pieces=0;
 for(const p of s.b)if(p&&p.c===c){n+=score[p.p];pieces++;}
 return {n,pieces};
}
function renderPlayers(g){
 playersEl.replaceChildren();
 for(let c=0;c<4;c++){
  const el=document.createElement("div");
  el.className="player"+(g.turn===c&&!g.winner?" active":"")+(!g.alive[c]?" eliminated":"")+(online?.seats?.[c]?.claimed&&!online.seats[c].online?" offline":"");
  const name=document.createElement("div");name.className="pname";
  const dot=document.createElement("span");dot.className="dot";dot.style.background=playerColors[c];
  name.append(dot,document.createTextNode(names[c]));
  if(online&&online.seat===c){const you=document.createElement("span");you.className="you-pill";you.textContent="YOU";name.append(you);}
  const info=document.createElement("small");
  const material=initialsMaterial(g,c);
  const teamName=g.mode==="teams"?" · Team "+(team(c)+1):"";
  const status=online?.seats?.[c]?.claimed?(online.seats[c].online?" · Online":" · Away"):"";
  info.textContent=g.alive[c]?material.pieces+" pcs · "+material.n+" pts"+teamName+status:"Eliminated";
  el.append(name,info);
  if(online?.clock?.remaining){const timer=document.createElement("strong");timer.className="clock-time";timer.textContent=formattedTime(liveClockMs(c));el.append(timer);}
  playersEl.append(el);
 }
}
function viewCoordToSquare(col,row){
 let x=col,y=row;
 for(let k=0;k<orientation;k++){const next=13-y;y=x;x=next;}
 return idx(x,y);
}
function renderBoard(g){
 boardEl.replaceChildren();
 const active=(!reviewing()&&!g.winner)&&(!online||(online.connected&&online.ready&&online.seat===g.turn&&!online.awaiting));
 const selectedTargets=active&&prefs.hints?new Set(targets.map(m=>m.to)):new Set();
 for(let j=0;j<N*N;j++){
  const col=j%N,row=Math.floor(j/N),i=viewCoordToSquare(col,row),[x,y]=xy(i);
  const playable=valid(x,y);
  const cell=document.createElement("button");
  cell.type="button";cell.className="square "+(!playable?"void":(x+y)%2?"dark":"light");
  cell.setAttribute("role","gridcell");
  cell.disabled=!playable;
  if(playable){
   const p=g.b[i];
   cell.dataset.square=String(i);
   cell.setAttribute("aria-label",sqName(i)+(p?" "+names[p.c]+" "+pieceNames[p.p]:" empty"));
   if(g.last&&(g.last.from===i||g.last.to===i))cell.classList.add("last");
   if(active&&selected===i)cell.classList.add("selected");
   if(selectedTargets.has(i))cell.classList.add(p?"capture":"candidate");
   if(p&&p.p==="k"&&isCheck(g,p.c)&&g.alive[p.c])cell.classList.add("check");
   if(p){const piece=document.createElement("span");piece.className="piece "+colors[p.c];piece.textContent=glyph[p.p];piece.setAttribute("aria-hidden","true");cell.append(piece);}
   if(prefs.coords&&(col===3||row===10)){const coord=document.createElement("span");coord.className="coords";coord.textContent=sqName(i);cell.append(coord);}
   cell.addEventListener("click",()=>clickSquare(i));
   cell.addEventListener("keydown",ev=>boardKey(ev,j));
  }
  boardEl.append(cell);
 }
}
function boardKey(event,visualIndex){
 const d={ArrowUp:[0,-1],ArrowDown:[0,1],ArrowLeft:[-1,0],ArrowRight:[1,0]}[event.key];
 if(!d)return;
 event.preventDefault();
 let x=visualIndex%N,y=Math.floor(visualIndex/N);
 for(let attempt=0;attempt<N;attempt++){
  x+=d[0];y+=d[1];if(x<0||y<0||x>=N||y>=N)break;
  const j=y*N+x,i=viewCoordToSquare(x,y);
  if(valid(...xy(i))){boardEl.children[j]?.focus();break;}
 }
}
function renderStatus(g){
 const viewing=reviewing();
 const check=g.alive[g.turn]&&isCheck(g,g.turn);
 let primary="";
 if(viewing)primary="Reviewing move "+reviewIndex+" of "+reviewLength();
 else if(online&&!online.connected)primary="Connecting to game…";
 else if(online&&!online.ready)primary="Waiting for players";
 else if(g.winner)primary=g.winner;
 else primary=names[g.turn]+" to move"+(check?" · Check":"");
 $("status").textContent=primary;
 const format=g.mode==="teams"?"Teams":"Free-for-all";
 $("statusSecondary").textContent=(online?"Online room "+online.room:"Local game")+" · "+format+(online?" · "+(CLOCK_NAMES[online.clockPreset]||"Unlimited"):"")+(viewing?" · Replay":"");
 $("currentRound").textContent="ROUND "+g.round;
 $("statusDot").className="status-dot"+(g.winner?" is-finished":online&&(!online.connected||!online.ready)?" is-waiting":"");
 let hint="Select a piece, then a highlighted square.";
 if(viewing)hint="Viewing an earlier position. Return to live to make moves.";
 else if(g.winner)hint="Game over. Open Moves to review the game.";
 else if(online&&!online.connected)hint="Reconnecting. Moves will resume when your connection returns.";
 else if(online&&!online.ready)hint="Invite friends until all four seats are filled.";
 else if(online&&g.turn!==online.seat)hint="It's "+names[g.turn]+"'s turn. You're playing "+names[online.seat]+".";
 else if(selected>=0)hint=targets.length?targets.length+" legal destinations. Choose one.":"This piece has no legal moves. Try another.";
 $("boardHint").textContent=hint;
}
function renderHistory(){
 historyEl.replaceChildren();
 const moves=state.moves;
 $("movecount").textContent="("+moves.length+")";
 if(!moves.length){const p=document.createElement("p");p.className="history-empty";p.textContent="The game record will appear here after the first move.";historyEl.append(p);}
 const activeStep=reviewIndex===null?moves.length:reviewIndex;
 for(let i=0;i<moves.length;i++){
  const move=moves[i],button=document.createElement("button");
  button.type="button";button.className="move"+(activeStep===i+1?" is-current":"");
  button.disabled=!!online&&!online.replayStates;
  const no=document.createElement("span");no.className="move-number";no.textContent=String(i+1).padStart(2,"0");
  const dot=document.createElement("span");dot.className="move-color";dot.style.background=playerColors[move.color]||"#899b9e";
  const label=document.createElement("span");label.textContent=move.notation;
  button.append(no,dot,label);
  button.addEventListener("click",()=>{if(online&&!online.replayStates)return;reviewIndex=i+1;selected=-1;targets=[];render();});
  historyEl.append(button);
 }
 const available=!online||!!online.replayStates;
 for(const id of ["reviewHome","reviewPrev","reviewNext","reviewLive"])$(id).disabled=!available||reviewLength()===0;
 $("reviewMessage").textContent=online&&!available?"Online replay unavailable for games recorded before this update":reviewing()?"Move "+reviewIndex+" / "+reviewLength()+" · Viewing history":"Live position · "+moves.length+" moves";
 renderArchives();
}
function renderArchives(){
 const section=$("onlineArchives"),list=$("archiveList");
 section.classList.toggle("hidden",!online||!online.archives?.length);
 list.replaceChildren();
 if(!online)return;
 for(const record of online.archives||[]){
  const row=document.createElement("div");row.className="archive-row";
  const meta=document.createElement("div");meta.className="archive-meta";
  const title=document.createElement("strong");title.textContent="Game "+record.gameNo+" · "+record.winner;
  const details=document.createElement("small");details.textContent=record.moveCount+" entries · "+new Date(record.endedAt).toLocaleDateString();
  meta.append(title,details);
  const download=document.createElement("button");download.type="button";download.className="button ghost";download.textContent="Export";
  download.addEventListener("click",()=>{if(online?.connected)online.ws.send(JSON.stringify({type:"archive",gameNo:record.gameNo}));else tell("Reconnect to export archived games.");});
  row.append(meta,download);list.append(row);
 }
}
function downloadRecord(record,file){
 const contents=JSON.stringify(record,null,2);
 if(typeof Blob==="undefined"||typeof URL?.createObjectURL!=="function"){
  navigator.clipboard?.writeText(contents).then(()=>tell("Game data copied."),()=>tell("Download is unsupported here."));return;
 }
 const blob=new Blob([contents],{type:"application/json"});
 const url=URL.createObjectURL(blob);
 const anchor=document.createElement("a");anchor.href=url;anchor.download=file;anchor.style.display="none";
 document.body.append(anchor);anchor.click();anchor.remove();
 setTimeout(()=>URL.revokeObjectURL(url),1000);
 tell("Game record downloaded.");
}
function currentExport(){
 return {format:"quadra-chess-game",version:1,exportedAt:new Date().toISOString(),
  variant:online?.variant|| (state.mode==="teams"?"quadra-teams":"quadra-ffa"),
  mode:state.mode,game:state,events:online?.events||null,gameNo:online?.gameNo||null,clock:online?.clockPreset||"untimed"};
}
function updateRoom(){
 const connected=!!online;
 $("roomDetails").classList.toggle("hidden",!connected);
 $("onlineLobby").classList.toggle("hidden",connected);
 $("createRoom").disabled=connected;
 $("joinRoom").disabled=connected;
 $("resumeRoom").classList.toggle("hidden",connected||!sessionCredentials());
 if(!connected)return;
 $("roomId").textContent=online.room;
 $("roomClockName").textContent=CLOCK_NAMES[online.clockPreset]||"Unlimited";
 $("roomStorage").textContent=online.persistent?"Database · beta":"Temporary memory";
 $("storageNotice").textContent=online.persistent?"Beta database storage is enabled. This free database expires December 9, 2026; export important games.":"This server currently stores rooms in memory. Games may disappear when it restarts.";
 $("rematchControls").classList.toggle("hidden",!state.winner);
 $("matchActions").classList.toggle("hidden",!online.ready||!!state.winner);
 $("resignRoom").disabled=!online.connected||!state.alive[online.seat];
 $("drawVote").disabled=!online.connected||!state.alive[online.seat]||!!online.drawVotes?.[online.seat];
 $("drawVote").textContent=online.drawVotes?.[online.seat]?"Draw vote submitted":"Offer / agree to draw";
 $("drawVotesStatus").textContent=(online.drawVotes||[]).filter(Boolean).length+" / "+state.alive.filter(Boolean).length+" active players agree";
 $("leaveRoom").textContent=online.ready?"Disconnect · keep my seat":"Leave lobby · release seat";
 if(state.winner){const votes=(online.rematch||[]).filter(Boolean).length;$("rematchVotes").textContent=votes+" / 4 players ready to restart";$("rematchRoom").disabled=!!online.rematch?.[online.seat]||!online.connected;$("rematchRoom").textContent=online.rematch?.[online.seat]?"Rematch vote sent":"Vote for rematch";}
 $("mySeat").textContent=names[online.seat];
 $("roomInput").value=online.room;
 const slots=$("roomSeats");slots.replaceChildren();
 for(let c=0;c<4;c++){
  const el=document.createElement("div");el.className="room-seat";
  const dot=document.createElement("span");dot.className="dot";dot.style.background=playerColors[c];
  const name=document.createElement("span");name.textContent=names[c]+(online.seat===c?" (you)":"");
  const status=document.createElement("em");
  status.textContent=online.seats[c]?.online?"Here":online.seats[c]?.claimed?"Away":"Open";
  el.append(dot,name,status);slots.append(el);
 }
}
function render(){
 const g=viewState();
 renderPlayers(g);renderBoard(g);renderStatus(g);renderHistory();updateTimers();
 $("undo").disabled=!!online||reviewing()||stack.length===0;
 $("mode").disabled=!!online;
 $("mode").value=state.mode;
 for(const id of ["new","save","load"])$(id).disabled=!!online;
 updateRoom();
}
function clickSquare(i){
 if(pending)return;
 if(reviewing()){tell("Return to live position before making a move.");return;}
 if(state.winner)return;
 if(online&&(!online.connected||!online.ready||online.awaiting||online.seat!==state.turn))return;
 const p=state.b[i];
 if(p&&p.c===state.turn){
  selected=selected===i?-1:i;targets=selected<0?[]:legal(state,state.turn).filter(m=>m.from===selected);
  render();return;
 }
 const m=targets.find(m=>m.to===i);
 if(m){
  const piece=state.b[m.from];
  if(piece.p==="p"&&reachEnd(m.to,piece.c)){pending=m;showPromotion();return;}
  commit(m);return;
 }
 selected=-1;targets=[];render();
}
function commit(m){
 if(online){
  if(online.awaiting||!online.connected||!online.ready||state.turn!==online.seat||online.ws?.readyState!==WebSocket.OPEN)return;
  online.awaiting=true;
  online.ws.send(JSON.stringify({type:"move",revision:online.rev,from:m.from,to:m.to,promotion:m.promotion||null}));
  selected=-1;targets=[];pending=null;promotionEl.classList.add("hidden");render();return;
 }
 try{
  const next=acceptMove(state,{from:m.from,to:m.to,...(m.promotion?{promotion:m.promotion}:{})},state.turn);
  stack.push(clone(state));state=next;reviewIndex=null;
  selected=-1;targets=[];pending=null;promotionEl.classList.add("hidden");
  if(prefs.follow)orientation=state.turn;
  saveAuto();render();
 }catch(e){tell(e.message||"Invalid move.");}
}
function showPromotion(){
 const box=$("promolist");box.replaceChildren();
 for(const p of ["q","r","b","n"]){
  const button=document.createElement("button");button.type="button";button.className="button ghost";
  const icon=document.createElement("span");icon.className="promo-glyph";icon.textContent=glyph[p];
  const title=document.createElement("span");title.textContent=pieceNames[p];
  button.append(icon,title);button.addEventListener("click",()=>{if(pending)commit({...pending,promotion:p});});
  box.append(button);
 }
 promotionEl.classList.remove("hidden");
 box.firstElementChild?.focus();
}
function newGame(mode){
 if(online)return;
 if(state.moves.length&&!confirm("Start a new game? Your current local position will be replaced."))return;
 state=fresh(mode);stack=[];reviewIndex=null;selected=-1;targets=[];pending=null;
 orientation=prefs.follow?0:orientation;saveAuto();render();tell("New game started.");
}
function loadSlot(){
 if(online)return;
 try{
  const raw=localStorage.getItem(SLOT_KEY)||localStorage.getItem("quadra-v1");
  if(!raw||!readBundle(JSON.parse(raw)))throw Error("No valid saved game found.");
  saveAuto();updateTheme();render();tell("Saved game restored.");
 }catch(e){tell(e.message||"Could not load the saved game.");}
}
function saveSlot(){
 if(online)return;
 try{localStorage.setItem(SLOT_KEY,JSON.stringify(saveBundle()));tell("Game saved on this device.");}
 catch(e){tell("Unable to save to this browser.");}
}
function reviewStep(step){
 if(online&&!online.replayStates){tell("This game was started before online replay recording was enabled.");return;}
 const length=reviewLength(),current=reviewIndex===null?length:reviewIndex;
 const next=Math.max(0,Math.min(length,step==="first"?0:step==="previous"?current-1:step==="next"?current+1:length));
 reviewIndex=next===length?null:next;selected=-1;targets=[];render();
}
function exportRecord(){
 const out="Quadra Chess · "+(state.mode==="teams"?"Teams":"Free-for-all")+"\n"+state.moves.map((m,i)=>(i+1)+". "+m.notation).join("\n")+"\n"+(state.winner||"Game in progress");
 navigator.clipboard?.writeText(out).then(()=>tell("Game record copied."),()=>prompt("Copy game record:",out)).catch(()=>prompt("Copy game record:",out));
 if(!navigator.clipboard)prompt("Copy game record:",out);
}
function sessionCredentials(){
 try{
  const v=JSON.parse(sessionStorage.getItem(ROOM_KEY)||"null");
  return v&&typeof v.room==="string"&&/^[A-F0-9]{7}$/.test(v.room)&&Number.isInteger(v.seat)&&v.seat>=0&&v.seat<4&&typeof v.token==="string"&&v.token.length>=32?v:null;
 }catch(e){return null;}
}
function connectRoom(data){
 if(online)return;
 saveAuto();
 backup={state:clone(state),stack:stack.map(clone),orientation};
 const s={room:data.room,seat:data.seat,token:data.token,ws:null,rev:0,ready:false,connected:false,awaiting:false,rematch:[false,false,false,false],drawVotes:[false,false,false,false],events:null,replayStates:null,archives:[],gameNo:1,seats:[{},{},{},{}],attempts:0,closed:false,clock:null,clockReceivedAt:Date.now(),clockPreset:data.clock||"untimed",persistent:!!data.persistent,variant:data.variant||null};
 online=s;playLocation="online";reviewIndex=null;selected=-1;targets=[];pending=null;orientation=s.seat;
 try{sessionStorage.setItem(ROOM_KEY,JSON.stringify({room:s.room,seat:s.seat,token:s.token}));}catch(e){}
 switchLocation("online");switchPanel("play");render();
 function socketConnect(){
  if(online!==s||s.closed)return;
  onlineMessage("Connecting securely to room "+s.room+"…");
  let ws;
  try{ws=new WebSocket(API.replace(/^http/,"ws")+"/ws");}catch(e){onlineMessage("Unable to start the connection.");return;}
  s.ws=ws;
  ws.onopen=()=>{if(online===s)ws.send(JSON.stringify({type:"hello",room:s.room,seat:s.seat,token:s.token}));};
  ws.onmessage=event=>{
   if(online!==s)return;let msg;try{msg=JSON.parse(event.data);}catch(e){return;}
   if(msg.type==="welcome"){s.connected=true;s.attempts=0;onlineMessage("Connected as "+names[s.seat]+".");render();return;}
   if(msg.type==="error"){s.awaiting=false;onlineMessage("Server: "+msg.error);render();return;}
   if(msg.type==="vacated"){leaveRoom(true);return;}
   if(msg.type==="archive"&&msg.archive){
    const a=msg.archive;
    downloadRecord({format:"quadra-chess-game",version:1,room:s.room,variant:s.variant,
      gameNo:a.gameNo,mode:a.mode,result:a.winner,moves:a.moves,events:a.events,endedAt:a.endedAt},
      "quadra-"+s.room+"-game-"+a.gameNo+".json");return;
   }
   if(msg.type==="state"){
    s.rev=msg.revision;s.seats=msg.seats||s.seats;s.rematch=msg.rematch||s.rematch;s.drawVotes=msg.drawVotes||s.drawVotes;
    s.archives=msg.archives||[];s.gameNo=msg.gameNo||1;s.events=msg.events;s.ready=!!msg.ready;s.awaiting=false;s.clock=msg.clock||null;s.clockReceivedAt=Date.now();s.persistent=!!msg.persistent;s.variant=msg.variant||s.variant; if(s.clock)s.clockPreset=s.clock.preset;
    if(safeState(msg.game))state=msg.game;
    const positions=window.QuadraReplay?.replay(s.events,state.mode,E);
    s.replayStates=positions&&positions.length===state.moves.length+1?positions:null;
    reviewIndex=null;selected=-1;targets=[];render();
    onlineMessage(s.ready?"Ready · "+s.seats.filter(v=>v.online).length+" players connected":"Lobby · "+s.seats.filter(v=>v.claimed).length+" of 4 seats claimed");
    return;
   }
  };
  ws.onclose=event=>{
   if(online!==s||s.closed)return;s.connected=false;s.awaiting=false;render();
   if(event.code===4003||event.code===4004){onlineMessage("Room expired or credentials rejected. Leave the room to start again.");return;}
   const delay=Math.min(30000,1000*Math.pow(2,Math.min(5,s.attempts++)));
   onlineMessage("Connection interrupted · reconnecting…");retryTimer=setTimeout(socketConnect,delay);
  };
  ws.onerror=()=>onlineMessage("Network issue · reconnecting if needed.");
 }
 socketConnect();
}
async function roomRequest(path,payload){
 const controller=new AbortController();
 const timeout=setTimeout(()=>controller.abort(),90000);
 try{
  const response=await fetch(API+path,{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify(payload),signal:controller.signal});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Room request failed.");
  return data;
 }finally{clearTimeout(timeout);}
}
async function enterRoom(which){
 if(online)return;
 const button=$(which==="create"?"createRoom":"joinRoom");button.disabled=true;
 onlineMessage("Starting the multiplayer service…");
 try{
  const room=$("roomInput").value.trim().toUpperCase();
  if(which==="join"&&!/^[A-F0-9]{7}$/.test(room))throw Error("Enter a valid seven-character room code.");
  const data=which==="create"?await roomRequest("/api/rooms",{mode:$("onlineFormat").value,clock:$("onlineClock").value}):await roomRequest("/api/rooms/"+room+"/join",{});
  connectRoom(data);tell("Private room joined.");
 }catch(e){onlineMessage(e.name==="AbortError"?"Server did not respond. Please try again.":"Unable to join: "+e.message);}
 finally{button.disabled=!!online;}
}
function leaveRoom(vacated=false){
 if(!online)return;
 const s=online;
 if(!vacated&&!s.ready&&s.connected&&s.ws?.readyState===WebSocket.OPEN){
  s.ws.send(JSON.stringify({type:"vacate"}));onlineMessage("Releasing your unused seat…");return;
 }
 const keepCredentials=s.ready||(!vacated&&!s.connected);
 s.closed=true;if(retryTimer)clearTimeout(retryTimer);s.ws?.close();
 online=null;
 if(!keepCredentials)try{sessionStorage.removeItem(ROOM_KEY);}catch(e){}
 if(backup){state=backup.state;stack=backup.stack;orientation=backup.orientation;}
 else{state=fresh("ffa");stack=[];}
 backup=null;reviewIndex=null;selected=-1;targets=[];pending=null;
 switchLocation("local");render();
 tell(keepCredentials?"Disconnected. Your seat is reserved; reconnect from this tab.":"Lobby seat released. Back to local play.");
}
function copyInvite(){
 if(!online)return;
 const url=location.origin+location.pathname+"?room="+online.room;
 if(!navigator.clipboard){prompt("Copy invitation link:",url);return;}
 navigator.clipboard.writeText(url).then(()=>tell("Invitation link copied."),()=>prompt("Copy invitation link:",url));
}
function bind(){
 for(const button of document.querySelectorAll("[data-tab]"))button.addEventListener("click",()=>switchPanel(button.dataset.tab,false));
 $("headerHelp").addEventListener("click",()=>switchPanel("rules",true));
 $("localMode").addEventListener("click",()=>switchLocation("local"));
 $("onlineMode").addEventListener("click",()=>switchLocation("online"));
 $("new").addEventListener("click",()=>newGame($("mode").value));
 $("mode").addEventListener("change",event=>{
  if(online){event.target.value=state.mode;return;}
  if(state.moves.length&&!confirm("Changing the format starts a new game. Continue?")){event.target.value=state.mode;return;}
  state=fresh(event.target.value);stack=[];reviewIndex=null;selected=-1;targets=[];orientation=prefs.follow?0:orientation;saveAuto();render();
 });
 $("undo").addEventListener("click",()=>{if(online||reviewing()||!stack.length)return;state=stack.pop();reviewIndex=null;selected=-1;targets=[];if(prefs.follow)orientation=state.turn;saveAuto();render();});
 $("flip").addEventListener("click",()=>{orientation=(orientation+1)%4;render();saveAuto();});
 $("save").addEventListener("click",saveSlot);
 $("load").addEventListener("click",loadSlot);
 $("export").addEventListener("click",exportRecord);
 $("downloadGame").addEventListener("click",()=>downloadRecord(currentExport(),"quadra-game-"+(online?.room||"local")+".json"));
 $("reviewHome").addEventListener("click",()=>reviewStep("first"));
 $("reviewPrev").addEventListener("click",()=>reviewStep("previous"));
 $("reviewNext").addEventListener("click",()=>reviewStep("next"));
 $("reviewLive").addEventListener("click",()=>reviewStep("live"));
 $("boardtheme").addEventListener("change",e=>{prefs.theme=e.target.value;updateTheme();saveSettings();render();});
 for(const [id,key] of [["showHints","hints"],["showCoords","coords"],["autoRotate","follow"]]){
  $(id).addEventListener("change",e=>{prefs[key]=e.target.checked;if(key==="follow"&&prefs.follow&&!online)orientation=state.turn;updateTheme();saveSettings();render();});
 }
 $("resetPreferences").addEventListener("click",()=>{prefs={...initialPrefs};updateTheme();saveSettings();render();tell("Appearance reset.");});
 $("cancelpromo").addEventListener("click",()=>{pending=null;promotionEl.classList.add("hidden");});
 $("createRoom").addEventListener("click",()=>enterRoom("create"));
 $("joinRoom").addEventListener("click",()=>enterRoom("join"));
 $("roomInput").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-F0-9]/g,"").slice(0,7);});
 $("copyInvite").addEventListener("click",copyInvite);
 $("rematchRoom").addEventListener("click",()=>{if(!online||!online.connected||!state.winner||online.rematch?.[online.seat])return;online.ws.send(JSON.stringify({type:"rematch"}));tell("Rematch vote sent.");});
 $("drawVote").addEventListener("click",()=>{
  if(!online?.connected||!online.ready||state.winner||!state.alive[online.seat]||online.drawVotes?.[online.seat])return;
  online.ws.send(JSON.stringify({type:"draw-vote"}));tell("Draw offer submitted.");
 });
 $("resignRoom").addEventListener("click",()=>{
  if(!online?.connected||!online.ready||state.winner||!state.alive[online.seat])return;
  if(!confirm("Resign as "+names[online.seat]+"? This cannot be undone."))return;
  online.ws.send(JSON.stringify({type:"resign"}));
 });
 $("leaveRoom").addEventListener("click",leaveRoom);
 $("resumeRoom").addEventListener("click",()=>{const v=sessionCredentials();if(v)connectRoom(v);else onlineMessage("No recent room available for this tab.");});
 document.addEventListener("keydown",e=>{
  if(e.key==="Escape"){if(pending){pending=null;promotionEl.classList.add("hidden");}selected=-1;targets=[];render();}
  if((e.ctrlKey||e.metaKey)&&e.key.toLowerCase()==="z"&&!online&&!reviewing()&&stack.length){e.preventDefault();state=stack.pop();selected=-1;targets=[];saveAuto();render();}
 });
 window.addEventListener("beforeunload",()=>{if(!online)saveAuto();});
 setInterval(()=>{if(online?.ws?.readyState===WebSocket.OPEN)online.ws.send(JSON.stringify({type:"ping"}));},25000);
 setInterval(updateTimers,300);
}
function init(){
 try{const old=JSON.parse(localStorage.getItem(PREFS_KEY)||"null");if(old&&typeof old==="object")prefs={...initialPrefs,...old};}catch(e){}
 const resumed=restoreAuto();updateTheme();bind();
 if(resumed&&prefs.follow)orientation=state.turn;
 const invited=new URLSearchParams(location.search).get("room");
 if(invited&&/^[A-F0-9]{7}$/i.test(invited)){
  $("roomInput").value=invited.toUpperCase();switchLocation("online");onlineMessage("Invitation detected. Select Join room to take a seat.");
 }
 render();
 if(resumed&&state.moves.length)tell("Your local game was restored.");
}
init();
window.QuadraApp={getState:()=>state,getReviewIndex:()=>reviewIndex,changePanel:switchPanel};
window.QuadraEngine={fresh,legal,acceptMove,finish,threatened,isCheck,valid,rotate};
})();
