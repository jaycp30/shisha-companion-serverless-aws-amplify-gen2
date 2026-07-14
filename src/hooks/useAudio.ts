import { useCallback, useState } from 'react';
import type { Mood, Track } from '../config/audio';
import { audio } from '../lib/audio';

export interface AudioState {
  started: boolean;
  mood: Mood;
  muted: boolean;
  shuffle: boolean;
  repeatOne: boolean;
  track: Track | null;
  start: (mood: Mood, muted: boolean) => void;
  setMood: (mood: Mood) => void;
  toggleMuted: () => void;
  toggleShuffle: () => void;
  toggleRepeatOne: () => void;
  next: () => void;
  previous: () => void;
  playSting: () => void;
}

/**
 * A thin React mirror over the imperative AudioManager. React holds only what the UI
 * needs to *render*; the manager owns the actual playback.
 *
 * Every action calls the manager and then re-reads its state, rather than trying to
 * predict it — the manager is the single source of truth for what is playing.
 */
export function useAudio(): AudioState {
  const [started, setStarted] = useState(audio.isStarted());
  const [mood, setMoodState] = useState<Mood>(audio.getMood());
  const [muted, setMutedState] = useState(audio.isMuted());
  const [shuffle, setShuffleState] = useState(audio.isShuffle());
  const [repeatOne, setRepeatOneState] = useState(audio.isRepeatOne());
  const [track, setTrack] = useState<Track | null>(audio.getTrack());

  const start = useCallback((nextMood: Mood, nextMuted: boolean) => {
    audio.start(nextMood, nextMuted);
    setStarted(true);
    setMoodState(nextMood);
    setMutedState(nextMuted);
    setTrack(audio.getTrack());
  }, []);

  const setMood = useCallback((nextMood: Mood) => {
    audio.setMood(nextMood);
    setMoodState(nextMood);
    setTrack(audio.getTrack());
  }, []);

  const toggleMuted = useCallback(() => {
    audio.setMuted(!audio.isMuted());
    setMutedState(audio.isMuted());
  }, []);

  const toggleShuffle = useCallback(() => {
    audio.setShuffle(!audio.isShuffle());
    setShuffleState(audio.isShuffle());
  }, []);

  const toggleRepeatOne = useCallback(() => {
    audio.setRepeatOne(!audio.isRepeatOne());
    setRepeatOneState(audio.isRepeatOne());
  }, []);

  const next = useCallback(() => {
    audio.next();
    setTrack(audio.getTrack());
  }, []);

  const previous = useCallback(() => {
    audio.previous();
    setTrack(audio.getTrack());
  }, []);

  const playSting = useCallback(() => audio.playSting(), []);

  return {
    started,
    mood,
    muted,
    shuffle,
    repeatOne,
    track,
    start,
    setMood,
    toggleMuted,
    toggleShuffle,
    toggleRepeatOne,
    next,
    previous,
    playSting,
  };
}
