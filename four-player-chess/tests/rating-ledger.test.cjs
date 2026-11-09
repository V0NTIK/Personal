"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createCommunity}=require("../community.js");
test("rated results update all four participants transactionally, exactly once, with daily anti-farming",async()=>{
 const ratedGames=new Map(),ratings=new Map();
 const query=async(sql,p=[])=>{
  if(sql.startsWith("CREATE "))return {rowCount:0,rows:[]};
  if(sql.startsWith("INSERT INTO quadra_rated_results")){
   const key=p[0]+":"+p[1];if(ratedGames.has(key))return {rowCount:0,rows:[]};
   ratedGames.set(key,{playersKey:p[2],status:"pending"});return {rowCount:1,rows:[{room_id:p[0]}]};
  }
  if(sql.startsWith("SELECT COUNT(*)")){
   const count=[...ratedGames.values()].filter(x=>x.playersKey===p[0]&&x.status==="counted").length;
   return {rowCount:1,rows:[{total:count}]};
  }
  if(sql.startsWith("UPDATE quadra_rated_results")){
   ratedGames.get(p[0]+":"+p[1]).status=sql.includes("daily-limit")?"daily-limit":"counted";
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith("INSERT INTO quadra_player_stats")){
   const key=p[0]+":"+p[1];if(!ratings.has(key))ratings.set(key,{user_id:p[0],rating:1200,games:0,wins:0,draws:0});
   return {rowCount:1,rows:[]};
  }
  if(sql.startsWith("SELECT user_id,rating FROM quadra_player_stats")){
   return {rowCount:4,rows:p[0].map(id=>ratings.get(id+":"+p[1]))};
  }
  if(sql.startsWith("UPDATE quadra_player_stats")){
   const row=ratings.get(p[3]+":"+p[4]);row.rating=Math.max(100,row.rating+p[0]);row.games++;row.wins+=p[1];row.draws+=p[2];
   return {rowCount:1,rows:[]};
  }
  throw Error("Unexpected query: "+sql.slice(0,60));
 };
 const store={persistent:true,query,transaction:fn=>fn(query)};
 const svc=createCommunity(store);await svc.init();
 const ids=["00000000-0000-4000-8000-000000000001","00000000-0000-4000-8000-000000000002","00000000-0000-4000-8000-000000000003","00000000-0000-4000-8000-000000000004"];
 const room={
  id:"ABCD123",rated:true,started:true,
  seats:ids.map(userId=>({userId})),game:{mode:"ffa",winner:"Red wins!"},
  events:Array.from({length:12},()=>({kind:"move"})),gameNo:1
 };
 const first=await svc.record(room);assert.equal(first.counted,true);
 assert.equal(first.delta.reduce((a,b)=>a+b),0);
 assert.equal(ratings.get(ids[0]+":ffa").rating>1200,true);
 assert.equal(ratings.get(ids[0]+":ffa").wins,1);
 assert.equal(ratedGames.size,1);
 assert.equal((await svc.record(room)).reason,"already-recorded");
 room.gameNo=2;assert.equal((await svc.record(room)).counted,true);
 room.gameNo=3;const limited=await svc.record(room);
 assert.equal(limited.counted,false);assert.equal(limited.reason,"daily-limit");
 assert.equal(ratings.get(ids[0]+":ffa").games,2);
 const tooShort={...room,gameNo:4,events:[{kind:"move"}]};
 assert.equal((await svc.record(tooShort)).reason,"too-short");
 assert.equal(ratedGames.size,3);
});
