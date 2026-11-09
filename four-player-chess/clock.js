"use strict";
const PRESETS=Object.freeze({
 untimed:{id:"untimed",name:"Unlimited",initialMs:null,incrementMs:0},
 bullet1:{id:"bullet1",name:"1 min",initialMs:60000,incrementMs:0},
 bullet1inc:{id:"bullet1inc",name:"1 | 1",initialMs:60000,incrementMs:1000},
 bullet2inc:{id:"bullet2inc",name:"2 | 1",initialMs:120000,incrementMs:1000},
 blitz3:{id:"blitz3",name:"3 min",initialMs:180000,incrementMs:0},
 blitz3inc:{id:"blitz3inc",name:"3 | 2",initialMs:180000,incrementMs:2000},
 blitz5:{id:"blitz5",name:"5 min",initialMs:300000,incrementMs:0},
 blitz5inc:{id:"blitz5inc",name:"5 | 5",initialMs:300000,incrementMs:5000},
 rapid10:{id:"rapid10",name:"10 min",initialMs:600000,incrementMs:0},
 rapid10inc:{id:"rapid10inc",name:"10 | 5",initialMs:600000,incrementMs:5000},
 rapid15:{id:"rapid15",name:"15 | 10",initialMs:900000,incrementMs:10000},
 classical30:{id:"classical30",name:"30 min",initialMs:1800000,incrementMs:0}
});
for(const item of Object.values(PRESETS))Object.freeze(item);
function preset(id){return PRESETS[id]||null;}
function normalize(spec="untimed"){
 if(typeof spec==="string"){const p=preset(spec);if(!p)throw Error("Unknown time control.");return {preset:p.id,initialMs:p.initialMs,incrementMs:p.incrementMs};}
 if(!spec||typeof spec!=="object"||spec.type!=="custom"||!Number.isInteger(spec.minutes)||!Number.isInteger(spec.incrementSeconds)||
 spec.minutes<1||spec.minutes>180||spec.incrementSeconds<0||spec.incrementSeconds>60)throw Error("Custom time must be 1–180 minutes with 0–60 seconds of increment.");
 return {preset:"custom",initialMs:spec.minutes*60000,incrementMs:spec.incrementSeconds*1000};
}
function create(spec="untimed"){
 const n=normalize(spec);
 return {...n,remaining:n.initialMs===null?null:Array(4).fill(n.initialMs),activeSince:null,started:false,flag:null};
}
function copy(clock){
 return {preset:clock.preset,initialMs:clock.initialMs??preset(clock.preset)?.initialMs??null,incrementMs:clock.incrementMs??preset(clock.preset)?.incrementMs??0,
 remaining:clock.remaining?.slice()??null,activeSince:clock.activeSince,started:clock.started,flag:clock.flag??null};
}
function start(clock,t){if(!clock||clock.started||clock.remaining===null)return clock;clock.started=true;clock.activeSince=t;return clock;}
function settle(clock,turn,t){
 if(!clock||clock.remaining===null||!clock.started||clock.flag!==null||clock.activeSince===null)return null;
 if(!Number.isInteger(turn)||turn<0||turn>3)throw Error("Invalid active player.");
 const elapsed=Math.max(0,Math.floor(t-clock.activeSince));
 clock.remaining[turn]=Math.max(0,clock.remaining[turn]-elapsed);clock.activeSince=t;
 if(clock.remaining[turn]===0){clock.flag=turn;return turn;}
 return null;
}
function moved(clock,player,t){
 if(!clock||clock.remaining===null||!clock.started)return;
 clock.remaining[player]+=clock.incrementMs??preset(clock.preset)?.incrementMs??0;
 clock.activeSince=t;
}
function visible(clock,turn,t){
 if(!clock)return null;
 const n=copy(clock);
 if(n.remaining!==null&&n.started&&n.flag===null&&n.activeSince!==null&&Number.isInteger(turn)){
  const elapsed=Math.max(0,Math.floor(t-n.activeSince));
  n.remaining[turn]=Math.max(0,n.remaining[turn]-elapsed);
 }
 return n;
}
module.exports={PRESETS,preset,normalize,create,copy,start,settle,moved,visible};
