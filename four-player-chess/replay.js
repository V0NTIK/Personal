(function(root){
"use strict";
function replay(events,mode,engine){
 if(!Array.isArray(events)||!engine||!["ffa","teams"].includes(mode))return null;
 let game=engine.fresh(mode);const positions=[engine.clone(game)];
 try{for(const e of events){
  const old=game.moves.length;
  if(e.kind==="move")game=engine.acceptMove(game,{from:e.from,to:e.to,...(e.promotion?{promotion:e.promotion}:{})},e.player);
  else if(e.kind==="resign")game=engine.eliminatePlayer(game,e.player,"resign");
  else if(e.kind==="flag")game=engine.eliminatePlayer(game,e.player,"time");
  else if(e.kind==="draw")game=engine.concludeDraw(game);
  else return null;
  const added=game.moves.length-old;
  if(added<1)return null;
  for(let i=0;i<added;i++)positions.push(engine.clone(game));
 }return positions;}catch(e){return null;}
}
const api={replay};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.QuadraReplay=api;
})(typeof window!=="undefined"?window:null);
