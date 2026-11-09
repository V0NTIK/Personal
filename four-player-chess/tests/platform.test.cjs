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
 clock:Clock.create("rapid10"),rematch:[true,false,false,false],created:10,updated:20,lock:Promise.resolve()};
 const plain=serialize(room);
 assert.equal(JSON.stringify(plain).includes("never persist"),false);
 const hydrated=deserialize(plain);
 assert.equal(hydrated.id,room.id);
 assert.equal(hydrated.rev,room.rev);
 assert.equal(hydrated.seats[0].tokenHash,room.seats[0].tokenHash);
 assert.equal(hydrated.seats[0].ws,null);
 assert.equal(hydrated.clock.preset,"rapid10");
 assert.equal(hydrated.rematch[0],true);
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
