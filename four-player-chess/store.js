"use strict";
const DAY=86_400_000;
const ROOM_TTL=29*DAY;
function serialize(room){
 return {id:room.id,revision:room.rev,game:room.game,variant:room.variant,
  seats:room.seats.map(s=>s?{tokenHash:s.tokenHash}:null),
  clock:room.clock,rematch:room.rematch,drawVotes:room.drawVotes,events:room.events,archives:room.archives,gameNo:room.gameNo,created:room.created,updated:room.updated};
}
function deserialize(data){
 if(!data||typeof data.id!=="string"||!/^[A-F0-9]{7}$/.test(data.id)||!data.game||!Array.isArray(data.seats)||data.seats.length!==4||!Number.isInteger(data.revision))throw Error("Invalid stored room.");
 return {id:data.id,rev:data.revision,game:data.game,variant:data.variant||null,
  seats:data.seats.map(s=>s?{tokenHash:s.tokenHash,ws:null}:null),
  clock:data.clock||null,rematch:Array.isArray(data.rematch)&&data.rematch.length===4?data.rematch:[false,false,false,false],
  drawVotes:Array.isArray(data.drawVotes)&&data.drawVotes.length===4?data.drawVotes:[false,false,false,false],
  events:Array.isArray(data.events)?data.events:(data.game.moves?.length?null:[]),
  archives:Array.isArray(data.archives)?data.archives.slice(-8):[],gameNo:Number.isInteger(data.gameNo)&&data.gameNo>0?data.gameNo:1,
  created:Number(data.created)||Date.now(),updated:Number(data.updated)||Date.now(),lock:Promise.resolve()};
}
function createStore(url=process.env.DATABASE_URL,options={}){
 const persistent=!!url;
 let pool=null;
 async function init(){
  if(!persistent)return;
  const Pool=options.Pool||require("pg").Pool;
  pool=new Pool({connectionString:url,max:4,idleTimeoutMillis:30000,connectionTimeoutMillis:15000});
  await pool.query('CREATE TABLE IF NOT EXISTS quadra_rooms (id varchar(7) PRIMARY KEY, revision integer NOT NULL, data jsonb NOT NULL, updated_at timestamptz NOT NULL, expires_at timestamptz NOT NULL)');
  await pool.query('CREATE INDEX IF NOT EXISTS quadra_rooms_expires_idx ON quadra_rooms (expires_at)');
 }
 async function save(room){
  if(!persistent)return;
  if(!pool)throw Error("Persistent store has not initialized.");
  const data=serialize(room);
  const res=await pool.query('INSERT INTO quadra_rooms (id,revision,data,updated_at,expires_at) VALUES ($1,$2,$3::jsonb,to_timestamp($4/1000.0),to_timestamp($5/1000.0)) ON CONFLICT (id) DO UPDATE SET revision=EXCLUDED.revision,data=EXCLUDED.data,updated_at=EXCLUDED.updated_at,expires_at=EXCLUDED.expires_at WHERE quadra_rooms.revision <= EXCLUDED.revision',[room.id,room.rev,JSON.stringify(data),room.updated,room.updated+ROOM_TTL]);
  if(res.rowCount!==1)throw Error("Outdated room revision; resync required.");
 }
 async function load(){
  if(!persistent)return [];
  if(!pool)throw Error("Persistent store not initialized.");
  const result=await pool.query('SELECT data FROM quadra_rooms WHERE expires_at > now() ORDER BY updated_at DESC LIMIT 200');
  return result.rows.map(r=>deserialize(r.data));
 }
 async function remove(id){if(persistent)await pool.query('DELETE FROM quadra_rooms WHERE id=$1',[id]);}
 async function cleanup(){if(persistent)await pool.query('DELETE FROM quadra_rooms WHERE expires_at <= now()');}
 async function close(){if(pool)await pool.end();}
 return {persistent,init,save,load,remove,cleanup,close};
}
module.exports={DAY,ROOM_TTL,serialize,deserialize,createStore};
