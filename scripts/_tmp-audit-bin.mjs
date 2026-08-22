import fs from 'node:fs';
const P = 'data/index/embeddings.json';
const ms = (f)=>{const t=process.hrtime.bigint();const r=f();return [Number(process.hrtime.bigint()-t)/1e6, r];};

// 1) JSON path, repeated
for (let i=0;i<3;i++){
  const [tr, s] = ms(()=>fs.readFileSync(P,'utf8'));
  const [tp, raw] = ms(()=>JSON.parse(s));
  const hashes = Object.keys(raw.vectors);
  const [tf] = ms(()=>{const m=new Float32Array(hashes.length*raw.dims); hashes.forEach((h,i)=>m.set(raw.vectors[h], i*raw.dims)); return m;});
  console.log(`JSON  run${i+1}: readFile=${tr.toFixed(0)}ms JSON.parse=${tp.toFixed(0)}ms float32fill=${tf.toFixed(0)}ms TOTAL=${(tr+tp+tf).toFixed(0)}ms  (${hashes.length} vecs x ${raw.dims})`);
}
// also: readFileSync as Buffer + JSON.parse(buffer)
{
  const [tr,b]=ms(()=>fs.readFileSync(P));
  const [tp]=ms(()=>JSON.parse(b));
  console.log(`JSON  buffer-variant: readFile=${tr.toFixed(0)}ms JSON.parse(buf)=${tp.toFixed(0)}ms TOTAL=${(tr+tp).toFixed(0)}ms`);
}

// 2) write binary: header json (model,dims,hashes) + raw f32
const raw = JSON.parse(fs.readFileSync(P,'utf8'));
const hashes = Object.keys(raw.vectors);
const dims = raw.dims;
const mat = new Float32Array(hashes.length*dims);
hashes.forEach((h,i)=>mat.set(raw.vectors[h], i*dims));
fs.writeFileSync('data/index/_tmp-emb.f32', Buffer.from(mat.buffer, mat.byteOffset, mat.byteLength));
fs.writeFileSync('data/index/_tmp-emb.meta.json', JSON.stringify({model:raw.model,dims,hashes}));
console.log('binary sizes MB: f32=' + (fs.statSync('data/index/_tmp-emb.f32').size/1e6).toFixed(2) + ' meta=' + (fs.statSync('data/index/_tmp-emb.meta.json').size/1e6).toFixed(2) + '  vs json=' + (fs.statSync(P).size/1e6).toFixed(2));

// 3) binary read path, repeated
for (let i=0;i<3;i++){
  const [tm, meta] = ms(()=>JSON.parse(fs.readFileSync('data/index/_tmp-emb.meta.json','utf8')));
  const [tb, m] = ms(()=>{const b=fs.readFileSync('data/index/_tmp-emb.f32'); return new Float32Array(b.buffer,b.byteOffset,b.byteLength/4);});
  console.log(`BIN   run${i+1}: meta=${tm.toFixed(1)}ms f32read=${tb.toFixed(1)}ms TOTAL=${(tm+tb).toFixed(1)}ms  (len=${m.length}, sample=${m[0].toFixed(5)} vs json ${raw.vectors[meta.hashes[0]][0]})`);
}
fs.rmSync('data/index/_tmp-emb.f32'); fs.rmSync('data/index/_tmp-emb.meta.json');
