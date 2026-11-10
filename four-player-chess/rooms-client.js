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
async function loadStats(){
 const status=$("homeStatsStatus");
 try{
  const data=await jsonFetch("/api/stats");
  for(const [id,key] of [["homeAccounts","accounts"],["homePlayers","playersOnline"],["homeRoomsCount","activeRooms"],["homeSpectators","spectatorsOnline"]])
   $(id).textContent=Number(data[key]||0).toLocaleString();
  status.textContent=(data.liveGames||0)+" live "+(data.liveGames===1?"game":"games")+" · Accounts counted once across rooms; guest seats may count separately";
 }catch(e){status.textContent="Live counts unavailable. Rooms may still work.";}
}
function infoMetric(label,value){
 const metric=document.createElement("div");metric.className="directory-metric";
 const top=document.createElement("small");top.textContent=label;
 const amount=document.createElement("strong");amount.textContent=String(value);
 metric.append(top,amount);return metric;
}
function renderRooms(){
 const box=$("publicRoomList");box.replaceChildren();
 const term=$("roomSearch").value.trim().toLowerCase(),filter=$("roomFilter").value;
 const items=listed.filter(r=>(!term||(r.title||"").toLowerCase().includes(term)||r.room.toLowerCase().includes(term))&&
  (filter==="all"||(filter==="join"&&!r.started&&r.players<4)||
   (filter==="watch"&&(r.started||r.finished))||(filter==="rated"&&r.rated))).sort((a,b)=>{
    const sort=$("roomSort").value;
    if(sort==="rating")return (b.averageRating??-1)-(a.averageRating??-1)||b.players-a.players;
    if(sort==="audience")return (b.spectatorCount||0)-(a.spectatorCount||0)||b.players-a.players;
    if(sort==="players")return b.players-a.players;
    return b.updated-a.updated;
   });
 $("lobbyTotal").textContent=String(listed.length);
 $("lobbyJoinable").textContent=String(listed.filter(r=>!r.started&&r.players<4).length);
 $("lobbyLive").textContent=String(listed.filter(r=>r.started&&!r.finished).length);
 if(!items.length){
  const empty=document.createElement("div");empty.className="directory-empty";
  const title=document.createElement("h3");title.textContent=loaded?"No rooms match your search":"Finding public rooms…";
  const copy=document.createElement("p");copy.textContent=loaded?
   "Try another filter, or host a new public room for your friends.":"Checking the community lobby.";
  empty.append(title,copy);
  if(loaded)empty.append(makeButton("Create a room",()=>window.QuadraApp?.changePanel?.("create",true),"primary"));
  box.append(empty);return;
 }
 for(const room of items){
  const already=!!window.QuadraApp?.isRoomOpen?.(room.room);
  const card=document.createElement("article");card.className="public-room-card";
  const top=document.createElement("div");top.className="room-card-top";
  const title=document.createElement("div");title.className="room-card-title";
  const heading=document.createElement("strong");heading.className="room-card-name";heading.textContent=room.title||"Public chess room";
  const sub=document.createElement("small");sub.className="room-code-label";sub.textContent="Room "+room.room;
  title.append(heading,sub);
  const status=document.createElement("span");status.className="room-card-status";
  status.textContent=room.finished?"Between games":room.started?"Live game":room.players<4?"Open seats":"Ready check";
  status.classList.add(room.started&&!room.finished?"live":room.finished?"finished":"open");
  top.append(title,status);
  const stats=document.createElement("div");stats.className="directory-metrics";
  const clock=room.clock==="untimed"?"Untimed":(room.clock||"Untimed").replace(/([a-z])([0-9])/i,"$1 $2");
  stats.append(infoMetric("SEATS",room.players+"/4"),infoMetric("WATCHING",room.spectatorCount||0),
   infoMetric("CLOCK",clock));
  const details=document.createElement("div");details.className="directory-details";
  const description=document.createElement("span");
  description.textContent=(room.mode==="teams"?"Teams":"Free-for-all")+" · "+(room.rated?"Rated":"Casual")+
   " · "+(Number.isFinite(room.averageRating)?"Avg "+room.averageRating+" provisional":"Unrated field");
  const host=document.createElement("span");host.textContent="Hosted by "+(room.host||"Guest");
  details.append(description,host);
  const actions=document.createElement("div");actions.className="room-card-actions";
  actions.append(makeButton(already?"Open my room":"Join players",
   ()=>already?window.QuadraApp?.activateRoom?.(room.room):joinPublic(room),"primary",
   !already&&(room.started||room.players>=4)),
   makeButton(already?"Open room":"Spectate",
    ()=>window.QuadraApp?.watchRoom?.(room.room),"ghost",
    !already&&!window.QuadraApp?.canAddRoom?.(room.room)));
  card.append(top,stats,details,actions);box.append(card);
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
 if(window.QuadraApp?.isRoomOpen?.(room.room)){window.QuadraApp?.activateRoom?.(room.room);return;}
 if(!window.QuadraApp?.canAddRoom?.(room.room)){$("publicRoomStatus").textContent="Your tab has too many open rooms. Leave one under My rooms first.";return;}
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
function playerBadge(player){
 const name=document.createElement("span");name.className="leader-identity-name";name.textContent="@"+player.username;
 const wrap=document.createElement("span");wrap.className="leader-name";wrap.append(name);
 if(player.role==="superuser"){
  const badge=document.createElement("span");badge.className="superuser-badge";
  badge.textContent="✦ Superuser";badge.setAttribute("title","Quadra Chess superuser");wrap.append(badge);
 }
 return wrap;
}
function renderLeaderList(){
 const host=$("leaderboardList"),podium=$("leaderPodium");host.replaceChildren();podium.replaceChildren();
 $("leaderTotalPlayers").textContent=String(leaders.length);
 if(!leaders.length){
  const p=paragraph("No rated games have been recorded for this format yet. Create a rated room to help build the standings.","leader-empty");
  host.append(p);return;
 }
 for(const player of leaders.slice(0,3)){
  const card=document.createElement("article");card.className="podium-entry podium-rank-"+player.position;
  const place=document.createElement("span");place.className="podium-position";place.textContent="#"+player.position;
  const name=playerBadge(player);
  const rating=document.createElement("strong");rating.className="podium-rating";rating.textContent=String(player.rating);
  const unit=document.createElement("small");unit.textContent=player.provisional?"Provisional Elo":"Elo rating";
  const record=document.createElement("span");record.className="podium-record";record.textContent=player.wins+" wins · "+player.games+" games";
  card.append(place,name,rating,unit,record);podium.append(card);
 }
 const headings=document.createElement("div");headings.className="leader-table-heading";
 for(const text of ["RANK","PLAYER","GAMES","WINS","ELO"]){
  const col=document.createElement("span");col.textContent=text;headings.append(col);
 }
 host.append(headings);
 for(const player of leaders){
  const row=document.createElement("article");row.className="leader-entry";
  const rank=document.createElement("span");rank.className="rank";rank.textContent="#"+player.position;
  const who=document.createElement("div");who.className="leader-person";who.append(playerBadge(player));
  const games=document.createElement("span");games.className="leader-number";games.textContent=String(player.games);
  const wins=document.createElement("span");wins.className="leader-number";wins.textContent=String(player.wins);
  const rating=document.createElement("strong");rating.className="rating";rating.textContent=String(player.rating);
  if(player.provisional){rating.setAttribute("title","Provisional rating until ten rated games");}
  row.append(rank,who,games,wins,rating);host.append(row);
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
window.QuadraCommunity={loadRooms,loadLeaders,loadStats,refreshReview,loadMyAchievements};
bind();loadRooms();loadStats();
})();
