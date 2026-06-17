/**
 * safety.ts — the medical safety layer applied to EVERY medical answer.
 *
 * Three guarantees, all enforced in CODE (not left to the model):
 *  1) Non-removable disclaimer: triage/education decision-SUPPORT, not diagnosis.
 *  2) Red-flag detection: emergency-implying queries lead with "seek emergency care now".
 *  3) Grounding guard: if retrieval found nothing relevant, refuse rather than hallucinate.
 *
 * SDK-free and pure so it is trivially testable.
 */

export type SafetyAction = "emergency_lead" | "answer" | "refuse_ungrounded";

export interface SafetyResult {
  red_flag: boolean;
  red_flag_terms: string[];
  grounded: boolean;
  action: SafetyAction;
}

export const MEDICAL_DISCLAIMER =
  "⚠️  Lifeline gives first-aid EDUCATION and triage SUPPORT — not a medical diagnosis. " +
  "It can be wrong or incomplete. In any emergency, call your local emergency number immediately.";

export const EMERGENCY_NOTICE =
  "🚨 THIS MAY BE A LIFE-THREATENING EMERGENCY. Call emergency services now (or your local emergency " +
  "number) and follow the dispatcher's instructions. Do not wait for or rely on the guidance below.";

/** Life-threatening signs that must trigger emergency-care guidance first. */
const RED_FLAGS: Array<{ re: RegExp; label: string }> = [
  { re: /\b(unconscious|unresponsive|not respond(ing|s)?|passed out|fainted|collapsed)\b/i, label: "unconsciousness" },
  { re: /\b(not breathing|stopped breathing|can'?t breathe|cannot breathe|difficulty breathing|trouble breathing|struggling to breathe|gasping|short of breath)\b/i, label: "breathing difficulty" },
  { re: /\b(chest pain|chest pressure|chest tightness)\b/i, label: "chest pain" },
  { re: /\b(severe bleeding|heavy bleeding|won'?t stop bleeding|will not stop bleeding|h(a)?emorrhage|spurting blood|bleeding (heavily|a lot)|massive bleed)\b/i, label: "severe bleeding" },
  { re: /\b(anaphylaxis|anaphylactic|throat closing|tongue swelling|swollen throat|severe allergic)\b/i, label: "anaphylaxis" },
  { re: /\bheat[\s-]?stroke\b/i, label: "heat stroke (heat emergency)" },
  // Cerebrovascular stroke — but NOT "heat stroke" (negative lookbehind).
  { re: /(?<!heat[\s-])\bstroke\b|face droop(ing)?|slurred speech|arm weakness|one side .*(weak|numb)|\bf\.?a\.?s\.?t\.? signs\b/i, label: "stroke signs" },
  { re: /\b(seizure|convuls(ion|ing)|fitting)\b/i, label: "seizure" },
  { re: /\b(choking|something stuck in (the |his |her |their )?throat|object in airway)\b/i, label: "choking" },
  { re: /\b(cardiac arrest|heart attack|no pulse|cpr)\b/i, label: "cardiac arrest" },
  { re: /\b(overdose|poison(ing|ed)?|swallowed .*(poison|chemical|bleach))\b/i, label: "poisoning/overdose" },
  { re: /\b(third[- ]degree burn|severe burn|large burn|burn .*(face|airway))\b/i, label: "severe burns" },
  { re: /\b(drowning|drowned|submerged)\b/i, label: "drowning" },
  { re: /\b(severe head injury|skull fracture|won'?t wake up|head trauma)\b/i, label: "severe head injury" },
];

export function detectRedFlags(query: string): string[] {
  const hits = new Set<string>();
  for (const { re, label } of RED_FLAGS) if (re.test(query)) hits.add(label);
  return [...hits];
}

export function assessSafety(opts: { query: string; grounded: boolean }): SafetyResult {
  const red_flag_terms = detectRedFlags(opts.query);
  const red_flag = red_flag_terms.length > 0;
  const action: SafetyAction = red_flag ? "emergency_lead" : opts.grounded ? "answer" : "refuse_ungrounded";
  return { red_flag, red_flag_terms, grounded: opts.grounded, action };
}

export function ungroundedRefusal(): string {
  return (
    "I couldn't find relevant guidance for that in the loaded field manual, so I won't guess. " +
    "Please consult a clinician or your local emergency services, and try rephrasing with more specifics."
  );
}

/** System prompt that constrains the model to the retrieved passages and demands citations. */
export function buildGroundedSystemPrompt(passages: Array<{ tag: string; content: string }>): string {
  const ctx = passages.map((p) => `[${p.tag}]\n${p.content}`).join("\n\n");
  return [
    "You are MedPsy running inside Lifeline, an OFFLINE first-aid and triage-support assistant.",
    "Answer the user's medical question USING ONLY the numbered context passages below.",
    "Cite the passages you use by their tag, e.g. [S1], inline.",
    "If the passages do not contain the answer, say you don't have guidance on it — do NOT invent facts, doses, or procedures.",
    "Be concise, practical, and calm. You provide decision SUPPORT, not a diagnosis.",
    "",
    "CONTEXT PASSAGES:",
    ctx,
  ].join("\n");
}
