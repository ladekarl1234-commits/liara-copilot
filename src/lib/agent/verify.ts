// Post-answer claim verification (optional stage, VERIFY_CLAIMS=on).
// Checks Liara-specific claims against the retrieved evidence; returns a short
// correction note when something is unsupported. Failures never break the
// user-facing answer — they are logged and skipped.

import { z } from 'zod';
import type { ModelProvider, ScoredChunk, Usage } from '@/types';
import { verifySystemPrompt, evidenceBlock } from '@/lib/agent/prompts';
import { extractJson } from '@/lib/agent/plan';
import { config } from '@/lib/config';

const VerifySchema = z.object({
  unsupported: z.array(z.string().max(300)).catch([]),
  note: z.string().max(500).catch(''),
});

export interface VerifyResult {
  checked: boolean;
  unsupportedCount: number;
  note?: string;
  usage: Usage;
}

export async function verifyAnswer(
  answer: string,
  evidence: ScoredChunk[],
  provider: ModelProvider | null,
): Promise<VerifyResult> {
  const cfg = config();
  const skip: VerifyResult = { checked: false, unsupportedCount: 0, usage: { inputTokens: 0, outputTokens: 0 } };
  if (cfg.VERIFY_CLAIMS !== 'on' || !provider || answer.length < 200 || !evidence.length) return skip;

  try {
    const res = await provider.generate({
      model: cfg.AI_MODEL_FAST,
      messages: [
        { role: 'system', content: verifySystemPrompt() },
        {
          role: 'user',
          content: `<evidence>\n${evidenceBlock(evidence)}\n</evidence>\n\n<answer>\n${answer.slice(0, 6000)}\n</answer>`,
        },
      ],
      maxTokens: 400,
      temperature: 0,
      jsonSchema: {},
    });
    const parsed = VerifySchema.safeParse(extractJson(res.text));
    if (!parsed.success) return { ...skip, usage: res.usage };
    const { unsupported, note } = parsed.data;
    return {
      checked: true,
      unsupportedCount: unsupported.length,
      note: unsupported.length && note ? note : undefined,
      usage: res.usage,
    };
  } catch {
    return skip;
  }
}
