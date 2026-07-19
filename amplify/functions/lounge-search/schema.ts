import { z } from 'zod';

// Runtime validation of the model's web-search output. Same boundary-check discipline as
// the menu analyzer: the model returns JSON, but TypeScript types are erased at runtime, so
// we validate the shape before storing it. A bad shape becomes a clean ERROR, not a crash.

// One lounge the web search turned up. `name` and `area` are the minimum worth showing;
// `address` and `url` are best-effort (a search result may not carry either).
const lounge = z.object({
  name: z.string(),
  area: z.string(),
  address: z.string().nullable().optional(),
  url: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

// The worker asks for a bare JSON array. Cap the length so one search can't balloon the
// stored row (and so the prompt's "≤8" is enforced, not merely requested).
const loungeList = z.array(lounge).max(8);

export type Lounge = z.infer<typeof lounge>;
export type LoungeList = z.infer<typeof loungeList>;

// Pull the JSON array out of the model's reply and validate it. Web-search replies often
// wrap the array in prose or a ```json fence, so locate the outermost [...] first rather
// than JSON.parse-ing the whole message.
export function parseLoungeList(text: string): LoungeList {
  const start = text.indexOf('[');
  const end = text.lastIndexOf(']');
  if (start === -1 || end === -1 || end < start) {
    // No array at all — treat as "found nothing" rather than an error, so the user sees a
    // clean empty state instead of a failure for a legitimately empty search.
    return [];
  }
  const parsed: unknown = JSON.parse(text.slice(start, end + 1));
  return loungeList.parse(parsed);
}
