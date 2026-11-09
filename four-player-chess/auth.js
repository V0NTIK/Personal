"use strict";
const crypto=require("node:crypto");
const {promisify}=require("node:util");
const scrypt=promisify(crypto.scrypt);
const TOKEN_RE=/^[a-zA-Z0-9_-]{43}$/;
const HANDLE_RE=/^[a-zA-Z][a-zA-Z0-9_-]{2,19}$/;
const RESERVED=new Set(["admin","administrator","moderator","system","quadra","quadrachess","chesscom","support","staff"]);
function handleOf(input){
 if(typeof input!=="string"||!HANDLE_RE.test(input)||RESERVED.has(input.toLowerCase()))throw Object.assign(Error("Choose a username: 3–20 letters, digits, _ or -, starting with a letter."),{code:400});
 return input.toLowerCase();
}
function passwordOf(input){
 if(typeof input!=="string"||input.length<12||input.length>128||/[\u0000-\u001f\u007f]/.test(input))throw Object.assign(Error("Use a password between 12 and 128 characters."),{code:400});
 return input;
}
function code(){return crypto.randomBytes(32).toString("base64url");}
function digest(secret){return crypto.createHash("sha256").update(secret).digest("hex");}
async function hashPassword(password,salt){
 return (await scrypt(password,salt,64,{N:16384,r:8,p:1,maxmem:64*1024*1024})).toString("hex");
}
function safeEqual(a,b){
 if(typeof a!=="string"||typeof b!=="string")return false;
 const ba=Buffer.from(a,"hex"),bb=Buffer.from(b,"hex");
 return ba.length===bb.length&&ba.length>0&&crypto.timingSafeEqual(ba,bb);
}
const dummySalt="00000000000000000000000000000000";
function createAuth(store){
 const enabled=!!store.persistent;
 function requireDb(){if(!enabled)throw Object.assign(Error("Accounts are unavailable until persistent storage is configured."),{code:503});}
 async function init(){
  if(!enabled)return;
  await store.query(`CREATE TABLE IF NOT EXISTS quadra_accounts (
   id uuid PRIMARY KEY,handle varchar(20) NOT NULL UNIQUE,
   pass_salt varchar(64) NOT NULL,pass_hash varchar(128) NOT NULL,recovery_hash varchar(64) NOT NULL,
   created_at timestamptz NOT NULL DEFAULT now())`);
  await store.query(`CREATE TABLE IF NOT EXISTS quadra_sessions (
   token_hash varchar(64) PRIMARY KEY,user_id uuid NOT NULL REFERENCES quadra_accounts(id) ON DELETE CASCADE,
   created_at timestamptz NOT NULL DEFAULT now(),expires_at timestamptz NOT NULL)`);
  await store.query("CREATE INDEX IF NOT EXISTS quadra_sessions_user_idx ON quadra_sessions(user_id)");
  await store.query("CREATE INDEX IF NOT EXISTS quadra_sessions_expiry_idx ON quadra_sessions(expires_at)");
 }
 async function session(userId){
  const token=code();
  await store.query("INSERT INTO quadra_sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '30 days')",[digest(token),userId]);
  return token;
 }
 async function register(input){
  requireDb();
  const handle=handleOf(input?.username),password=passwordOf(input?.password);
  const salt=crypto.randomBytes(16).toString("hex"),hash=await hashPassword(password,salt),recoveryCode=code(),id=crypto.randomUUID();
  const result=await store.query("INSERT INTO quadra_accounts(id,handle,pass_salt,pass_hash,recovery_hash) VALUES($1,$2,$3,$4,$5) ON CONFLICT(handle) DO NOTHING RETURNING id,handle,created_at",[id,handle,salt,hash,digest(recoveryCode)]);
  if(!result.rowCount)throw Object.assign(Error("That username is taken."),{code:409});
  const token=await session(id);
  return {token,username:handle,id,recoveryCode};
 }
 async function authenticate(handle,password){
  const result=await store.query("SELECT id,handle,pass_salt,pass_hash,created_at FROM quadra_accounts WHERE handle=$1",[handle]);
  const user=result.rows[0]||null;
  const computed=await hashPassword(password,user?.pass_salt||dummySalt);
  if(!user||!safeEqual(computed,user.pass_hash))throw Object.assign(Error("Invalid username or password."),{code:401});
  return user;
 }
 async function login(input){
  requireDb();const handle=handleOf(input?.username),password=passwordOf(input?.password);
  const user=await authenticate(handle,password),token=await session(user.id);
  return {token,username:user.handle,id:user.id};
 }
 async function verify(token){
  if(!enabled||typeof token!=="string"||!TOKEN_RE.test(token))return null;
  const result=await store.query("SELECT a.id,a.handle,a.created_at FROM quadra_sessions s JOIN quadra_accounts a ON a.id=s.user_id WHERE s.token_hash=$1 AND s.expires_at>now() LIMIT 1",[digest(token)]);
  const user=result.rows[0];return user?{id:user.id,username:user.handle,createdAt:user.created_at}:null;
 }
 async function recover(input){
  requireDb();
  const handle=handleOf(input?.username),password=passwordOf(input?.newPassword),recoveryCode=input?.recoveryCode;
  if(typeof recoveryCode!=="string"||!TOKEN_RE.test(recoveryCode))throw Object.assign(Error("Invalid recovery information."),{code:401});
  const result=await store.query("SELECT id,recovery_hash FROM quadra_accounts WHERE handle=$1",[handle]);
  const user=result.rows[0];
  if(!user||!safeEqual(digest(recoveryCode),user.recovery_hash))throw Object.assign(Error("Invalid recovery information."),{code:401});
  const salt=crypto.randomBytes(16).toString("hex"),hash=await hashPassword(password,salt),nextRecovery=code();
  await store.query("UPDATE quadra_accounts SET pass_salt=$1,pass_hash=$2,recovery_hash=$3 WHERE id=$4",[salt,hash,digest(nextRecovery),user.id]);
  await store.query("DELETE FROM quadra_sessions WHERE user_id=$1",[user.id]);
  const token=await session(user.id);
  return {token,username:handle,id:user.id,recoveryCode:nextRecovery};
 }
 async function logout(token){if(enabled&&TOKEN_RE.test(token||""))await store.query("DELETE FROM quadra_sessions WHERE token_hash=$1",[digest(token)]);}
 async function deleteAccount(token,password){
  requireDb();const u=await verify(token);
  if(!u)throw Object.assign(Error("Please sign in first."),{code:401});
  const p=passwordOf(password);
  await authenticate(u.username,p);
  await store.query("DELETE FROM quadra_accounts WHERE id=$1",[u.id]);
  return u;
 }
 async function cleanup(){if(enabled)await store.query("DELETE FROM quadra_sessions WHERE expires_at<=now()");}
 return {enabled,init,register,login,verify,recover,logout,deleteAccount,cleanup};
}
module.exports={createAuth,handleOf,passwordOf,digest,hashPassword,safeEqual,TOKEN_RE};
