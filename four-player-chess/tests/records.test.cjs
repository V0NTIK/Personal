"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const E=require("../engine.js"),Replay=require("../replay.js"),Records=require("../records.js");
test("portable export reconstructs game positions locally without server data",()=>{
 let g=E.fresh("ffa");const events=[];
 for(let i=0;i<4;i++){const m=E.legal(g,g.turn)[0];events.push({kind:"move",player:g.turn,from:m.from,to:m.to});g=E.acceptMove(g,{from:m.from,to:m.to},g.turn);}
 const json=JSON.stringify({format:"quadra-chess-game",version:1,mode:"ffa",variant:"quadra-ffa",events,game:g});
 const record=Records.decode(json,E,Replay);
 assert.equal(record.limited,false);
 assert.equal(record.positions.length,5);
 assert.deepEqual(record.positions.at(-1),g);
 assert.equal(record.moves.length,4);
});
test("archived game downloads can replay without a full game snapshot",()=>{
 const events=[{kind:"resign",player:0},{kind:"draw"}];
 const record=Records.decode({format:"quadra-chess-game",version:1,mode:"ffa",events,moves:[{notation:"Red resigned"},{notation:"Draw"}],result:"Draw by agreement",gameNo:5},E,Replay);
 assert.equal(record.positions.length,3);
 assert.equal(record.result,"Draw by agreement");
 assert.equal(record.gameNo,5);
});
test("older exports without events show a final board safely",()=>{
 const g=E.fresh("teams");
 const record=Records.decode({format:"quadra-chess-game",version:1,mode:"teams",game:g,events:null},E,Replay);
 assert.equal(record.limited,true);
 assert.equal(record.positions.length,1);
 assert.equal(record.positions[0].b.filter(Boolean).length,64);
});
test("reject unsupported or unsafe records instead of executing them",()=>{
 assert.throws(()=>Records.decode('{"format":"something-else","version":1}',E,Replay),/supported/);
 assert.throws(()=>Records.decode({format:"quadra-chess-game",version:1,mode:"ffa",events:[{kind:"move",player:0,from:0,to:1}]},E,Replay),/illegal/);
 assert.throws(()=>Records.decode({format:"quadra-chess-game",version:1,mode:"ffa",events:[]},null,Replay),/unavailable/);
});
