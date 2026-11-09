(function(root){
"use strict";
const VARIANTS=Object.freeze([
 Object.freeze({id:"quadra-ffa",engine:"quadra-chess-v1",family:"chess",name:"Four-player free-for-all",players:4,mode:"ffa",version:1,ready:true,description:"Four independent armies compete to be the last color standing."}),
 Object.freeze({id:"quadra-teams",engine:"quadra-chess-v1",family:"chess",name:"Four-player teams",players:4,mode:"teams",version:1,ready:true,description:"Red and Yellow play together against Blue and Green."})
]);
const byId=id=>VARIANTS.find(v=>v.id===id)||null;
const byMode=mode=>VARIANTS.find(v=>v.mode===mode)||null;
function createGame(id,engine){
 const variant=byId(id);
 if(!variant)throw Error("Unknown or unavailable game variant.");
 if(!engine||typeof engine.fresh!=="function")throw Error("Variant's rules engine is unavailable.");
 return engine.fresh(variant.mode);
}
const api={VARIANTS,byId,byMode,createGame};
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.QuadraVariants=api;
})(typeof window!=="undefined"?window:null);
