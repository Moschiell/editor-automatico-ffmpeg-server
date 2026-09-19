FROM node:22-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY server.js ./
RUN mkdir -p /app/data/uploads /app/data/outputs /app/data/assets && chown -R node:node /app
USER node
ENV NODE_ENV=production
CMD ["npm","start"]
