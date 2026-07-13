import { z } from 'zod';

// Runtime validation of the model's JSON output. TypeScript types are erased at
// runtime, so we cannot trust the shape of anything Bedrock returns — this is the
// boundary check (zod here is the TypeScript equivalent of Python's pydantic).

const pick = z.object({ name: z.string(), why: z.string() });

const menuAnalysis = z.object({
  menu_items: z.array(z.string()).default([]),
  picks: z.object({ best: pick, safer: pick, stronger: pick }),
  avoid: z.array(z.object({ name: z.string(), why: z.string() })).default([]),
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

// Parse + validate the raw model text. Throws if the shape is wrong so the
// caller surfaces a real error instead of shipping garbage to the UI.
export function parseMenuAnalysis(raw: string): MenuResponse {
  // Models occasionally wrap JSON in ```json fences despite instructions — strip them.
  const cleaned = raw
    .trim()
    .replace(/^```(?:json)?/, '')
    .replace(/```$/, '')
    .trim();

  const result = menuResponse.safeParse(JSON.parse(cleaned));
  if (!result.success) {
    throw new Error(`Model returned an unexpected shape: ${result.error.message}`);
  }
  return result.data;
}
