import { Howl, Howler } from 'howler';
import {
  AUDIO_CONFIG,
  MOODS,
  STING_TRACK,
  bgmUrl,
  type Mood,
  type Track,
} from '../config/audio';

/** Fisher-Yates. Returns a new array — the source order is never mutated. */
function shuffled<T>(items: readonly T[]): T[] {
  const copy = [...items];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

/**
 * Background music.
 *
 * Deliberately a plain class rather than React state: audio is inherently imperative
 * and long-lived. A Howl instance must survive re-renders untouched — it is not
 * something you want React reconciling, and a track should not restart because a timer
 * ticked elsewhere in the tree.
 */
class AudioManager {
  private current: Howl | null = null;
  private sting: Howl | null = null;
  private mood: Mood = 'cozy';
  /** The play order for the current mood — shuffled or not. */
  private queue: Track[] = [];
  private position = 0;
  private muted = false;
  private started = false;
  private shuffle = false;
  private repeatOne = false;

  isStarted(): boolean {
    return this.started;
  }
  isMuted(): boolean {
    return this.muted;
  }
  isShuffle(): boolean {
    return this.shuffle;
  }
  isRepeatOne(): boolean {
    return this.repeatOne;
  }
  getMood(): Mood {
    return this.mood;
  }
  getTrack(): Track | null {
    return this.queue[this.position] ?? null;
  }

  /**
   * MUST be called from a real user gesture (a click). Every browser blocks audio until
   * the user has interacted with the page — which is the entire reason the splash screen
   * exists. It isn't decoration; it's the unlock.
   */
  start(mood: Mood, muted: boolean): void {
    this.started = true;
    this.setMuted(muted);
    this.loadMood(mood);
  }

  setMood(mood: Mood): void {
    if (!this.started || mood === this.mood) return;
    this.loadMood(mood);
  }

  setShuffle(shuffle: boolean): void {
    this.shuffle = shuffle;
    if (!this.started) return;

    // Rebuild the queue, but keep whatever is CURRENTLY playing as the current entry —
    // toggling shuffle should reorder what comes next, not yank the song out from under
    // you mid-listen.
    const playing = this.getTrack();
    this.buildQueue();
    if (playing) {
      const index = this.queue.findIndex((track) => track.file === playing.file);
      if (index >= 0) this.position = index;
    }
  }

  setRepeatOne(repeatOne: boolean): void {
    this.repeatOne = repeatOne;
  }

  next(): void {
    if (!this.started || this.queue.length === 0) return;
    this.position = (this.position + 1) % this.queue.length;
    this.playCurrent();
  }

  previous(): void {
    if (!this.started || this.queue.length === 0) return;
    this.position = (this.position - 1 + this.queue.length) % this.queue.length;
    this.playCurrent();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    // Mute globally rather than zeroing each Howl: the track keeps playing underneath,
    // so unmuting drops you back into the music where it actually is, not where it was.
    Howler.mute(muted);
  }

  /** The "quest cleared" flourish: duck the ambient, play, restore. */
  playSting(): void {
    if (!this.started) return;

    const bgm = this.current;
    bgm?.fade(bgm.volume(), AUDIO_CONFIG.duckVolume, AUDIO_CONFIG.duckFadeMs);

    this.sting?.unload();
    this.sting = new Howl({
      src: [bgmUrl(STING_TRACK)],
      volume: AUDIO_CONFIG.stingVolume,
      onend: () => {
        // Bring the music back slower than it ducked — a fast duck feels responsive, a
        // fast recovery feels abrupt.
        bgm?.fade(bgm.volume(), AUDIO_CONFIG.bgmVolume, AUDIO_CONFIG.duckFadeMs * 3);
      },
    });
    this.sting.play();
  }

  private loadMood(mood: Mood): void {
    this.mood = mood;
    this.buildQueue();
    this.position = 0;
    this.playCurrent();
  }

  private buildQueue(): void {
    const { tracks } = MOODS[this.mood];
    this.queue = this.shuffle ? shuffled(tracks) : [...tracks];
  }

  private playCurrent(): void {
    const track = this.getTrack();
    if (!track) return;

    const next = new Howl({
      src: [bgmUrl(track.file)],
      // Stream instead of decoding a 3-minute track fully into memory. These are
      // multi-MB files and we already have two videos competing for resources.
      html5: true,
      volume: 0,
      onend: () => {
        // Repeat-one replays the same track; otherwise advance through the queue.
        if (this.repeatOne) {
          this.playCurrent();
        } else {
          this.next();
        }
      },
    });

    const previous = this.current;
    this.current = next;

    next.play();
    next.fade(0, AUDIO_CONFIG.bgmVolume, AUDIO_CONFIG.crossfadeMs);

    if (previous) {
      previous.fade(previous.volume(), 0, AUDIO_CONFIG.crossfadeMs);
      // Release the previous track after the crossfade. Each bgm Howl is `html5: true`,
      // so it holds one node from Howler's small HTML5 audio pool (default 10) until it's
      // unloaded. The old code released it ONLY on Howler's 'fade' event — which doesn't
      // fire if the fade is cut short by a rapid track/mood switch, leaking a node every
      // time until the pool exhausts ("HTML5 audio pool exhausted", then playback stalls).
      // A guaranteed timer plus a run-once guard releases it reliably, exactly once.
      let released = false;
      const release = (): void => {
        if (released) return;
        released = true;
        previous.stop();
        previous.unload();
      };
      previous.once('fade', release);
      window.setTimeout(release, AUDIO_CONFIG.crossfadeMs + 100);
    }
  }
}

export const audio = new AudioManager();
