(function(){
"use strict";
const API="https://quadra-chess-api.onrender.com";
const E=window.QuadraCore;
const $=id=>document.getElementById(id);
const names=["Red","Blue","Yellow","Green"];
let listed=[],loaded=false,leaders=[],myAchievements=[];
function paragraph(text,className="history-empty"){
 const el=document.createElement("p");el.className=className;el.textContent=text;return el;
}
function makeButton(text,action,variant="ghost",disabled=false){
 const el=document.createElement("button");el.type="button";el.className="button "+variant;
 el.textContent=text;el.disabled=!!disabled;el.addEventListener("click",action);return el;
}
async function jsonFetch(url,headers){
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),45000);
 try{
  const response=await fetch(API+url,{headers:headers||{},signal:controller.signal});
  const result=await response.json();
  if(!response.ok)throw Error(result.error||"Request failed");
  return result;
 }finally{clearTimeout(timeout);}
}
function renderRooms(){
 const box=$("publicRoomList");box.replaceChildren();
 const term=$("roomSearch").value.trim().toLowerCase(),filter=$("roomFilter").value;
 const items=listed.filter(r=>(!term||(r.title||"").toLowerCase().includes(term)||r.room.toLowerCase().includes(term))&&
  (filter==="all"||(filter==="join"&&!r.started&&r.players<4)||(filter==="watch"&&(r.started||r.finished))||(filter==="rated"&&r.rated))).sort((a,b)=>{
    const sort=$("roomSort").value;
    if(sort==="rating")return (b.averageRating??-1)-(a.averageRating??-1)||b.players-a.players;
    if(sort==="audience")return (b.spectatorCount||0)-(a.spectatorCount||0);
    if(sort==="players")return b.players-a.players;
    return b.updated-a.updated;
   });
 if(!items.length){
  box.append(paragraph(loaded?"No matching public rooms yet. Create one and invite your friends!":"Loading rooms…"));return;
 }
 for(const room of items){
  const card=document.createElement("article");card.className="public-room-card";
  const top=document.createElement("div");top.className="room-card-top";
  const heading=document.createElement("div");heading.className="room-card-name";heading.textContent=room.title||"Public chess room";
  const status=document.createElement("span");status.className="room-card-status";
  status.textContent=room.finished?"Between games":room.started?"Live match":"Lobby";
  top.append(heading,status);
  const meta=document.createElement("div");meta.className="room-card-meta";
  const rating=Number.isFinite(room.averageRating)?"Avg "+room.averageRating+" provisional":"No account rating yet";
  meta.textContent=room.room+" · "+(room.mode==="teams"?"Teams":"Free-for-all")+
   " · "+room.players+"/4 seats · "+(room.spectatorCount||0)+" watching · "+
   (room.rated?"Rated":"Casual")+" · "+rating+" · Round "+room.gameNo;
  const actions=document.createElement("div");actions.className="room-card-actions";
  actions.append(
   makeButton("Join room",()=>joinPublic(room),"primary",room.started||room.players>=4),
   makeButton("Watch",()=>window.QuadraApp?.watchRoom?.(room.room),"ghost")
  );
  card.append(top,meta,actions);box.append(card);
 }
}
async function loadRooms(){
 $("publicRoomStatus").textContent="Checking public rooms…";
 try{
  const data=await jsonFetch("/api/rooms/public");
  listed=Array.isArray(data.rooms)?data.rooms:[];
  loaded=true;
  $("publicRoomStatus").textContent=listed.length+" public room"+(listed.length===1?"":"s")+" available";
  renderRooms();
 }catch(e){$("publicRoomStatus").textContent="Rooms could not load: "+e.message;renderRooms();}
}
async function joinPublic(room){
 if(window.QuadraApp?.isOnline?.()){$("publicRoomStatus").textContent="Disconnect from your current room before joining another.";return;}
 const t=window.QuadraAccount?.token?.();
 if(room.rated&&!t){$("publicRoomStatus").textContent="Sign in to join a rated room.";window.QuadraApp?.changePanel?.("account",true);return;}
 try{
  $("publicRoomStatus").textContent="Joining "+room.room+"…";
  const headers={"Content-Type":"application/json"};if(t)headers.Authorization="Bearer "+t;
  const response=await fetch(API+"/api/rooms/"+room.room+"/join",{method:"POST",headers,body:JSON.stringify({})});
  const data=await response.json();
  if(!response.ok)throw Error(data.error||"Could not join");
  window.QuadraApp?.openRoom?.(data);
  window.QuadraAccount?.refreshRooms?.();
 }catch(e){$("publicRoomStatus").textContent=e.message;}
}
function renderLeaderList(){
 const el=$("leaderboardList");el.replaceChildren();
 if(!leaders.length){el.append(paragraph("No rated games for this format yet. The first leaderboard could start with your room."));return;}
 for(const player of leaders){
  const row=document.createElement("article");row.className="leader-entry";
  const rank=document.createElement("span");rank.className="rank";rank.textContent="#"+player.position;
  const text=document.createElement("div");
  const name=document.createElement("strong");name.textContent="@"+player.username;
  const info=document.createElement("small");
  info.textContent=player.games+" played · "+player.wins+" wins"+(player.provisional?" · Provisional":"");
  text.append(name,info);
  const rating=document.createElement("span");rating.className="rating";rating.textContent=String(player.rating);
  row.append(rank,text,rating);el.append(row);
 }
}
function renderAchievements(){
 const host=$("communityAchievements");host.replaceChildren();
 if(!myAchievements.length){host.append(paragraph("Sign in to track achievements across completed rated games."));return;}
 for(const a of myAchievements){
  const card=document.createElement("div");card.className="achievement"+(a.unlocked?"":" locked");
  const heading=document.createElement("strong");heading.textContent=(a.unlocked?"★ ":"◇ ")+a.name;
  const detail=document.createElement("small");detail.textContent=a.description;
  card.append(heading,detail);host.append(card);
 }
}
async function loadMyAchievements(){
 const token=window.QuadraAccount?.token?.();
 if(!token){myAchievements=[];renderAchievements();return;}
 try{
  const data=await jsonFetch("/api/auth/me",{Authorization:"Bearer "+token});
  myAchievements=data.profile?.achievements||[];
  renderAchievements();
 }catch(e){myAchievements=[];renderAchievements();}
}
async function loadLeaders(){
 const mode=$("leaderboardMode").value;
 $("leaderboardStatus").textContent="Loading provisional ratings…";
 try{
  const data=await jsonFetch("/api/community/leaderboard?mode="+encodeURIComponent(mode));
  leaders=Array.isArray(data.players)?data.players:[];
  $("leaderboardStatus").textContent=leaders.length+" rated player"+(leaders.length===1?"":"s")+" · "+(mode==="ffa"?"Free-for-all":"Teams");
  renderLeaderList();
 }catch(e){$("leaderboardStatus").textContent="Leaderboard unavailable: "+e.message;}
 await loadMyAchievements();
}
function refreshReview(){
 const panel=$("reviewDetails"),message=$("reviewAvailability");
 const game=window.QuadraApp?.getState?.();
 if(!game?.winner){
  panel.classList.add("hidden");
  message.textContent="The match is still in progress. Game reviews open when a game finishes.";
  return;
 }
 const positions=window.QuadraApp?.getPositions?.();
 const review=window.QuadraReview?.review(positions,E);
 if(!review){
  panel.classList.add("hidden");
  message.textContent="This older game does not have a complete replay record. You can still inspect its move list.";
  return;
 }
 panel.classList.remove("hidden");
 message.textContent="Match completed · "+review.moves+" recorded entries";
 $("reviewResult").textContent=review.result;
 const stats=$("reviewStats");stats.replaceChildren();
 for(const player of review.players){
  const card=document.createElement("div");card.className="review-stat-card";
  const name=document.createElement("strong");name.textContent=names[player.color];
  const info=document.createElement("small");
  info.textContent=player.moves+" turns · "+player.captures+" captures · "+player.checks+" checks · "+player.promotions+" promotions · "+player.material+" material";
  card.append(name,info);stats.append(card);
 }
 const moments=$("reviewMoments");moments.replaceChildren();
 if(!review.moments.length)moments.append(paragraph("No checks, captures, promotions or eliminations recorded in this match."));
 for(const moment of review.moments.slice(0,100)){
  const button=document.createElement("button");button.type="button";button.className="review-moment";
  const title=document.createElement("strong");title.textContent=moment.ply+". "+names[moment.color]+" · "+moment.notation;
  const detail=document.createElement("small");detail.textContent=moment.description+" · View this moment";
  button.append(title,detail);
  button.addEventListener("click",()=>window.QuadraApp?.reviewPly?.(moment.ply));
  moments.append(button);
 }
}
function bind(){
 $("refreshPublicRooms").addEventListener("click",loadRooms);
 $("roomSearch").addEventListener("input",renderRooms);
 $("roomFilter").addEventListener("change",renderRooms);
 $("roomSort").addEventListener("change",renderRooms);
 $("refreshLeaders").addEventListener("click",loadLeaders);
 $("leaderboardMode").addEventListener("change",loadLeaders);
 $("reviewToMoves").addEventListener("click",()=>window.QuadraApp?.changePanel?.("moves",true));
 $("tab-community").addEventListener("click",loadLeaders);
 $("tab-review").addEventListener("click",refreshReview);
 $("tab-rooms").addEventListener("click",loadRooms);
}
window.QuadraCommunity={loadRooms,loadLeaders,refreshReview,loadMyAchievements};
bind();loadRooms();
})();
