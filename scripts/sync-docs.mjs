// Clone or update the official Liara docs repo into DOCS_DIR.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const REPO = process.env.LIARA_DOCS_REPO ?? 'https://github.com/liara-cloud/docs';
const dir = process.env.DOCS_DIR ?? path.join('data', 'liara-docs');

const git = (args, cwd) => execFileSync('git', args, { cwd, stdio: 'inherit' });

if (fs.existsSync(path.join(dir, '.git'))) {
  console.log(`[sync-docs] updating ${dir}`);
  git(['-C', dir, 'pull', '--ff-only', '--depth', '1']);
} else {
  console.log(`[sync-docs] cloning ${REPO} -> ${dir}`);
  fs.mkdirSync(path.dirname(dir), { recursive: true });
  git(['clone', '--depth', '1', REPO, dir]);
}
console.log('[sync-docs] done');
