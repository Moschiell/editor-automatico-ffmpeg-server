# Editor Automático — servidor FFmpeg V5

Backend para o frontend hospedado no GitHub Pages.

## Endpoints

- `GET /` — página simples de diagnóstico
- `GET /health` — verifica servidor e FFmpeg
- `POST /api/jobs` — recebe até 5 vídeos no campo `videos`
- `GET /api/jobs/:id` — acompanha o lote
- `GET /api/jobs/:id/videos/:vid` — baixa o MP4 pronto

## Deploy no Render

Use Docker e mantenha o serviço web apontando para este diretório/repositório.

A porta é obtida de `PORT` e o processo escuta em `0.0.0.0`.

## Observação importante

O armazenamento local do Render Free é efêmero. Os arquivos deste projeto são temporários e podem desaparecer se o serviço for reiniciado/reimplantado. A V5 melhora o diagnóstico e o recebimento dos uploads, mas não transforma o armazenamento temporário do Render em armazenamento permanente.
