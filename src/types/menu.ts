// Shape of the analyzeMenu response.
//
// The Lambda already validates this with Zod (amplify/functions/analyze-menu/schema.ts)
// before returning, so the frontend does NOT re-validate every field — it only needs to
// narrow the success / not-a-menu union.

export interface FlavorPick {
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
  menu_items: string[];
  picks: {
    best: FlavorPick;
    safer: FlavorPick;
    stronger: FlavorPick;
  };
  avoid: FlavorPick[];
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
