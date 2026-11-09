(function(){
"use strict";
const N=14, colors=["red","blue","yellow","green"], names=["Red","Blue","Yellow","Green"], glyph={k:"♚",q:"♛",r:"♜",b:"♝",n:"♞",p:"♟"}, score={p:1,n:3,b:3,r:5,q:9,k:0}, letters="abcdefghijklmn";
const idx=(x,y)=>y*N+x, xy=i=>[i%N,Math.floor(i/N)], valid=(x,y)=>x>=0&&x<N&&y>=0&&y<N&&!((x<3||x>10)&&(y<3||y>10));
const team=p=>p%2, allied=(a,b,mode)=>a===b||(mode==="teams"&&team(a)===team(b));
const rotate=(x,y,c)=>c===0?[x,y]:c===1?[13-y,x]:c===2?[13-x,13-y]:[y,13-x];
const forward=[[0,-1],[1,0],[0,1],[-1,0]], side=[[1,0],[0,1],[-1,0],[0,-1]];
function fresh(mode){const b=Array(N*N).fill(null),order=["r","n","b","q","k","b","n","r"];for(let c=0;c<4;c++)for(let x=3;x<=10;x++){const [bx,by]=rotate(x,13,c),[px,py]=rotate(x,12,c);b[idx(bx,by)]={p:order[x-3],c,m:false};b[idx(px,py)]={p:"p",c,m:false};}return {b,turn:0,alive:[true,true,true,true],mode:mode||"ffa",ep:null,moves:[],last:null,winner:null,round:1};}
function clone(s){return {b:s.b.map(p=>p?{...p}:null),turn:s.turn,alive:s.alive.slice(),mode:s.mode,ep:s.ep?{...s.ep}:null,moves:s.moves.map(m=>({...m})),last:s.last?{...s.last}:null,winner:s.winner,round:s.round};}
function isEnemy(a,b,s){return b&&s.alive[b.c]&&!allied(a,b.c,s.mode);}
function threatened(s,square,color){const [tx,ty]=xy(square);for(let f=0;f<N*N;f++){const pc=s.b[f];if(!pc||!s.alive[pc.c]||allied(color,pc.c,s.mode))continue;const [x,y]=xy(f);if(pc.p==="p"){const d=forward[pc.c],a=side[pc.c];for(const sign of [-1,1])if(x+d[0]+sign*a[0]===tx&&y+d[1]+sign*a[1]===ty)return true;continue;}const ds=pc.p==="n"?[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]:pc.p==="k"?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:pc.p==="b"?[[1,1],[1,-1],[-1,1],[-1,-1]]:pc.p==="r"?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];for(const [dx,dy] of ds){let xx=x+dx,yy=y+dy;while(valid(xx,yy)){if(xx===tx&&yy===ty)return true;if(s.b[idx(xx,yy)]||pc.p==="n"||pc.p==="k")break;xx+=dx;yy+=dy;}}}return false;}
function kingSquare(s,c){return s.b.findIndex(p=>p&&p.c===c&&p.p==="k");}
function isCheck(s,c){const k=kingSquare(s,c);return k>=0&&threatened(s,k,c);}
function rawMoves(s,f,castleAllowed){const pc=s.b[f];if(!pc||!s.alive[pc.c])return [];const [x,y]=xy(f),out=[];const add=(xx,yy,extra)=>{if(!valid(xx,yy))return false;const t=idx(xx,yy),hit=s.b[t];if(hit&&(!isEnemy(pc.c,hit,s)||hit.p==="k"))return false;out.push({from:f,to:t,...extra});return !hit;};
if(pc.p==="p"){const d=forward[pc.c],a=side[pc.c],xx=x+d[0],yy=y+d[1];if(valid(xx,yy)&&!s.b[idx(xx,yy)]){out.push({from:f,to:idx(xx,yy)});const xx2=xx+d[0],yy2=yy+d[1];if(!pc.m&&valid(xx2,yy2)&&!s.b[idx(xx2,yy2)])out.push({from:f,to:idx(xx2,yy2),double:true});}for(const sign of [-1,1]){const cx=xx+sign*a[0],cy=yy+sign*a[1];if(!valid(cx,cy))continue;const t=idx(cx,cy),hit=s.b[t];if(isEnemy(pc.c,hit,s)&&hit.p!=="k")out.push({from:f,to:t});else if(s.ep&&s.ep.target===t&&s.ep.victim!==undefined){const victim=s.b[s.ep.victim];if(victim&&victim.p==="p"&&isEnemy(pc.c,victim,s))out.push({from:f,to:t,ep:s.ep.victim});}}return out;}
const ds=pc.p==="n"?[[1,2],[2,1],[-1,2],[-2,1],[1,-2],[2,-1],[-1,-2],[-2,-1]]:pc.p==="k"?[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]]:pc.p==="b"?[[1,1],[1,-1],[-1,1],[-1,-1]]:pc.p==="r"?[[1,0],[-1,0],[0,1],[0,-1]]:[[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]];
for(const [dx,dy] of ds){let xx=x+dx,yy=y+dy;while(valid(xx,yy)){if(!add(xx,yy))break;if(pc.p==="k"||pc.p==="n")break;xx+=dx;yy+=dy;}}
if(pc.p==="k"&&castleAllowed&&!pc.m&&!isCheck(s,pc.c)){for(const dir of [-1,1]){const rloc=rotate(dir===-1?3:10,13,pc.c),rookI=idx(...rloc),rook=s.b[rookI];if(!rook||rook.p!=="r"||rook.c!==pc.c||rook.m)continue;const v=side[pc.c];let clear=true;for(let j=1;j<= (dir===-1?3:2);j++){const xx=x+v[0]*dir*j,yy=y+v[1]*dir*j;if(!valid(xx,yy)||s.b[idx(xx,yy)]||j<=2&&threatened(s,idx(xx,yy),pc.c)){clear=false;break;}}if(clear)out.push({from:f,to:idx(x+v[0]*dir*2,y+v[1]*dir*2),castle:{rookI,rookTo:idx(x+v[0]*dir,y+v[1]*dir)}});}}
return out;}
function reachEnd(square,c){const [x,y]=xy(square);return c===0?y===3:c===1?x===10:c===2?y===10:x===3;}
function perform(s,m,advance){const q=clone(s),pc=q.b[m.from];q.b[m.from]=null;const captured=q.b[m.to];if(m.ep!==undefined)q.b[m.ep]=null;pc.m=true;if(m.promotion)pc.p=m.promotion;q.b[m.to]=pc;if(m.castle){const rook=q.b[m.castle.rookI];q.b[m.castle.rookI]=null;if(rook){rook.m=true;q.b[m.castle.rookTo]=rook;}}q.ep=null;if(m.double){const [a,b]=xy(m.from),[c,d]=xy(m.to);q.ep={target:idx((a+c)/2,(b+d)/2),victim:m.to,owner:pc.c};}
q.last={from:m.from,to:m.to};if(advance){const notation=names[pc.c]+": "+letters[xy(m.from)[0]]+(14-xy(m.from)[1])+"–"+letters[xy(m.to)[0]]+(14-xy(m.to)[1])+(m.castle?" (castle)":"")+(m.ep!==undefined?" e.p.":"")+(m.promotion?"="+m.promotion.toUpperCase():"")+(captured||m.ep!==undefined?" ×":"");q.moves.push({notation,color:pc.c});q.turn=(pc.c+1)%4;if(q.turn===0)q.round++;}return q;}
function legal(s,c){if(!s.alive[c])return [];const out=[];for(let f=0;f<N*N;f++){if(s.b[f]?.c!==c)continue;for(const m of rawMoves(s,f,true)){const simulated=perform(s,m,false);if(!isCheck(simulated,c))out.push(m);}}return out;}
function finish(s){for(let attempt=0;attempt<4;attempt++){const active=s.alive.map((v,i)=>v?i:-1).filter(i=>i>=0);if(active.length<=1){s.winner=active.length?names[active[0]]+" wins!":"Draw";return;}if(s.mode==="teams"&&active.every(c=>team(c)===team(active[0]))){s.winner=(team(active[0])===0?"Red & Yellow":"Blue & Green")+" win!";return;}if(!s.alive[s.turn]){s.turn=(s.turn+1)%4;continue;}if(legal(s,s.turn).length){s.winner=null;return;}const c=s.turn;s.alive[c]=false;for(let i=0;i<s.b.length;i++)if(s.b[i]?.c===c)s.b[i]=null;s.moves.push({notation:names[c]+" eliminated (no legal moves)",color:c});if(s.ep?.owner===c)s.ep=null;s.turn=(c+1)%4;}s.winner="Game finished";}
function eliminatePlayer(state,color,reason="time"){
 if(!Number.isInteger(color)||color<0||color>3||!state.alive[color])throw Error("Player is not active.");
 const s=clone(state);s.alive[color]=false;
 for(let i=0;i<s.b.length;i++)if(s.b[i]?.c===color)s.b[i]=null;
 if(s.ep?.owner===color)s.ep=null;
 s.moves.push({notation:names[color]+" eliminated ("+(reason==="time"?"time expired":"resigned")+")",color});
 if(s.turn===color)s.turn=(color+1)%4;
 finish(s);return s;
}
function sqName(i){const [x,y]=xy(i);return letters[x]+(14-y);}


function acceptMove(s,action,color){
 if(!s||s.winner||s.turn!==color||!s.alive[color]) throw Error("Not your turn.");
 if(!action||!Number.isInteger(action.from)||!Number.isInteger(action.to)||action.from<0||action.from>=N*N||action.to<0||action.to>=N*N)throw Error("Invalid square.");
 const m=legal(s,color).find(v=>v.from===action.from&&v.to===action.to);
 if(!m)throw Error("Illegal move.");
 const pawn=s.b[m.from]?.p==="p",isPromotion=pawn&&reachEnd(m.to,color);
 const promo=action.promotion;
 if(isPromotion&&!["q","r","b","n"].includes(promo))throw Error("Choose a valid promotion piece.");
 if(!isPromotion&&promo!==undefined&&promo!==null&&promo!=="")throw Error("Unexpected promotion.");
 const n=perform(s,{...m,...(isPromotion?{promotion:promo}:{})},true);finish(n);return n;
}
function publicState(s){return {b:s.b,turn:s.turn,alive:s.alive,mode:s.mode,ep:s.ep,moves:s.moves,last:s.last,winner:s.winner,round:s.round};}
const api={N,colors,names,glyph,score,letters,idx,xy,valid,team,allied,rotate,forward,side,fresh,clone,isEnemy,threatened,kingSquare,isCheck,rawMoves,reachEnd,perform,legal,finish,sqName,acceptMove,publicState,eliminatePlayer};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(typeof window!=="undefined")window.QuadraCore=api;

})();
