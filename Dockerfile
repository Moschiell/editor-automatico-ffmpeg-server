FROM node:20-bookworm-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --shell /usr/sbin/nologin appuser

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY server.js ./

RUN mkdir -p /app/data/uploads /app/data/outputs \
    && chown -R appuser:appuser /app

USER appuser

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

CMD ["npm", "start"]
