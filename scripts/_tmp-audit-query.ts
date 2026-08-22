import { embedTexts } from '@/lib/ai/local-embeddings';
import { loadIndex, search } from '@/lib/retrieval/index';

const DIR = process.env.INDEX_DIR!;
const ms = async (f: () => Promise<unknown>) => { const t = process.hrtime.bigint(); await f(); return Number(process.hrtime.bigint()-t)/1e6; };

const Q = [
  'چطور پروژه Next.js را روی لیارا دیپلوی کنم؟',
  'بعد از دیپلوی خطای 502 می‌گیرم، چه کنم؟',
  'How can I connect PostgreSQL to my application?',
  'تنظیم دامنه اختصاصی و CNAME چطور است؟',
  'DATABASE_URL را کجا تعریف کنم؟',
  'قیمت دیسک چقدر است؟',
  'لاگ‌های برنامه‌ام را کجا ببینم؟',
  'باکت آبجکت استوریج بسازم',
];

(async () => {
  // COLD: first embed call = pipeline construction (ONNX/WASM init + tokenizer) from disk cache
  const cold = await ms(() => embedTexts([Q[0]], 'query'));
  console.log(`embed COLD (pipeline init from disk cache + 1 query): ${cold.toFixed(0)}ms`);

  // WARM: single query, repeated
  const warm: number[] = [];
  for (let i = 0; i < 12; i++) warm.push(await ms(() => embedTexts([Q[i % Q.length]], 'query')));
  const s = [...warm.slice(2)].sort((a,b)=>a-b);
  console.log(`embed WARM 1 query x10: min=${s[0].toFixed(1)} p50=${s[Math.floor(s.length/2)].toFixed(1)} max=${s[s.length-1].toFixed(1)}ms  all=[${warm.map(x=>x.toFixed(0)).join(',')}]`);

  // batch of 3 (search() sends up to 3 planned queries in ONE call)
  const b3: number[] = [];
  for (let i=0;i<6;i++) b3.push(await ms(() => embedTexts(Q.slice(0,3), 'query')));
  const sb = [...b3.slice(1)].sort((a,b)=>a-b);
  console.log(`embed WARM batch of 3: p50=${sb[Math.floor(sb.length/2)].toFixed(1)}ms  all=[${b3.map(x=>x.toFixed(0)).join(',')}]`);

  // full search()
  const idx = loadIndex(DIR);
  const embedQuery = (t: string[]) => embedTexts(t, 'query');
  const lex: number[] = [], hyb: number[] = [];
  for (const q of Q) { await search([q], {}, {}, idx); }            // warm lexical
  for (const q of Q) lex.push(await ms(() => search([q], {}, {}, idx)));
  for (const q of Q) hyb.push(await ms(() => search([q], {}, { embedQuery }, idx)));
  const p = (a: number[]) => { const x=[...a].sort((m,n)=>m-n); return `p50=${x[Math.floor(x.length/2)].toFixed(1)} p95=${x[Math.min(x.length-1,Math.ceil(0.95*x.length)-1)].toFixed(1)} max=${x[x.length-1].toFixed(1)}`; };
  console.log(`search() lexical-only (warm index, n=${lex.length}): ${p(lex)}ms  all=[${lex.map(x=>x.toFixed(0)).join(',')}]`);
  console.log(`search() hybrid      (warm index, n=${hyb.length}): ${p(hyb)}ms  all=[${hyb.map(x=>x.toFixed(0)).join(',')}]`);

  // isolate the vector scan alone
  const vec = await embedTexts([Q[0]], 'query');
  const t0 = process.hrtime.bigint();
  for (let i=0;i<20;i++) await search([Q[0]], {}, { embedQuery: async () => [vec[0]] }, idx);
  console.log(`search() hybrid with PRE-EMBEDDED vector (no model call), avg of 20: ${(Number(process.hrtime.bigint()-t0)/1e6/20).toFixed(1)}ms`);
})();
