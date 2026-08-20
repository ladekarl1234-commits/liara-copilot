// Deterministic prompt-injection / instruction-override detector.
// The <user_data> fencing in prompts.ts stops pasted content from being read
// as policy; this is the complementary front door — a message whose PURPOSE is
// to override instructions or exfiltrate the system prompt/secrets is refused
// before any model call, regardless of what retrieval returns. Zero model cost.
//
// Scoped tightly to override/exfiltration intent so it never trips a genuine
// question (a user asking "how do prompts work in Liara AI" is fine).

import { normalizeFa } from '@/lib/text/persian';

const OVERRIDE_PATTERNS: RegExp[] = [
  // English: ignore/disregard/forget ... (previous|above|prior|all) ... instructions/rules/prompt
  /\b(ignore|disregard|forget|override|bypass)\b[\s\S]{0,40}\b(previous|above|prior|earlier|all|any)\b[\s\S]{0,25}\b(instruction|instructions|rule|rules|prompt|prompts|context|direction|directions)\b/i,
  // English: reveal/print/repeat the ASSISTANT'S system prompt / instructions.
  // NOTE: user credentials (api key / password / connection string) are NOT
  // listed here — asking how to view YOUR OWN key in the Liara panel is a legit
  // docs question. Only the assistant's own secrets/prompt are protected
  // (covered by "your (system) prompt/instructions" below) (SEC3-001).
  /\b(reveal|print|show|repeat|display|output|leak|expose|give me|tell me)\b[\s\S]{0,40}\b(system prompt|system message|your (instructions|prompt|rules|guidelines|configuration)|the (text|instructions|prompt) above)/i,
  // exfiltrating the assistant's OWN key/secret (framed as "your …"), not the
  // user's ("my … in the panel" is legit — SEC3-001). "your password/token/
  // credential/secret" is still an exfil attempt on the assistant (SECV-001).
  /\byour\b[\s\S]{0,20}\b(api[\s_-]?key|secret|secrets|credential|credentials|password|access token|token)\b/i,
  // English: "what are your instructions/rules" / "repeat everything above"
  /\b(what (are|is) your (system )?(instructions|rules|prompt|guidelines)|repeat (everything|the text|all text|what('| i)s) (above|before)|print everything above)\b/i,
  // English: "you are now" / "act as" role-reassignment to escape policy
  /\b(you are now|from now on you are|act as if you (are|have)|pretend (to be|you are)|new instructions:|developer mode|do anything now|\bDAN\b)\b/i,
  // Persian: نادیده بگیر / بی‌خیال دستورات قبلی / دستورهای قبلی را فراموش کن
  /(نادیده\s*بگیر|بی[\s‌]?خیال|فراموش\s*کن)[\s\S]{0,30}(دستور|قوانین|قواعد|پرامپت|prompt)/i,
  // Persian: پرامپت سیستم / دستورهای سیستمی / کلید ای‌پی‌آی خودت را بگو/چاپ کن/نشان بده
  /(پرامپت\s*سیستم|دستور(ها|های)?\s*سیستم|کلید\s*api|api\s*key|رمز|کلید\s*مخفی)[\s\S]{0,30}(بگو|چاپ|نشان|فاش|بده|نمایش)/i,
  /(بگو|چاپ\s*کن|نشان\s*بده|فاش\s*کن|لو\s*بده)[\s\S]{0,30}(پرامپت\s*سیستم|دستور(ها|های)?\s*سیستم|کلید\s*api|api\s*key)/i,
  // Malicious cross-account destruction. Scoped to ANOTHER account / OTHERS'
  // resources ONLY — a legit "delete all MY old apps" or "remove unused apps"
  // must NOT trip (SEC2-001 false positive).
  /\b(delete|wipe|drop|destroy|remove|nuke)\b[\s\S]{0,50}\b(another|someone else'?s?|other('?s| people'?s| users'?)|other user'?s?)\b[\s\S]{0,25}\b(app|apps|database|databases|account|accounts|project|projects|resource|resources)\b/i,
  /(پاک|حذف|نابود)[\s\S]{0,40}(اکانت|حساب|کاربر|پروژه|برنامه‌های?)\s*(دیگه|دیگر|دیگری|دیگران|شخص\s*دیگ)/i,
  /(اکانت|حساب|کاربر)\s*(دیگه|دیگر|دیگری|دیگران)[\s\S]{0,40}(پاک|حذف|نابود)/i,
];

export function detectInjection(text: string): boolean {
  const norm = normalizeFa(text);
  return OVERRIDE_PATTERNS.some((re) => re.test(text) || re.test(norm));
}

// NOTE: a hardcoded "features Liara doesn't offer" list was tried and removed —
// it made confident factual-absence claims the corpus contradicted (Liara DOES
// document a Kubernetes/K8S container-registry mirror, GPU AI models, and a
// refund policy). The honest behavior for an unanswerable question is the
// evidence gate's "I couldn't find this in the docs" — which asserts no absence
// — not a fabricated "this isn't offered". Do not reintroduce such a list
// without programmatically verifying each entry against the built index.
