import { defineAuth } from '@aws-amplify/backend';

// Curator login. This is NOT a public sign-up: the app stays anonymous-first
// (`publicApiKey` is still the default auth mode). Cognito exists only so a small,
// hand-picked group — the owner and friends — can sign in and have their café notes
// recorded as *verified*, which the cat then trusts above anonymous hearsay.
//
// Public registration is disabled in backend.ts (`allowAdminCreateUserOnly`), so the
// only way to exist here is for an admin to create the user in the Cognito console.
// That escape hatch is the actual guard — this file just says "email + password".
export const auth = defineAuth({
  loginWith: { email: true },
});
