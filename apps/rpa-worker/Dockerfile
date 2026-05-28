FROM mcr.microsoft.com/playwright:v1.60.0-jammy

WORKDIR /app

COPY dist/apps/rpa-worker ./
COPY node_modules ./node_modules

# Resolve broken monorepo workspace symlink
RUN rm -rf node_modules/@rpa/automation-core && ln -s /app/libs/automation-core node_modules/@rpa/automation-core

ENV NODE_ENV=production
CMD ["node", "."]
