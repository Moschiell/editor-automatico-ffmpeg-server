# Editor Automático — FFmpeg Cloud Server

Servidor de teste para o Editor Automático. Usa FFmpeg nativo dentro de Docker, recebe até 5 vídeos, processa um por vez e disponibiliza os MP4.

## Deploy
1. Suba estes arquivos para a raiz de um repositório GitHub.
2. No Blitz.cloud: Aplicativos → My own code → selecione o repositório.
3. Se pedir a porta, use `3000`.
4. Após publicar, abra `https://SEU-ENDERECO/health`.
5. Deve aparecer JSON com `ok: true` e `ffmpeg: native`.

## API
POST `/api/jobs` com multipart/form-data e campo `videos` (até 5).
GET `/api/jobs/ID` para status.
GET `/api/jobs/ID/videos/VIDEO_ID` para baixar.

Esta é a primeira versão do motor. O objetivo é medir a velocidade do FFmpeg nativo antes de conectar o editor completo.


## V2 — compatibilidade Blitz

A imagem agora cria e usa o usuário não-root `appuser`, conforme a exigência do Blitz.cloud.
