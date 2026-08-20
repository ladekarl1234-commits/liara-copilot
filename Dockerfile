# ---- deps ----
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

# ---- build ----
FROM node:24-alpine AS build
RUN apk add --no-cache git
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Build the docs index inside the image (lexical index needs no API key).
# To ship a vector index instead, run `npm run index` with AI_* env set and
# COPY the resulting data/index — see docs/DEPLOYMENT.md.
RUN npm run sync-docs && npx tsx scripts/build-index.ts
RUN npm run build

# ---- run ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/data/index ./data/index
RUN mkdir -p data/runtime && chown -R app:app data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
