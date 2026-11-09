"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const E=require("../engine.js");
const {review}=require("../review.js");
test("review produces a tactical recap without inventing chess-engine accuracy",()=>{
 let g=E.fresh("ffa");const positions=[E.clone(g)];
 for(let t=0;t<8;t++){
  const moves=E.legal(g,g.turn);const move=moves[0];g=E.acceptMove(g,{from:move.from,to:move.to,...(move.promotion?{promotion:move.promotion}:{})},g.turn);
  // The rules engine may occasionally append elimination entries on its own.
  while(positions.length<=g.moves.length)positions.push(E.clone(g));
 }
 const report=review(positions,E);
 assert.ok(report);
 assert.equal(report.moves,g.moves.length);
 assert.equal(report.players.reduce((n,p)=>n+p.moves,0),report.moves);
 assert.ok(report.disclaimer.includes("not computer evaluation"));
 assert.equal(report.players.length,4);
});
test("replay analysis never treats an incomplete history as analyzed",()=>{
 assert.equal(review([],E),null);
 assert.equal(review([E.fresh()],null),null);
 const g=E.fresh();
 const move=E.legal(g,0)[0],next=E.acceptMove(g,{from:move.from,to:move.to},0);
 assert.equal(review([next],E),null);
});
