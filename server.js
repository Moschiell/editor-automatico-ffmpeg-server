const express=require('express');
const multer=require('multer');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawn}=require('child_process');
const app=express();
const PORT=Number(process.env.PORT||3000);
const base=path.join(__dirname,'data'),uploads=path.join(base,'uploads'),outputs=path.join(base,'outputs');
for(const d of [base,uploads,outputs])fs.mkdirSync(d,{recursive:true});
const jobs=new Map(); const MAX_FILES=5, MAX_FILE_SIZE=500*1024*1024;
const allowedVideoExt=new Set(['.mp4','.mov','.webm','.mkv','.m4v','.avi']);
const allowedImageExt=new Set(['.jpg','.jpeg','.png','.webp']);
function uid(){return crypto.randomBytes(10).toString('hex')}
function safeUnlink(p){try{if(p&&fs.existsSync(p))fs.unlinkSync(p)}catch(e){console.error('[cleanup]',e.message)}}
function isVideo(f){const ext=path.extname(f.originalname||'').toLowerCase();return allowedVideoExt.has(ext)||/^video\//i.test(f.mimetype||'')||f.mimetype==='application/octet-stream'}
function isImage(f){const ext=path.extname(f.originalname||'').toLowerCase();return allowedImageExt.has(ext)||/^image\/(jpeg|jpg|png|webp)$/i.test(f.mimetype||'')}
function isAllowedUpload(f){return f.fieldname==='watermark'?isImage(f):isVideo(f)}
const storage=multer.diskStorage({destination:(_r,_f,cb)=>cb(null,uploads),filename:(_r,f,cb)=>cb(null,`${uid()}-${path.basename(f.originalname||'file')}`)});
const upload=multer({storage,limits:{fileSize:MAX_FILE_SIZE,files:MAX_FILES+1},fileFilter:(_r,f,cb)=>cb(isAllowedUpload(f)?null:new Error(`Formato não reconhecido: ${f.originalname||'arquivo'}`))});
app.disable('x-powered-by');
app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next()});
function escText(s){return String(s||'').replace(/\\/g,'\\\\').replace(/:/g,'\\:').replace(/'/g,"\\'").replace(/%/g,'\\%').replace(/,/g,'\\,').replace(/\[/g,'\\[').replace(/\]/g,'\\]')}
function normColor(c,def){return /^0x[0-9a-fA-F]{8}$/.test(c||'')?c:def}
function buildFilter(opts,hasLogo){
 const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
 const mirror=opts.mirror==='true';
 const transform=(mirror?'hflip':'null')+(speed===1?'':`,setpts=PTS/${speed}`);
 const parts=[`[0:v]${transform},split=2[bg0][fg0]`,`[bg0]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,gblur=sigma=22[bg]`,`[fg0]scale=680:1200:force_original_aspect_ratio=decrease[fg]`,`[bg][fg]overlay=(W-w)/2:120[base]`];
 const template=opts.template||'news-card';
 let last='base';
 if(template==='news-card'){
   const title=escText(opts.headline), caption=escText(opts.caption), handle=escText(opts.handle);
   if(title) {parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${title}':fontcolor=white:fontsize=42:line_spacing=8:x=38:y=34:box=1:boxcolor=0x000000B3:boxborderw=14[title]`);last='title'}
   if(caption) {parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${caption}':fontcolor=white:fontsize=32:line_spacing=7:x=38:y=1135:box=1:boxcolor=0x000000B3:boxborderw=14[cap]`);last='cap'}
   if(handle) {parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${handle}':fontcolor=white:fontsize=26:x=38:y=1240:box=1:boxcolor=0x00000099:boxborderw=8[hdl]`);last='hdl'}
 } else if(template==='clean') {
   const caption=escText(opts.caption),handle=escText(opts.handle);
   if(caption){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${caption}':fontcolor=white:fontsize=34:line_spacing=7:x=36:y=1140:box=1:boxcolor=0x000000A6:boxborderw=12[cap]`);last='cap'}
   if(handle){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${handle}':fontcolor=white:fontsize=25:x=36:y=1242[hdl]`);last='hdl'}
 } else if(template==='headline') {
   const title=escText(opts.headline),caption=escText(opts.caption);
   if(title){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${title}':fontcolor=white:fontsize=40:x=36:y=35:box=1:boxcolor=0x000000B8:boxborderw=12[t]`);last='t'}
   if(caption){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${caption}':fontcolor=white:fontsize=30:x=36:y=1145:box=1:boxcolor=0x000000B8:boxborderw=12[c]`);last='c'}
 }
 if(hasLogo){parts.push(`[1:v]scale=${Math.max(40,Math.min(260,Number(opts.logoSize)||120))}:-1[logo]`,`[${last}][logo]overlay=W-w-24:24[wm]`);last='wm'}
 parts.push(`[${last}]format=yuv420p[out]`); return parts.join(';');
}
function render(input,output,opts,label,logoPath){return new Promise((resolve,reject)=>{
 const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
 const filter=buildFilter(opts,!!logoPath);
 const args=['-hide_banner','-loglevel','error','-i',input];
 if(logoPath) args.push('-i',logoPath);
 args.push('-filter_complex',filter,'-map','[out]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','23');
 if(speed!==1)args.push('-filter:a',`atempo=${speed}`);
 args.push('-c:a','aac','-b:a','128k','-movflags','+faststart','-y',output);
 console.log(`[ffmpeg] INÍCIO ${label}`,{template:opts.template,hasLogo:!!logoPath,speed});const started=Date.now();
 const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let err='';p.stderr.on('data',d=>{err+=d.toString();if(err.length>15000)err=err.slice(-15000)});
 p.on('error',reject);p.on('close',c=>{const sec=((Date.now()-started)/1000).toFixed(1);if(c===0){console.log(`[ffmpeg] FIM ${label} OK em ${sec}s`);resolve()}else{console.error(`[ffmpeg] FIM ${label} FALHOU em ${sec}s:`,err);reject(new Error(err||`FFmpeg código ${c}`))}})
})}
app.get('/',(_q,s)=>s.send('<h1>Editor Automático V7.3</h1><p>Servidor FFmpeg nativo.</p><p><a href="/health">/health</a></p>'));
app.get('/health',(_q,s)=>s.json({ok:true,service:'editor-automatico-ffmpeg',version:'v7.3',ffmpeg:'native',time:new Date().toISOString()}));
app.post('/api/jobs',(req,res,next)=>{console.log('[api] POST /api/jobs recebido');upload.any()(req,res,async err=>{
 if(err)return next(err);const received=Array.isArray(req.files)?req.files:[];const files=received.filter(f=>f.fieldname==='videos').slice(0,MAX_FILES);const wm=received.find(f=>f.fieldname==='watermark');
 console.log('[upload] campos recebidos:',received.map(f=>({field:f.fieldname,name:f.originalname,mime:f.mimetype,size:f.size})));console.log('[upload] vídeos:',files.map(f=>({name:f.originalname,mime:f.mimetype,size:f.size,path:f.path}))); if(wm)console.log('[upload] marca d\'água:',{name:wm.originalname,mime:wm.mimetype,size:wm.size,path:wm.path});
 if(!files.length){if(wm)safeUnlink(wm.path);return res.status(400).json({error:'Nenhum vídeo enviado.',receivedFiles:0})}
 let options={template:String(req.body?.template||'news-card'),headline:String(req.body?.headline||''),caption:String(req.body?.caption||''),handle:String(req.body?.handle||''),mirror:String(req.body?.mirror||'false'),speed:String(req.body?.speed||'1'),logoSize:String(req.body?.logoSize||'120')};
 const id=uid(),job={id,status:'processing',total:files.length,completed:0,failed:0,createdAt:Date.now(),videos:[],options};jobs.set(id,job);console.log(`[job ${id}] CRIADO`,options);
 res.status(202).json({id,status:job.status,total:job.total,statusUrl:`/api/jobs/${id}`});
 (async()=>{for(const file of files){const vid=uid(),out=path.join(outputs,`${id}-${vid}.mp4`),item={id:vid,name:path.basename(file.originalname||'video'),status:'processing'};job.videos.push(item);try{await render(file.path,out,options,`${id}/${vid}`,wm?.path);item.status='done';item.downloadUrl=`/api/jobs/${id}/videos/${vid}`;job.completed++;}catch(e){item.status='error';item.error=e.message;job.failed++;}finally{safeUnlink(file.path)} } if(wm)safeUnlink(wm.path);job.status=job.failed?'finished_with_errors':'done';job.finishedAt=Date.now();console.log(`[job ${id}] FINALIZADO: ${job.status} — ${job.completed}/${job.total}`)})().catch(e=>{job.status='error';job.error=e.message;job.finishedAt=Date.now();if(wm)safeUnlink(wm.path);console.error(`[job ${id}] FATAL`,e)})
 })});
app.get('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Lote não encontrado. O servidor pode ter sido reiniciado.'});res.json({id:j.id,status:j.status,total:j.total,completed:j.completed,failed:j.failed,videos:j.videos,options:j.options,createdAt:j.createdAt,finishedAt:j.finishedAt||null,error:j.error||null})});
app.get('/api/jobs/:id/videos/:vid',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Lote não encontrado.'});const v=j.videos.find(x=>x.id===req.params.vid);if(!v||v.status!=='done')return res.status(404).json({error:'Vídeo ainda não está pronto.'});const f=path.join(outputs,`${j.id}-${v.id}.mp4`);if(!fs.existsSync(f))return res.status(404).json({error:'Arquivo não encontrado.'});res.download(f,`editor-automatico-${v.id}.mp4`)});
setInterval(()=>{const cut=Date.now()-30*60*1000;for(const[id,j]of jobs)if(j.createdAt<cut){j.videos.forEach(v=>safeUnlink(path.join(outputs,`${id}-${v.id}.mp4`)));jobs.delete(id)}},5*60*1000).unref();
let server;function shutdown(){if(!server)return;console.log('[process] encerrando');server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),25000).unref()}process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
server=app.listen(PORT,'0.0.0.0',()=>console.log(`FFmpeg server V7.3 listening on ${PORT}`));
app.use((err,_q,res,_n)=>{console.error('[api] ERRO:',err);if(err instanceof multer.MulterError)return res.status(400).json({error:`Erro no upload: ${err.message}`,code:err.code});res.status(400).json({error:err.message||'Erro interno.'})});
