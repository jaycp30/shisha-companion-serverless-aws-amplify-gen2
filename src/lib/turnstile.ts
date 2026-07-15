// Thin wrapper around the Cloudflare Turnstile widget: load the script once, run one
// challenge, hand back the single-use token. The widget is a "Managed" one (set in the
// Cloudflare dashboard): for most visitors it passes invisibly; only traffic Cloudflare
// finds suspicious sees an interactive check.

// Public site key — safe to ship in the bundle (the secret stays server-side).
const SITE_KEY = import.meta.env.VITE_TURNSTILE_SITE_KEY as string | undefined;
// `render=explicit` stops the script from auto-scanning the DOM; we render on demand.
const SCRIPT_SRC = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
// A challenge that hasn't resolved in this long is stuck (script blocked, widget
// swallowed an error) — fail with a clear message instead of hanging the upload.
const CHALLENGE_TIMEOUT_MS = 30_000;

/** Errors with a message safe to show the user. */
export class TurnstileError extends Error {}

// The slice of the Turnstile JS API we actually use.
interface TurnstileApi {
  render: (
    container: HTMLElement,
    params: {
      sitekey: string;
      appearance?: 'always' | 'execute' | 'interaction-only';
      callback?: (token: string) => void;
      'error-callback'?: () => boolean | void;
      'expired-callback'?: () => void;
    },
  ) => string | undefined;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

// The script is loaded at most once, on first use — visitors who never upload or chat
// never fetch it at all.
let scriptPromise: Promise<void> | null = null;

function loadScript(): Promise<void> {
  if (window.turnstile) return Promise.resolve();
  scriptPromise ??= new Promise<void>((resolve, reject) => {
    const script = document.createElement('script');
    script.src = SCRIPT_SRC;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => {
      // Allow a retry on the next call instead of caching the failure forever.
      scriptPromise = null;
      reject(new TurnstileError("The human check couldn't load — check your connection."));
    };
    document.head.appendChild(script);
  });
  return scriptPromise;
}

/**
 * Run one Turnstile challenge and resolve with its token (single-use, minutes-lived —
 * exchange it promptly via mintSessionToken). The widget renders into a bottom-center
 * overlay that stays empty unless Cloudflare decides the visitor must interact.
 */
export async function getTurnstileToken(): Promise<string> {
  if (!SITE_KEY) {
    throw new TurnstileError(
      'Human check is not configured (missing VITE_TURNSTILE_SITE_KEY).',
    );
  }
  await loadScript();
  const turnstile = window.turnstile;
  if (!turnstile) {
    throw new TurnstileError("The human check didn't start — please try again.");
  }

  return new Promise<string>((resolve, reject) => {
    const container = document.createElement('div');
    // Invisible when the challenge auto-passes; becomes the challenge box when
    // Cloudflare escalates. Fixed bottom-center so it never shoves the layout around.
    container.className = 'fixed bottom-6 left-1/2 z-50 -translate-x-1/2';
    document.body.appendChild(container);

    let widgetId: string | undefined;
    let settled = false;

    function finish(action: () => void): void {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      if (widgetId) turnstile?.remove(widgetId);
      container.remove();
      action();
    }

    const timer = window.setTimeout(() => {
      finish(() =>
        reject(new TurnstileError('The human check timed out — please try again.')),
      );
    }, CHALLENGE_TIMEOUT_MS);

    widgetId = turnstile.render(container, {
      sitekey: SITE_KEY,
      // Only show UI when interaction is actually required.
      appearance: 'interaction-only',
      callback: (token) => finish(() => resolve(token)),
      'error-callback': () => {
        finish(() =>
          reject(new TurnstileError('The human check failed — please try again.')),
        );
        return true; // we handled it; stop Turnstile logging to console
      },
      'expired-callback': () =>
        finish(() =>
          reject(new TurnstileError('The human check expired — please try again.')),
        ),
    });

    if (widgetId === undefined) {
      finish(() =>
        reject(new TurnstileError("The human check couldn't render — please try again.")),
      );
    }
  });
}
