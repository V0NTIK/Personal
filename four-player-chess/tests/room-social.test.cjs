"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const Social=require("../room-social.js");
const user={id:"00000000-0000-4000-8000-000000000001",username:"northstar"};
function room(){
 return {hostSeat:0,seats:[{userId:user.id},{userId:"b"},{userId:"c"},null],messages:[],reports:{},mutedUsers:[]};
}
test("chat normalizes Unicode and refuses contact information and external links",()=>{
 assert.equal(Social.cleanMessage("  Hello\u200b   team!  "),"Hello team!");
 for(const message of ["https://example.com","join www.example.org","my email is x@domain.test","Call 216 555 0987"]){
  assert.throws(()=>Social.cleanMessage(message),/Links, email addresses and phone numbers/);
 }
 assert.throws(()=>Social.cleanMessage("a".repeat(241)),/240/);
 assert.throws(()=>Social.cleanMessage("   "),/between/);
});
test("room chat persists max 80 messages with sender rate limiting",()=>{
 const r=room();
 r.messages=Social.appendMessage(r,user,"Good game",0,100000);
 assert.equal(r.messages[0].text,"Good game");
 assert.equal(r.messages[0].alias,user.username);
 assert.throws(()=>Social.appendMessage(r,user,"Too fast",0,100500),/slower/);
 r.messages=Social.appendMessage(r,user,"Second message",0,103000);
 assert.equal(r.messages.length,2);
 r.mutedUsers.push(user.id);
 assert.throws(()=>Social.appendMessage(r,user,"Muted message",0,108000),/muted/);
});
test("message reports need independent room participants and hide at two",()=>{
 let r=room();
 r.messages=Social.appendMessage(r,user,"Possible issue",0,100000);
 const id=r.messages[0].id;
 const once=Social.reportMessage(r,id,"b");r={...r,...once};
 assert.equal(once.hidden,false);
 const twice=Social.reportMessage(r,id,"b");assert.equal(twice.reportCount,1);
 const second=Social.reportMessage(r,id,"c");assert.equal(second.hidden,true);
 assert.equal(Social.publicMessages(second.messages)[0].text,"Message removed by moderation");
 assert.equal(Social.publicMessages(second.messages)[0].userId,undefined);
 assert.throws(()=>Social.reportMessage(r,id,user.id),/own/);
});
test("host can remove and mute participants by message, never another host",()=>{
 let r=room();r.messages=Social.appendMessage(r,{id:"b",username:"blue"},"Hello everyone",1,100000);
 const id=r.messages[0].id;
 const mute=Social.moderate(r,user.id,id,"mute");
 assert.deepEqual(mute.mutedUsers,["b"]);
 const remove=Social.moderate(r,user.id,id,"remove");
 assert.equal(remove.messages[0].hidden,true);
 assert.throws(()=>Social.moderate(r,"c",id,"remove"),/host/);
});
