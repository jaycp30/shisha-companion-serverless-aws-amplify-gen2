// Shape of the analyzeMenu response.
//
// The Lambda already validates this with Zod (amplify/functions/analyze-menu/schema.ts)
// before returning, so the frontend does NOT re-validate every field — it only needs to
// narrow the success / not-a-menu union.

/** A recommendation, carrying its role: "Best", "Safer", "Wildcard", … */
export interface FlavorPick {
  label: string;
  name: string;
  why: string;
}

/** Something to skip. No role — just a name and a reason. */
export interface AvoidItem {
  name: string;
  why: string;
}

export interface Mix {
  components: string[];
  why: string;
}

export interface DrinkPairing {
  pick: string;
  drink: string;
  why: string;
}

export interface MenuAnalysis {
  /** 5-7 picks; the first three are always Best / Safer / Stronger. */
  picks: FlavorPick[];
  avoid: AvoidItem[];
  mixes: Mix[];
  drink_pairings: DrinkPairing[];
  session_notes: string;
}

export interface NotAMenu {
  error: 'not_a_menu';
}

export type MenuResponse = MenuAnalysis | NotAMenu;

// The model returns { error: 'not_a_menu' } when the photo isn't a shisha menu.
export function isNotAMenu(res: MenuResponse): res is NotAMenu {
  return 'error' in res;
}
