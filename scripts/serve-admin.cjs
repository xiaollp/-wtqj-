const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(__dirname,'../admin');
const allowed=new Set(['index.html','style.css','config.js','api.js','app.js']);
const server=http.createServer((req,res)=>{
 const pathname=new URL(req.url,'http://localhost').pathname;
 const name=pathname==='/'?'index.html':pathname.slice(1);
 if(req.method!=='GET'||!allowed.has(name)){res.writeHead(404);res.end('Not found');return;}
 const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8'};
 fs.readFile(path.join(root,name),(error,data)=>{if(error){res.writeHead(500);res.end('Read failed');return;}res.writeHead(200,{'Content-Type':types[path.extname(name)],'Cache-Control':'no-store'});res.end(data);});
});
server.on('error',error=>{console.error(error.message);process.exitCode=1;});
server.listen(4173,'127.0.0.1',()=>console.log('管理后台 http://127.0.0.1:4173 · Ctrl+C停止'));
