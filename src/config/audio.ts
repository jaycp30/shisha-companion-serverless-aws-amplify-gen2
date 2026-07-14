import { assetUrl } from './assets';

export interface Track {
  file: string;
  title: string;
}

const HEARTHSIDE: Track = { file: 'Hearthside_Reprieve.mp3', title: 'Hearthside Reprieve' };
const BOOTS_OFF: Track = { file: 'Boots_Off_Cloak_Dry.mp3', title: 'Boots Off, Cloak Dry' };
const VILLAGE: Track = { file: '02_Village.mp3', title: 'Village' };
const AMUSEMENT: Track = { file: '06_Amusement_Quarters.mp3', title: 'Amusement Quarters' };
const RAIN: Track = { file: 'Rain_Against_the_Timber.mp3', title: 'Rain Against the Timber' };
const FARM: Track = { file: '03_A_Day_on_Farm.mp3', title: 'A Day on the Farm' };

export type Mood = 'cozy' | 'lively' | 'calm' | 'all';

/**
 * Each mood holds MORE THAN ONE track and we rotate through them rather than looping a
 * single one — a 3-minute loop repeating across a 90-minute session is the fastest way
 * to make someone reach for mute.
 *
 * 'all' exists so SHUFFLE has something to do. With only two tracks in a mood, shuffling
 * is barely distinguishable from alternating; across all six it actually means something.
 */
export const MOODS: Record<Mood, { label: string; tracks: readonly Track[] }> = {
  cozy: { label: 'Cozy', tracks: [HEARTHSIDE, BOOTS_OFF] },
  lively: { label: 'Lively', tracks: [VILLAGE, AMUSEMENT] },
  calm: { label: 'Calm', tracks: [RAIN, FARM] },
  all: {
    label: 'All',
    tracks: [HEARTHSIDE, BOOTS_OFF, VILLAGE, AMUSEMENT, RAIN, FARM],
  },
};

export const MOOD_ORDER: readonly Mood[] = ['cozy', 'lively', 'calm', 'all'];

/** The "quest cleared" flourish, played once when recommendations land. */
export const STING_TRACK = 'QuestCleared001The_Final_Crest.mp3';

export const AUDIO_CONFIG = {
  /** Music sits UNDER the session, not over it. Start quiet. */
  bgmVolume: 0.35,
  stingVolume: 0.6,
  /** Crossfade when a track ends, is skipped, or the mood changes. */
  crossfadeMs: 1500,
  /** Ambient drops to this while the sting plays, then comes back up. */
  duckVolume: 0.2,
  duckFadeMs: 300,
} as const;

export function bgmUrl(file: string): string {
  return assetUrl(`bgm/${file}`);
}
