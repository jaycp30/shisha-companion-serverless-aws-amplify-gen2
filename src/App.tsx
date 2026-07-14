import { useEffect, useState } from 'react';
import { AudioControls } from './components/AudioControls';
import { BackgroundVideo } from './components/BackgroundVideo';
import { ChatDrawer } from './components/ChatDrawer';
import { ClickSpark } from './components/ClickSpark';
import { ErrorBoundary } from './components/ErrorBoundary';
import { MascotDock } from './components/MascotDock';
import { MenuUpload } from './components/MenuUpload';
import { Recommendations } from './components/Recommendations';
import { ScrollProgress } from './components/ScrollProgress';
import { SessionHud } from './components/SessionHud';
import { Splash } from './components/Splash';
import type { Mood } from './config/audio';
import type { MascotState } from './config/mascot';
import { ONE_SHOT_MS, SESSION_CONFIG } from './config/session';
import { useAudio } from './hooks/useAudio';
import { useSession } from './hooks/useSession';
import type { Stage } from './lib/analyzeMenu';
import type { ChatSessionContext } from './lib/chat';
import { isNotAMenu, type MenuResponse } from './types/menu';

function App() {
  const session = useSession();
  const audio = useAudio();

  const [result, setResult] = useState<MenuResponse | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);

  // The chat drives the HUD out of the way and brings it back — but the manual toggle
  // still works at any time, so opening the chat is a default, not a lock.
  useEffect(() => {
    setHudCollapsed(chatOpen);
  }, [chatOpen]);

  // Transient clips that play once then get out of the way. `greeting` is set when the
  // session actually STARTS, not on mount — otherwise its 5s timer would run out while
  // you were still sitting on the splash screen, and the cat would never wave.
  const [oneShot, setOneShot] = useState<MascotState | null>(null);
  // Two idle clips, alternated, so a resting cat doesn't look like a stuck GIF.
  const [idleClip, setIdleClip] = useState<MascotState>('idle');

  // A one-shot also clears on a timer, not only when its clip ends. If something
  // higher-priority preempts it mid-play (the coals run out during 'happy'), the video
  // never finishes, 'ended' never fires, and the state would be stuck on forever.
  useEffect(() => {
    if (!oneShot) return;
    const id = window.setTimeout(() => setOneShot(null), ONE_SHOT_MS);
    return () => window.clearTimeout(id);
  }, [oneShot]);

  /**
   * The mascot priority chain — highest wins. Spent coals outrank everything: it's the
   * one thing worth interrupting for. Pacing comes next, because a nudge to slow down
   * is worthless if it waits its turn.
   *
   * (Per the handoff, 'sleepy' should outrank 'greeting'. It doesn't need to here —
   * greeting only fires at t=0, when a 90-minute session is impossible.)
   */
  const mascotState: MascotState = session.coalsExpired
    ? 'alert'
    : session.pacingNudge
      ? 'easy-there'
      : isAnalyzing
        ? 'thinking'
        : isTalking
          ? 'talking'
          : (oneShot ?? (session.isSleepy ? 'sleepy' : idleClip));

  // What the cat knows about your session when you chat to it. `pace` is a coarse
  // bucket on purpose — see the note in lib/chat.ts.
  const chatSession: ChatSessionContext = {
    elapsedMinutes: Math.floor(session.elapsedSeconds / 60),
    coalsMinutes: Math.floor(session.coalsSeconds / 60),
    coalsExpired: session.coalsExpired,
    pace: session.recentPuffs > SESSION_CONFIG.puffLimit ? 'fast' : 'ok',
  };

  // The chat only gets a menu once one has actually been analyzed successfully.
  const analyzedMenu = result && !isNotAMenu(result) ? result : null;

  function handleClipEnd(): void {
    // A finished one-shot steps aside, and an idle that has run its course hands over
    // to the other idle clip. Both are "this clip is done" — one handler covers it.
    setOneShot(null);
    setIdleClip((current) => (current === 'idle' ? 'idle-variant' : 'idle'));
  }

  function handleStageChange(stage: Stage | null): void {
    setIsAnalyzing(stage !== null);
  }

  function handleResult(response: MenuResponse): void {
    setResult(response);
    if (!isNotAMenu(response)) {
      setOneShot('happy');
      // The quest-cleared flourish: ducks the music, plays, restores.
      audio.playSting();
    }
  }

  function handleStart(mood: Mood, muted: boolean): void {
    // This runs inside a real click, which is what lets the browser unlock audio.
    audio.start(mood, muted);
    setOneShot('greeting');
  }

  if (!audio.started) {
    return <Splash onStart={handleStart} />;
  }

  return (
    <div className="relative min-h-dvh text-espresso">
      <ScrollProgress />
      <BackgroundVideo scene="lounge-hero" />
      <AudioControls audio={audio} />

      {/* With the chat docked on the right (desktop only), the content slides left and
          narrows rather than hiding behind the panel — so you can keep reading and
          scrolling your recommendations while you talk to the cat. */}
      <div
        className={`px-6 py-16 transition-all duration-300 ${
          chatOpen ? 'mx-auto max-w-3xl lg:mx-0 lg:ml-16 lg:max-w-2xl' : 'mx-auto max-w-3xl'
        }`}
      >
        <header className="mb-10">
          <h1 className="text-5xl font-semibold tracking-tight">Shisha Companion</h1>
          <p className="mt-3 text-lg text-espresso-soft">
            Snap a menu, get flavor picks, and hang out with your session buddy.
          </p>
        </header>

        <ErrorBoundary>
          <MenuUpload onResult={handleResult} onStageChange={handleStageChange} />

          {result && (
            <div className="mt-12">
              {isNotAMenu(result) ? (
                <p className="rounded-2xl border border-petal bg-cream p-6 leading-relaxed">
                  Hmm, that doesn&apos;t look like a shisha menu to me. Try a photo of the
                  flavor list? 🐾
                </p>
              ) : (
                <Recommendations analysis={result} />
              )}
            </div>
          )}
        </ErrorBoundary>
      </div>

      <SessionHud
        session={session}
        collapsed={hudCollapsed}
        onToggle={() => setHudCollapsed((collapsed) => !collapsed)}
      />

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        menu={analyzedMenu}
        session={chatSession}
        onTalkingChange={setIsTalking}
      />

      <MascotDock
        state={mascotState}
        notice={session.notice}
        chatOpen={chatOpen}
        onClipEnd={handleClipEnd}
        onTap={session.logPuff}
        onDismissNotice={session.dismissNotice}
        onOpenChat={() => setChatOpen(true)}
      />

      {/* Sits above everything with pointer-events:none, so it never blocks a click. */}
      <ClickSpark />
    </div>
  );
}

export default App;
