(function(root){
"use strict";
function isGame(s){
 return !!s&&Array.isArray(s.b)&&s.b.length===196&&Array.isArray(s.alive)&&s.alive.length===4&&
 Array.isArray(s.moves)&&s.moves.length<=3000&&Number.isInteger(s.turn)&&s.turn>=0&&s.turn<4&&
 ["ffa","teams"].includes(s.mode);
}
function decode(input,engine,replayer){
 const data=typeof input==="string"?JSON.parse(input):input;
 if(!data||data.format!=="quadra-chess-game"||data.version!==1)throw Error("Not a supported Quadra Chess game record.");
 if(!["ffa","teams"].includes(data.mode))throw Error("Invalid game variant.");
 if(!engine||!replayer)throw Error("Replay engine unavailable.");
 const rawEvents=data.events;
 if(rawEvents!==null&&rawEvents!==undefined&&!Array.isArray(rawEvents))throw Error("Invalid event history.");
 if(Array.isArray(rawEvents)&&rawEvents.length>2000)throw Error("This game has too many events to replay safely.");
 let positions=null;
 if(Array.isArray(rawEvents)){
  positions=replayer.replay(rawEvents,data.mode,engine);
  if(!positions)throw Error("The event record contains illegal or unsupported moves.");
  if(data.game&&isGame(data.game)&&positions.at(-1).moves.length!==data.game.moves.length)positions=null;
  if(data.moves&&Array.isArray(data.moves)&&positions&&positions.at(-1).moves.length!==data.moves.length)positions=null;
 }
 let limited=false;
 if(!positions){
  if(!isGame(data.game))throw Error("No valid board position or complete replay history in this file.");
  positions=[data.game];limited=true;
 }
 const final=positions.at(-1);
 const moves=limited?data.game.moves:final.moves;
 return {mode:data.mode,variant:data.variant||"quadra-ffa",gameNo:data.gameNo||null,result:data.result||final.winner||"In progress",
  positions,moves,limited,clock:data.clock||"untimed",metadata:{exportedAt:data.exportedAt||null,endedAt:data.endedAt||null}};
}
const api={decode,isGame};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.QuadraRecords=api;
})(typeof window!=="undefined"?window:null);
