import '../scripts/env';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { z } from 'zod';
import { config } from '@/lib/config';

const CATEGORIES = [
  'simple-factual',
  'how-to',
  'service-discovery',
  'multi-hop',
  'cross-service',
  'platform-specific',
  'ambiguous',
  'troubleshooting',
  'error-log',
  'deployment-workflow',
  'domain-dns',
  'database',
  'object-storage',
  'ai-api',
  'unsupported',
  'incorrect-assumption',
  'adversarial',
  'persian',
  'english',
  'mixed',
] as const;

const Case = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'kebab-case id'),
  question: z.string().min(5),
  category: z.enum(CATEGORIES),
  language: z.enum(['fa', 'en', 'mixed']),
  expectedSources: z.array(z.string().startsWith('https://docs.liara.ir/')),
  expectedFacts: z.array(z.string()),
  forbiddenClaims: z.array(z.string()),
  shouldClarify: z.boolean(),
  filters: z.object({ product: z.string().optional(), platform: z.string().optional() }).optional(),
});

const CASES_DIR = path.join(__dirname, '..', 'evals', 'cases');

/** canonical page path: no origin, no /llms prefix, no .md, no #anchor, no trailing slash */
function pagePath(url: string): string {
  let p = url.replace(/^https?:\/\/[^/]+/, '').split('#')[0];
  p = p.replace(/^\/llms\//, '/').replace(/\.md$/, '');
  return p.replace(/\/+$/, '').replace(/^\/+/, '/');
}

function loadAll() {
  const files = fs.readdirSync(CASES_DIR).filter((f) => f.endsWith('.json'));
  return files.map((f) => ({
    file: f,
    cases: JSON.parse(fs.readFileSync(path.join(CASES_DIR, f), 'utf8').replace(/\r\n?/g, '\n')) as unknown[],
  }));
}

describe('evals/cases schema', () => {
  const groups = loadAll();

  it('has case files with at least 48 cases total', () => {
    expect(groups.length).toBeGreaterThan(0);
    const total = groups.reduce((n, g) => n + g.cases.length, 0);
    expect(total).toBeGreaterThanOrEqual(48);
  });

  it('every case matches the schema', () => {
    for (const g of groups) {
      for (const c of g.cases) {
        const parsed = Case.safeParse(c);
        expect(parsed.success, `${g.file}: ${JSON.stringify(c).slice(0, 120)} -> ${parsed.success ? '' : parsed.error.message}`).toBe(true);
      }
    }
  });

  it('ids are unique across all files', () => {
    const ids = groups.flatMap((g) => g.cases.map((c) => (c as { id: string }).id));
    const dupes = ids.filter((id, i) => ids.indexOf(id) !== i);
    expect(dupes, `duplicate ids: ${dupes.join(', ')}`).toEqual([]);
  });

  it('every expectedSources url exists in all-links-llms.txt', () => {
    const linksFile = path.join(config().DOCS_DIR, 'public', 'all-links-llms.txt');
    expect(fs.existsSync(linksFile), `missing ${linksFile} — check DOCS_DIR`).toBe(true);
    const txt = fs.readFileSync(linksFile, 'utf8').replace(/\r\n?/g, '\n');
    const known = new Set<string>();
    for (const m of txt.matchAll(/https:\/\/docs\.liara\.ir\/\S+?(?=\)|\s|$)/g)) known.add(pagePath(m[0]));

    for (const g of groups) {
      for (const c of g.cases as { id: string; expectedSources: string[] }[]) {
        for (const url of c.expectedSources) {
          expect(known.has(pagePath(url)), `${g.file}#${c.id}: unknown doc url ${url}`).toBe(true);
        }
      }
    }
  });
});
