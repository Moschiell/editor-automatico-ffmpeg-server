# Editor Automático — servidor FFmpeg V6

Backend Node/Express + FFmpeg nativo para o Editor Automático.

## V6 — correção do filtro FFmpeg

Corrige o erro:
`Invalid stream specifier: src2`

O vídeo é dividido em duas cópias (`split=2`) antes de criar o fundo desfocado e o vídeo principal, evitando consumir a mesma etiqueta duas vezes.

## Recursos

- FFmpeg nativo dentro do Docker
- até 5 vídeos por lote
- upload robusto para Android/Chrome
- aceita MP4, MOV, WebM, MKV, M4V e AVI
- aceita MIME `video/*` e arquivos com extensão de vídeo
- saída vertical 720x1280 (9:16)
- fundo ampliado e desfocado
- espelhamento opcional
- velocidade de 0,5x a 2x
- áudio ajustado com `atempo` quando a velocidade muda
- logs detalhados de upload, job e FFmpeg
- endpoint `/health`
- tratamento de SIGTERM para o Render

## Deploy no Render

Use este conteúdo como o repositório conectado ao serviço Web Service do Render.
O Render deve construir o Dockerfile e iniciar `node server.js`.

Após o deploy, abra:
`https://SEU-SERVICO.onrender.com/health`

O retorno deve conter `"version":"v6"`.

## API

`POST /api/jobs` com multipart/form-data e campo `videos`.

Campos opcionais: `headline`, `handle`, `mirror`, `speed`.

`GET /api/jobs/:id` consulta o progresso.

`GET /api/jobs/:id/videos/:vid` baixa o MP4 concluído.
