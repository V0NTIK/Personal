"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const fs=require("node:fs");
const path=require("node:path");
const vm=require("node:vm");
const html=fs.readFileSync(path.join(__dirname,"../index.html"),"utf8");
const code=fs.readFileSync(path.join(__dirname,"../account-client.js"),"utf8");
const ids=[...html.matchAll(/\bid="([^"]+)"/g)].map(m=>m[1]);
class MockElement{
 constructor(){
  this.textContent="";this.value="";this.disabled=false;this.children=[];this.events={};this.style={};this.className="";
  const classes=new Set();this.classList={add:k=>classes.add(k),remove:k=>classes.delete(k),toggle:(k,v)=>v?classes.add(k):classes.delete(k),contains:k=>classes.has(k)};
 }
 addEventListener(event,listener){this.events[event]=listener;}
 emit(event){return this.events[event]?.({});}
 replaceChildren(){this.children=[];}
 append(...parts){this.children.push(...parts);}
}
function make(){
 const elements={};for(const id of ids)elements[id]=new MockElement();
 const storage=new Map(),requests=[],calls=[];
 const sessionStorage={getItem:k=>storage.has(k)?storage.get(k):null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)};
 const fetch=async(url,options)=>{
  requests.push({url,options});
  if(url.endsWith("/api/auth/register"))return {ok:true,json:async()=>({username:"tactician19",id:"test-user",token:"t".repeat(43),recoveryCode:"r".repeat(43)})};
  if(url.endsWith("/api/auth/rooms"))return {ok:true,json:async()=>({rooms:[{room:"ABC1234",seat:0,title:"Weekend chess",started:true,finished:false,variant:"quadra-ffa",clock:"blitz5"}]})};
  if(url.endsWith("/api/auth/me"))return {ok:true,json:async()=>({account:{id:"test-user",username:"tactician19"}})};
  if(url.endsWith("/api/auth/logout"))return {ok:true,json:async()=>({ok:true})};
  if(url.endsWith("/api/auth/delete"))return {ok:true,json:async()=>({ok:true})};
  return {ok:true,json:async()=>({username:"tactician19",id:"test-user",token:"u".repeat(43)})};
 };
 const window={QuadraApp:{refresh:()=>calls.push("refresh"),openRoom:r=>calls.push({room:r}),changePanel:p=>calls.push(p),isOnline:()=>false}};
 const context={window,document:{getElementById:id=>elements[id],createElement:()=>new MockElement()},sessionStorage,
 navigator:{clipboard:{writeText:async()=>{}}},fetch,AbortController,setTimeout,clearTimeout,confirm:()=>true};
 vm.runInNewContext(code,context,{filename:"account-client.js",timeout:5000});
 return {elements,storage,requests,calls,window};
}
test("registration issues a private session, one-time recovery code and personal room list",async()=>{
 const x=make();
 x.elements.authUsername.value="Tactician19";
 x.elements.authPassword.value="QuietLighthouse2026!";
 await x.elements.authRegister.emit("click");
 assert.equal(x.storage.get("quadra-account-session"),"t".repeat(43));
 assert.equal(x.window.QuadraAccount.username(),"tactician19");
 assert.equal(x.elements.recoveryCodeValue.textContent,"r".repeat(43));
 assert.equal(x.elements.authGuest.classList.contains("hidden"),true);
 assert.equal(x.elements.accountRoomList.children.length,1);
 assert.ok(x.requests.some(q=>q.url.endsWith("/api/auth/register")));
 assert.ok(x.requests.some(q=>q.url.endsWith("/api/auth/rooms")));
 const el=x.elements.accountRoomList.children[0];
 const button=el.children[1];button.emit("click");
 assert.equal(x.calls.some(v=>v.room?.room==="ABC1234"),true);
 await x.elements.authLogout.emit("click");
 assert.equal(x.storage.has("quadra-account-session"),false);
 assert.equal(x.elements.authGuest.classList.contains("hidden"),false);
});
test("account creation prevents short passwords and deletion clears session state",async()=>{
 const x=make();x.elements.authUsername.value="Tactician19";x.elements.authPassword.value="short";
 await x.elements.authRegister.emit("click");
 assert.match(x.elements.accountStatus.textContent,/12/);
 assert.equal(x.requests.length,0);
 x.elements.authPassword.value="QuietLighthouse2026!";
 await x.elements.authRegister.emit("click");
 x.elements.authDeletePassword.value="QuietLighthouse2026!";
 await x.elements.authDelete.emit("click");
 assert.equal(x.window.QuadraAccount.username(),null);
 assert.equal(x.storage.has("quadra-account-session"),false);
 assert.ok(x.requests.some(q=>q.url.endsWith("/api/auth/delete")));
});
