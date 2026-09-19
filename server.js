const express=require('express');
const multer=require('multer');
const fs=require('fs');
const path=require('path');
const crypto=require('crypto');
const {spawn}=require('child_process');
const app=express();
const PORT=Number(process.env.PORT||3000);
const base=path.join(__dirname,'data'),uploads=path.join(base,'uploads'),outputs=path.join(base,'outputs'),assets=path.join(base,'assets');
for(const d of [base,uploads,outputs,assets])fs.mkdirSync(d,{recursive:true});
const jobs=new Map();
const MAX_FILES=5,MAX_FILE_SIZE=500*1024*1024,MAX_IMAGE_BYTES=10*1024*1024;
const allowedExt=new Set(['.mp4','.mov','.webm','.mkv','.m4v','.avi']);
const storage=multer.diskStorage({destination:(_r,_f,cb)=>cb(null,uploads),filename:(_r,f,cb)=>cb(null,`${uid()}-${path.basename(f.originalname||'video')}`)});
const upload=multer({storage,limits:{fileSize:MAX_FILE_SIZE,files:MAX_FILES,fieldSize:20*1024*1024},fileFilter:(_r,f,cb)=>{const ext=path.extname(f.originalname||'').toLowerCase();if(allowedExt.has(ext)||/^video\//i.test(f.mimetype||'')||f.mimetype==='application/octet-stream')return cb(null,true);cb(new Error(`Formato de vídeo não reconhecido: ${f.originalname||'arquivo'}`));}});
function uid(){return crypto.randomBytes(10).toString('hex')}
function safeUnlink(p){try{if(p&&fs.existsSync(p))fs.unlinkSync(p)}catch(e){}}
function esc(s){return String(s||'').replace(/\\/g,'\\\\').replace(/'/g,"\\'").replace(/:/g,'\\:').replace(/,/g,'\\,').replace(/%/g,'\\%').replace(/\[/g,'\\[').replace(/\]/g,'\\]');}
function saveImageDataUrl(dataUrl,label){
  if(!dataUrl)return null;
  const m=String(dataUrl).match(/^data:image\/(png|jpeg|jpg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if(!m)throw new Error(`${label} inválido. Use JPG, PNG ou WebP.`);
  const buf=Buffer.from(m[2].replace(/\s/g,''),'base64');
  if(!buf.length||buf.length>MAX_IMAGE_BYTES)throw new Error(`${label} muito grande (máximo 10 MB).`);
  const ext=m[1].toLowerCase()==='jpeg'||m[1].toLowerCase()==='jpg'?'jpg':m[1].toLowerCase();
  const p=path.join(assets,`${uid()}-${label.toLowerCase().replace(/[^a-z0-9]+/g,'-')}.${ext}`);fs.writeFileSync(p,buf);return p;
}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function templateRect(opts){
  // Área do primeiro template de teste: 864x1536, janela central delimitada em ~10.1%,12.76%,79.86%,73.11%.
  return {
    x:clamp(Number(opts.templateX)||0.1007,0,0.5),
    y:clamp(Number(opts.templateY)||0.1276,0,0.6),
    w:clamp(Number(opts.templateW)||0.7986,0.2,1),
    h:clamp(Number(opts.templateH)||0.7311,0.2,1)
  };
}
function buildFilter(opts,logo,template){
  const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
  const mirror=opts.mirror==='true';
  const first=`[0:v]${mirror?'hflip':'null'}${speed===1?'':`,setpts=PTS/${speed}`},split=2[bg0][fg0]`;
  const parts=[first,`[bg0]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,gblur=sigma=22[bg]`];
  let last;
  if(template){
    const r=templateRect(opts);
    const x=Math.round(r.x*720),y=Math.round(r.y*1280),w=Math.round(r.w*720),h=Math.round(r.h*1280);
    const safeX=clamp(x,1,718),safeY=clamp(y,1,1278),safeW=clamp(w,1,720-safeX),safeH=clamp(h,1,1280-safeY);
    const rightW=Math.max(1,720-(safeX+safeW)),bottomH=Math.max(1,1280-(safeY+safeH));
    parts.push(`[fg0]scale=${safeW}:${safeH}:force_original_aspect_ratio=increase,crop=${safeW}:${safeH}[fg]`,`[bg][fg]overlay=${safeX}:${safeY}[base]`);
    parts.push(`[1:v]scale=720:1280,split=4[tt][tl][tr][tb]`,`[tt]crop=720:${safeY}:0:0[tp]`,`[tl]crop=${safeX}:${safeH}:0:${safeY}[tlc]`,`[tr]crop=${rightW}:${safeH}:${safeX+safeW}:${safeY}[trc]`,`[tb]crop=720:${bottomH}:0:${safeY+safeH}[bp]`,`[base][tp]overlay=0:0[t1]`,`[t1][tlc]overlay=0:${safeY}[t2]`,`[t2][trc]overlay=${safeX+safeW}:${safeY}[t3]`,`[t3][bp]overlay=0:${safeY+safeH}[templated]`);
    last='templated';
  }else{
    parts.push(`[fg0]scale=680:1200:force_original_aspect_ratio=decrease[fg]`,`[bg][fg]overlay=(W-w)/2:120[base]`);
    last='base';
  }
  const templateMode=!!template;
  const title=esc(opts.headline),caption=esc(opts.caption),handle=esc(opts.handle);
  if(!templateMode && (opts.template==='news-card'||opts.template==='headline')){
    if(title){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${title}':fontcolor=white:fontsize=42:line_spacing=8:x=38:y=34:box=1:boxcolor=0x000000B3:boxborderw=14[t]`);last='t';}
    if(caption){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${caption}':fontcolor=white:fontsize=32:line_spacing=7:x=38:y=1135:box=1:boxcolor=0x000000B3:boxborderw=14[c]`);last='c';}
    if(handle){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${handle}':fontcolor=white:fontsize=26:x=38:y=1240:box=1:boxcolor=0x00000099:boxborderw=8[h]`);last='h';}
  }else if(!templateMode && opts.template==='clean'){
    if(caption){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf:text='${caption}':fontcolor=white:fontsize=32:x=38:y=1140:box=1:boxcolor=0x000000A6:boxborderw=12[c]`);last='c';}
    if(handle){parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${handle}':fontcolor=white:fontsize=26:x=38:y=1240[h]`);last='h';}
  }else if(templateMode && caption){
    // Na primeira versão do template por imagem, a legenda ocupa a caixa inferior da arte.
    parts.push(`[${last}]drawtext=fontfile=/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf:text='${caption}':fontcolor=white:fontsize=24:line_spacing=6:x=104:y=1162:box=0[c]`);last='c';
  }
  if(logo){
    const size=Math.max(40,Math.min(260,Number(opts.logoSize)||120));
    const idx=template?2:1;
    parts.push(`[${idx}:v]scale=${size}:-1[logo]`,`[${last}][logo]overlay=W-w-24:24[wm]`);last='wm';
  }
  parts.push(`[${last}]format=yuv420p[out]`);
  return parts.join(';');
}
function render(input,output,opts,logo,template,label){
  return new Promise((resolve,reject)=>{
    const speed=Math.max(.5,Math.min(2,Number(opts.speed)||1));
    const filter=buildFilter(opts,logo,template);
    const args=['-hide_banner','-loglevel','error','-i',input];
    if(template)args.push('-i',template);
    if(logo)args.push('-i',logo);
    args.push('-filter_complex',filter,'-map','[out]','-map','0:a?','-c:v','libx264','-preset','veryfast','-crf','23');
    if(speed!==1)args.push('-filter:a',`atempo=${speed}`);
    args.push('-c:a','aac','-b:a','128k','-movflags','+faststart','-shortest','-y',output);
    console.log(`[ffmpeg] INÍCIO ${label}`,{hasTemplate:!!template,hasLogo:!!logo});
    const p=spawn('ffmpeg',args,{stdio:['ignore','ignore','pipe']});let err='';
    p.stderr.on('data',d=>{err+=d.toString();if(err.length>16000)err=err.slice(-16000)});
    p.on('error',reject);p.on('close',c=>c===0?resolve():reject(new Error(err||`FFmpeg terminou com código ${c}`)));
  });
}
app.disable('x-powered-by');app.use((req,res,next)=>{res.setHeader('Access-Control-Allow-Origin','*');res.setHeader('Access-Control-Allow-Methods','GET,POST,OPTIONS');res.setHeader('Access-Control-Allow-Headers','Content-Type');if(req.method==='OPTIONS')return res.sendStatus(204);next();});
app.get('/health',(_q,s)=>s.json({ok:true,service:'editor-automatico-ffmpeg',version:'v7.9',ffmpeg:'native',time:new Date().toISOString()}));
app.post('/api/jobs',(req,res,next)=>{console.log('[api] POST /api/jobs recebido');upload.array('videos',MAX_FILES)(req,res,async err=>{
  if(err)return next(err);
  const files=req.files||[];console.log('[upload] resultado:',files.map(f=>({name:f.originalname,mime:f.mimetype,size:f.size,path:f.path})));
  if(!files.length)return res.status(400).json({error:'Nenhum vídeo enviado.'});
  let logo=null,template=null;
  try{
    logo=saveImageDataUrl(req.body?.watermarkData,'Marca d\'água');
    template=saveImageDataUrl(req.body?.templateData,'Template');
    const options={template:String(req.body?.template||'news-card'),headline:String(req.body?.headline||''),caption:String(req.body?.caption||''),handle:String(req.body?.handle||''),mirror:String(req.body?.mirror||'false'),speed:String(req.body?.speed||'1'),logoSize:String(req.body?.logoSize||'120'),templateX:String(req.body?.templateX||'0.1007'),templateY:String(req.body?.templateY||'0.1276'),templateW:String(req.body?.templateW||'0.7986'),templateH:String(req.body?.templateH||'0.7311')};
    const id=uid();const job={id,status:'processing',total:files.length,completed:0,failed:0,createdAt:Date.now(),videos:[],options};jobs.set(id,job);
    console.log(`[job ${id}] CRIADO com ${files.length} vídeo(s)`,options,{hasWatermark:!!logo,hasTemplate:!!template});res.status(202).json({id,status:job.status,total:job.total,statusUrl:`/api/jobs/${id}`});
    (async()=>{for(const f of files){const vid=uid(),out=path.join(outputs,`${id}-${vid}.mp4`),item={id:vid,name:path.basename(f.originalname||'video'),status:'processing'};job.videos.push(item);try{await render(f.path,out,options,logo,template,`${id}/${vid}`);item.status='done';item.downloadUrl=`/api/jobs/${id}/videos/${vid}`;job.completed++;}catch(e){item.status='error';item.error=e.message;job.failed++;console.error(`[job ${id}] vídeo ${vid} FALHOU`,e.message);}finally{safeUnlink(f.path);}}safeUnlink(logo);safeUnlink(template);job.status=job.failed?'finished_with_errors':'done';job.finishedAt=Date.now();console.log(`[job ${id}] FINALIZADO: ${job.status} — ${job.completed}/${job.total}`);})().catch(e=>{safeUnlink(logo);safeUnlink(template);job.status='error';job.error=e.message;job.finishedAt=Date.now();console.error(`[job ${id}] FATAL`,e)});
  }catch(e){files.forEach(f=>safeUnlink(f.path));safeUnlink(logo);safeUnlink(template);return res.status(400).json({error:e.message});}
});});
app.get('/api/jobs/:id',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Lote não encontrado.'});res.json({id:j.id,status:j.status,total:j.total,completed:j.completed,failed:j.failed,videos:j.videos,options:j.options,createdAt:j.createdAt,finishedAt:j.finishedAt||null,error:j.error||null});});
app.get('/api/jobs/:id/videos/:vid',(req,res)=>{const j=jobs.get(req.params.id);if(!j)return res.status(404).json({error:'Lote não encontrado.'});const v=j.videos.find(x=>x.id===req.params.vid);if(!v||v.status!=='done')return res.status(404).json({error:'Vídeo ainda não está pronto.'});const f=path.join(outputs,`${j.id}-${v.id}.mp4`);if(!fs.existsSync(f))return res.status(404).json({error:'Arquivo não encontrado.'});res.download(f,`editor-automatico-${v.id}.mp4`);});
app.use((e,_q,res,_n)=>{console.error('[api] ERRO:',e);res.status(400).json({error:e.message||'Erro interno.'});});
app.listen(PORT,'0.0.0.0',()=>console.log(`FFmpeg server V7.9 listening on ${PORT}`));
