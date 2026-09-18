FROM node:20-bookworm-slim
RUN apt-get update && apt-get install -y --no-install-recommends ffmpeg fonts-dejavu && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev
COPY . .
RUN mkdir -p /app/data/uploads /app/data/outputs && chown -R node:node /app
USER node
EXPOSE 10000
CMD ["node","server.js"]
