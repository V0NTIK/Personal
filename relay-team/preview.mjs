import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
const mime={'.html':'text/html','.css':'text/css','.js':'text/javascript','.md':'text/markdown','.svg':'image/svg+xml'};
http.createServer(async(req,res)=>{try{let p=new URL(req.url,'http://localhost').pathname;p=p==='/'?'/index.html':p;if(p.includes('..'))throw Error();const data=await readFile(path.join('dist',p));res.writeHead(200,{'content-type':mime[path.extname(p)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end('Not found');}}).listen(process.env.PORT||3000,'0.0.0.0');
