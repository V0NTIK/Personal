"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const Engine=require("../engine.js");
const markup=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const source=fs.readFileSync(path.join(__dirname,"../app.js"),"utf8");
const replaySource=fs.readFileSync(path.join(__dirname,"../replay.js"),"utf8");
const ids=[...markup.matchAll(/\bid="([^"]+)"/g)].map(x=>x[1]);
class MockElement{
 constructor(){
  this.children=[];this.dataset={};this.style={};this.events={};this.attrs={};this.textContent="";this.className="";this.value="";this.checked=false;this.disabled=false;this.tabIndex=0;
  const set=new Set();
  this.classList={add(...v){v.forEach(x=>set.add(x))},remove(...v){v.forEach(x=>set.delete(x))},toggle(k,force){const state=force===undefined?!set.has(k):!!force;state?set.add(k):set.delete(k);return state;},contains:k=>set.has(k)};
 }
 append(...v){this.children.push(...v);}
 replaceChildren(...v){this.children=[...v];}
 addEventListener(name,fn){this.events[name]=fn;}
 setAttribute(k,v){this.attrs[k]=v;}
 get firstElementChild(){return this.children[0];}
 focus(){}
 scrollIntoView(){}
 emit(name,event={}){return this.events[name]?.(event);}
}
function launch({storage=new Map(),url=""}={}){
 const nodes={};for(const id of ids)nodes[id]=new MockElement();
 const tabs=["rooms","play","moves","review","community","settings","rules","account"].map(tab=>{const node=nodes["tab-"+tab];node.dataset.tab=tab;return node;});
 const document={
  getElementById:id=>nodes[id],
  createElement:()=>new MockElement(),
  createTextNode:s=>s,
  querySelectorAll:q=>q==="[data-tab]"?tabs:[],
  documentElement:{style:{values:{},setProperty(k,v){this.values[k]=v;}}},
  addEventListener(){}
 };
 const localStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const session=new Map(),sessionStorage={getItem:k=>session.has(k)?session.get(k):null,setItem:(k,v)=>session.set(k,v),removeItem:k=>session.delete(k)};
 const sockets=[];
 class FakeSocket{
  static OPEN=1;
  constructor(target){this.target=target;this.readyState=1;this.sent=[];sockets.push(this);}
  send(payload){this.sent.push(JSON.parse(payload));}
  close(){this.readyState=3;}
  receive(value){this.onmessage?.({data:JSON.stringify(value)});}
 }
 const window={QuadraCore:Engine,matchMedia:()=>({matches:false}),addEventListener(){}};
 const navigator={clipboard:{writeText:async()=>{}}};
 const location={origin:"https://quadra-chess.onrender.com",pathname:"/",search:url};
 const requests=[];
 const fetch=async(url,options)=>{requests.push({url,options});if(url.endsWith("/api/rooms"))return {ok:true,json:async()=>({room:"ABC1234",seat:0,token:"t".repeat(43),mode:"ffa",revision:0})};return {ok:true,json:async()=>({room:"ABC1234",seat:1,token:"q".repeat(43),mode:"ffa",revision:0})};};
 const context={window,document,localStorage,sessionStorage,navigator,location,URLSearchParams,WebSocket:FakeSocket,fetch,AbortController,
 setTimeout:()=>1,clearTimeout:()=>{},setInterval:()=>{},confirm:()=>true,prompt:()=>{}};
 vm.runInNewContext(replaySource,context,{filename:"replay.js",timeout:5000});
 vm.runInNewContext(source,context,{filename:"app.js",timeout:5000});
 return {nodes,window,storage,sockets,requests,document,sessionStorage};
}
function square(nodes,index){return nodes.board.children.find(c=>c.dataset.square===String(index));}
test("all required IDs exist uniquely and board renders 196 cells and four player cards",()=>{
 assert.equal(new Set(ids).size,ids.length);
 const {nodes}=launch();
 assert.equal(nodes.board.children.length,196);
 assert.equal(nodes.players.children.length,4);
 assert.equal(nodes.status.textContent,"Red to move");
});
test("local movement, undo and deterministic replay work",()=>{
 const {nodes,window}=launch();
 const m=Engine.legal(Engine.fresh(),0)[0];
 square(nodes,m.from).emit("click");
 assert.ok(nodes.board.children.some(c=>c.classList.contains("selected")));
 square(nodes,m.to).emit("click");
 assert.equal(window.QuadraApp.getState().moves.length,1);
 assert.equal(window.QuadraApp.getState().turn,1);
 nodes["tab-moves"].emit("click");
 assert.equal(nodes["tab-moves"].attrs["aria-selected"],"true");
 nodes.reviewHome.emit("click");assert.equal(window.QuadraApp.getReviewIndex(),0);
 nodes.reviewLive.emit("click");assert.equal(window.QuadraApp.getReviewIndex(),null);
 nodes.undo.emit("click");assert.equal(window.QuadraApp.getState().turn,0);
});
test("autosave restores the local game after page reload",()=>{
 const storage=new Map();
 const first=launch({storage});
 const m=Engine.legal(Engine.fresh(),0)[0];
 square(first.nodes,m.from).emit("click");
 square(first.nodes,m.to).emit("click");
 assert.ok(storage.has("quadra-autosave-v3"));
 const second=launch({storage});
 assert.equal(second.window.QuadraApp.getState().turn,1);
 assert.equal(second.window.QuadraApp.getState().moves.length,1);
});
test("settings change board colors and legal destination visibility",()=>{
 const {nodes,document}=launch();
 const m=Engine.legal(Engine.fresh(),0)[0];
 square(nodes,m.from).emit("click");
 assert.ok(nodes.board.children.some(c=>c.classList.contains("candidate")));
 nodes.showHints.checked=false;
 nodes.showHints.emit("change",{target:nodes.showHints});
 assert.ok(!nodes.board.children.some(c=>c.classList.contains("candidate")));
 nodes.boardtheme.value="wood";
 nodes.boardtheme.emit("change",{target:nodes.boardtheme});
 assert.equal(document.documentElement.style.values["--board-dark"],"#a88b68");
});
test("private online room handshake gates moves and submits server move",async()=>{
 const {nodes,sockets,requests}=launch();
 nodes.onlineMode.emit("click");
 assert.equal(nodes.onlineMode.attrs["aria-pressed"],"true");
 await nodes.createRoom.emit("click");
 assert.equal(requests.length,1);
 assert.equal(sockets.length,1);
 const ws=sockets[0];ws.onopen();
 assert.equal(ws.sent[0].type,"hello");
 ws.receive({type:"welcome",seat:0});
 const state=Engine.fresh();
 ws.receive({type:"state",revision:0,ready:false,seats:[{claimed:true,online:true},{claimed:false,online:false},{claimed:false,online:false},{claimed:false,online:false}],game:state});
 const m=Engine.legal(state,0)[0];
 square(nodes,m.from).emit("click");
 assert.equal(ws.sent.length,1,"no moves while seats unfilled");
 ws.receive({type:"state",revision:0,ready:true,seats:[{claimed:true,online:true},{claimed:true,online:true},{claimed:true,online:true},{claimed:true,online:true}],game:state});
 square(nodes,m.from).emit("click");square(nodes,m.to).emit("click");
 assert.equal(ws.sent.at(-1).type,"move");
 assert.equal(ws.sent.at(-1).from,m.from);
 assert.equal(ws.sent.at(-1).to,m.to);
});

test("online clock selection and authoritative clock snapshot render properly",async()=>{
 const {nodes,sockets,requests}=launch();
 nodes.onlineMode.emit("click");
 nodes.onlineClock.value="rapid15";
 await nodes.createRoom.emit("click");
 const payload=JSON.parse(requests[0].options.body);
 assert.equal(payload.clock,"rapid15");
 const ws=sockets[0];ws.onopen();
 ws.receive({type:"welcome",seat:0,persistent:false});
 const clock={preset:"rapid15",remaining:[900000,900000,900000,900000],activeSince:Date.now(),started:true,flag:null};
 ws.receive({type:"state",revision:0,ready:true,seats:[{claimed:true,online:true},{claimed:true,online:true},{claimed:true,online:true},{claimed:true,online:true}],game:Engine.fresh(),clock,persistent:false,variant:"quadra-ffa"});
 assert.equal(nodes.roomClockName.textContent,"15 | 10");
 assert.equal(nodes.roomStorage.textContent,"Temporary memory");
 assert.ok(nodes.players.children[0].children.some(child=>child.className==="clock-time"));
 assert.match(nodes.players.children[0].children.at(-1).textContent,/^15:00$/);
});

test("online replay supports move-by-move navigation after authenticated sync",async()=>{
 const {nodes,sockets,window}=launch();
 nodes.onlineMode.emit("click");
 await nodes.createRoom.emit("click");
 const ws=sockets[0];ws.onopen();ws.receive({type:"welcome",seat:0});
 const seats=Array.from({length:4},(_,i)=>({color:i,claimed:true,online:true}));
 const game=Engine.fresh("ffa");
 ws.receive({type:"state",revision:0,ready:true,seats,game,events:[],archives:[],drawVotes:[false,false,false,false]});
 const m=Engine.legal(game,0)[0];
 const next=Engine.acceptMove(game,{from:m.from,to:m.to},0);
 ws.receive({type:"state",revision:1,ready:true,seats,game:next,events:[{kind:"move",player:0,from:m.from,to:m.to}],archives:[],drawVotes:[false,false,false,false]});
 nodes["tab-moves"].emit("click");
 assert.equal(nodes.reviewHome.disabled,false);
 nodes.reviewHome.emit("click");
 assert.equal(window.QuadraApp.getReviewIndex(),0);
 assert.equal(nodes.status.textContent,"Reviewing move 0 of 1");
 nodes.reviewLive.emit("click");
 assert.equal(window.QuadraApp.getReviewIndex(),null);
});
test("authenticated multiplayer resignation and draw voting are wired",async()=>{
 const {nodes,sockets}=launch();
 nodes.onlineMode.emit("click");await nodes.createRoom.emit("click");
 const ws=sockets[0];ws.onopen();ws.receive({type:"welcome",seat:0});
 const seats=Array.from({length:4},(_,i)=>({color:i,claimed:true,online:true}));
 ws.receive({type:"state",revision:0,ready:true,seats,game:Engine.fresh("ffa"),events:[],drawVotes:[false,false,false,false]});
 assert.equal(nodes.matchActions.classList.contains("hidden"),false);
 nodes.drawVote.emit("click");
 assert.equal(ws.sent.at(-1).type,"draw-vote");
 nodes.resignRoom.emit("click");
 assert.equal(ws.sent.at(-1).type,"resign");
});
test("disconnecting a pregame lobby sends a seat release request",async()=>{
 const {nodes,sockets,sessionStorage}=launch();
 nodes.onlineMode.emit("click");await nodes.createRoom.emit("click");
 const ws=sockets[0];ws.onopen();ws.receive({type:"welcome",seat:0});
 const seats=[{color:0,claimed:true,online:true},...Array.from({length:3},(_,i)=>({color:i+1,claimed:false,online:false}))];
 ws.receive({type:"state",revision:0,ready:false,seats,game:Engine.fresh("ffa"),events:[]});
 nodes.leaveRoom.emit("click");
 assert.equal(ws.sent.at(-1).type,"vacate");
 ws.receive({type:"vacated"});
 assert.equal(sessionStorage.getItem("quadra-online"),null);
 assert.equal(nodes.localMode.attrs["aria-pressed"],"true");
});

test("local resignation and agreed draw support undo and autosave",()=>{
 const {nodes,window,storage}=launch();
 nodes.resignLocal.emit("click");
 let g=window.QuadraApp.getState();
 assert.equal(g.alive[0],false);
 assert.equal(g.turn,1);
 assert.match(g.moves.at(-1).notation,/resigned/);
 nodes.drawLocal.emit("click");
 g=window.QuadraApp.getState();
 assert.equal(g.winner,"Draw by agreement");
 assert.ok(storage.has("quadra-autosave-v3"));
 nodes.undo.emit("click");
 assert.equal(window.QuadraApp.getState().winner,null);
 nodes.undo.emit("click");
 assert.equal(window.QuadraApp.getState().alive[0],true);
});

test("game setup supports custom increment, named rooms and preferred colors",async()=>{
 const {nodes,requests}=launch();
 nodes.onlineMode.emit("click");
 nodes.onlineClock.value="custom";
 nodes.onlineClock.emit("change",{target:nodes.onlineClock});
 assert.equal(nodes.customTimeFields.classList.contains("hidden"),false);
 nodes.customMinutes.value="8";
 nodes.customIncrement.value="3";
 nodes.preferredSeat.value="2";
 nodes.roomTitleInput.value="Weekend chess";
 await nodes.createRoom.emit("click");
 const payload=JSON.parse(requests[0].options.body);
 assert.equal(payload.clock.type,"custom");
 assert.equal(payload.clock.minutes,8);
 assert.equal(payload.clock.incrementSeconds,3);
 assert.equal(payload.seat,2);
 assert.equal(payload.title,"Weekend chess");
});
test("four-seat readiness is explicit and can be withdrawn before a match starts",async()=>{
 const {nodes,sockets}=launch();
 nodes.onlineMode.emit("click");await nodes.createRoom.emit("click");
 const ws=sockets[0];ws.onopen();ws.receive({type:"welcome",seat:0});
 const seats=Array.from({length:4},(_,i)=>({color:i,claimed:true,online:true,ready:false}));
 ws.receive({type:"state",revision:0,ready:false,filled:true,seatReady:[false,false,false,false],seats,game:Engine.fresh("ffa")});
 assert.match(nodes.status.textContent,/Waiting for everyone/);
 nodes.readyButton.emit("click");
 assert.equal(ws.sent.at(-1).type,"ready");
 seats[0].ready=true;
 ws.receive({type:"state",revision:0,ready:false,filled:true,seatReady:[true,false,false,false],seats,game:Engine.fresh("ffa")});
 assert.equal(nodes.readyButton.textContent,"Cancel ready");
 nodes.readyButton.emit("click");
 assert.equal(ws.sent.at(-1).type,"unready");
 ws.receive({type:"state",revision:0,ready:true,filled:true,seatReady:[true,true,true,true],seats,game:Engine.fresh("ffa")});
 assert.equal(nodes.readyControls.classList.contains("hidden"),true);
 assert.equal(nodes.status.textContent,"Red to move");
});
test("Account tab is accessible without interfering with the playable board",()=>{
 const {nodes,window}=launch();
 nodes.headerAccount.emit("click");
 assert.equal(nodes["tab-account"].attrs["aria-selected"],"true");
 assert.equal(nodes["panel-account"].classList.contains("hidden"),false);
 assert.equal(window.QuadraApp.getState().b.filter(Boolean).length,64);
});

test("private/public room and provisional-rated settings are submitted at creation",async()=>{
 const {nodes,requests}=launch();
 nodes.onlineMode.emit("click");
 nodes.roomVisibility.value="public";
 nodes.roomRated.checked=true;
 await nodes.createRoom.emit("click");
 const sent=JSON.parse(requests[0].options.body);
 assert.equal(sent.visibility,"public");
 assert.equal(sent.rated,true);
});
test("spectator link opens a watch-only board and returns to rooms without taking a seat",()=>{
 const {nodes,sockets,window}=launch({url:"?watch=ABC1234"});
 assert.equal(sockets.length,1);
 const ws=sockets[0];ws.onopen();
 assert.equal(ws.sent[0].type,"watch");
 assert.equal(ws.sent[0].room,"ABC1234");
 ws.receive({type:"welcome",room:"ABC1234",spectator:true,seat:null});
 const seats=Array.from({length:4},(_,i)=>({color:i,claimed:true,online:true,ready:true,alias:null}));
 const game=Engine.fresh();
 ws.receive({type:"state",revision:1,ready:true,filled:true,title:"Public test",visibility:"public",rated:false,
  spectatorCount:1,hostSeat:0,seats,game,messages:[],events:[],archives:[],drawVotes:[false,false,false,false]});
 assert.equal(nodes.mySeat.textContent,"Spectator");
 assert.equal(nodes.chatComposer.classList.contains("hidden"),true);
 assert.equal(nodes.readyControls.classList.contains("hidden"),true);
 const m=Engine.legal(game,0)[0];
 square(nodes,m.from).emit("click");
 square(nodes,m.to).emit("click");
 assert.equal(ws.sent.some(x=>x.type==="move"),false);
 nodes.leaveRoom.emit("click");
 assert.equal(window.QuadraApp.isOnline(),false);
 assert.equal(nodes["tab-rooms"].attrs["aria-selected"],"true");
});
test("room chat history is visible and can be locally hidden without exposing account IDs",async()=>{
 const {nodes,sockets}=launch();
 nodes.onlineMode.emit("click");await nodes.createRoom.emit("click");
 const ws=sockets[0];ws.onopen();ws.receive({type:"welcome",seat:0});
 const seats=[{color:0,claimed:true,online:true,alias:"host",ready:false},{},{},{}];
 ws.receive({type:"state",revision:1,ready:false,filled:false,seats,game:Engine.fresh(),events:[],
  hostSeat:0,visibility:"private",messages:[{id:"abc",alias:"another",text:"Great match!",at:Date.now(),hidden:false}]});
 assert.equal(nodes.chatList.children.length,1);
 assert.equal(nodes.chatList.children[0].children[1].textContent,"Great match!");
 const actions=nodes.chatList.children[0].children[2].children;
 assert.ok(actions.some(b=>b.textContent==="Hide"));
 const hide=actions.find(b=>b.textContent==="Hide");
 hide.emit("click");
 assert.equal(nodes.chatList.children[0].children[1].textContent,"Hidden on this device");
});

test("home hub, global pages and contextual game navigation remain accessible",()=>{
 const {nodes}=launch();
 assert.equal(nodes.homeScreen.classList.contains("hidden"),false);
 assert.equal(nodes.workLayout.classList.contains("hidden"),true);
 nodes.headerRooms.emit("click");
 assert.equal(nodes.homeScreen.classList.contains("hidden"),true);
 assert.equal(nodes.arena.classList.contains("hidden"),true);
 nodes.headerPlay.emit("click");
 assert.equal(nodes.arena.classList.contains("hidden"),false);
 nodes.navMoves.emit("click");
 assert.equal(nodes["panel-moves"].classList.contains("hidden"),false);
 nodes.navReview.emit("click");
 assert.equal(nodes["panel-review"].classList.contains("hidden"),false);
 nodes.headerSettings.emit("click");
 assert.equal(nodes["panel-settings"].classList.contains("hidden"),false);
 nodes.headerHome.emit("click");
 assert.equal(nodes.homeScreen.classList.contains("hidden"),false);
});
test("one-code room joining bypasses the advanced room host form",async()=>{
 const {nodes,requests,window}=launch();
 nodes.homeJoinCode.value="abc1234";
 await nodes.homeJoin.emit("click");
 assert.equal(requests.some(r=>r.url.endsWith("/api/rooms/ABC1234/join")),true);
 assert.equal(window.QuadraApp.isOnline(),true);
 assert.equal(nodes["panel-play"].classList.contains("hidden"),false);
});
