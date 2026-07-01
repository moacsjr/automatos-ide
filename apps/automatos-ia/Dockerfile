FROM mcr.microsoft.com/playwright:v1.61.1-jammy

WORKDIR /app

COPY dist/apps/automatos-ia ./
COPY node_modules ./node_modules

ENV NODE_ENV=production
CMD ["node", "."]
