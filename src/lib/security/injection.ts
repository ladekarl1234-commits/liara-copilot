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
  // English: reveal/print/show/repeat/leak your system prompt / instructions / api key / secret
  /\b(reveal|print|show|repeat|display|output|leak|expose|give me|tell me)\b[\s\S]{0,40}\b(system prompt|system message|your (instructions|prompt|rules)|api[\s_-]?key|secret|credential|password|token|env(ironment)? var)/i,
  // English: "you are now" / "act as" role-reassignment to escape policy
  /\b(you are now|from now on you are|act as if you (are|have)|pretend (to be|you are)|new instructions:)\b/i,
  // Persian: نادیده بگیر / بی‌خیال دستورات قبلی / دستورهای قبلی را فراموش کن
  /(نادیده\s*بگیر|بی[\s‌]?خیال|فراموش\s*کن)[\s\S]{0,30}(دستور|قوانین|قواعد|پرامپت|prompt)/i,
  // Persian: پرامپت سیستم / دستورهای سیستمی / کلید ای‌پی‌آی خودت را بگو/چاپ کن/نشان بده
  /(پرامپت\s*سیستم|دستور(ها|های)?\s*سیستم|کلید\s*api|api\s*key|رمز|کلید\s*مخفی)[\s\S]{0,30}(بگو|چاپ|نشان|فاش|بده|نمایش)/i,
  /(بگو|چاپ\s*کن|نشان\s*بده|فاش\s*کن|لو\s*بده)[\s\S]{0,30}(پرامپت\s*سیستم|دستور(ها|های)?\s*سیستم|کلید\s*api|api\s*key)/i,
  // Malicious cross-account / mass-destruction requests. Scoped to OTHERS'
  // resources or ALL accounts so a legit "how do I delete MY app" never trips.
  /\b(delete|wipe|drop|destroy|remove|nuke)\b[\s\S]{0,40}\b(all|every|another|someone else|other('|)s?)\b[\s\S]{0,25}\b(app|apps|database|databases|account|accounts|project|projects|resource|resources)\b/i,
  /(پاک|حذف|نابود)[\s\S]{0,30}(همه|تمام|اکانت\s*(دیگه|دیگر|دیگری|دیگران)|حساب\s*(دیگه|دیگر|دیگری)|کاربر\s*دیگر)/i,
  /(اکانت|حساب|کاربر)\s*(دیگه|دیگر|دیگری|دیگران)[\s\S]{0,30}(پاک|حذف|نابود)/i,
];

export function detectInjection(text: string): boolean {
  const norm = normalizeFa(text);
  return OVERRIDE_PATTERNS.some((re) => re.test(text) || re.test(norm));
}
