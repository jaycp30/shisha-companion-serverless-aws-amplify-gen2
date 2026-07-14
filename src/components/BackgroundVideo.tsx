import { assetUrl } from '../config/assets';

export type Scene = 'lounge-hero' | 'lounge-normal' | 'village-dusk';

// The 'lounge-normal' clip came out noticeably darker than the other two, so lift it
// to keep all three scenes at a similar brightness behind the UI.
const SCENE_FILTER: Record<Scene, string> = {
  'lounge-hero': '',
  'lounge-normal': 'brightness-110 saturate-150',
  'village-dusk': '',
};

interface BackgroundVideoProps {
  scene: Scene;
}

export function BackgroundVideo({ scene }: BackgroundVideoProps) {
  return (
    <div className="fixed inset-0 -z-10 overflow-hidden" aria-hidden="true">
      {/* key={scene} forces React to remount (and restart) the video on a scene swap. */}
      <video
        key={scene}
        className={`h-full w-full object-cover ${SCENE_FILTER[scene]}`}
        src={assetUrl(`bg/${scene}.mp4`)}
        poster={assetUrl('stills/lounge-master.jpg')}
        autoPlay
        loop
        muted
        playsInline
      />

      {/* A linen wash so cream cards and espresso text stay readable on top. Kept
          deliberately light — the brief asks for warm and colourful, not a dark scrim. */}
      <div className="absolute inset-0 bg-linen/70" />
    </div>
  );
}
