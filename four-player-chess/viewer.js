(function(){
"use strict";
const E=window.QuadraCore,R=window.QuadraReplay,Records=window.QuadraRecords;
const $=id=>document.getElementById(id);
if(!E||!R||!Records){$("feedback").textContent="The replay engine failed to load.";return;}
const tints=["#fa797e","#7fc1ff","#ffe084","#95e0b4"];
let record=null,step=0,orientation=0;
const visualSquare=(col,row)=>{let x=col,y=row;for(let k=0;k<orientation;k++){const nx=13-y;y=x;x=nx;}return E.idx(x,y);};
function boardState(){return record?record.positions[step]:E.fresh("ffa");}
function renderBoard(s){
 const board=$("board");board.replaceChildren();
 for(let j=0;j<196;j++){
  const i=visualSquare(j%14,Math.floor(j/14)),[x,y]=E.xy(i),p=s.b[i],valid=E.valid(x,y);
  const cell=document.createElement("div");
  cell.className="square "+(!valid?"void":(x+y)%2?"dark":"light");
  cell.setAttribute("role","gridcell");
  if(valid){
   cell.setAttribute("aria-label",E.sqName(i)+(p?" "+E.names[p.c]+" "+p.p:" empty"));
   if(s.last&&(s.last.from===i||s.last.to===i))cell.classList.add("last");
   if(p){
    const span=document.createElement("span");span.className="piece "+E.colors[p.c];
    span.textContent=E.glyph[p.p];span.setAttribute("aria-hidden","true");cell.append(span);
   }
  }
  board.append(cell);
 }
}
function renderPlayers(s){
 const host=$("players");host.replaceChildren();
 for(let c=0;c<4;c++){
  const card=document.createElement("div");card.className="player"+(!s.alive[c]?" eliminated":s.turn===c&&!s.winner?" active":"");
  const heading=document.createElement("div");heading.className="pname";
  const color=document.createElement("i");color.className="dot";color.style.background=tints[c];
  heading.append(color,document.createTextNode(E.names[c]));
  const stats=document.createElement("small");
  const pieces=s.b.filter(p=>p&&p.c===c),points=pieces.reduce((n,p)=>n+E.score[p.p],0);
  stats.textContent=s.alive[c]?pieces.length+" pieces · "+points+" pts":"Eliminated";
  card.append(heading,stats);host.append(card);
 }
}
function renderMoves(){
 const host=$("moveList");host.replaceChildren();
 const moves=record?.moves||[];
 $("movesCount").textContent="("+moves.length+")";
 if(!record){
  const p=document.createElement("p");p.className="history-empty";p.textContent="Select a game record to see its moves.";host.append(p);return;
 }
 if(!moves.length){
  const p=document.createElement("p");p.className="history-empty";p.textContent="No recorded moves.";host.append(p);return;
 }
 const canReplay=record.positions.length>1;
 for(let i=0;i<moves.length;i++){
  const m=moves[i];
  const button=document.createElement("button");button.className="move"+(canReplay&&step===i+1?" is-current":"");
  button.type="button";button.disabled=!canReplay;
  const number=document.createElement("span");number.className="move-number";number.textContent=String(i+1).padStart(2,"0");
  const color=document.createElement("span");color.className="move-color";color.style.background=tints[m.color]||"#90a4ae";
  const name=document.createElement("span");name.textContent=m.notation||"Unlabeled move";
  button.append(number,color,name);
  button.addEventListener("click",()=>{step=i+1;render();});
  host.append(button);
 }
}
function render(){
 const s=boardState();renderBoard(s);renderPlayers(s);renderMoves();
 const total=record?record.positions.length-1:0;
 $("positionIndex").textContent=record?(record.limited?"FINAL POSITION":"MOVE "+step+" / "+total):"REPLAY";
 $("positionStatus").textContent=!record?"Open a .json game record":step===total?(record.result||"In progress"):"Move "+step+" of "+total;
 $("positionMeta").textContent=!record?"Nothing is sent to a server":record.mode==="teams"?"Team game":"Free-for-all";
 $("boardHint").textContent=!record?"Choose a JSON file to start.":record.limited?"Final board only; no complete event log.":"Select a move or use the navigation buttons.";
 $("statusDot").className="status-dot"+(!record?" is-waiting":"");
 $("gameInfo").textContent=!record?"No game loaded":(record.gameNo?"Game "+record.gameNo+" · ":"")+record.moves.length+" history entries"+(record.limited?" · replay unavailable":"");
 for(const id of ["first","previous","next","last"])$(id).disabled=!record||record.positions.length<=1;
}
async function openFile(file){
 if(!file)return;
 if(file.size>3*1024*1024){$("feedback").textContent="File is too large (maximum 3 MB).";return;}
 $("feedback").textContent="Reading game record…";
 try{
  const json=await file.text();
  const result=Records.decode(json,E,R);
  record=result;step=result.positions.length-1;
  $("feedback").textContent="Loaded: "+file.name+(result.limited?" · final board only":" · complete replay");
  render();
 }catch(err){$("feedback").textContent=err.message||"Unable to read this record.";}
}
$("fileInput").addEventListener("change",e=>openFile(e.target.files?.[0]));
$("rotate").addEventListener("click",()=>{orientation=(orientation+1)%4;render();});
$("first").addEventListener("click",()=>{step=0;render();});
$("previous").addEventListener("click",()=>{step=Math.max(0,step-1);render();});
$("next").addEventListener("click",()=>{if(record)step=Math.min(record.positions.length-1,step+1);render();});
$("last").addEventListener("click",()=>{if(record)step=record.positions.length-1;render();});
const drop=$("dropZone");
drop.addEventListener("dragover",e=>{e.preventDefault();drop.classList.add("dragging");});
drop.addEventListener("dragleave",()=>drop.classList.remove("dragging"));
drop.addEventListener("drop",e=>{e.preventDefault();drop.classList.remove("dragging");openFile(e.dataTransfer?.files?.[0]);});
document.addEventListener("keydown",e=>{
 if(e.target?.matches?.("input,textarea,select"))return;
 if(e.key==="ArrowLeft"&&record){step=Math.max(0,step-1);render();}
 if(e.key==="ArrowRight"&&record){step=Math.min(record.positions.length-1,step+1);render();}
});
render();
})();
