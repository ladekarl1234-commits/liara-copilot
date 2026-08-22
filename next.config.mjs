/** @type {import('next').NextConfig} */

// Vercel builds its own function bundles from the per-route trace files, so
// `output: 'standalone'` is redundant there — it produces a second full copy of
// node_modules that is then thrown away. The Docker/Liara image still needs it:
// its CMD is literally `node server.js` from .next/standalone.
const onVercel = Boolean(process.env.VERCEL);

const nextConfig = {
  ...(onVercel ? {} : { output: 'standalone' }),
  // pin the tracing root to this project so the standalone server.js lands at
  // .next/standalone/server.js — otherwise Next infers a parent monorepo root
  // (here the OneDrive path) and the Docker `CMD node server.js` breaks (DEPLOY-004)
  outputFileTracingRoot: import.meta.dirname,
  poweredByHeader: false,

  // The docs index is opened through a runtime-computed path (config().INDEX_DIR,
  // default 'data/index'), which the static tracer cannot see. Without this the
  // deployed function has no index at all: loadIndex() throws on every request
  // and /api/health returns 503. Only the two files the runtime actually reads
  // are shipped — embeddings.json is the incremental BUILD cache and is 12 MB of
  // JSON the server never opens.
  outputFileTracingIncludes: {
    // '/*' is Next's documented ALL-ROUTES key. '/api/**' silently matched
    // nothing — verified against .next/server/app/api/chat/route.js.nft.json,
    // which listed zero data/index entries.
    '/*': [
      './data/index/chunks.json',
      './data/index/lexical.json',
      './data/index/meta.json',
      './data/index/vectors.json',
      './data/index/vectors.bin',
    ],
  },

  // Dead weight in the function, measured from the route's .nft.json:
  // @xenova/transformers 21 MB + @img/sharp-* 19 MB + onnxruntime 1 MB.
  // The WASM embedding runtime is unreachable on this deployment — query
  // embeddings come from the hosted provider, so `embedTexts()`, its only
  // importer, is never called. It stays a real dependency for the Docker
  // image, where the model is baked in and AI_EMBEDDINGS_MODEL=local: is a
  // supported configuration. `sharp` is unreachable in both: no next/image.
  // Cutting them is a cold-start optimization, not a size requirement — the
  // whole function traces 64.6 MB against a 250 MB limit.
  outputFileTracingExcludes: {
    '/*': [
      'node_modules/@xenova/**',
      'node_modules/@img/**',
      'node_modules/onnxruntime-web/**',
      'node_modules/onnxruntime-common/**',
      'node_modules/sharp/**',
      'node_modules/typescript/**',
    ],
  },

  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          // `microphone=()` is an EMPTY allowlist — it disables the microphone
          // for this origin too, so the app's own voice input could not work in
          // any deployment. `(self)` grants it to this origin and nobody else.
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(self), geolocation=()' },
          // The deployment is HTTPS-only; without this a first plaintext request
          // is still strippable. Safe here because there is no HTTP-only subdomain.
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' },
          {
            key: 'Content-Security-Policy',
            value:
              "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
