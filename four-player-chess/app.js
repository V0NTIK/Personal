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
let online=null,backup=null,retryTimer=null,reviewIndex=null,activePanel="home",playLocation="local",toastTimer=null;

function tell(message){
 const el=$("toast");el.textContent=message;el.classList.remove("hidden");
 if(toastTimer)clearTimeout(toastTimer);
 toastTimer=setTimeout(()=>el.classList.add("hidden"),3300);
}
function onlineMessage(message){
 $("onlineStatus").textContent=message;
 $("setupStatus").textContent=message;
 if(activePanel==="waiting")$("waitingStatus").textContent=message;
}
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
const PANELS=["rooms","local","create","play","moves","review","community","settings","rules","account","admin"];
const ROOM_SCREENS=new Set(["waiting","play","moves","review"]);
function roomScreen(){return online?(online.ready?"play":"waiting"):"create";}
function switchPanel(requested,scroll=false){
 let name=requested==="room"?roomScreen():requested;
 if(name==="play"&&!online)name="local";
 if(online&&!online.ready&&["play","moves","review"].includes(name))name="waiting";
 if(name==="waiting"&&!online)name="create";
 if(name==="local"&&online){tell("Leave your current room before starting a local game.");return;}
 if(name==="create"&&online){tell("Leave your current room before creating or joining another.");return;}
 if(name!=="home"&&name!=="waiting"&&!PANELS.includes(name))return;
 if(name==="admin"&&window.QuadraAccount?.role?.()!=="superuser"){tell("Superuser sign-in required.");return;}
 activePanel=name;
 const isHome=name==="home",isWaiting=name==="waiting",isMatch=["play","moves","review"].includes(name)&&!!online;
 const boardVisible=name==="local"||["play","moves","review"].includes(name);
 $("homeScreen").classList.toggle("hidden",!isHome);
 $("waitingRoomScreen").classList.toggle("hidden",!isWaiting);
 $("workLayout").classList.toggle("hidden",isHome||isWaiting);
 $("arena").classList.toggle("hidden",!boardVisible);
 $("gameNavigation").classList.toggle("hidden",!boardVisible);
 $("arenaTitle").textContent=isMatch?"Online match":"Local four-player chess";
 $("arenaSubtitle").textContent=isMatch?"Live board · "+(online?.room||"Room"):"Pass & play on one board";
 if(document.body?.dataset)document.body.dataset.screen=name;
 for(const id of PANELS){
  const active=id===name;
  $("panel-"+id).classList.toggle("hidden",!active);
  $("tab-"+id).setAttribute("aria-selected",String(active));
  $("tab-"+id).tabIndex=active?0:-1;
 }
 const details=$("roomDetails"),target=isWaiting?$("waitingRoomContent"):$("onlineControls");
 if(target&&details&&details.parentElement!==target)target.append(details);
 $("headerRoom").classList.toggle("hidden",!online);
 $("headerRoom").textContent=online?"My room · "+online.room:"My room";
 const headers={home:"headerHome",rooms:"headerRooms",local:"headerPlay",create:"headerCreate",
  waiting:"headerRoom",play:isMatch?"headerRoom":"headerPlay",
  moves:isMatch?"headerRoom":"headerPlay",review:isMatch?"headerRoom":"headerPlay",
  community:"headerLeaders",rules:"headerHelp",settings:"headerSettings",account:"headerAccount",admin:"headerAdmin"};
 for(const id of ["headerHome","headerRooms","headerPlay","headerCreate","headerRoom","headerLeaders","headerHelp","headerSettings","headerAccount","headerAdmin"]){
  $(id).setAttribute("aria-current",headers[name]===id?"page":"false");
 }
 for(const [id,dest] of [["navGame",isMatch?"play":"local"],["navMoves","moves"],["navReview","review"]]){
  $(id).setAttribute("aria-current",name===dest?"page":"false");
 }
 if(name==="home")window.QuadraCommunity?.loadStats?.();
 if(name==="rooms")window.QuadraCommunity?.loadRooms?.();
 if(name==="community")window.QuadraCommunity?.loadLeaders?.();
 if(name==="review")window.QuadraCommunity?.refreshReview?.();
 if(name==="admin")window.QuadraAccount?.refreshAdmin?.();
 if(scroll&&window.matchMedia?.("(max-width: 940px)").matches){
  (isWaiting?$("waitingRoomScreen"):boardVisible?$("arena"):$("controls")).scrollIntoView({behavior:"smooth",block:"start"});
 }
}
function switchLocation(name){
 if(name==="local"){
  if(online){tell("Leave your room before local play.");return;}
  playLocation="local";switchPanel("local");return;
 }
 if(name==="online"){playLocation="online";switchPanel(roomScreen());}
}
const CLOCK_NAMES={untimed:"Unlimited",bullet1:"1 min",bullet1inc:"1 | 1",bullet2inc:"2 | 1",
 blitz3:"3 min",blitz3inc:"3 | 2",blitz5:"5 min",blitz5inc:"5 | 5",rapid10:"10 min",rapid10inc:"10 | 5",
 rapid15:"15 | 10",classical30:"30 min",custom:"Custom"};
function clockLabel(session){
 if(!session)return "Unlimited";
 if(session.clockPreset==="custom"){
  const base=session.clockSettings?.initialMs??session.clock?.initialMs;
  const increment=session.clockSettings?.incrementMs??session.clock?.incrementMs;
  return Number.isFinite(base)?Math.round(base/60000)+" | "+Math.round((increment||0)/1000):"Custom";
 }
 return CLOCK_NAMES[session.clockPreset]||"Unlimited";
}
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
function superuserBadge(){
 const badge=document.createElement("span");
 badge.className="superuser-badge";badge.textContent="✦ Superuser";
 badge.setAttribute("aria-label","Superuser");
 badge.setAttribute("title","Quadra Chess superuser");
 return badge;
}
function renderPlayers(g){
 playersEl.replaceChildren();
 for(let c=0;c<4;c++){
  const el=document.createElement("div");
  el.className="player"+(g.turn===c&&!g.winner?" active":"")+(!g.alive[c]?" eliminated":"")+(online?.seats?.[c]?.claimed&&!online.seats[c].online?" offline":"");
  const name=document.createElement("div");name.className="pname";
  const dot=document.createElement("span");dot.className="dot";dot.style.background=playerColors[c];
  name.append(dot,document.createTextNode(names[c]));
  if(online&&!online.spectator&&online.seat===c){const you=document.createElement("span");you.className="you-pill";you.textContent="YOU";name.append(you);}
  
  const info=document.createElement("small");
  const material=initialsMaterial(g,c);
  const teamName=g.mode==="teams"?" · Team "+(team(c)+1):"";
  const status=online?(online.seats?.[c]?.claimed?(online.seats[c].ready?" · Ready":online.seats[c].online?" · Here":" · Away"):" · Open"):"";
  info.textContent=(online?.seats?.[c]?.alias?"@"+online.seats[c].alias+" · ":"")+(g.alive[c]?material.pieces+" pcs · "+material.n+" pts"+teamName+status:"Eliminated");
  el.append(name,info);
  if(online?.seats?.[c]?.role==="superuser")el.append(superuserBadge());
  if(online?.hostSeat===c){const host=document.createElement("span");host.className="host-tag";host.textContent="HOST";name.append(host);}
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
 else if(online&&!online.ready)primary=online.filled?"Waiting for everyone to get ready":"Waiting for players";
 else if(g.winner)primary=g.winner;
 else primary=names[g.turn]+" to move"+(check?" · Check":"");
 $("status").textContent=primary;
 const format=g.mode==="teams"?"Teams":"Free-for-all";
 $("statusSecondary").textContent=(online?"Online room "+online.room:"Local game")+" · "+format+(online?" · "+clockLabel(online):"")+(viewing?" · Replay":"");
 $("currentRound").textContent="ROUND "+g.round;
 $("statusDot").className="status-dot"+(g.winner?" is-finished":online&&(!online.connected||!online.ready)?" is-waiting":"");
 let hint="Select a piece, then a highlighted square.";
 if(viewing)hint="Viewing an earlier position. Return to live to make moves.";
 else if(g.winner)hint="Game over. Open Moves to review the game.";
 else if(online&&!online.connected)hint="Reconnecting. Moves will resume when your connection returns.";
 else if(online&&!online.ready)hint=online.filled?"All four players must press Ready to start.":"Invite friends to claim the remaining seats.";
 else if(online?.spectator)hint="Spectator view · "+names[g.turn]+" is to move. You cannot make moves.";
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
function localReplayFrames(){
 const frames=[...stack,state];
 if(frames.length===1||frames[0].moves.length!==0)return [state];
 const expanded=[frames[0]];
 for(let i=1;i<frames.length;i++){
  const delta=frames[i].moves.length-frames[i-1].moves.length;
  if(delta<1)return [state];
  for(let j=0;j<delta;j++)expanded.push(frames[i]);
 }
 return expanded.length===state.moves.length+1?expanded:[state];
}
function currentExport(){
 return {format:"quadra-chess-game",version:1,exportedAt:new Date().toISOString(),
  variant:online?.variant|| (state.mode==="teams"?"quadra-teams":"quadra-ffa"),
  mode:state.mode,game:state,events:online?.events||null,positions:online?null:localReplayFrames(),gameNo:online?.gameNo||null,clock:online?.clockPreset||"untimed"};
}
const hiddenChatIds=new Set();
function renderChat(){
 const host=$("chatList");host.replaceChildren();
 if(!online)return;
 const messages=online.messages||[];
 if(!messages.length){const p=document.createElement("p");p.className="history-empty";p.textContent="No messages yet. Conversation history remains in this room between matches.";host.append(p);return;}
 const username=window.QuadraAccount?.username();
 const canReport=!!username&&!online.spectator&&online.seats[online.seat]?.alias===username;
 const isHost=!online.spectator&&online.seat===online.hostSeat;
 for(const m of messages){
  const el=document.createElement("article");el.className="chat-message"+(m.hidden?" removed":"");
  const heading=document.createElement("div");heading.className="chat-byline";
  const name=document.createElement("strong");name.textContent=m.alias?"@"+m.alias:"Player";
  const time=document.createElement("span");time.textContent=new Date(m.at).toLocaleTimeString([],{hour:"numeric",minute:"2-digit"});
  heading.append(name,time);
  const text=document.createElement("p");text.className="chat-text";
  text.textContent=hiddenChatIds.has(m.id)?"Hidden on this device":m.text;
  const actions=document.createElement("div");actions.className="chat-actions";
  if(!m.hidden){
   const hide=document.createElement("button");hide.type="button";hide.textContent="Hide";
   hide.addEventListener("click",()=>{hiddenChatIds.add(m.id);renderChat();});actions.append(hide);
   if(canReport&&m.alias!==username){
    const report=document.createElement("button");report.type="button";report.textContent="Report";
    report.addEventListener("click",()=>{if(online?.connected){online.ws.send(JSON.stringify({type:"chat-report",id:m.id}));tell("Message reported.");}});
    actions.append(report);
   }
   if(isHost){
    const remove=document.createElement("button");remove.type="button";remove.textContent="Remove";
    remove.addEventListener("click",()=>online?.ws?.send(JSON.stringify({type:"moderate",action:"remove",id:m.id})));
    const mute=document.createElement("button");mute.type="button";mute.textContent="Mute";
    mute.addEventListener("click",()=>{if(confirm("Mute @"+m.alias+" from this room?"))online?.ws?.send(JSON.stringify({type:"moderate",action:"mute",id:m.id}));});
    actions.append(remove,mute);
   }
  }
  el.append(heading,text,actions);host.append(el);
 }
 if(Number.isFinite(host.scrollHeight))host.scrollTop=host.scrollHeight;
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
 $("roomDisplayTitle").textContent=online.title||"Quadra chess room";
 $("roomAccessLabel").textContent=(online.visibility==="public"?"PUBLIC":"PRIVATE")+" ROOM";
 $("roomModeLabel").textContent=(online.visibility==="public"?"Public":"Private")+" · "+(online.rated?"Provisional rated":"Casual");
 $("roomSpectators").textContent=(online.spectatorCount||0)+" watching";
  const host=online.seats[online.hostSeat];
  $("roomHost").textContent=(host?.alias?"@"+host.alias:"Guest host")+(online.seat===online.hostSeat&&!online.spectator?" · You":"");
  const audience=$("roomSpectatorList");audience.replaceChildren();
  if(!online.spectators?.length){const no=document.createElement("span");no.textContent=(online.spectatorCount||0)>0?"Other viewers are guests.":"No signed-in spectators yet.";audience.append(no);}
  else for(const viewer of online.spectators){
   const line=document.createElement("div");line.className="spectator-entry";line.textContent="@"+viewer.username;
   if(viewer.role==="superuser")line.append(superuserBadge());
   audience.append(line);
  }
 $("waitingRoomName").textContent=online.title||"Room "+online.room;
  $("waitingRoomDescription").textContent=online.spectator?
   "You're watching the waiting room. The game board opens automatically when the match begins.":
   "Invite friends, claim your color, and press Ready. The game board opens only when everyone is connected and ready.";
  $("waitingOccupancy").textContent=online.seats.filter(seat=>seat.claimed).length+" / 4";
  $("waitingReadyCount").textContent=(online.seatReady||[]).filter(Boolean).length+" / 4";
  $("waitingAudience").textContent=String(online.spectatorCount||0);
  $("waitingStatus").textContent=!online.connected?"Connecting to the room…":
   online.filled?"All four colors claimed · Waiting for Ready confirmations":"Waiting for more players to join";
 const isSpectator=!!online.spectator;
  const isHost=!isSpectator&&online.seat===online.hostSeat;
  $("hostSettings").classList.toggle("hidden",!isHost);
  for(const id of ["hostRoomFormat","hostRoomClock","hostRoomRated","hostCustomMinutes","hostCustomIncrement"])$(id).disabled=!!online.ready;
 $("copySpectatorInvite").disabled=online.visibility==="private"&&!online.spectatorKey;
 $("rotateWatchLink").classList.toggle("hidden",isSpectator||online.seat!==online.hostSeat);
 $("copyInvite").classList.toggle("hidden",isSpectator);
 $("nextRoundControls").classList.toggle("hidden",!state.winner||isSpectator||online.seat!==online.hostSeat);
 $("nextRound").disabled=!online.connected;
 $("chatComposer").classList.toggle("hidden",isSpectator||!window.QuadraAccount?.token());
 $("chatScopeLabel").textContent=isSpectator?"Watch-only · no posting":"Keeps going between matches";
 $("chatPolicy").textContent=isSpectator?"Spectators can read but cannot post.":"Only signed-in players can post. No links or personal contact details. Report inappropriate messages.";
 renderChat();
 $("readyControls").classList.toggle("hidden",online.ready||isSpectator);
 const readyCount=(online.seatReady||[]).filter(Boolean).length;
 $("readyStatus").textContent=online.ready?"Match started":readyCount+" of 4 ready · "+(online.filled?"Waiting for confirmation":"Waiting for remaining seats");
 $("readyButton").disabled=!online.connected||isSpectator||!online.seats[online.seat]?.claimed;
 $("readyButton").textContent=online.seatReady?.[online.seat]?"Cancel ready":"I’m ready";

 $("roomClockName").textContent=clockLabel(online);
 $("roomStorage").textContent=online.persistent?"Database · beta":"Temporary memory";
 $("storageNotice").textContent=online.persistent?"Beta database storage is enabled. This free database expires December 9, 2026; export important games.":"This server currently stores rooms in memory. Games may disappear when it restarts.";
 $("rematchControls").classList.toggle("hidden",!state.winner||isSpectator);
 $("matchActions").classList.toggle("hidden",isSpectator||!online.ready||!!state.winner);
 $("resignRoom").disabled=!online.connected||!state.alive[online.seat];
 $("drawVote").disabled=!online.connected||!state.alive[online.seat]||!!online.drawVotes?.[online.seat];
 $("drawVote").textContent=online.drawVotes?.[online.seat]?"Draw vote submitted":"Offer / agree to draw";
 $("drawVotesStatus").textContent=(online.drawVotes||[]).filter(Boolean).length+" / "+state.alive.filter(Boolean).length+" active players agree";
 $("leaveRoom").textContent=isSpectator?"Stop spectating":online.ready&&!state.winner?"Resign and leave room":"Leave room · release seat";
 if(state.winner){const votes=(online.rematch||[]).filter(Boolean).length;$("rematchVotes").textContent=votes+" / 4 players ready to restart";$("rematchRoom").disabled=!!online.rematch?.[online.seat]||!online.connected;$("rematchRoom").textContent=online.rematch?.[online.seat]?"Rematch vote sent":"Vote for rematch";}
 $("mySeat").textContent=isSpectator?"Spectator":names[online.seat];
 $("roomInput").value=online.room;
 const slots=$("roomSeats");slots.replaceChildren();
 for(let c=0;c<4;c++){
  const el=document.createElement("div");el.className="room-seat";
  const dot=document.createElement("span");dot.className="dot";dot.style.background=playerColors[c];
  const name=document.createElement("span");name.className="seat-identity";
  const label=document.createElement("strong");label.className="seat-name";label.textContent=names[c]+(!isSpectator&&online.seat===c?" · You":"");
  name.append(label);
  if(online.seats[c]?.alias){const username=document.createElement("small");username.textContent="@"+online.seats[c].alias;name.append(username);}
  if(online.hostSeat===c){const host=document.createElement("span");host.className="host-tag";host.textContent="HOST";name.append(host);}
  if(online.seats[c]?.role==="superuser")name.append(superuserBadge());
  const status=document.createElement("em");status.className="seat-presence";
  status.textContent=online.seats[c]?.ready?"Ready":online.seats[c]?.online?"Here":online.seats[c]?.claimed?"Away":"Open";
  el.classList.add("seat-"+status.textContent.toLowerCase());
  if(online.seats[c]?.ready)el.classList.add("is-ready");
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
 for(const id of ["resignLocal","drawLocal"])$(id).disabled=!!online||!!state.winner;
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
  return v&&typeof v.room==="string"&&/^[A-F0-9]{7}$/.test(v.room)&&Number.isInteger(v.seat)&&v.seat>=0&&v.seat<4&&((typeof v.token==="string"&&v.token.length>=32)||(v.token===null&&!!window.QuadraAccount?.token()))?v:null;
 }catch(e){return null;}
}
function connectRoom(data){
 if(online)return;
 saveAuto();
 backup={state:clone(state),stack:stack.map(clone),orientation};
 const s={room:data.room,seat:data.seat??null,token:data.token||null,spectator:!!data.spectator,watchKey:data.watchKey||null,
 spectatorKey:data.spectatorKey||null,visibility:data.visibility||"private",rated:!!data.rated,hostSeat:0,
 messages:[],spectators:[],spectatorCount:0,ws:null,rev:0,ready:false,filled:false,seatReady:[false,false,false,false],title:data.title||"",clockSettings:data.clockSettings||null,connected:false,awaiting:false,rematch:[false,false,false,false],drawVotes:[false,false,false,false],events:null,replayStates:null,archives:[],gameNo:1,seats:[{},{},{},{}],attempts:0,closed:false,clock:null,clockReceivedAt:Date.now(),clockPreset:data.clock||"untimed",persistent:!!data.persistent,variant:data.variant||null};
 online=s;playLocation="online";reviewIndex=null;selected=-1;targets=[];pending=null;orientation=s.spectator?0:s.seat;
 if(!s.spectator)try{sessionStorage.setItem(ROOM_KEY,JSON.stringify({room:s.room,seat:s.seat,token:s.token,spectatorKey:s.spectatorKey}));}catch(e){}
 switchPanel("waiting");render();
 function socketConnect(){
  if(online!==s||s.closed)return;
  onlineMessage("Connecting securely to room "+s.room+"…");
  let ws;
  try{ws=new WebSocket(API.replace(/^http/,"ws")+"/ws");}catch(e){onlineMessage("Unable to start the connection.");return;}
  s.ws=ws;
  ws.onopen=()=>{if(online===s)ws.send(JSON.stringify(s.spectator?{type:"watch",room:s.room,key:s.watchKey,session:window.QuadraAccount?.token()||null}:
    {type:"hello",room:s.room,seat:s.seat,token:s.token,session:window.QuadraAccount?.token()||null}));};
  ws.onmessage=event=>{
   if(online!==s)return;let msg;try{msg=JSON.parse(event.data);}catch(e){return;}
   if(msg.type==="welcome"){s.connected=true;s.attempts=0;onlineMessage(s.spectator?"Watching the room in read-only mode.":"Connected as "+names[s.seat]+".");render();return;}
   if(msg.type==="error"){s.awaiting=false;onlineMessage("Server: "+msg.error);render();return;}
   if(msg.type==="vacated"){leaveRoom(true);return;}
   if(msg.type==="room-closed"){const message=msg.message||"Room closed.";leaveRoom(true);tell(message);return;}
   if(msg.type==="notice"){tell(msg.message||"Update received.");return;}
   if(msg.type==="spectator-key"&&typeof msg.key==="string"){
    s.spectatorKey=msg.key;
    try{sessionStorage.setItem(ROOM_KEY,JSON.stringify({room:s.room,seat:s.seat,token:s.token,spectatorKey:s.spectatorKey}));}catch(e){}
    tell("New private spectator link is ready to copy.");render();return;
   }
   if(msg.type==="archive"&&msg.archive){
    const a=msg.archive;
    downloadRecord({format:"quadra-chess-game",version:1,room:s.room,variant:s.variant,
      gameNo:a.gameNo,mode:a.mode,result:a.winner,moves:a.moves,events:a.events,endedAt:a.endedAt},
      "quadra-"+s.room+"-game-"+a.gameNo+".json");return;
   }
   if(msg.type==="state"){
    s.rev=msg.revision;s.seats=msg.seats||s.seats;
    s.visibility=msg.visibility||s.visibility;s.rated=!!msg.rated;s.hostSeat=Number.isInteger(msg.hostSeat)?msg.hostSeat:s.hostSeat;
    s.messages=Array.isArray(msg.messages)?msg.messages:s.messages;s.spectatorCount=msg.spectatorCount||0;s.spectators=Array.isArray(msg.spectators)?msg.spectators:[];
    s.seatReady=msg.seatReady||s.seatReady;s.filled=!!msg.filled;s.title=msg.title||s.title;s.rematch=msg.rematch||s.rematch;s.drawVotes=msg.drawVotes||s.drawVotes;
    s.archives=msg.archives||[];s.gameNo=msg.gameNo||1;s.events=msg.events;s.ready=!!msg.ready;s.awaiting=false;s.clock=msg.clock||null;s.clockSettings=msg.clock||s.clockSettings;s.clockReceivedAt=Date.now();s.persistent=!!msg.persistent;s.variant=msg.variant||s.variant; if(s.clock)s.clockPreset=s.clock.preset;
    if(safeState(msg.game))state=msg.game;
    $("hostRoomTitle").value=s.title||"";
    $("hostRoomVisibility").value=s.visibility;
    $("hostRoomRated").checked=s.rated;
    $("hostRoomFormat").value=state.mode;
    $("hostRoomClock").value=s.clockPreset||"untimed";
    if($("hostRoomClock").value!==s.clockPreset)$("hostRoomClock").value="custom";
    if(s.clockPreset==="custom"){
     $("hostCustomMinutes").value=String(Math.round((s.clockSettings?.initialMs||300000)/60000));
     $("hostCustomIncrement").value=String(Math.round((s.clockSettings?.incrementMs||0)/1000));
    }
    $("hostCustomTime").classList.toggle("hidden",$("hostRoomClock").value!=="custom");
    const positions=window.QuadraReplay?.replay(s.events,state.mode,E);
    s.replayStates=positions&&positions.length===state.moves.length+1?positions:null;
    reviewIndex=null;selected=-1;targets=[];render();
    if(s.ready&&activePanel==="waiting")switchPanel("play");
    else if(!s.ready&&["play","moves","review"].includes(activePanel))switchPanel("waiting");
    window.QuadraCommunity?.refreshReview?.();
    onlineMessage(s.ready?"Game started · "+s.seats.filter(v=>v.online).length+" online":"Lobby · "+s.seats.filter(v=>v.claimed).length+"/4 seats · "+s.seatReady.filter(Boolean).length+"/4 ready");
    return;
   }
  };
  ws.onclose=event=>{
   if(online!==s||s.closed)return;s.connected=false;s.awaiting=false;render();
   if(event.code===4003||event.code===4004){onlineMessage("Room no longer accessible. Returning to rooms.");leaveRoom(true);return;}
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
  const token=window.QuadraAccount?.token();
  const headers={"Content-Type":"application/json"};if(token)headers.Authorization="Bearer "+token;
  const response=await fetch(API+path,{method:"POST",headers,body:JSON.stringify(payload),signal:controller.signal});
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
  const preference=$("preferredSeat").value;
  const seat=preference===""?null:Number(preference);
  let clock=$("onlineClock").value;
  if(which==="create"&&clock==="custom"){
   const minutes=Number($("customMinutes").value),incrementSeconds=Number($("customIncrement").value);
   if(!Number.isInteger(minutes)||minutes<1||minutes>180||!Number.isInteger(incrementSeconds)||incrementSeconds<0||incrementSeconds>60)throw Error("Custom time: 1–180 minutes and 0–60 seconds per move.");
   clock={type:"custom",minutes,incrementSeconds};
  }
  const data=which==="create"?await roomRequest("/api/rooms",{mode:$("onlineFormat").value,clock,seat,
   title:$("roomTitleInput").value.trim(),visibility:$("roomVisibility").value,rated:$("roomRated").checked}):
   await roomRequest("/api/rooms/"+room+"/join",{seat});
  connectRoom(data);tell("Room joined.");
 }catch(e){onlineMessage(e.name==="AbortError"?"Server did not respond. Please try again.":"Unable to join: "+e.message);}
 finally{button.disabled=!!online;}
}
function leaveRoom(vacated=false){
 if(!online)return;
 const s=online;
 if(!s.spectator&&!vacated){
  if(!s.connected||s.ws?.readyState!==WebSocket.OPEN){tell("Reconnect to release your seat. Disconnecting alone does not remove the room.");return;}
  if(s.ready&&!state.winner&&!confirm("Leaving a live game resigns your color. Continue?"))return;
  s.ws.send(JSON.stringify({type:"vacate"}));onlineMessage("Leaving room and releasing seat…");return;
 }
 s.closed=true;if(retryTimer)clearTimeout(retryTimer);s.ws?.close();
 online=null;
 try{sessionStorage.removeItem(ROOM_KEY);}catch(e){}
 if(backup){state=backup.state;stack=backup.stack;orientation=backup.orientation;}
 else{state=fresh("ffa");stack=[];}
 backup=null;reviewIndex=null;selected=-1;targets=[];pending=null;
 switchLocation("local");switchPanel("rooms");render();
 if(!vacated)tell("Returned to the public rooms.");
}
async function joinByCode(code){
 if(online){tell("Leave your current room before joining another.");return;}
 const room=String(code||"").trim().toUpperCase();
 if(!/^[A-F0-9]{7}$/.test(room)){tell("Enter the seven-character room code.");return;}
 $("roomInput").value=room;$("preferredSeat").value="";
 switchPanel("create",true);
 await enterRoom("join");
}
function watchRoom(room,key=null){
 if(online){tell("Leave your current room before watching another.");return;}
 if(!/^[A-F0-9]{7}$/i.test(room||"")){tell("Invalid spectator room code.");return;}
 connectRoom({room:room.toUpperCase(),seat:null,spectator:true,watchKey:key||null,persistent:true,visibility:key?"private":"public"});
}
function copySpectatorInvite(){
 if(!online)return;
 const secret=online.visibility==="private"?online.spectatorKey:null;
 if(online.visibility==="private"&&!secret){tell("The host can reset the watch-only link to create a new invitation.");return;}
 const url=location.origin+location.pathname+"?watch="+online.room+(secret?"&key="+encodeURIComponent(secret):"");
 if(!navigator.clipboard){prompt("Share spectator link:",url);return;}
 navigator.clipboard.writeText(url).then(()=>tell("Watch-only invitation copied."),()=>prompt("Share spectator link:",url));
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
 $("headerSettings").addEventListener("click",()=>switchPanel("settings",true));
 for(const [id,page] of [["navGame","play"],["navMoves","moves"],["navReview","review"]])$(id).addEventListener("click",()=>switchPanel(page,true));
 $("headerHome").addEventListener("click",()=>switchPanel("home",true));
 $("headerRooms").addEventListener("click",()=>switchPanel("rooms",true));
 $("headerPlay").addEventListener("click",()=>switchPanel("local",true));
 $("headerCreate").addEventListener("click",()=>switchPanel("create",true));
 $("headerRoom").addEventListener("click",()=>switchPanel("room",true));
 $("headerLeaders").addEventListener("click",()=>switchPanel("community",true));
 $("headerAccount").addEventListener("click",()=>switchPanel("account",true));
 $("headerAdmin").addEventListener("click",()=>switchPanel("admin",true));
 $("brandHome").addEventListener("click",e=>{e.preventDefault();switchPanel("home",true);});
 for(const [id,page] of [["homeRooms","rooms"],["homeWatch","rooms"],["homeRules","rules"]])$(id).addEventListener("click",()=>switchPanel(page,true));
 $("homeCreate").addEventListener("click",()=>switchPanel("create",true));
 $("homeJoin").addEventListener("click",()=>{switchPanel("create",true);$("quickJoinCode").focus();});
 $("homeLocal").addEventListener("click",()=>switchPanel("local",true));
 for(const [button,input] of [["quickJoinButton","quickJoinCode"]]){
  $(button).addEventListener("click",()=>joinByCode($(input).value));
  $(input).addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-F0-9]/g,"").slice(0,7);});
  $(input).addEventListener("keydown",e=>{if(e.key==="Enter"){e.preventDefault();$(button).click();}});
 }
 $("onlineClock").addEventListener("change",e=>$("customTimeFields").classList.toggle("hidden",e.target.value!=="custom"));
 $("localMode").addEventListener("click",()=>switchLocation("local"));
 $("onlineMode").addEventListener("click",()=>switchLocation("online"));
 $("new").addEventListener("click",()=>newGame($("mode").value));
 $("resignLocal").addEventListener("click",()=>{
  if(online||state.winner)return;
  const player=state.turn;
  if(!confirm("Resign as "+names[player]+"? This removes that player's pieces."))return;
  stack.push(clone(state));state=E.eliminatePlayer(state,player,"resign");
  selected=-1;targets=[];pending=null;reviewIndex=null;if(prefs.follow)orientation=state.turn;
  saveAuto();render();tell(names[player]+" resigned.");
 });
 $("drawLocal").addEventListener("click",()=>{
  if(online||state.winner)return;
  if(!confirm("Do all players agree to end this game in a draw?"))return;
  stack.push(clone(state));state=E.concludeDraw(state);
  selected=-1;targets=[];pending=null;reviewIndex=null;saveAuto();render();tell("Game ended by agreement.");
 });
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
 $("roomsCreate").addEventListener("click",()=>switchPanel("create",true));
 $("joinRoom").addEventListener("click",()=>enterRoom("join"));
 $("readyButton").addEventListener("click",()=>{if(!online?.connected||online.ready)return;
  const type=online.seatReady?.[online.seat]?"unready":"ready";online.ws.send(JSON.stringify({type}));onlineMessage(type==="ready"?"Ready confirmation submitted.":"Ready confirmation cancelled.");});
 $("roomInput").addEventListener("input",e=>{e.target.value=e.target.value.toUpperCase().replace(/[^A-F0-9]/g,"").slice(0,7);});
 $("copyInvite").addEventListener("click",copyInvite);
 $("copySpectatorInvite").addEventListener("click",copySpectatorInvite);
 $("rotateWatchLink").addEventListener("click",()=>{if(online?.connected&&!online.spectator&&online.seat===online.hostSeat)online.ws.send(JSON.stringify({type:"spectator-key-rotate"}));});
 $("hostRoomClock").addEventListener("change",()=>{ $("hostCustomTime").classList.toggle("hidden",$("hostRoomClock").value!=="custom");});
 $("saveHostSettings").addEventListener("click",()=>{
  if(!online?.connected||online.spectator||online.seat!==online.hostSeat)return;
  const payload={type:"room-settings",title:$("hostRoomTitle").value.trim(),
   visibility:$("hostRoomVisibility").value,rated:online.ready?online.rated:$("hostRoomRated").checked,
   mode:online.ready?state.mode:$("hostRoomFormat").value};
  if(!online.ready){
   payload.clock=$("hostRoomClock").value;
   if(payload.clock==="custom"){
    const minutes=Number($("hostCustomMinutes").value),incrementSeconds=Number($("hostCustomIncrement").value);
    if(!Number.isInteger(minutes)||minutes<1||minutes>180||!Number.isInteger(incrementSeconds)||incrementSeconds<0||incrementSeconds>60){tell("Custom time must be 1–180 minutes and 0–60 seconds increment.");return;}
    payload.clock={type:"custom",minutes,incrementSeconds};
   }
  }
  online.ws.send(JSON.stringify(payload));
  onlineMessage("Saving room settings…");
 });
 $("deleteHostedRoom").addEventListener("click",()=>{
  if(!online?.connected||online.spectator||online.seat!==online.hostSeat)return;
  if(!confirm("Permanently delete this room for every player and spectator? The room cannot be restored."))return;
  online.ws.send(JSON.stringify({type:"delete-room"}));
 });
 $("nextRound").addEventListener("click",()=>{if(online?.connected&&!online.spectator&&online.seat===online.hostSeat&&state.winner&&confirm("Open a fresh match in this room? Chat and archived matches will stay."))online.ws.send(JSON.stringify({type:"new-round"}));});
 $("sendChat").addEventListener("click",()=>{
  if(!online?.connected||online.spectator){tell("Join as a player to chat.");return;}
  if(!window.QuadraAccount?.token()){tell("Sign in to use room chat.");switchPanel("account",true);return;}
  const text=$("chatInput").value.trim();
  if(!text||text.length>240){tell("Enter a message under 240 characters.");return;}
  online.ws.send(JSON.stringify({type:"chat",text}));$("chatInput").value="";
 });
 $("chatInput").addEventListener("keydown",e=>{if(e.key==="Enter"&&!e.shiftKey){e.preventDefault();$("sendChat").click();}});
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
 $("leaveRoom").addEventListener("click",()=>leaveRoom(false));
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
 const initial=(typeof location.hash==="string"&&({
  "#/home":"home","#/":"home","#/lobby":"rooms","#/local":"local","#/setup":"create",
  "#/leaders":"community","#/rules":"rules","#/settings":"settings","#/account":"account"
 })[location.hash])||"home";
 switchPanel(initial);
 if(resumed&&prefs.follow)orientation=state.turn;
 const invited=new URLSearchParams(location.search).get("room");
 const watchCode=new URLSearchParams(location.search).get("watch");
 const watchKey=new URLSearchParams(location.search).get("key");
 if(watchCode&&/^[A-F0-9]{7}$/i.test(watchCode)){
  watchRoom(watchCode,watchKey);return;
 }
 if(invited&&/^[A-F0-9]{7}$/i.test(invited)){
  $("roomInput").value=invited.toUpperCase();
  onlineMessage("Invite detected · joining room…");
  setTimeout(()=>{if(!online)joinByCode(invited);},400);
 }
 render();
 if(resumed&&state.moves.length)tell("Your local game was restored.");
}
init();
window.QuadraApp={getState:()=>state,getReviewIndex:()=>reviewIndex,changePanel:switchPanel,openRoom:connectRoom,
 watchRoom,joinRoomCode:joinByCode,isOnline:()=>!!online,refresh:render,getPositions:()=>online?.replayStates||localReplayFrames(),
 getOnline:()=>online?{room:online.room,seat:online.seat,spectator:online.spectator,rated:online.rated,visibility:online.visibility,ready:online.ready,
  gameNo:online.gameNo,hostSeat:online.hostSeat}:null,
 reviewPly:(i)=>{if(Number.isInteger(i)&&i>=0&&i<=reviewLength()){reviewIndex=i===reviewLength()?null:i;selected=-1;targets=[];render();switchPanel("moves",true);}}
};
window.QuadraEngine={fresh,legal,acceptMove,finish,threatened,isCheck,valid,rotate};
})();
