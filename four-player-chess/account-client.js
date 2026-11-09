(function(){
"use strict";
const API="https://quadra-chess-api.onrender.com",KEY="quadra-account-session";
const $=id=>document.getElementById(id);
const NAMES=["Red","Blue","Yellow","Green"];
let account=null,recoveryCode=null,loading=false;
function token(){
 try{const v=sessionStorage.getItem(KEY);return /^[A-Za-z0-9_-]{43}$/.test(v||"")?v:null;}catch(e){return null;}
}
function saveToken(raw){try{if(raw)sessionStorage.setItem(KEY,raw);else sessionStorage.removeItem(KEY);}catch(e){}}
function message(s){$("accountStatus").textContent=s||"";}
async function request(path,method="GET",body){
 const headers={"Content-Type":"application/json"};
 const t=token();if(t)headers.Authorization="Bearer "+t;
 const controller=new AbortController(),timeout=setTimeout(()=>controller.abort(),90000);
 try{
  const res=await fetch(API+"/api/auth/"+path,{method,headers,...(body!==undefined?{body:JSON.stringify(body)}:{}),signal:controller.signal});
  let data;try{data=await res.json();}catch(e){throw Error("Account service returned an unreadable response.");}
  if(!res.ok)throw Error(data.error||"Account request was unsuccessful.");
  return data;
 }finally{clearTimeout(timeout);}
}
function render(){
 const signed=!!account;
 $("authGuest").classList.toggle("hidden",signed);
 $("authSignedIn").classList.toggle("hidden",!signed);
 $("headerAccount").textContent=signed?"@"+account.username:"Account";
  $("headerAdmin").classList.toggle("hidden",account?.role!=="superuser");
  $("tab-admin").classList.toggle("hidden",account?.role!=="superuser");
  $("accountRole").classList.toggle("hidden",account?.role!=="superuser");
 if(signed){
  $("accountName").textContent="@"+account.username;
  $("accountAvatar").textContent=(account.username[0]||"Q").toUpperCase();
 }
 $("recoveryResult").classList.toggle("hidden",!recoveryCode);
 $("recoveryCodeValue").textContent=recoveryCode||"";
 window.QuadraApp?.refresh?.();
}
function renderRatings(profile){
 const host=$("accountRatingStats");host.replaceChildren();
 const stats=profile?.stats||[];
 for(const mode of ["ffa","teams"]){
  const record=stats.find(s=>s.mode===mode)||{rating:1200,games:0,wins:0,draws:0,provisional:true};
  const card=document.createElement("div");card.className="review-stat-card";
  const title=document.createElement("strong");title.textContent=mode==="ffa"?"Free-for-all":"Teams";
  const details=document.createElement("small");details.textContent=record.rating+" provisional Elo · "+record.games+" rated matches · "+record.wins+" wins";
  card.append(title,details);host.append(card);
 }
}
async function refreshProfile(){
 if(!account)return;
 try{
  const data=await request("me");account=data.account;render();renderRatings(data.profile);
  window.QuadraCommunity?.loadMyAchievements?.();
 }catch(e){message("Ratings unavailable: "+e.message);}
}
async function refreshRooms(){
 if(!account)return;
 try{
  const data=await request("rooms");
  const host=$("accountRoomList");host.replaceChildren();
  if(!data.rooms?.length){
   const p=document.createElement("p");p.className="history-empty";
   p.textContent="No rooms linked to your account yet. Create one under Play.";host.append(p);await refreshProfile();return;
  }
  for(const info of data.rooms){
   const line=document.createElement("div");line.className="archive-row";
   const meta=document.createElement("div");meta.className="archive-meta";
   const label=document.createElement("strong");label.textContent=info.title||"Private room "+info.room;
   const details=document.createElement("small");
   details.textContent=info.room+" · "+NAMES[info.seat]+" · "+(info.finished?"Finished":info.started?"In progress":"Lobby");
   meta.append(label,details);
   const button=document.createElement("button");button.className="button ghost";button.type="button";button.textContent="Open";
   button.addEventListener("click",()=>{
    if(window.QuadraApp?.isOnline?.()){message("Leave your current room before opening another.");return;}
    window.QuadraApp?.openRoom?.({room:info.room,seat:info.seat,token:null,clock:info.clock,title:info.title,variant:info.variant,persistent:true});
    window.QuadraApp?.changePanel?.("play",true);
   });
   line.append(meta,button);host.append(line);
  }
  await refreshProfile();
 }catch(e){message(e.message);}
}
async function submit(kind){
 if(loading)return;
 const username=$("authUsername").value.trim(),password=$("authPassword").value;
 if(username.length<3||username.length>20){message("Choose a username between 3 and 20 characters.");return;}
 if(password.length<12){message("Use a password with at least 12 characters.");return;}
 loading=true;for(const id of ["authLogin","authRegister","authRecover"])$(id).disabled=true;
 message(kind==="register"?"Creating your private account…":"Signing in…");
 try{
  const result=await request(kind,"POST",{username,password});
  saveToken(result.token);account={id:result.id,username:result.username,role:result.role||"user"};recoveryCode=result.recoveryCode||null;
  $("authPassword").value="";render();
  message(kind==="register"?"Account created. Save your recovery code below before closing this page.":"Welcome back, @"+account.username+".");
  await refreshRooms();
 }catch(e){message(e.message||"Unable to sign in.");}
 finally{loading=false;for(const id of ["authLogin","authRegister","authRecover"])$(id).disabled=false;}
}
async function recover(){
 if(loading)return;
 loading=true;message("Verifying your recovery code…");
 try{
  const result=await request("recover","POST",{username:$("authUsername").value.trim(),
   recoveryCode:$("authRecoveryInput").value.trim(),newPassword:$("authNewPassword").value});
  saveToken(result.token);account={id:result.id,username:result.username,role:result.role||"user"};recoveryCode=result.recoveryCode;
  $("authRecoveryInput").value="";$("authNewPassword").value="";
  render();message("Password updated. Save your new recovery code.");
  await refreshRooms();
 }catch(e){message(e.message);}
 finally{loading=false;}
}
async function logout(){
 const previous=token();saveToken(null);account=null;recoveryCode=null;render();message("Signed out of this tab.");
 if(previous)try{await fetch(API+"/api/auth/logout",{method:"POST",headers:{"Content-Type":"application/json",Authorization:"Bearer "+previous},body:"{}"});}catch(e){}
}
async function deleteAccount(){
 if(!account||!confirm("Permanently delete @"+account.username+"? This cannot be undone."))return;
 const password=$("authDeletePassword").value;
 if(!password){message("Enter your account password to confirm deletion.");return;}
 message("Deleting account…");
 try{
  await request("delete","POST",{password});
  $("authDeletePassword").value="";
  saveToken(null);account=null;recoveryCode=null;render();message("Your account was deleted.");
 }catch(e){message(e.message);}
}
async function refreshAdmin(){
 if(account?.role!=="superuser")return;
 const status=$("adminStatus"),host=$("adminAccountList");
 status.textContent="Loading accounts…";
 try{
  const t=token(),response=await fetch(API+"/api/admin/accounts",{headers:{Authorization:"Bearer "+t}});
  const data=await response.json();if(!response.ok)throw Error(data.error||"Access denied");
  host.replaceChildren();
  status.textContent=data.accounts.length+" registered accounts · Server-authorized admin view";
  for(const user of data.accounts){
   const row=document.createElement("article");row.className="admin-account"+(user.banned?" is-banned":"");
   const meta=document.createElement("div"),name=document.createElement("strong"),detail=document.createElement("small");
   name.textContent="@"+user.username+(user.role==="superuser"?" · ✦ Superuser":"");
   detail.textContent=(user.banned?"Suspended":user.online?"Online":user.activeSession?"Signed-in session":"Offline")+
    " · Joined "+(user.createdAt?new Date(user.createdAt).toLocaleDateString():"unknown");
   meta.append(name,detail);
   const button=document.createElement("button");
   button.type="button";button.className="button "+(user.banned?"ghost":"danger");
   button.textContent=user.banned?"Restore account":"Ban account";
   button.disabled=user.role==="superuser";
   button.addEventListener("click",async()=>{
    if(!confirm((user.banned?"Restore @":"Suspend @")+user.username+"?"+(user.banned?"":" Active sessions and room seats will be revoked.")))return;
    button.disabled=true;status.textContent="Updating @"+user.username+"…";
    try{
     const action=user.banned?"unban":"ban";
     const res=await fetch(API+"/api/admin/accounts/"+encodeURIComponent(user.id)+"/"+action,
      {method:"POST",headers:{Authorization:"Bearer "+token()}});
     const result=await res.json();if(!res.ok)throw Error(result.error||"Could not update account");
     await refreshAdmin();
    }catch(e){status.textContent=e.message;button.disabled=false;}
   });
   row.append(meta,button);host.append(row);
  }
 }catch(e){status.textContent="Admin dashboard unavailable: "+e.message;}
}
function bind(){
 $("refreshAdmin").addEventListener("click",refreshAdmin);
  $("authLogin").addEventListener("click",()=>submit("login"));
 $("authRegister").addEventListener("click",()=>submit("register"));
 $("authRecover").addEventListener("click",recover);
 $("authLogout").addEventListener("click",logout);
 $("authDelete").addEventListener("click",deleteAccount);
 $("refreshAccountRooms").addEventListener("click",refreshRooms);
 $("copyRecoveryCode").addEventListener("click",async()=>{
  if(!recoveryCode)return;
  try{await navigator.clipboard.writeText(recoveryCode);message("Recovery code copied. Store it somewhere private.");}
  catch(e){message("Select and copy the code above to save it.");}
 });
 $("dismissRecoveryCode").addEventListener("click",()=>{recoveryCode=null;render();});
}
async function init(){
 bind();render();
 const t=token();if(!t)return;
 message("Checking your account session…");
 try{
  const data=await request("me");
  account=data.account;render();message("Signed in as @"+account.username);
  await refreshRooms();
 }catch(e){saveToken(null);account=null;render();message("Session expired. Please sign in again.");}
}
window.QuadraAccount={token,username:()=>account?.username||null,role:()=>account?.role||"user",refreshRooms,refreshAdmin};
init();
})();
