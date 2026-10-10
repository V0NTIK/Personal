import {mkdir,cp,writeFile} from 'node:fs/promises';
const url=process.env.RELAY_API_URL;
if(!url || !/^https:\/\/[a-z0-9]+\.supabase\.co\/functions\/v1\/relay-api$/.test(url)) throw new Error('RELAY_API_URL must be the deployed Supabase relay-api HTTPS endpoint.');
await mkdir('dist',{recursive:true});
await cp('public','dist',{recursive:true});
await writeFile('dist/config.js',`window.RELAY_CONFIG=${JSON.stringify({api:url})};\n`);
console.log('Relay Team built. No secrets are included in the public bundle.');
