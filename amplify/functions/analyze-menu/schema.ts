import { z } from 'zod';

// Runtime validation of the model's JSON output. TypeScript types are erased at
// runtime, so we cannot trust the shape of anything Bedrock returns — this is the
// boundary check (zod here is the TypeScript equivalent of Python's pydantic).

// A pick carries a role label ("Best", "Safer", "Wildcard"...). The model returns 5-7.
const pick = z.object({
  label: z.string(),
  name: z.string(),
  why: z.string(),
});

// Things to skip have no role — just a name and a reason.
const avoidItem = z.object({ name: z.string(), why: z.string() });

const menuAnalysis = z.object({
  // min(1) rather than min(5): if the model returns four good picks for a tiny menu,
  // that's a worse answer, not a broken one. Rejecting it would turn a mild quality
  // dip into a hard error the user sees as a crash.
  picks: z.array(pick).min(1).max(8),
  avoid: z.array(avoidItem).default([]),
  mixes: z
    .array(z.object({ components: z.array(z.string()), why: z.string() }))
    .default([]),
  drink_pairings: z
    .array(z.object({ pick: z.string(), drink: z.string(), why: z.string() }))
    .default([]),
  session_notes: z.string(),
});

// The model returns this instead when the photo is not a shisha menu.
const notAMenu = z.object({ error: z.literal('not_a_menu') });

const menuResponse = z.union([notAMenu, menuAnalysis]);

export type MenuResponse = z.infer<typeof menuResponse>;

// Parse + validate the raw model text. Throws if the shape is wrong so the caller
// surfaces a real error instead of shipping garbage to the UI.
export function parseMenuAnalysis(raw: string): MenuResponse {
  // Despite "STRICT JSON ONLY" instructions, models sometimes wrap the JSON in ```json
  // fences or lead with prose ("This is part of a menu..."). Don't fight it in the
  // prompt alone — slice out the outermost {...} and parse that.
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start === -1 || end <= start) {
    throw new Error('Model returned no JSON object.');
  }
  const cleaned = raw.slice(start, end + 1);

  const result = menuResponse.safeParse(JSON.parse(cleaned));
  if (!result.success) {
    throw new Error(`Model returned an unexpected shape: ${result.error.message}`);
  }
  return result.data;
}
