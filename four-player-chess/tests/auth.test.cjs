"use strict";
const test=require("node:test");
const assert=require("node:assert/strict");
const {createAuth,handleOf,passwordOf}=require("../auth.js");

function mockStore(){
 const users=new Map(),sessions=new Map(),tables=[];
 const store={persistent:true,users,sessions,tables,async query(sql,params=[]){
  const q=sql.trim();
  if(q.startsWith("CREATE TABLE")||q.startsWith("CREATE INDEX")||q.startsWith("ALTER TABLE")){tables.push(q);return {rowCount:0,rows:[]};}
  if(q.startsWith("INSERT INTO quadra_admin_bootstrap"))return {rowCount:0,rows:[]};
  if(q.startsWith("INSERT INTO quadra_accounts")){
   const [id,handle,pass_salt,pass_hash,recovery_hash]=params;
   if(users.has(handle))return {rowCount:0,rows:[]};
   const user={id,handle,pass_salt,pass_hash,recovery_hash,role:"user",banned_at:null,created_at:new Date()};
   users.set(handle,user);return {rowCount:1,rows:[user]};
  }
  if(q.startsWith("INSERT INTO quadra_sessions")){
   sessions.set(params[0],params[1]);return {rowCount:1,rows:[]};
  }
  if(q.startsWith("SELECT a.id,a.handle,a.created_at")){
   const id=sessions.get(params[0]),user=[...users.values()].find(x=>x.id===id);
   return {rowCount:user&&!user.banned_at?1:0,rows:user&&!user.banned_at?[user]:[]};
  }
  if(q.startsWith("SELECT id,handle,pass_salt,pass_hash")){
   const user=users.get(params[0]);return {rowCount:user?1:0,rows:user?[user]:[]};
  }
  if(q.startsWith("SELECT id,recovery_hash")){
   const user=users.get(params[0]);return {rowCount:user?1:0,rows:user?[user]:[]};
  }
  if(q.startsWith("SELECT COUNT(*)::int AS total FROM quadra_accounts"))return {rowCount:1,rows:[{total:users.size}]};
  if(q.startsWith("SELECT a.id,a.handle,a.role,a.created_at,a.banned_at")){
   const records=[...users.values()].map(a=>({...a,active_session:[...sessions.values()].includes(a.id)}));
   return {rowCount:records.length,rows:records};
  }
  if(q.startsWith("SELECT id,handle,role FROM quadra_accounts WHERE id=")){
   const user=[...users.values()].find(x=>x.id===params[0]);return {rowCount:user?1:0,rows:user?[user]:[]};
  }
  if(q.startsWith("UPDATE quadra_accounts SET banned_at")){
   const user=[...users.values()].find(x=>x.id===params[1]);
   if(user)user.banned_at=params[0];return {rowCount:user?1:0,rows:[]};
  }
  if(q.startsWith("UPDATE quadra_accounts")){
   const user=[...users.values()].find(x=>x.id===params[3]);
   if(user){user.pass_salt=params[0];user.pass_hash=params[1];user.recovery_hash=params[2];}
   return {rowCount:user?1:0,rows:[]};
  }
  if(q.startsWith("DELETE FROM quadra_accounts")){
   const user=[...users.values()].find(x=>x.id===params[0]);if(user)users.delete(user.handle);
   for(const [hash,id] of sessions)if(id===params[0])sessions.delete(hash);
   return {rowCount:1,rows:[]};
  }
  if(q.startsWith("DELETE FROM quadra_sessions WHERE user_id")){
   for(const [hash,id] of sessions)if(id===params[0])sessions.delete(hash);
   return {rowCount:1,rows:[]};
  }
  if(q.startsWith("DELETE FROM quadra_sessions WHERE token_hash")){sessions.delete(params[0]);return {rowCount:1,rows:[]};}
  if(q.startsWith("DELETE FROM quadra_sessions WHERE expires_at"))return {rowCount:0,rows:[]};
  throw Error("Unrecognized account query: "+q.slice(0,90));
 }};
 return store;
}
const PASSWORD="QuietLighthouse2026!";

test("anonymous account handles enforce privacy-oriented username and password rules",()=>{
 assert.equal(handleOf("Tactician_19"),"tactician_19");
 assert.throws(()=>handleOf("Admin"),/username/);
 assert.throws(()=>handleOf("Al"),/username/);
 assert.throws(()=>handleOf("Jane Smith"),/username/);
 assert.throws(()=>passwordOf("123"),/12/);
 assert.throws(()=>passwordOf("bad\npassword0123"),/password/);
 assert.equal(passwordOf(PASSWORD),PASSWORD);
});
test("account registration hashes passwords, issues a revocable session and one-time recovery code",async()=>{
 const store=mockStore(),auth=createAuth(store);
 await auth.init();
 assert.ok(store.tables.length>=3);
 const registered=await auth.register({username:"Tactician19",password:PASSWORD});
 assert.equal(registered.username,"tactician19");
 assert.equal(registered.token.length,43);
 assert.equal(registered.recoveryCode.length,43);
 const row=store.users.get("tactician19");
 assert.ok(row);
 assert.equal(row.pass_hash.includes(PASSWORD),false);
 assert.equal(row.recovery_hash.includes(registered.recoveryCode),false);
 const user=await auth.verify(registered.token);
 assert.equal(user.username,"tactician19");
 await assert.rejects(auth.register({username:"tactician19",password:PASSWORD}),/taken/);
 await assert.rejects(auth.login({username:"tactician19",password:"IncorrectPassword2026"}),/Invalid username or password/);
 const signedIn=await auth.login({username:"TACTICIAN19",password:PASSWORD});
 assert.equal((await auth.verify(signedIn.token)).id,user.id);
 await auth.logout(signedIn.token);
 assert.equal(await auth.verify(signedIn.token),null);
 assert.ok(await auth.verify(registered.token));
});
test("recovery rotates the secret, resets sessions and account deletion clears user records",async()=>{
 const store=mockStore(),auth=createAuth(store);await auth.init();
 const a=await auth.register({username:"strategist2026",password:PASSWORD});
 await assert.rejects(auth.recover({username:"strategist2026",recoveryCode:"z".repeat(43),newPassword:"SecureNewPassword2026!"}),/Invalid recovery/);
 const recovered=await auth.recover({username:"strategist2026",recoveryCode:a.recoveryCode,newPassword:"SecureNewPassword2026!"});
 assert.notEqual(recovered.recoveryCode,a.recoveryCode);
 assert.equal(await auth.verify(a.token),null);
 assert.equal((await auth.verify(recovered.token)).username,"strategist2026");
 await assert.rejects(auth.login({username:"strategist2026",password:PASSWORD}),/Invalid username or password/);
 await assert.rejects(auth.deleteAccount(recovered.token,PASSWORD),/Invalid username or password/);
 await auth.deleteAccount(recovered.token,"SecureNewPassword2026!");
 assert.equal(await auth.verify(recovered.token),null);
 assert.equal(store.users.size,0);
});
test("account endpoints stay unavailable without durable storage",async()=>{
 const auth=createAuth({persistent:false});
 await auth.init();
 assert.equal(auth.enabled,false);
 assert.equal(await auth.verify("z".repeat(43)),null);
 await assert.rejects(auth.register({username:"coolplayer",password:PASSWORD}),/unavailable/);
});

test("superuser authority is server-verified, reversible bans revoke sessions and block sign-in",async()=>{
 const store=mockStore(),auth=createAuth(store);await auth.init();
 const adminLogin=await auth.register({username:"chessowner",password:PASSWORD});
 const userLogin=await auth.register({username:"ordinaryplayer",password:PASSWORD});
 store.users.get("chessowner").role="superuser";
 const admin=await auth.verify(adminLogin.token),user=await auth.verify(userLogin.token);
 assert.equal(admin.role,"superuser");
 await assert.rejects(auth.setBan(user,admin.id,true),/Superuser permission/);
 await assert.rejects(auth.setBan(admin,admin.id,true),/Cannot suspend a superuser/);
 await auth.setBan(admin,user.id,true);
 assert.equal((await auth.listAccounts()).find(x=>x.id===user.id).banned,true);
 assert.equal(await auth.verify(userLogin.token),null);
 await assert.rejects(auth.login({username:"ordinaryplayer",password:PASSWORD}),/suspended/);
 await assert.rejects(auth.recover({username:"ordinaryplayer",recoveryCode:userLogin.recoveryCode,newPassword:PASSWORD}),/suspended/);
 await auth.setBan(admin,user.id,false);
 assert.equal((await auth.listAccounts()).find(x=>x.id===user.id).banned,false);
 const loginAgain=await auth.login({username:"ordinaryplayer",password:PASSWORD});
 assert.equal((await auth.verify(loginAgain.token)).username,"ordinaryplayer");
 assert.equal(await auth.countAccounts(),2);
});
