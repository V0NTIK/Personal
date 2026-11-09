(function(root){
"use strict";
function review(positions,engine){
 if(!Array.isArray(positions)||!positions.length||!engine)return null;
 const final=positions[positions.length-1],moves=final?.moves||[];
 if(positions.length!==moves.length+1)return null;
 const players=Array.from({length:4},(_,color)=>({color,moves:0,captures:0,checks:0,promotions:0,eliminations:0}));
 const moments=[];
 const pieces=s=>Array.from({length:4},(_,c)=>s.b.filter(p=>p&&p.c===c).length);
 for(let i=0;i<moves.length;i++){
  const a=positions[i],b=positions[i+1],move=moves[i],color=move.color;
  if(!Number.isInteger(color)||color<0||color>3)continue;
  const player=players[color];player.moves++;
  const before=pieces(a),after=pieces(b);
  const removed=before.map((value,c)=>c===color?0:Math.max(0,value-after[c])).reduce((sum,n)=>sum+n,0);
  const checks=b.alive.map((v,c)=>v&&c!==color&&engine.isCheck(b,c)?c:null).filter(c=>c!==null);
  const isElimination=move.notation?.includes("eliminated");
  const isPromotion=/=[QRBN]/.test(move.notation||"");
  if(!isElimination&&removed>0)player.captures+=removed;
  if(checks.length)player.checks++;
  if(isPromotion)player.promotions++;
  if(isElimination)player.eliminations++;
  const labels=[];
  if(isElimination)labels.push("Elimination");
  if(!isElimination&&removed>0)labels.push("Capture"+(removed>1?"s":""));
  if(checks.length)labels.push("Check");
  if(isPromotion)labels.push("Promotion");
  if(/Draw by agreement|Draw agreed/i.test(move.notation||""))labels.push("Agreed draw");
  if(labels.length)moments.push({ply:i+1,color,notation:move.notation||"Move",labels,description:labels.join(" · ")});
 }
 const endMaterial=Array.from({length:4},(_,c)=>final.b.reduce((n,p)=>n+(p?.c===c?(engine.score[p.p]||0):0),0));
 return {result:final.winner||"In progress",moves:moves.length,players:players.map((p,c)=>({...p,material:endMaterial[c],alive:final.alive[c]})),moments,
  disclaimer:"This is an event-based game recap, not computer evaluation or move accuracy. It does not identify best moves or blunders."};
}
const api={review};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.QuadraReview=api;
})(typeof window!=="undefined"?window:null);
