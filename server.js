const express = require('express');
const multer = require('multer');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

const app = express();
const PORT = Number(process.env.PORT || 3000);

const base = path.join(__dirname, 'data');
const uploads = path.join(base, 'uploads');
const outputs = path.join(base, 'outputs');
for (const dir of [base, uploads, outputs]) fs.mkdirSync(dir, { recursive: true });

const jobs = new Map();
const MAX_FILES = 5;
const MAX_FILE_SIZE = 500 * 1024 * 1024;

const allowedExt = new Set(['.mp4', '.mov', '.webm', '.mkv', '.m4v', '.avi']);
const allowedMime = /^(video\/|application\/octet-stream$)/i;

function uid() {
  return crypto.randomBytes(10).toString('hex');
}

function safeUnlink(filePath) {
  try {
    if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
  } catch (e) {
    console.error('[cleanup] erro ao remover', filePath, e.message);
  }
}

function fileLooksLikeVideo(file) {
  const ext = path.extname(file.originalname || '').toLowerCase();
  return allowedExt.has(ext) || allowedMime.test(file.mimetype || '');
}

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, uploads),
  filename: (_req, file, cb) => cb(null, `${uid()}-${path.basename(file.originalname || 'video')}`)
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_SIZE, files: MAX_FILES },
  fileFilter: (_req, file, cb) => {
    // Android/Chrome pode enviar MIME vazio ou diferente do esperado.
    // Por isso a extensão também é aceita.
    if (fileLooksLikeVideo(file)) return cb(null, true);
    console.warn('[upload] arquivo rejeitado:', {
      name: file.originalname,
      mime: file.mimetype
    });
    return cb(new Error(`Formato não reconhecido: ${file.originalname || 'arquivo'}`));
  }
});

app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

function render(input, output, opts = {}, label = '') {
  return new Promise((resolve, reject) => {
    const speedRaw = Number(opts.speed);
    const speed = Math.max(0.5, Math.min(2, Number.isFinite(speedRaw) && speedRaw > 0 ? speedRaw : 1));
    const mirror = opts.mirror === 'true';

    const src = mirror ? '[0:v]hflip[src]' : '[0:v]null[src]';
    const pts = speed === 1 ? '[src]' : '[src]setpts=PTS/' + speed + '[src2]';
    const baseLabel = speed === 1 ? 'src' : 'src2';

    // Canvas vertical 720x1280, com fundo ampliado e desfocado e vídeo preservando proporção.
    const filter = `${src};${pts};` +
      `[${baseLabel}]scale=720:1280:force_original_aspect_ratio=increase,crop=720:1280,gblur=sigma=18[bg];` +
      `[${baseLabel}]scale=720:1280:force_original_aspect_ratio=decrease[fg];` +
      `[bg][fg]overlay=(W-w)/2:(H-h)/2,format=yuv420p[out]`;

    const args = [
      '-hide_banner',
      '-loglevel', 'error',
      '-i', input,
      '-filter_complex', filter,
      '-map', '[out]',
      '-map', '0:a?',
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '23'
    ];

    if (speed !== 1) {
      args.push('-filter:a', `atempo=${speed}`);
    }

    args.push(
      '-c:a', 'aac',
      '-b:a', '128k',
      '-movflags', '+faststart',
      '-y', output
    );

    console.log(`[ffmpeg] INÍCIO ${label}`, { speed, mirror, input, output });
    const started = Date.now();
    const child = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';

    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 12000) stderr = stderr.slice(-12000);
    });

    child.on('error', err => {
      console.error(`[ffmpeg] ERRO DE PROCESSO ${label}:`, err.message);
      reject(err);
    });

    child.on('close', code => {
      const seconds = ((Date.now() - started) / 1000).toFixed(1);
      if (code === 0) {
        console.log(`[ffmpeg] FIM ${label} OK em ${seconds}s`);
        resolve();
      } else {
        const message = stderr.trim() || `FFmpeg terminou com código ${code}`;
        console.error(`[ffmpeg] FIM ${label} FALHOU em ${seconds}s:`, message);
        reject(new Error(message));
      }
    });
  });
}

app.get('/', (_req, res) => {
  res.send(`<!doctype html>
<html lang="pt-BR"><head><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Editor Automático V5</title></head><body>
<h1>Editor Automático V5</h1>
<p>Servidor FFmpeg nativo online.</p>
<p><a href="/health">Verificar /health</a></p>
</body></html>`);
});

app.get('/health', (_req, res) => {
  res.json({
    ok: true,
    service: 'editor-automatico-ffmpeg',
    version: 'v5',
    ffmpeg: 'native',
    time: new Date().toISOString()
  });
});

app.post('/api/jobs', (req, res, next) => {
  console.log('[api] POST /api/jobs recebido');
  upload.array('videos', MAX_FILES)(req, res, async err => {
    if (err) return next(err);

    const files = req.files || [];
    console.log('[upload] resultado:', files.map(f => ({
      name: f.originalname,
      mime: f.mimetype,
      size: f.size,
      path: f.path
    })));

    if (!files.length) {
      return res.status(400).json({
        error: 'Nenhum vídeo enviado. O campo multipart esperado é "videos".',
        receivedFiles: 0
      });
    }

    const id = uid();
    const job = {
      id,
      status: 'processing',
      total: files.length,
      completed: 0,
      failed: 0,
      createdAt: Date.now(),
      videos: [],
      options: {
        headline: String(req.body?.headline || ''),
        handle: String(req.body?.handle || ''),
        mirror: String(req.body?.mirror || 'false'),
        speed: String(req.body?.speed || '1')
      }
    };

    jobs.set(id, job);
    console.log(`[job ${id}] CRIADO com ${files.length} vídeo(s)`, job.options);

    // Respondemos imediatamente; o processamento continua em segundo plano.
    res.status(202).json({
      id,
      status: job.status,
      total: job.total,
      statusUrl: `/api/jobs/${id}`
    });

    (async () => {
      for (const file of files) {
        const vid = uid();
        const out = path.join(outputs, `${id}-${vid}.mp4`);
        const item = {
          id: vid,
          name: path.basename(file.originalname || 'video'),
          status: 'processing'
        };
        job.videos.push(item);

        try {
          await render(file.path, out, job.options, `${id}/${vid}`);
          if (!fs.existsSync(out)) throw new Error('FFmpeg terminou sem criar o arquivo de saída.');
          item.status = 'done';
          item.downloadUrl = `/api/jobs/${id}/videos/${vid}`;
          job.completed++;
          console.log(`[job ${id}] vídeo ${vid} CONCLUÍDO (${job.completed}/${job.total})`);
        } catch (e) {
          item.status = 'error';
          item.error = e.message || 'Erro desconhecido no FFmpeg.';
          job.failed++;
          console.error(`[job ${id}] vídeo ${vid} FALHOU:`, item.error);
        } finally {
          safeUnlink(file.path);
        }
      }

      job.status = job.failed > 0 ? 'finished_with_errors' : 'done';
      job.finishedAt = Date.now();
      console.log(`[job ${id}] FINALIZADO: ${job.status} — ${job.completed}/${job.total}`);
    })().catch(e => {
      job.status = 'error';
      job.error = e.message || 'Erro interno no processamento.';
      job.finishedAt = Date.now();
      console.error(`[job ${id}] ERRO FATAL:`, e);
    });
  });
});

app.get('/api/jobs/:id', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) {
    console.warn(`[api] GET /api/jobs/${req.params.id} -> 404 (lote não encontrado na memória)`);
    return res.status(404).json({
      error: 'Lote não encontrado. O servidor pode ter sido reiniciado antes da consulta.'
    });
  }
  res.json({
    id: job.id,
    status: job.status,
    total: job.total,
    completed: job.completed,
    failed: job.failed,
    videos: job.videos,
    createdAt: job.createdAt,
    finishedAt: job.finishedAt || null,
    error: job.error || null
  });
});

app.get('/api/jobs/:id/videos/:vid', (req, res) => {
  const job = jobs.get(req.params.id);
  if (!job) return res.status(404).json({ error: 'Lote não encontrado. O servidor pode ter sido reiniciado.' });

  const video = job.videos.find(v => v.id === req.params.vid);
  if (!video || video.status !== 'done') {
    return res.status(404).json({ error: 'Vídeo ainda não está pronto.' });
  }

  const filePath = path.join(outputs, `${job.id}-${video.id}.mp4`);
  if (!fs.existsSync(filePath)) {
    return res.status(404).json({ error: 'Arquivo de saída não está mais disponível no armazenamento temporário.' });
  }

  console.log(`[download] ${job.id}/${video.id}`);
  res.download(filePath, `editor-automatico-${video.id}.mp4`);
});

// Limpeza de jobs antigos. Arquivos ficam apenas enquanto o job existir.
setInterval(() => {
  const cut = Date.now() - 30 * 60 * 1000;
  for (const [id, job] of jobs) {
    if (job.createdAt < cut) {
      for (const v of job.videos) {
        safeUnlink(path.join(outputs, `${id}-${v.id}.mp4`));
      }
      jobs.delete(id);
      console.log(`[cleanup] lote removido: ${id}`);
    }
  }
}, 5 * 60 * 1000).unref();

// Encerramento limpo quando o Render envia SIGTERM.
let shuttingDown = false;
process.on('SIGTERM', () => {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log('[process] SIGTERM recebido — encerrando servidor HTTP. Jobs em andamento podem ser interrompidos pelo Render.');
  server.close(() => {
    console.log('[process] servidor HTTP encerrado.');
    process.exit(0);
  });
  setTimeout(() => process.exit(0), 25000).unref();
});

process.on('SIGINT', () => {
  console.log('[process] SIGINT recebido.');
  server.close(() => process.exit(0));
});

const server = app.listen(PORT, '0.0.0.0', () => {
  console.log(`FFmpeg server V5 listening on ${PORT}`);
  console.log(`Node ${process.version}`);
});

app.use((err, _req, res, _next) => {
  console.error('[api] ERRO:', err);
  if (err instanceof multer.MulterError) {
    return res.status(400).json({ error: `Erro no upload: ${err.message}`, code: err.code });
  }
  return res.status(400).json({ error: err.message || 'Erro interno.' });
});
