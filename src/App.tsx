import { useEffect, useRef, useState } from 'react';
import { AudioControls } from './components/AudioControls';
import { BackgroundVideo } from './components/BackgroundVideo';
import { ChatDrawer } from './components/ChatDrawer';
import { BrandMark } from './components/BrandMark';
import { ClickSpark } from './components/ClickSpark';
import { CuratorPanel } from './components/CuratorPanel';
import { ErrorBoundary } from './components/ErrorBoundary';
import { HeroTitle } from './components/HeroTitle';
import { MascotDock } from './components/MascotDock';
import { MenuUpload } from './components/MenuUpload';
import { NearbyCafes } from './components/NearbyCafes';
import { Recommendations } from './components/Recommendations';
import { ScrollProgress } from './components/ScrollProgress';
import { SessionHud } from './components/SessionHud';
import { Splash } from './components/Splash';
import type { Mood } from './config/audio';
import { ALL_MASCOT_STATES, type MascotState } from './config/mascot';
import { ONE_SHOT_MS, SESSION_CONFIG } from './config/session';

// The cat pipes up once per session, after things have settled in. The reply becomes an
// anonymous note about the café (see chat handler), so ask only when a session is real.
const CAFE_QUESTION_AFTER_SECONDS = 10 * 60;
const CAT_CAFE_QUESTION =
  "How's this place treating you so far? Tell me in the chat — I'm curious 🐾";
// Distinct from useSession's incrementing notice ids, which start at 1.
const CAFE_BUBBLE_NOTICE_ID = -1;
import { useAudio } from './hooks/useAudio';
import { useSession } from './hooks/useSession';
import type { Stage } from './lib/analyzeMenu';
import type { ChatSessionContext } from './lib/chat';
import { currentCurator, type CuratorUser } from './lib/curator';
import { isNotAMenu, type MenuResponse } from './types/menu';

function App() {
  const session = useSession();
  const audio = useAudio();

  const [result, setResult] = useState<MenuResponse | null>(null);
  // S3 keys of every menu page analyzed this session — the append-behaviour ledger.
  const [menuKeys, setMenuKeys] = useState<string[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [isTalking, setIsTalking] = useState(false);
  const [chatOpen, setChatOpen] = useState(false);
  const [hudCollapsed, setHudCollapsed] = useState(false);
  // Zen mode: fade the content column away so the animated lounge background can be
  // enjoyed. The column stays mounted — an in-flight analysis or accumulated menu
  // state must survive the fade — it just becomes invisible and unclickable.
  const [zenMode, setZenMode] = useState(false);

  // The signed-in curator, if any. Null is the normal case — this app is
  // anonymous-first and everything works without ever signing in.
  const [curator, setCurator] = useState<CuratorUser | null>(null);

  // Restore an existing Cognito session on load, so a curator isn't asked to sign in
  // again on every refresh.
  useEffect(() => {
    void currentCurator().then(setCurator);
  }, []);

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
  // Dev-only: force a specific clip via the switcher strip (null = normal behaviour).
  const [devClip, setDevClip] = useState<MascotState | null>(null);

  // The cat's one proactive question per session, asked mid-session once a menu exists.
  // Its answer (the user's next chat message) becomes an anonymous café note.
  const [cafeSeed, setCafeSeed] = useState<string | null>(null);
  const [cafeBubbleOpen, setCafeBubbleOpen] = useState(false);
  const askedAboutCafe = useRef(false);

  useEffect(() => {
    if (
      askedAboutCafe.current ||
      !session.started ||
      session.elapsedSeconds < CAFE_QUESTION_AFTER_SECONDS
    ) {
      return;
    }
    askedAboutCafe.current = true;
    setCafeSeed(CAT_CAFE_QUESTION);
    setCafeBubbleOpen(true);
  }, [session.started, session.elapsedSeconds]);

  const cafeBubbleNotice =
    cafeBubbleOpen && cafeSeed ? { id: CAFE_BUBBLE_NOTICE_ID, text: cafeSeed } : null;

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
  const mascotState: MascotState = devClip
    ? devClip
    : session.coalsExpired
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

  // A puff earns the smoking clip — from the HUD button or from tapping the cat.
  function logPuffWithSmoke(): void {
    session.logPuff();
    setOneShot('smoking');
  }

  // The cat is a big, inviting tap target, and before the session starts the natural
  // reason to touch it is to pet it — not to report a puff you haven't taken. Logging
  // one here would silently start BOTH clocks, contradicting the HUD's own "the clocks
  // start when you light up" and quietly bypassing 'Light the coals'. So: pet before
  // the session, log after. (The HUD's own 'Log a puff' button only exists once
  // started, so this was the one way to log a phantom puff.)
  function handleMascotTap(): void {
    if (!session.started) {
      setOneShot('happy');
      return;
    }
    logPuffWithSmoke();
  }

  // Changing the coals plays 'goodbye' (the cat waves off the spent coals). Only on a
  // RE-light: the first light is the session starting, not a farewell to anything.
  function lightCoalsWithGoodbye(): void {
    if (session.started) setOneShot('goodbye');
    session.lightCoals();
  }

  // End the session: the cat waves goodbye, then a full reload returns to the splash.
  // A reload (rather than resetting each piece of state) is the honest "clean slate" —
  // every bit of session state is in-memory by design, so this restores the pristine
  // start exactly. The delay lets the goodbye clip play before the page resets.
  function handleEndSession(): void {
    setOneShot('goodbye');
    window.setTimeout(() => window.location.reload(), ONE_SHOT_MS);
  }

  function handleClipEnd(): void {
    // A finished one-shot steps aside, and an idle that has run its course hands over
    // to the other idle clip. Both are "this clip is done" — one handler covers it.
    setOneShot(null);
    setIdleClip((current) => (current === 'idle' ? 'idle-variant' : 'idle'));
  }

  function handleStageChange(stage: Stage | null): void {
    setIsAnalyzing(stage !== null);
  }

  function handleResult(response: MenuResponse, s3Keys: string[]): void {
    setResult(response);
    if (!isNotAMenu(response)) {
      // Remember every page behind this analysis — the next upload appends to them,
      // so the cat's menu knowledge grows instead of being replaced.
      setMenuKeys(s3Keys);
      setOneShot('happy');
      // The quest-cleared flourish: ducks the music, plays, restores.
      audio.playSting();
    }
  }

  // "New lounge, new menu": forget the accumulated pages and the current analysis.
  function handleMenuReset(): void {
    setMenuKeys([]);
    setResult(null);
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
      <BackgroundVideo scene="lounge-hero" unwashed={zenMode} />
      <AudioControls audio={audio} />

      {/* Top-left row: the docked brand mark, then the controls. One line of plain text
          in the only corner the others left free (audio top-right, HUD bottom-left,
          mascot bottom-right). BrandMark grows from zero width as you scroll, which is
          what slides the controls right to make room for it. */}
      <div className="fixed left-4 top-4 z-30 flex items-center gap-3">
        <BrandMark />

        <button
          type="button"
          aria-pressed={zenMode}
          aria-label={zenMode ? 'Leave zen mode' : 'Enter zen mode (hide the cards)'}
          onClick={() => setZenMode((zen) => !zen)}
          className="control-halo shrink-0 text-xs tracking-wide text-espresso/70 transition hover:text-espresso"
        >
          {zenMode ? 'Zen off' : 'Zen'}
        </button>

        {/* Fades with zen mode — a login form has no place in a "just watch the room"
            view. The zen toggle itself must stay: it's the way back out. */}
        <div
          aria-hidden={zenMode}
          className={`shrink-0 transition-opacity duration-500 ${
            zenMode ? 'pointer-events-none opacity-0' : 'opacity-100'
          }`}
        >
          <CuratorPanel curator={curator} onChange={setCurator} />
        </div>
      </div>

      {/* With the chat docked on the right (desktop only), the content slides left and
          narrows rather than hiding behind the panel — so you can keep reading and
          scrolling your recommendations while you talk to the cat. */}
      <div
        aria-hidden={zenMode}
        className={`px-6 py-16 transition-all duration-500 ${
          chatOpen ? 'mx-auto max-w-3xl lg:mx-0 lg:ml-16 lg:max-w-2xl' : 'mx-auto max-w-3xl'
        } ${zenMode ? 'pointer-events-none opacity-0' : 'opacity-100'}`}
      >
        <HeroTitle />

        <ErrorBoundary>
          <div className="mb-6">
            <NearbyCafes isCurator={curator !== null} />
          </div>

          <MenuUpload
            onResult={handleResult}
            onStageChange={handleStageChange}
            existingKeys={menuKeys}
            onReset={handleMenuReset}
          />

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
        session={{ ...session, logPuff: logPuffWithSmoke, lightCoals: lightCoalsWithGoodbye }}
        collapsed={hudCollapsed}
        onToggle={() => setHudCollapsed((collapsed) => !collapsed)}
        onEndSession={handleEndSession}
      />

      <ChatDrawer
        open={chatOpen}
        onClose={() => setChatOpen(false)}
        menu={analyzedMenu}
        session={chatSession}
        onTalkingChange={setIsTalking}
        seedQuestion={cafeSeed}
        onSeedConsumed={() => setCafeSeed(null)}
        isCurator={curator !== null}
      />

      <MascotDock
        state={mascotState}
        notice={session.notice ?? cafeBubbleNotice}
        chatOpen={chatOpen}
        onClipEnd={handleClipEnd}
        onTap={handleMascotTap}
        tapLabel={session.started ? 'Log a puff' : 'Pet the cat'}
        onDismissNotice={
          session.notice ? session.dismissNotice : () => setCafeBubbleOpen(false)
        }
        onOpenChat={() => {
          setCafeBubbleOpen(false);
          setChatOpen(true);
        }}
      />

      {/* Dev-only clip switcher: force any mascot state to verify all 11 clips render.
          Ships to nobody — import.meta.env.DEV is false in production builds. */}
      {import.meta.env.DEV && (
        <div className="fixed bottom-0 left-1/2 z-50 flex max-w-xl -translate-x-1/2 flex-wrap justify-center gap-1 p-1">
          {ALL_MASCOT_STATES.map((state) => (
            <button
              key={state}
              type="button"
              onClick={() => setDevClip((current) => (current === state ? null : state))}
              className={`rounded px-1.5 py-0.5 text-[10px] ${
                devClip === state ? 'bg-espresso text-cream' : 'bg-petal-soft text-espresso'
              }`}
            >
              {state}
            </button>
          ))}
        </div>
      )}

      {/* Sits above everything with pointer-events:none, so it never blocks a click. */}
      <ClickSpark />
    </div>
  );
}

export default App;
