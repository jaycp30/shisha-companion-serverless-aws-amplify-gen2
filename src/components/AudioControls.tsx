import { useState } from 'react';
import { MOODS, MOOD_ORDER, type Mood } from '../config/audio';
import type { AudioState } from '../hooks/useAudio';

interface AudioControlsProps {
  audio: AudioState;
}

/**
 * Monochrome line icons, drawn with currentColor so they take the espresso ink like
 * everything else. This replaced emoji (⏮ 🔀 🔊), which render as the operating
 * system's own colourful glyphs — a bright blue shuffle icon in a warm muted palette
 * looks like a bug, and you cannot restyle it.
 */
function Icon({ path, filled = false }: { path: string; filled?: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="15"
      height="15"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d={path} />
    </svg>
  );
}

const ICONS = {
  previous: 'M6 5v14M18 5 8 12l10 7z',
  next: 'M18 5v14M6 5l10 7L6 19z',
  shuffle: 'M16 3h5v5M4 20 21 3M21 16v5h-5M15 15l6 6M4 4l5 5',
  repeat: 'M17 2l4 4-4 4M3 11v-1a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v1a4 4 0 0 1-4 4H3',
  volumeOn: 'M11 5 6 9H2v6h4l5 4zM15.5 8.5a5 5 0 0 1 0 7',
  volumeOff: 'M11 5 6 9H2v6h4l5 4zM22 9l-6 6M16 9l6 6',
  chevronDown: 'm6 9 6 6 6-6',
  chevronUp: 'm18 15-6-6-6 6',
} as const;

function IconButton({
  onClick,
  label,
  path,
  active = false,
}: {
  onClick: () => void;
  label: string;
  path: string;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={`rounded-full p-1.5 text-espresso transition hover:bg-petal-soft ${
        active ? 'bg-petal' : 'text-espresso-soft'
      }`}
    >
      <Icon path={path} />
    </button>
  );
}

export function AudioControls({ audio }: AudioControlsProps) {
  const [open, setOpen] = useState(false);

  // Collapsed: just what's playing, and a way to silence it. That's the only thing you
  // need at a glance — everything else is a decision you make rarely.
  if (!open) {
    return (
      <div className="fixed right-4 top-4 z-30 flex items-center gap-1 rounded-full border border-petal bg-cream/95 py-1 pl-1 pr-2 backdrop-blur-sm">
        <IconButton
          onClick={audio.toggleMuted}
          label={audio.muted ? 'Unmute music' : 'Mute music'}
          path={audio.muted ? ICONS.volumeOff : ICONS.volumeOn}
          active={audio.muted}
        />
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-expanded={false}
          className="flex items-center gap-1 rounded-full px-1 text-[11px] text-espresso-soft transition hover:text-espresso"
        >
          <span className="max-w-[9rem] truncate">
            {audio.track?.title ?? 'Music'}
          </span>
          <Icon path={ICONS.chevronDown} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed right-4 top-4 z-30 w-52 rounded-2xl border border-petal bg-cream/95 p-2 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-1">
        <div className="flex gap-0.5">
          {MOOD_ORDER.map((mood: Mood) => (
            <button
              key={mood}
              type="button"
              onClick={() => audio.setMood(mood)}
              aria-pressed={audio.mood === mood}
              className={`rounded-full px-2 py-1 text-[11px] font-medium transition ${
                audio.mood === mood
                  ? 'bg-petal text-espresso'
                  : 'text-espresso-soft hover:bg-petal-soft'
              }`}
            >
              {MOODS[mood].label}
            </button>
          ))}
        </div>
        <button
          type="button"
          onClick={() => setOpen(false)}
          aria-expanded
          aria-label="Collapse music controls"
          className="rounded-full p-1 text-espresso-soft transition hover:bg-petal-soft"
        >
          <Icon path={ICONS.chevronUp} />
        </button>
      </div>

      <div className="mt-1 flex items-center justify-center gap-0.5">
        <IconButton onClick={audio.previous} label="Previous track" path={ICONS.previous} />
        <IconButton onClick={audio.next} label="Next track" path={ICONS.next} />
        <IconButton
          onClick={audio.toggleShuffle}
          label="Shuffle"
          path={ICONS.shuffle}
          active={audio.shuffle}
        />
        <IconButton
          onClick={audio.toggleRepeatOne}
          label="Repeat this track"
          path={ICONS.repeat}
          active={audio.repeatOne}
        />
        <IconButton
          onClick={audio.toggleMuted}
          label={audio.muted ? 'Unmute music' : 'Mute music'}
          path={audio.muted ? ICONS.volumeOff : ICONS.volumeOn}
          active={audio.muted}
        />
      </div>

      {audio.track && (
        <p className="mt-1 truncate px-1 text-center text-[11px] text-espresso-soft">
          {audio.track.title}
        </p>
      )}
    </div>
  );
}
