import {
  signIn,
  signOut,
  confirmSignIn,
  getCurrentUser,
  type SignInOutput,
} from 'aws-amplify/auth';

// Curator session helpers. Deliberately thin: the app is anonymous-first, and being
// signed in only changes two things — café notes get recorded as verified, and the
// "suggest a lounge to OpenStreetMap" action unlocks. Everything else is identical.

export interface CuratorUser {
  email: string;
}

// Users are created by an admin in the Cognito console, so the very first sign-in
// always lands on a "you must replace the temporary password" challenge. Callers
// render a set-password step when this comes back, then call completeNewPassword().
export type SignInResult =
  | { status: 'signedIn'; user: CuratorUser }
  | { status: 'newPasswordRequired' };

function toResult(email: string, output: SignInOutput): SignInResult {
  if (output.isSignedIn) return { status: 'signedIn', user: { email } };
  if (
    output.nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED'
  ) {
    return { status: 'newPasswordRequired' };
  }
  // Any other step (MFA, TOTP setup...) isn't configured for this pool. Failing loudly
  // beats silently pretending the user is signed in.
  throw new Error(`Unsupported sign-in step: ${output.nextStep.signInStep}`);
}

export async function curatorSignIn(
  email: string,
  password: string,
): Promise<SignInResult> {
  // Amplify throws if a stale session is already around; clear it first so a retry
  // after a half-finished attempt doesn't dead-end on "already signed in".
  try {
    await signOut();
  } catch {
    // No session to clear — expected on a first sign-in.
  }
  return toResult(email, await signIn({ username: email, password }));
}

// Second half of the first-login flow: swap the admin's temporary password for a real one.
export async function completeNewPassword(
  email: string,
  newPassword: string,
): Promise<SignInResult> {
  return toResult(email, await confirmSignIn({ challengeResponse: newPassword }));
}

export async function curatorSignOut(): Promise<void> {
  await signOut();
}

// Restore the session on page load. Returns null for the common case: a public
// visitor who was never signed in.
export async function currentCurator(): Promise<CuratorUser | null> {
  try {
    const user = await getCurrentUser();
    return { email: user.signInDetails?.loginId ?? user.username };
  } catch {
    return null;
  }
}
