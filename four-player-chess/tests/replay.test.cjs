"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const E=require("../engine.js");
const Replay=require("../replay.js");
test("replay precisely reconstructs legal chess moves",()=>{
 let g=E.fresh("ffa"),events=[];
 for(let turn=0;turn<8;turn++){
  const m=E.legal(g,g.turn)[0],player=g.turn;
  events.push({kind:"move",player,from:m.from,to:m.to});
  g=E.acceptMove(g,{from:m.from,to:m.to},player);
 }
 const positions=Replay.replay(events,"ffa",E);
 assert.ok(positions);
 assert.equal(positions.length,g.moves.length+1);
 assert.deepEqual(positions.at(-1),g);
 assert.equal(positions[0].b.filter(Boolean).length,64);
 assert.equal(positions[0].turn,0);
});
test("replay also handles time forfeits, resignations and agreed draws",()=>{
 const events=[{kind:"resign",player:0},{kind:"flag",player:1},{kind:"draw"}];
 const positions=Replay.replay(events,"ffa",E);
 assert.equal(positions.length,4);
 assert.equal(positions[1].alive[0],false);
 assert.equal(positions[2].alive[1],false);
 assert.equal(positions[3].winner,"Draw by agreement");
 assert.equal(positions[0].alive[0],true);
});
test("replay rejects unsupported events and impossible moves",()=>{
 assert.equal(Replay.replay([{kind:"bad"}],"ffa",E),null);
 assert.equal(Replay.replay([{kind:"move",player:0,from:0,to:1}],"ffa",E),null);
 assert.equal(Replay.replay(null,"ffa",E),null);
});
