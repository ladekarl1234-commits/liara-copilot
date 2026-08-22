import fs from 'node:fs';
import path from 'node:path';
import MiniSearch from 'minisearch';
import { loadIndex, resetIndexForTests, miniOptions, corpusIdf } from '@/lib/retrieval/index';

const DIR = process.env.INDEX_DIR!;
const ms = (f: () => unknown) => { const t = process.hrtime.bigint(); f(); return Number(process.hrtime.bigint() - t) / 1e6; };

const sz = (f: string) => fs.statSync(path.join(DIR, f)).size;
console.log('sizes MB:', ['chunks.json','lexical.json','embeddings.json','meta.json'].map(f => `${f}=${(sz(f)/1e6).toFixed(2)}`).join(' '));

// --- component breakdown (fresh strings each time) ---
for (const round of [1,2,3]) {
  let sChunks='', sLex='', sEmb='';
  const tReadC = ms(() => { sChunks = fs.readFileSync(path.join(DIR,'chunks.json'),'utf8'); });
  const tReadL = ms(() => { sLex = fs.readFileSync(path.join(DIR,'lexical.json'),'utf8'); });
  const tReadE = ms(() => { sEmb = fs.readFileSync(path.join(DIR,'embeddings.json'),'utf8'); });
  let chunks: any[] = [], raw: any = null, mini: any = null;
  const tParseC = ms(() => { chunks = JSON.parse(sChunks); });
  const tLoadL  = ms(() => { mini = MiniSearch.loadJSON(sLex, miniOptions()); });
  const tParseE = ms(() => { raw = JSON.parse(sEmb); });
  let matrix: Float32Array;
  const tMatrix = ms(() => {
    const present = chunks.filter((c:any)=>raw.vectors[c.hash]);
    matrix = new Float32Array(present.length * raw.dims);
    present.forEach((c:any,i:number)=>matrix.set(raw.vectors[c.hash], i*raw.dims));
  });
  const tMap = ms(() => new Map(chunks.map((c:any)=>[c.id,c])));
  console.log(`round ${round}: readChunks=${tReadC.toFixed(0)} parseChunks=${tParseC.toFixed(0)} readLex=${tReadL.toFixed(0)} miniLoadJSON=${tLoadL.toFixed(0)} readEmb=${tReadE.toFixed(0)} parseEmb=${tParseE.toFixed(0)} float32fill=${tMatrix.toFixed(0)} byIdMap=${tMap.toFixed(0)} SUM=${(tReadC+tParseC+tReadL+tLoadL+tReadE+tParseE+tMatrix+tMap).toFixed(0)}ms  chunks=${chunks.length} dims=${raw.dims} vecs=${Object.keys(raw.vectors).length}`);
  void mini;
}

// --- whole loadIndex(), hybrid (embeddings on) ---
for (const round of [1,2,3]) {
  resetIndexForTests();
  const t = ms(() => loadIndex(DIR));
  console.log(`loadIndex hybrid round ${round}: ${t.toFixed(0)}ms`);
}
// warm (memoized)
resetIndexForTests(); loadIndex(DIR);
console.log(`loadIndex warm (globalThis hit): ${ms(()=>loadIndex(DIR)).toFixed(3)}ms`);

// --- lexical-only ---
process.env.AI_EMBEDDINGS_MODEL = '';
for (const round of [1,2]) {
  resetIndexForTests();
  const t = ms(() => loadIndex(DIR));
  console.log(`loadIndex lexical-only round ${round}: ${t.toFixed(0)}ms`);
}

// --- corpusIdf lazy cost ---
process.env.AI_EMBEDDINGS_MODEL = 'local:';
resetIndexForTests();
const idx = loadIndex(DIR);
console.log(`corpusIdf (first call, lazy): ${ms(()=>corpusIdf(idx)).toFixed(0)}ms`);
console.log(`corpusIdf (memoized): ${ms(()=>corpusIdf(idx)).toFixed(3)}ms`);
console.log('rss MB:', (process.memoryUsage().rss/1e6).toFixed(0), 'heapUsed MB:', (process.memoryUsage().heapUsed/1e6).toFixed(0));
