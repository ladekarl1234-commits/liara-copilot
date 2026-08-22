// Post-answer claim verification (optional stage, VERIFY_CLAIMS=on).
// Checks Liara-specific claims against the retrieved evidence; returns a short
// correction note when something is unsupported. Failures never break the
// user-facing answer — they are logged and skipped.

import { z } from 'zod';
import type { ModelProvider, ScoredChunk, Usage } from '@/types';
import { verifySystemPrompt, sanitizeFences } from '@/lib/agent/prompts';
import { citationUrl } from '@/lib/retrieval/index';
import { extractJson } from '@/lib/agent/plan';
import { config } from '@/lib/config';

const VerifySchema = z.object({
  unsupported: z.array(z.string().max(300)).catch([]),
  note: z.string().max(500).catch(''),
});

export interface VerifyResult {
  checked: boolean;
  /**
   * Why the check did not run. `'failed'` means it was ATTEMPTED and broke —
   * the only case a caller must read as "grounding is UNKNOWN" rather than
   * "grounding was not required". `'not-applicable'` covers the benign skips:
   * the feature is off, there is no provider, the answer is too short to carry
   * a checkable claim, or the client already went away.
   *
   * Judge finding COST-01: the answer cache keyed on `unsupportedCount === 0`,
   * which a never-run verifier also reports, so "the verifier broke" was read
   * as "the verifier passed" and the unverified answer was cached permanently
   * for every later asker of that question.
   */
  skipReason?: 'not-applicable' | 'failed';
  unsupportedCount: number;
  note?: string;
  usage: Usage;
}

export async function verifyAnswer(
  answer: string,
  evidence: ScoredChunk[],
  provider: ModelProvider | null,
  signal?: AbortSignal,
): Promise<VerifyResult> {
  const cfg = config();
  const skip: VerifyResult = { checked: false, unsupportedCount: 0, skipReason: 'not-applicable', usage: { inputTokens: 0, outputTokens: 0 } };
  const failed = (usage = { inputTokens: 0, outputTokens: 0 }): VerifyResult => ({ checked: false, unsupportedCount: 0, skipReason: 'failed', usage });
  if (cfg.VERIFY_CLAIMS !== 'on' || !provider || answer.length < 200 || !evidence.length) return skip;
  if (signal?.aborted) return skip; // client already gone — don't spend a call

  try {
    const res = await provider.generate({
      model: cfg.fastModel,
      messages: [
        { role: 'system', content: verifySystemPrompt() },
        {
          role: 'user',
          content: `<evidence>\n${sanitizeFences(citedEvidenceBlock(answer, evidence))}\n</evidence>\n\n<answer>\n${answer.slice(0, 6000)}\n</answer>`,
        },
      ],
      maxTokens: 400,
      temperature: 0,
      jsonSchema: {},
      budgetMs: cfg.VERIFY_BUDGET_MS,
      signal,
    });
    const parsed = VerifySchema.safeParse(extractJson(res.text));
    if (!parsed.success) return failed(res.usage);
    const { unsupported, note } = parsed.data;
    return {
      checked: true,
      unsupportedCount: unsupported.length,
      note: unsupported.length && note ? note : undefined,
      usage: res.usage,
    };
  } catch {
    return failed();
  }
}

/**
 * Evidence for the verify call = only the chunks the answer actually cited.
 *
 * A claim can only be grounded in a chunk the answer referenced, so re-sending
 * all 8 chunks (the identical text the answer call was handed seconds earlier)
 * bought nothing and was 42% of per-turn input tokens (COST-01). Typically 2-3
 * of 8 survive, and the checker keeps full checking power: an unsupported claim
 * is precisely one that no cited chunk backs.
 *
 * Marker numbers are PRESERVED (`[3]` stays `[3]`), never renumbered — the
 * checker reads the answer's own markers and must land on the same source.
 * Fallback when the answer cites nothing: the top 3, the same set
 * citationsFromAnswer() shows the user in that case.
 */
export function citedEvidenceBlock(answer: string, evidence: ScoredChunk[]): string {
  // markers are scanned OUTSIDE code fences/inline code so `argv[2]` is not a
  // citation — same rule as citationsFromAnswer (duplicated rather than
  // imported: verify.ts <- orchestrator.ts would be an import cycle).
  // ponytail: 6 duplicated lines; lift into retrieval/index.ts if a third caller appears.
  const prose = answer.replace(/```[\s\S]*?(```|$)/g, ' ').replace(/`[^`\n]*`/g, ' ');
  const picked = new Set<number>();
  for (const m of prose.matchAll(/\[(\d{1,2})\]/g)) {
    const n = Number(m[1]);
    if (n >= 1 && n <= evidence.length) picked.add(n);
  }
  const items = picked.size
    ? [...picked].sort((a, b) => a - b).map((n) => ({ n, chunk: evidence[n - 1].chunk }))
    : evidence.slice(0, 3).map((s, i) => ({ n: i + 1, chunk: s.chunk }));

  return items
    .map(({ n, chunk: c }) => `[${n}] ${c.title}${c.heading ? ` › ${c.heading}` : ''}\nURL: ${citationUrl(c)}\n${c.text}`)
    .join('\n\n---\n\n');
}
