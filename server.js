const express=require('express');
const multer=require('multer');
const fs=require('fs'),path=require('path'),crypto=require('crypto');
const {spawn}=require('child_process');
const app=express(); const PORT=process.env.PORT||3000;
const base=path.join(__dirname,'data'),uploads=path.join(base,'uploads'),outputs=path.join(base,'outputs');
[base,uploads,outputs].forEach(d=>fs.mkdirSync(d,{recursive:true}));
const jobs=new Map();
const upload=multer({dest:uploads,limits:{fileSize:500*1024*1024,files:5},fileFilter:(r,f,cb)=>cb(/^video\/(mp4|quicktime|webm|x-matroska)$/i.test(f.mimetype)?null:new Error('Envie um vídeo compatível.'))});
const uid=()=>crypto.randomBytes(10).toString('hex');
const unlink=p=>{try{if(p&&fs.existsSync(p))fs.unlinkSync(p)}catch{}};
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
function render(input,output,opts={}){return new Promise((resolve,reject)=>{
  const speed=Math.max(0.5,Math.min(2,Number(opts.speed)||1));
  const mirror=opts.mirror==='true';
  const src=mirror?'[0:v]hflip[src]':'[0:v]null[src]';
  const pts=speed===1?'[src]':'[src]setpts=PTS/'+speed+'[src2]';
  const baseLabel=speed===1?'src':'src2';
  const filter=`${src};${pts};[${baseLabel}]scale=360:640:force_original_aspect_ratio=increase,crop=360:640,gblur=sigma=18[bg];[${baseLabel}]scale=980:1742:force_original_aspect_ratio=decrease[fg];[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]`;
  const args=['-hide_banner','-loglevel','error','-i',input,'-filter_complex',filter,'-map','[out]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','24'];
  if(speed!==1)args.push('-filter:a',`atempo=${speed}`);
  args.push('-c:a','aac','-b:a','128k','-movflags','+faststart','-y',output);
  const p=spawn('ffmpeg',args);let err='';p.stderr.on('data',d=>err+=d);p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error(err||`FFmpeg terminou com código ${c}`)));
 });}
app.get('/',(r,s)=>s.send('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1"><h1>Editor Automático</h1><p>Servidor FFmpeg nativo online.</p><p><a href="/health">/health</a></p>'));
app.get('/health',(r,s)=>s.json({ok:true,service:'editor-automatico-ffmpeg',ffmpeg:'native',time:new Date().toISOString()}));
app.post('/api/jobs',upload.array('videos',5),async(r,s)=>{
 const files=r.files||[];if(!files.length)return s.status(400).json({error:'Nenhum vídeo enviado.'});
 const id=uid();const job={id,status:'processing',total:files.length,completed:0,createdAt:Date.now(),videos:[],options:{headline:r.body.headline||'',handle:r.body.handle||'',mirror:r.body.mirror||'false',speed:r.body.speed||'1'}};jobs.set(id,job);
 s.status(202).json({id,status:job.status,total:job.total,statusUrl:`/api/jobs/${id}`});
 (async()=>{for(const f of files){const vid=uid(),out=path.join(outputs,`${id}-${vid}.mp4`),item={id:vid,name:path.basename(f.originalname),status:'processing'};job.videos.push(item);try{await render(f.path,out,job.options);item.status='done';item.downloadUrl=`/api/jobs/${id}/videos/${vid}`;job.completed++}catch(e){item.status='error';item.error=e.message}finally{unlink(f.path)}}job.status=job.videos.every(v=>v.status==='done')?'done':'finished_with_errors';job.finishedAt=Date.now()})().catch(e=>{job.status='error';job.error=e.message});
});
app.get('/api/jobs/:id',(r,s)=>{const j=jobs.get(r.params.id);if(!j)return s.status(404).json({error:'Lote não encontrado.'});s.json({id:j.id,status:j.status,total:j.total,completed:j.completed,videos:j.videos,createdAt:j.createdAt,finishedAt:j.finishedAt||null})});
app.get('/api/jobs/:id/videos/:vid',(r,s)=>{const j=jobs.get(r.params.id);if(!j)return s.status(404).json({error:'Lote não encontrado.'});const v=j.videos.find(x=>x.id===r.params.vid);if(!v||v.status!=='done')return s.status(404).json({error:'Vídeo ainda não está pronto.'});const f=path.join(outputs,`${j.id}-${v.id}.mp4`);if(!fs.existsSync(f))return s.status(404).json({error:'Arquivo não encontrado.'});s.download(f,`editor-automatico-${v.id}.mp4`)});
setInterval(()=>{const cut=Date.now()-30*60*1000;for(const[id,j]of jobs){if(j.createdAt<cut){j.videos.forEach(v=>unlink(path.join(outputs,`${id}-${v.id}.mp4`)));jobs.delete(id)}}},5*60*1000).unref();
app.use((e,r,s,n)=>s.status(400).json({error:e.message||'Erro interno.'}));
app.listen(PORT,'0.0.0.0',()=>console.log(`FFmpeg server listening on ${PORT}`));
