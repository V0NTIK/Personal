"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {outcomes,changes,achievementList,createCommunity}=require("../community.js");
test("four-player FFA and Teams results are recognized without inventing placements",()=>{
 assert.deepEqual(outcomes("ffa","Red wins!"),[1,0,0,0]);
 assert.deepEqual(outcomes("ffa","Green wins!"),[0,0,0,1]);
 assert.deepEqual(outcomes("teams","Red & Yellow win!"),[1,0,1,0]);
 assert.deepEqual(outcomes("teams","Blue & Green win!"),[0,1,0,1]);
 assert.deepEqual(outcomes("ffa","Draw by agreement"),[.5,.5,.5,.5]);
 assert.equal(outcomes("ffa","Something else"),null);
});
test("provisional Elo is pairwise zero-sum, with mode-specific team scoring",()=>{
 const before=[1200,1200,1200,1200];
 const result=changes(before,[1,0,0,0],"ffa");
 assert.ok(result[0]>0);
 assert.ok(result.slice(1).every(x=>x<0));
 assert.equal(result.reduce((a,b)=>a+b),0);
 const team=changes(before,[1,0,1,0],"teams");
 assert.deepEqual(team,[12,-12,12,-12]);
 const draw=changes(before,[.5,.5,.5,.5],"ffa");
 assert.deepEqual(draw,[0,0,0,0]);
});
test("achievements derive from real counted games and remain locked otherwise",()=>{
 const empty=achievementList([]);
 assert.equal(empty.every(x=>!x.unlocked),true);
 const achievements=achievementList([{rating:1450,games:20,wins:2,draws:1}]);
 assert.equal(achievements.every(x=>x.unlocked),true);
 assert.equal(new Set(achievements.map(x=>x.id)).size,achievements.length);
});
test("no database means leaderboards are empty and rated record is skipped",async()=>{
 const community=createCommunity({persistent:false});
 await community.init();
 assert.deepEqual(await community.leaderboard(),[]);
 assert.deepEqual(await community.profile("anything"),{stats:[],achievements:achievementList([])});
 assert.deepEqual(await community.record({rated:false}),{counted:false,reason:"not-rated"});
});
