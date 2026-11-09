"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs"),path=require("node:path"),vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const script=fs.readFileSync(path.join(__dirname,"../rooms-client.js"),"utf8");
class Element{
 constructor(){this.events={};this.children=[];this.textContent="";this.value="";this.disabled=false;this.className="";this.style={};}
 addEventListener(event,fn){this.events[event]=fn;}
 emit(event){return this.events[event]?.({});}
 replaceChildren(){this.children=[];}
 append(...nodes){this.children.push(...nodes);}
}
function launch({signedIn=false}={}){
 const nodes={};for(const [,id] of html.matchAll(/\bid="([^"]+)"/g))nodes[id]=new Element();
 nodes.roomFilter.value="all";nodes.leaderboardMode.value="ffa";
 const calls=[],requests=[];
 const rooms=[
  {room:"ABC1234",title:"Weekend League",mode:"ffa",players:2,started:false,gameNo:1,rated:false,averageRating:1200,spectatorCount:0},
  {room:"D0A4567",title:"Rated Showcase",mode:"teams",players:4,started:true,gameNo:2,rated:true,averageRating:1415,spectatorCount:3}
 ];
 const fetch=async(url,options={})=>{
  requests.push({url,options});
  if(url.includes("/api/rooms/public"))return {ok:true,json:async()=>({rooms})};
  if(url.includes("/api/community/leaderboard"))return {ok:true,json:async()=>({mode:"ffa",players:[{position:1,username:"strategist",rating:1420,games:11,wins:7,draws:1,provisional:false}]})};
  if(url.includes("/api/auth/me"))return {ok:true,json:async()=>({profile:{achievements:[{id:"first-game",name:"First Match",description:"Complete a rated game",unlocked:true}]}})};
  if(url.includes("/join"))return {ok:true,json:async()=>({room:"ABC1234",seat:2,token:"t".repeat(43)})};
  throw Error("Unexpected URL "+url);
 };
 const app={isOnline:()=>false,openRoom:args=>calls.push({openRoom:args}),watchRoom:room=>calls.push({watch:room}),
  changePanel:panel=>calls.push({panel}),getState:()=>({winner:"Red wins!"}),
  getPositions:()=>[{},{}],reviewPly:ply=>calls.push({ply})};
 const window={QuadraApp:app,QuadraCore:{},QuadraReview:{review:()=>({result:"Red wins!",moves:1,
  players:Array.from({length:4},(_,color)=>({color,moves:color===0?1:0,captures:0,checks:0,promotions:0,material:8})),
  moments:[{ply:1,color:0,notation:"A1-A2",description:"Check"}]})},
 QuadraAccount:{token:()=>signedIn?"t".repeat(43):null}};
 const context={window,document:{getElementById:id=>nodes[id],createElement:()=>new Element()},fetch,setTimeout,clearTimeout,AbortController,URLSearchParams};
 vm.runInNewContext(script,context,{filename:"rooms-client.js"});
 return {nodes,calls,requests,window};
}
test("public room cards include join/watch behavior and filter by active games",async()=>{
 const x=launch();
 await x.nodes.refreshPublicRooms.emit("click");
 assert.equal(x.nodes.publicRoomList.children.length,2);
 const first=x.nodes.publicRoomList.children[0];
 assert.match(first.children[1].textContent,/2\/4 seats/);
 first.children[2].children[1].emit("click");
 assert.ok(x.calls.some(c=>c.watch==="ABC1234"));
 await first.children[2].children[0].emit("click");
 assert.ok(x.calls.some(c=>c.openRoom?.room==="ABC1234"));
 x.nodes.roomFilter.value="watch";x.nodes.roomFilter.emit("change");
 assert.equal(x.nodes.publicRoomList.children.length,1);
 assert.match(x.nodes.publicRoomList.children[0].children[0].children[0].textContent,/Rated Showcase/);
});
test("leaderboards render provisional ratings without public account secrets",async()=>{
 const x=launch({signedIn:true});
 await x.nodes.refreshLeaders.emit("click");
 assert.equal(x.nodes.leaderboardList.children.length,1);
 assert.match(x.nodes.leaderboardList.children[0].children[1].children[0].textContent,/strategist/);
 assert.equal(x.nodes.communityAchievements.children.length,1);
 assert.ok(x.requests.every(v=>!JSON.stringify(v).includes("password")));
});
test("postgame review highlights recorded moments with replay navigation",()=>{
 const x=launch();
 x.window.QuadraCommunity.refreshReview();
 assert.equal(x.nodes.reviewDetails.children.length,0);
 assert.equal(x.nodes.reviewDetails.classList?.contains?.("hidden")??false,false);
 assert.equal(x.nodes.reviewStats.children.length,4);
 assert.equal(x.nodes.reviewMoments.children.length,1);
 x.nodes.reviewMoments.children[0].emit("click");
 assert.ok(x.calls.some(v=>v.ply===1));
});
