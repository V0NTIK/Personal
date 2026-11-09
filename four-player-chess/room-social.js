"use strict";
const crypto=require("node:crypto");
const MAX_MESSAGES=80,MAX_LENGTH=240;
const forbidden=/https?:\/\/|www\.|(?:\S+\s*(?:dot|\.)\s*(?:com|net|org|gg|io))\b|(?:[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,})|(?:\+?\d[\d()\s.-]{7,}\d)/i;
const unsafe=/\b(?:kill yourself|kys|send nudes|doxx|racial slur|sexual favors)\b/i;
function cleanMessage(value){
 if(typeof value!=="string")throw Error("Enter a message.");
 const text=value.normalize("NFKC").replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200d]/g," ").replace(/\s+/g," ").trim();
 if(text.length<1||text.length>MAX_LENGTH)throw Error("Messages must be between 1 and 240 characters.");
 if(forbidden.test(text))throw Error("Links, email addresses and phone numbers are not allowed in room chat.");
 if(unsafe.test(text))throw Error("That message cannot be posted.");
 return text;
}
function publicMessages(messages){
 return (messages||[]).slice(-MAX_MESSAGES).map(m=>({
  id:m.id,alias:m.alias,color:Number.isInteger(m.color)?m.color:null,
  text:m.hidden?"Message removed by moderation":m.text,hidden:!!m.hidden,at:m.at
 }));
}
function userMessageCount(messages,userId,since){
 return (messages||[]).filter(m=>m.userId===userId&&m.at>=since).length;
}
function appendMessage(room,user,text,color,t=Date.now()){
 const value=cleanMessage(text);
 if((room.mutedUsers||[]).includes(user.id))throw Error("You are muted in this room.");
 const history=room.messages||[];
 const prior=history.filter(m=>m.userId===user.id).at(-1);
 if(prior&&t-prior.at<2500)throw Error("Send messages a little slower.");
 if(userMessageCount(history,user.id,t-60_000)>=12)throw Error("Room chat limit reached. Try again shortly.");
 const message={id:crypto.randomUUID(),userId:user.id,alias:user.username,color,text:value,hidden:false,at:t};
 return [...history,message].slice(-MAX_MESSAGES);
}
function reportMessage(room,id,reporterId){
 if(typeof id!=="string"||id.length>64)throw Error("Invalid message.");
 const message=(room.messages||[]).find(m=>m.id===id);
 if(!message)throw Error("Message no longer available.");
 if(message.userId===reporterId)throw Error("You cannot report your own message.");
 const reports={...room.reports};
 const reporters=[...(reports[id]||[])];
 if(!reporters.includes(reporterId))reporters.push(reporterId);
 reports[id]=reporters;
 const hidden=reporters.length>=2;
 return {reports,messages:hidden?room.messages.map(m=>m.id===id?{...m,hidden:true}:m):room.messages,
  hidden,reportCount:reporters.length};
}
function moderate(room,hostUserId,targetId,action){
 if(hostUserId!==room.seats[room.hostSeat]?.userId)throw Error("Only the room host can moderate messages.");
 if(action==="remove"){
  if(typeof targetId!=="string")throw Error("Invalid message.");
  const found=room.messages.find(m=>m.id===targetId);
  if(!found)throw Error("Message was not found.");
  return {messages:room.messages.map(m=>m.id===targetId?{...m,hidden:true}:m),mutedUsers:room.mutedUsers||[]};
 }
 if(action==="mute"||action==="unmute"){
  const message=(room.messages||[]).find(m=>m.id===targetId);
  const userId=message?.userId;
  if(!userId||userId===hostUserId)throw Error("Invalid participant.");
  if(!room.seats.some(s=>s?.userId===userId))throw Error("This user is not seated in the room.");
  const values=new Set(room.mutedUsers||[]);
  if(action==="mute")values.add(userId);else values.delete(userId);
  return {messages:room.messages,mutedUsers:[...values]};
 }
 throw Error("Unsupported moderation action.");
}
module.exports={MAX_MESSAGES,MAX_LENGTH,cleanMessage,publicMessages,appendMessage,reportMessage,moderate};
