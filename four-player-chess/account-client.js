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
 if(signed){
  $("accountName").textContent="@"+account.username;
  $("accountAvatar").textContent=(account.username[0]||"Q").toUpperCase();
 }
 $("recoveryResult").classList.toggle("hidden",!recoveryCode);
 $("recoveryCodeValue").textContent=recoveryCode||"";
 window.QuadraApp?.refresh?.();
}
async function refreshRooms(){
 if(!account)return;
 try{
  const data=await request("rooms");
  const host=$("accountRoomList");host.replaceChildren();
  if(!data.rooms?.length){
   const p=document.createElement("p");p.className="history-empty";
   p.textContent="No private rooms linked to your account yet. Create one under Play.";host.append(p);return;
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
  saveToken(result.token);account={id:result.id,username:result.username};recoveryCode=result.recoveryCode||null;
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
  saveToken(result.token);account={id:result.id,username:result.username};recoveryCode=result.recoveryCode;
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
function bind(){
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
window.QuadraAccount={token,username:()=>account?.username||null,refreshRooms};
init();
})();
