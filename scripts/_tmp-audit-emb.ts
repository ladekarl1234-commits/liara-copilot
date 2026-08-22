process.on('unhandledRejection', (e) => { console.error('UNHANDLED', e); process.exit(3); });
import { embedTexts } from '@/lib/ai/local-embeddings';
(async () => {
  console.log('start', new Date().toISOString());
  const t = process.hrtime.bigint();
  const v = await embedTexts(['چطور دیپلوی کنم؟'], 'query');
  console.log('cold ms=', (Number(process.hrtime.bigint()-t)/1e6).toFixed(0), 'dims=', v[0].length);
})().catch(e => { console.error('ERR', e); process.exit(4); });
