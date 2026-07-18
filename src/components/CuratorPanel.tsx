import { useState, type FormEvent } from 'react';
import {
  curatorSignIn,
  completeNewPassword,
  curatorSignOut,
  type CuratorUser,
} from '../lib/curator';

interface CuratorPanelProps {
  curator: CuratorUser | null;
  onChange: (curator: CuratorUser | null) => void;
}

// Two-step because Cognito users here are admin-created: the first sign-in always
// comes back asking to replace the temporary password.
type Step = 'signIn' | 'newPassword';

function errorText(error: unknown): string {
  // Cognito's own messages ("Incorrect username or password.") are already
  // user-appropriate and deliberately vague about which half was wrong.
  return error instanceof Error ? error.message : 'Sign-in failed.';
}

/**
 * Discreet curator sign-in. Deliberately understated — a public visitor should never
 * feel they're missing out on a locked feature; this is a back door for the owner and
 * friends, not an upsell. Signing in only marks your café notes as verified and
 * unlocks suggesting a lounge to OpenStreetMap.
 */
export function CuratorPanel({ curator, onChange }: CuratorPanelProps) {
  const [open, setOpen] = useState(false);
  const [step, setStep] = useState<Step>('signIn');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  function reset(): void {
    setStep('signIn');
    setEmail('');
    setPassword('');
    setNewPassword('');
    setError('');
    setBusy(false);
  }

  async function handleSignIn(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await curatorSignIn(email, password);
      if (result.status === 'newPasswordRequired') {
        setStep('newPassword');
      } else {
        onChange(result.user);
        setOpen(false);
        reset();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleNewPassword(event: FormEvent): Promise<void> {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await completeNewPassword(email, newPassword);
      if (result.status === 'signedIn') {
        onChange(result.user);
        setOpen(false);
        reset();
      }
    } catch (err) {
      setError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleSignOut(): Promise<void> {
    await curatorSignOut();
    onChange(null);
  }

  if (curator) {
    return (
      <div className="control-halo flex items-center gap-3 text-xs tracking-wide">
        <span className="text-espresso/70" title={curator.email}>
          Curator ✓
        </span>
        <button
          type="button"
          onClick={handleSignOut}
          className="inline-flex min-h-6 items-center px-1 text-espresso/50 underline-offset-2 transition hover:text-espresso hover:underline"
        >
          Sign out
        </button>
      </div>
    );
  }

  const isNewPassword = step === 'newPassword';

  // The trigger stays mounted while the form is open, and the form hangs off it as an
  // absolute dropdown. Two reasons: this now sits in the top-left row beside the brand
  // mark and zen toggle, so a 16rem form as a flex child would shove them sideways the
  // moment it opened; and swapping the trigger out for the form would collapse the row's
  // layout underneath it.
  return (
    <div className="relative">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => {
          if (open) reset();
          setOpen(!open);
        }}
        className="control-halo inline-flex min-h-6 items-center px-1 text-xs tracking-wide text-espresso/50 transition hover:text-espresso"
      >
        Curator
      </button>

      {open && (
        <form
          onSubmit={isNewPassword ? handleNewPassword : handleSignIn}
          className="absolute left-0 top-full z-40 mt-2 w-64 rounded-2xl bg-linen/95 p-4 text-sm shadow-sm backdrop-blur-sm"
        >
          <p className="mb-3 text-xs text-espresso/60">
            {isNewPassword
              ? 'Set a new password to finish signing in.'
              : 'Curator sign-in — invite only.'}
          </p>

          {!isNewPassword && (
            <>
              <label className="sr-only" htmlFor="curator-email">
                Email
              </label>
              <input
                id="curator-email"
                type="email"
                required
                autoComplete="username"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="mb-2 w-full rounded-lg border border-espresso/15 bg-white/70 px-3 py-2 text-espresso focus:border-espresso/40"
              />
              <label className="sr-only" htmlFor="curator-password">
                Password
              </label>
              <input
                id="curator-password"
                type="password"
                required
                autoComplete="current-password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Password"
                className="mb-2 w-full rounded-lg border border-espresso/15 bg-white/70 px-3 py-2 text-espresso focus:border-espresso/40"
              />
            </>
          )}

          {isNewPassword && (
            <>
              <label className="sr-only" htmlFor="curator-new-password">
                New password
              </label>
              <input
                id="curator-new-password"
                type="password"
                required
                autoComplete="new-password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                placeholder="New password"
                className="mb-2 w-full rounded-lg border border-espresso/15 bg-white/70 px-3 py-2 text-espresso focus:border-espresso/40"
              />
            </>
          )}

          {error && (
            <p role="alert" className="mb-2 text-xs text-red-800">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="submit"
              disabled={busy}
              className="flex-1 rounded-full bg-petal px-3 py-2 text-xs font-medium text-espresso transition hover:brightness-95 disabled:opacity-60"
            >
              {busy ? 'Working…' : isNewPassword ? 'Set password' : 'Sign in'}
            </button>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                reset();
              }}
              className="rounded-full px-3 py-2 text-xs text-espresso/60 hover:text-espresso"
            >
              Cancel
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
