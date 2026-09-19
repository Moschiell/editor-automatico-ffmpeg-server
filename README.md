# Editor Automático — servidor FFmpeg V7.6

Baseado no caminho de upload que funcionou na V6.

- `videos`: multipart com até 5 arquivos de vídeo.
- `watermarkData`: marca d'água opcional enviada como Data URL (JPG/PNG/WebP).
- Renderização 9:16 em FFmpeg nativo.
- Título, legenda, @, velocidade e espelhamento.

## Deploy no Render
Envie estes arquivos para o repositório conectado ao serviço Render e aguarde o deploy.

`/health` deve retornar `version: v7.6`.
