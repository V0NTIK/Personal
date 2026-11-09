"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Clock=require("../clock.js");
const Variants=require("../variants.js");
const Engine=require("../engine.js");
const {serialize,deserialize,createStore}=require("../store.js");

test("versioned registry exposes two playable four-player variants",()=>{
 assert.equal(Variants.VARIANTS.length,2);
 for(const variant of Variants.VARIANTS){
  assert.equal(variant.players,4);assert.equal(variant.family,"chess");
  assert.equal(variant.version,1);assert.equal(variant.ready,true);
  const game=Variants.createGame(variant.id,Engine);
  assert.equal(game.mode,variant.mode);assert.equal(game.b.filter(Boolean).length,64);
 }
 assert.equal(Variants.byId("unsupported"),null);
 assert.throws(()=>Variants.createGame("unsupported",Engine),/Unknown/);
});

test("untimed controls never count down",()=>{
 const c=Clock.create("untimed");
 Clock.start(c,1000);
 assert.equal(c.started,false);
 assert.equal(Clock.settle(c,0,10000),null);
 assert.equal(Clock.visible(c,0,10000).remaining,null);
});

test("clock starts on room readiness and deducts precisely elapsed time",()=>{
 const c=Clock.create("rapid10");
 assert.deepEqual(c.remaining,[600000,600000,600000,600000]);
 assert.equal(c.started,false);
 Clock.start(c,1000);
 assert.equal(c.started,true);
 assert.equal(Clock.settle(c,0,51000),null);
 assert.equal(c.remaining[0],550000);
 Clock.moved(c,0,51000);
 assert.equal(c.remaining[0],550000);
 assert.equal(Clock.visible(c,1,61000).remaining[1],590000);
 assert.equal(c.remaining[1],600000,"views must not mutate the authoritative clock");
});

test("increment adds to mover only after a legal move",()=>{
 const c=Clock.create("rapid15");
 Clock.start(c,1000);
 Clock.settle(c,0,11000);
 Clock.moved(c,0,11000);
 assert.equal(c.remaining[0],900000);
 Clock.settle(c,1,31000);
 Clock.moved(c,1,31000);
 assert.equal(c.remaining[1],890000);
});

test("flag triggers exactly at zero and does not overdraw",()=>{
 const c=Clock.create("blitz5");
 Clock.start(c,0);
 assert.equal(Clock.settle(c,0,299999),null);
 assert.equal(c.remaining[0],1);
 assert.equal(Clock.settle(c,0,300000),0);
 assert.equal(c.remaining[0],0);
 assert.equal(c.flag,0);
 assert.equal(Clock.settle(c,0,400000),null);
});

test("server timeout elimination leaves other players active",()=>{
 const g=Engine.fresh();
 const next=Engine.eliminatePlayer(g,0,"time");
 assert.equal(next.alive[0],false);
 assert.equal(next.turn,1);
 assert.equal(next.b.some(p=>p&&p.c===0),false);
 assert.equal(next.alive[1],true);
 assert.equal(g.alive[0],true);
 assert.match(next.moves.at(-1).notation,/time expired/);
});

test("storage roundtrip drops all WebSocket objects and retains hashed seat credentials",()=>{
 const room={id:"ABC1234",rev:4,variant:"quadra-ffa",game:Engine.fresh(),
 seats:[{tokenHash:"a".repeat(64),ws:{secret:"never persist this"}},null,null,null],
 clock:Clock.create("rapid10"),rematch:[true,false,false,false],drawVotes:[true,false,false,false],events:[{kind:"resign",player:1}],archives:[{gameNo:1,winner:"Draw",moves:[],events:[{kind:"draw"}],endedAt:20,clock:"untimed"}],gameNo:2,created:10,updated:20,lock:Promise.resolve()};
 const plain=serialize(room);
 assert.equal(JSON.stringify(plain).includes("never persist"),false);
 const hydrated=deserialize(plain);
 assert.equal(hydrated.id,room.id);
 assert.equal(hydrated.rev,room.rev);
 assert.equal(hydrated.seats[0].tokenHash,room.seats[0].tokenHash);
 assert.equal(hydrated.seats[0].ws,null);
 assert.equal(hydrated.clock.preset,"rapid10");
 assert.equal(hydrated.rematch[0],true);
 assert.equal(hydrated.drawVotes[0],true);
 assert.equal(hydrated.events[0].kind,"resign");
 assert.equal(hydrated.archives[0].events[0].kind,"draw");
 assert.equal(hydrated.gameNo,2);
 assert.ok(hydrated.lock instanceof Promise);
});

test("memory store remains usable when no durable DATABASE_URL is configured",async()=>{
 const store=createStore("");
 assert.equal(store.persistent,false);
 await store.init();
 await store.save({id:"ABC1234"});
 assert.deepEqual(await store.load(),[]);
 await store.close();
});

test("persistent adapter saves and restores rooms across separate process instances",async()=>{
 const table=new Map();
 class MockPool{
  async query(sql,params=[]){
   if(sql.startsWith("CREATE "))return {rowCount:0};
   if(sql.startsWith("INSERT ")){
    const [id,revision,json,updated,expires]=params,previous=table.get(id);
    if(previous&&previous.revision>revision)return {rowCount:0};
    table.set(id,{revision,data:JSON.parse(json),updated,expires});
    return {rowCount:1};
   }
   if(sql.startsWith("SELECT "))return {rows:[...table.values()].map(v=>({data:v.data}))};
   if(sql.startsWith("DELETE "))return {rowCount:1};
   throw Error("Unexpected SQL: "+sql);
  }
  async end(){}
 }
 const room={id:"D3A4567",rev:1,variant:"quadra-ffa",game:Engine.fresh(),
  seats:[{tokenHash:"b".repeat(64),ws:{privateData:"must not be saved"}},null,null,null],
  clock:Clock.create("blitz5"),rematch:[false,false,false,false],created:Date.now(),updated:Date.now()};
 const s1=createStore("postgres://example.invalid/test",{Pool:MockPool});
 await s1.init();assert.equal(s1.persistent,true);await s1.save(room);await s1.close();
 const text=JSON.stringify(table.get(room.id).data);
 assert.equal(text.includes("must not be saved"),false);
 const s2=createStore("postgres://example.invalid/test",{Pool:MockPool});
 await s2.init();const loaded=await s2.load();await s2.close();
 assert.equal(loaded.length,1);
 assert.equal(loaded[0].id,room.id);
 assert.equal(loaded[0].rev,1);
 assert.equal(loaded[0].seats[0].tokenHash,room.seats[0].tokenHash);
 assert.equal(loaded[0].seats[0].ws,null);
 assert.equal(loaded[0].clock.preset,"blitz5");
 assert.equal(loaded[0].game.b.filter(Boolean).length,64);
});

test("legacy stored rooms without replay fields load safely",()=>{
 const room={id:"BC12345",revision:0,game:Engine.fresh(),seats:[null,null,null,null],clock:Clock.create("untimed"),created:100,updated:200};
 const migrated=deserialize(room);
 assert.deepEqual(migrated.events,[]);
 assert.deepEqual(migrated.archives,[]);
 assert.deepEqual(migrated.drawVotes,[false,false,false,false]);
 assert.equal(migrated.gameNo,1);
});
