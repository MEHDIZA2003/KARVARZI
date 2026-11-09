# Production-ready Lightweight Container for Karvarzi Platform
FROM node:20-alpine

WORKDIR /app

# Copy application files
COPY package.json ./
COPY server.js ./
COPY index.html ./
COPY manifest.json ./
COPY sw.js ./
COPY icon.svg ./
COPY services/ ./services/
COPY data/ ./data/

# Environment Variables
ENV PORT=3000
ENV NODE_ENV=production

EXPOSE 3000

CMD ["node", "server.js"]
