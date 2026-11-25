import http from 'node:http';
import { readFileSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
const port=Number(process.env.PORT || 8903);
const compressed=process.env.PREVIEW_GZIP==='1' ? gzipSync(readFileSync('dist/index.html')) : null;
const files={'/hitori-jinro/':['index.html','text/html; charset=utf-8'],'/hitori-jinro/og.png':['og.png','image/png'],'/hitori-jinro/favicon.svg':['favicon.svg','image/svg+xml']};
http.createServer((req,res)=>{const path=new URL(req.url,'http://localhost').pathname;
if(path==='/hitori-jinro'){res.writeHead(308,{Location:'/hitori-jinro/'}).end();return;}
const entry=files[path]; if(!entry){res.writeHead(404).end();return;} try{const zip=compressed && entry[0]==='index.html' && /gzip/.test(req.headers['accept-encoding'] || ''); res.writeHead(200,{'Content-Type':entry[1],...(zip?{'Content-Encoding':'gzip','Vary':'Accept-Encoding'}:{})});res.end(zip?compressed:readFileSync(`dist/${entry[0]}`));}catch{res.writeHead(404).end();}
}).listen(port,'127.0.0.1',()=>console.log(`http://127.0.0.1:${port}/hitori-jinro/`));
