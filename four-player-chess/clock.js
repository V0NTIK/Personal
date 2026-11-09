"use strict";
const PRESETS=Object.freeze({
  untimed:Object.freeze({id:"untimed",name:"No clock",initialMs:null,incrementMs:0}),
  blitz5:Object.freeze({id:"blitz5",name:"5 min",initialMs:5*60_000,incrementMs:0}),
  rapid10:Object.freeze({id:"rapid10",name:"10 min",initialMs:10*60_000,incrementMs:0}),
  rapid15:Object.freeze({id:"rapid15",name:"15 min + 10 sec",initialMs:15*60_000,incrementMs:10_000}),
  classical30:Object.freeze({id:"classical30",name:"30 min",initialMs:30*60_000,incrementMs:0})
});
function preset(id){return PRESETS[id]||null;}
function create(id="untimed"){
 const p=preset(id);
 if(!p)throw Error("Unknown time control.");
 return {preset:id,remaining:p.initialMs===null?null:[p.initialMs,p.initialMs,p.initialMs,p.initialMs],activeSince:null,started:false,flag:null};
}
function copy(clock){return {preset:clock.preset,remaining:clock.remaining?.slice()??null,activeSince:clock.activeSince,started:clock.started,flag:clock.flag??null};}
function start(clock,now){if(!clock||clock.started||clock.remaining===null)return clock;clock.started=true;clock.activeSince=now;return clock;}
function settle(clock,turn,now){
 if(!clock||clock.remaining===null||!clock.started||clock.flag!==null||clock.activeSince===null)return null;
 if(!Number.isInteger(turn)||turn<0||turn>3)throw Error("Invalid active player.");
 const elapsed=Math.max(0,Math.floor(now-clock.activeSince));
 clock.remaining[turn]=Math.max(0,clock.remaining[turn]-elapsed);
 clock.activeSince=now;
 if(clock.remaining[turn]===0){clock.flag=turn;return turn;}
 return null;
}
function moved(clock,player,now){
 if(!clock||clock.remaining===null||!clock.started)return;
 const p=preset(clock.preset);
 clock.remaining[player]+=p.incrementMs;
 clock.activeSince=now;
}
function visible(clock,turn,now){
 if(!clock)return null;
 const n=copy(clock);
 if(n.remaining!==null&&n.started&&n.flag===null&&n.activeSince!==null&&Number.isInteger(turn)){
  const delta=Math.max(0,Math.floor(now-n.activeSince));
  n.remaining[turn]=Math.max(0,n.remaining[turn]-delta);
 }
 return n;
}
module.exports={PRESETS,preset,create,copy,start,settle,moved,visible};
