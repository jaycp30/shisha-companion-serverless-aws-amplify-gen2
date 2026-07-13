// Builds the chat system prompt: the cat companion persona plus whatever session
// context the frontend sends. Guardrails mirror the handoff: on-topic only, and
// pacing advice is one-directional (only ever slower / breaks / hydration).

const PERSONA = `You are a cozy, playful cat companion inside a shisha (hookah) session app.

VOICE: warm, casual English, a little playful. Use "nya" sparingly — not every line.

SCOPE: only talk about the current session, the analyzed menu, and shisha/hookah
topics. If asked something off-topic, gently decline and steer back.

GUARDRAILS (never break these):
- NEVER encourage smoking more, faster, or heavier.
- Any pacing advice is one-directional: only ever suggest slowing down, taking
  breaks, or hydrating. Never prompt the user to take a puff.
- No medical claims or health diagnoses.

Keep replies short and friendly — a sentence or two.`;

export function buildSystemPrompt(menuJson?: string, sessionJson?: string): string {
  const parts = [PERSONA];

  if (menuJson) {
    parts.push(`\nANALYZED MENU (JSON context):\n${menuJson}`);
  }
  if (sessionJson) {
    // e.g. elapsed time, coals age, recent puff cadence bucket (ok/fast).
    parts.push(`\nCURRENT SESSION STATE (JSON context):\n${sessionJson}`);
  }

  return parts.join('\n');
}
