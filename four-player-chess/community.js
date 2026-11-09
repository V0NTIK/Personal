"use strict";
const MODES=new Set(["ffa","teams"]);
const START_RATING=1200,K=24;
function outcomes(mode,winner){
 if(!MODES.has(mode)||typeof winner!=="string")return null;
 if(/^Draw/.test(winner))return [0.5,0.5,0.5,0.5];
 if(mode==="ffa"){
  const color=["Red","Blue","Yellow","Green"].findIndex(name=>winner===name+" wins!");
  if(color===-1)return null;
  return [0,0,0,0].map((_,i)=>i===color?1:0);
 }
 if(winner==="Red & Yellow win!")return [1,0,1,0];
 if(winner==="Blue & Green win!")return [0,1,0,1];
 return null;
}
function changes(ratings,results,mode){
 if(ratings?.length!==4||results?.length!==4||!MODES.has(mode))throw Error("Invalid rated result.");
 const delta=[0,0,0,0];
 for(let i=0;i<4;i++)for(let j=i+1;j<4;j++){
  if(mode==="teams"&&i%2===j%2)continue;
  const expected=1/(1+Math.pow(10,(ratings[j]-ratings[i])/400));
  const actual=results[i]===results[j]?0.5:results[i]>results[j]?1:0;
  const factor=mode==="teams"?K/2:K/3;
  const adjustment=factor*(actual-expected);
  delta[i]+=adjustment;delta[j]-=adjustment;
 }
 return delta.map(Math.round);
}
function achievementList(stats){
 const total=stats.reduce((n,s)=>n+Number(s.games||0),0);
 const wins=stats.reduce((n,s)=>n+Number(s.wins||0),0);
 const draws=stats.reduce((n,s)=>n+Number(s.draws||0),0);
 const maxRating=Math.max(START_RATING,...stats.map(s=>Number(s.rating||START_RATING)));
 return [
  ["first-game","First Match","Complete your first rated game",total>=1],
  ["first-win","First Victory","Earn your first rated win",wins>=1],
  ["persistent","Regular","Finish five rated games",total>=5],
  ["seasoned","Veteran","Finish twenty rated games",total>=20],
  ["peacemaker","Diplomat","Finish a rated game in a draw",draws>=1],
  ["climber","Rising Star","Reach a provisional rating of 1400",maxRating>=1400]
 ].map(([id,name,description,unlocked])=>({id,name,description,unlocked}));
}
function createCommunity(store){
 const enabled=!!store.persistent;
 async function init(){
  if(!enabled)return;
  await store.query("CREATE TABLE IF NOT EXISTS quadra_player_stats (user_id uuid NOT NULL REFERENCES quadra_accounts(id) ON DELETE CASCADE,mode varchar(10) NOT NULL,rating integer NOT NULL DEFAULT 1200,games integer NOT NULL DEFAULT 0,wins integer NOT NULL DEFAULT 0,draws integer NOT NULL DEFAULT 0,updated_at timestamptz NOT NULL DEFAULT now(),PRIMARY KEY(user_id,mode))");
  await store.query("CREATE TABLE IF NOT EXISTS quadra_rated_results (room_id varchar(7) NOT NULL,game_no integer NOT NULL,players_key varchar(160) NOT NULL,mode varchar(10) NOT NULL,calculated_at timestamptz NOT NULL DEFAULT now(),status varchar(24) NOT NULL,PRIMARY KEY(room_id,game_no))");
  await store.query("CREATE INDEX IF NOT EXISTS quadra_rated_results_repeat_idx ON quadra_rated_results(players_key,calculated_at)");
 }
 async function ratings(userIds,mode){
  if(!enabled||!userIds.length||!MODES.has(mode))return new Map();
  const result=await store.query("SELECT user_id,rating,games,wins,draws FROM quadra_player_stats WHERE user_id=ANY($1::uuid[]) AND mode=$2",[userIds,mode]);
  return new Map(result.rows.map(r=>[r.user_id,{rating:Number(r.rating),games:Number(r.games),wins:Number(r.wins),draws:Number(r.draws)}]));
 }
 async function profile(id){
  if(!enabled)return {stats:[],achievements:achievementList([])};
  const result=await store.query("SELECT mode,rating,games,wins,draws FROM quadra_player_stats WHERE user_id=$1 ORDER BY mode",[id]);
  return {stats:result.rows.map(r=>({mode:r.mode,rating:Number(r.rating),games:Number(r.games),wins:Number(r.wins),draws:Number(r.draws),provisional:Number(r.games)<10})),achievements:achievementList(result.rows)};
 }
 async function leaderboard(mode="ffa",limit=30){
  if(!enabled||!MODES.has(mode))return [];
  const result=await store.query("SELECT a.handle AS username,s.rating,s.games,s.wins,s.draws FROM quadra_player_stats s JOIN quadra_accounts a ON a.id=s.user_id WHERE s.mode=$1 AND s.games>0 ORDER BY s.rating DESC,s.wins DESC LIMIT $2",[mode,Math.max(1,Math.min(50,Number(limit)||30))]);
  return result.rows.map((r,i)=>({position:i+1,username:r.username,rating:Number(r.rating),games:Number(r.games),wins:Number(r.wins),draws:Number(r.draws),provisional:Number(r.games)<10}));
 }
 async function record(room){
  if(!enabled||!room.rated||!room.game?.winner||!room.started)return {counted:false,reason:"not-rated"};
  const accounts=room.seats.map(s=>s?.userId||null);
  if(accounts.some(x=>!x)||new Set(accounts).size!==4)return {counted:false,reason:"accounts-required"};
  const result=outcomes(room.game.mode,room.game.winner);
  if(!result)return {counted:false,reason:"unsupported-result"};
  const ids=accounts.slice().sort(),key=ids.join(":");
  return store.transaction(async query=>{
   const row=await query("INSERT INTO quadra_rated_results(room_id,game_no,players_key,mode,status) VALUES($1,$2,$3,$4,'pending') ON CONFLICT DO NOTHING RETURNING room_id",[room.id,room.gameNo,key,room.game.mode]);
   if(!row.rowCount)return {counted:false,reason:"already-recorded"};
   // Prevent unlimited farming between exactly the same quartet.
   const repeats=await query("SELECT COUNT(*)::int AS total FROM quadra_rated_results WHERE players_key=$1 AND status='counted' AND calculated_at>now()-interval '24 hours'",[key]);
   if(Number(repeats.rows[0]?.total||0)>=2){
    await query("UPDATE quadra_rated_results SET status='daily-limit' WHERE room_id=$1 AND game_no=$2",[room.id,room.gameNo]);
    return {counted:false,reason:"daily-limit"};
   }
   for(const id of accounts)await query("INSERT INTO quadra_player_stats(user_id,mode) VALUES($1,$2) ON CONFLICT DO NOTHING",[id,room.game.mode]);
   const stats=await query("SELECT user_id,rating FROM quadra_player_stats WHERE user_id=ANY($1::uuid[]) AND mode=$2 FOR UPDATE",[accounts,room.game.mode]);
   const map=new Map(stats.rows.map(r=>[r.user_id,Number(r.rating)]));
   const before=accounts.map(id=>map.get(id)??START_RATING);
   const delta=changes(before,result,room.game.mode);
   for(let i=0;i<4;i++){
    await query("UPDATE quadra_player_stats SET rating=GREATEST(100,rating+$1),games=games+1,wins=wins+$2,draws=draws+$3,updated_at=now() WHERE user_id=$4 AND mode=$5",
     [delta[i],result[i]===1?1:0,result[i]===0.5?1:0,accounts[i],room.game.mode]);
   }
   await query("UPDATE quadra_rated_results SET status='counted' WHERE room_id=$1 AND game_no=$2",[room.id,room.gameNo]);
   return {counted:true,delta,before,after:before.map((v,i)=>Math.max(100,v+delta[i]))};
  });
 }
 return {enabled,init,ratings,profile,leaderboard,record};
}
module.exports={MODES,START_RATING,changes,outcomes,achievementList,createCommunity};
