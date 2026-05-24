FROM mcr.microsoft.com/playwright:v1.49.0-jammy

WORKDIR /app

COPY dist/apps/rpa-worker ./
COPY node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "index.js"]
