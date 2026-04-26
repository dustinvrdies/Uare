FROM node:20-bookworm-slim AS deps
WORKDIR /app
COPY custom_backend/package*.json ./
RUN npm ci && npm cache clean --force

FROM node:20-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=deps /app/node_modules ./node_modules
COPY custom_backend/ ./
RUN mkdir -p /app/data /app/artifacts && chown -R node:node /app
USER node
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:8787/ready').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["bash", "-lc", "node scripts/runMigrations.mjs && node server.mjs"]
