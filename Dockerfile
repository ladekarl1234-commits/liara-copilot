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
# Build the docs index inside the image. AI_EMBEDDINGS_MODEL defaults to
# `local:` (no API key), so this step ALSO downloads the ~90 MB e5 model into
# TRANSFORMERS_CACHE — and that cache is then copied into the runner below.
# Without it the first chat request fetches the model from the HF hub inside the
# request: measured, >100s in the `searching` stage with no answer streamed.
# Needs network for github.com (docs) and huggingface.co (model). To build with
# neither, set AI_EMBEDDINGS_MODEL= (empty) for a lexical-only image, or build
# data/index out-of-band and COPY it. See docs/DEPLOYMENT.md.
ENV TRANSFORMERS_CACHE=/app/.cache/transformers
RUN mkdir -p "$TRANSFORMERS_CACHE" \
 && npm run sync-docs \
 && npx tsx scripts/build-index.ts
RUN npm run build

# ---- run ----
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production PORT=3000 HOSTNAME=0.0.0.0 TRANSFORMERS_CACHE=/app/.cache/transformers
RUN addgroup -S app && adduser -S app -G app
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static
COPY --from=build /app/public ./public
COPY --from=build /app/data/index ./data/index
# the embedding model, already on disk from the build stage — keeps the HF hub
# off the request path entirely (warm load measured 766ms, warm embed 5ms)
COPY --from=build /app/.cache/transformers ./.cache/transformers
RUN mkdir -p data/runtime && chown -R app:app data
USER app
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
