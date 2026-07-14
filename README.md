# Shisha Companion

Upload a photo of a shisha lounge's menu and get AI flavour picks, mixes, and drink
pairings — with an animated cat mascot who keeps you company, paces your session, and
reminds you to drink some water.

A serverless portfolio project built on **AWS Amplify Gen 2** and **Amazon Bedrock**.

## Architecture

```
React 19 + Vite (Amplify Hosting)
        │  typed client (generateClient<Schema>)
        ▼
AWS AppSync  ──  3 custom operations, publicApiKey auth (no login)
        │
        ├── getUploadUrl  → Lambda → presigned S3 PUT (photo goes browser → S3 direct)
        ├── analyzeMenu   → Lambda → S3 read + Bedrock vision → Zod-validated JSON
        └── chat          → Lambda → Bedrock (cat companion persona)
```

- **No database.** AppSync is a typed front door to three Lambdas; session state
  (timers, puff log, chat) lives client-side.
- **No auth.** `publicApiKey` — it's a personal app.
- **Bedrock:** Claude Sonnet 4.6 via the `jp.` cross-region inference profile
  (`ap-northeast-1`). Permissions are granted through the CDK escape hatch in
  `amplify/backend.ts`, scoped to that one model — not `bedrock:*`.
- **Uploads** never pass through a Lambda (which caps payloads at 6 MB). The browser
  PUTs straight to S3 with a presigned URL; only the object key goes to `analyzeMenu`.

## Stack

| Layer | Tech |
|---|---|
| Frontend | React 19, Vite 8, TypeScript 5.9, Tailwind v4 |
| Backend | Amplify Gen 2 (`defineData` / `defineStorage` / `defineFunction`) |
| AI | Amazon Bedrock — Claude Sonnet 4.6 (vision + chat) |
| Validation | Zod, at the Lambda boundary |
| Media | Public S3 bucket — see [ASSETS.md](./ASSETS.md) |

## Running it

```bash
npm install
npx ampx sandbox    # deploys your own backend; writes amplify_outputs.json
npm run dev
```

`ampx sandbox` only needs to run when you change anything under `amplify/`. The
frontend talks to the deployed backend either way.

Media assets are **not in this repo** — they live in a public S3 bucket. To rebuild and
upload them, see [ASSETS.md](./ASSETS.md).

## Deploying to AWS (Amplify Gen 2)

There are **two backends** in this project's life, and they are separate on purpose:

| | Created by | Purpose |
|---|---|---|
| **Sandbox** | `npx ampx sandbox` (you, locally) | Your dev loop. Own AppSync API, Lambdas, S3. |
| **Branch env** | `npx ampx pipeline-deploy` (Amplify CI) | The live app. Its own AppSync API, Lambdas, S3. |

Never run `pipeline-deploy` by hand — Amplify runs it for you during a build, per
[`amplify.yml`](./amplify.yml). Dev and production must never share a backend.

### Prerequisites

1. **AWS account + CLI**, authenticated. Everything here assumes **`ap-northeast-1`**
   (Tokyo) — the region must match where you have **Amazon Bedrock model access** for
   Claude Sonnet 4.6, or the backend deploys somewhere it cannot call the model.
2. **Node 22+**.
3. **A fork of this repo** on GitHub.

### Connect the repo (Amplify console + GitHub App)

There is no GitHub App to *create* — AWS publishes one called **"AWS Amplify"**. You
install it and point it at one repo. That install can only be triggered from the Amplify
console (see [why it isn't in IaC](#why-the-repo-connection-isnt-in-cloudformation)).

1. Open the Amplify console **in your backend's region**:
   `https://ap-northeast-1.console.aws.amazon.com/amplify/create`

   ⚠️ **Check the region selector.** The console defaults to `us-east-1`, which would
   deploy the backend away from your Bedrock model access.

2. Source provider → **GitHub** → **Next**. GitHub takes over:
   - **Authorize AWS Amplify** (check you're signed in as the right GitHub account)
   - **"Only select repositories"** → your fork → **Install & Authorize**

   The GitHub App is now installed. It's scoped to that one repo, stores **no token in
   AWS**, and is revocable at GitHub → Settings → Applications → Installed GitHub Apps.

3. Back in AWS: pick the repo and the **`main`** branch → **Next**.

4. Amplify reads [`amplify.yml`](./amplify.yml). **Confirm you see BOTH a `backend` phase
   and a `frontend` phase.** If only a frontend phase appears, it hasn't detected
   `amplify/` — you'd deploy a UI with no API behind it.

5. **Service role** → **Create and use a new service role**.

   ⚠️ This role gets **`AdministratorAccess-Amplify`**, the only AWS-managed policy for
   the job, and it is near-administrator. That isn't carelessness — deploying this
   backend genuinely requires creating Lambdas, AppSync APIs, S3 buckets *and IAM roles*.
   The consequence is worth internalising: **anyone who can push to the connected branch
   can make that role run arbitrary CloudFormation in your account.** Protect the branch.

6. **Save and deploy.** ~10–15 minutes: it deploys the whole Gen 2 backend, *then*
   builds the frontend. Every later push to `main` repeats both.

### Why the repo connection isn't in CloudFormation

This project deliberately has **no IaC for the Amplify app**, and the reason is worth
knowing rather than assuming it was laziness.

`AWS::Amplify::App` exposes exactly three repo-connection properties:

```
Repository      # the URL
AccessToken     # a token
OauthToken      # a token
```

There is **no property to reference an installed GitHub App**. So CloudFormation (and
CDK, which just synthesizes to CloudFormation) can only connect a repo **with a token**.
And Amplify's token path has a further trap: it accepts only **classic** PATs. A
fine-grained token — the secure kind, scoped to one repo — fails at webhook creation:

```
"Resource not accessible by personal access token"
documentation_url: .../repos/webhooks#create-a-repository-webhook
status: 403
```

So the IaC route forces a **classic** `repo`-scope token, which grants AWS read/write to
**every repository you own**, stored permanently (Amplify re-uses it to clone on every
build, so it can't be short-lived). Combined with auto-build and that near-admin service
role, a leaked token becomes a path into your AWS account.

**The automatability and the insecurity are the same property, inverted:** a token can be
handed to a machine (so it's IaC-able) precisely *because* it's a bearer credential (so
it's dangerous). The GitHub App can't be handed to a machine precisely *because* it
isn't one.

Note this is **partly an AWS gap, not a law of nature**. The one-time OAuth click is
genuinely unavoidable — GitHub will never let a machine grant a machine access to your
account. But *referencing* an existing connection from IaC is perfectly possible, and AWS
does exactly that elsewhere: **CodeConnections** (`AWS::CodeStarConnections::Connection`)
is created in CloudFormation, sits `PENDING` until a human approves it once, and then
yields a durable ARN that CodePipeline consumes forever. Amplify simply isn't wired to
it. Given the choice between click-ops and a permanent account-wide credential, the six
clicks win.

### Other gotchas we hit

- **`validate-template` does not validate ARNs.** It checks *syntax only*. A template
  referencing a policy that doesn't exist validates perfectly, then fails at deploy. A
  green validate is not a green deploy.
- **`AmplifyBackendDeployFullAccess` does not exist.** The real policy is
  `AdministratorAccess-Amplify`.
- **`ROLLBACK_COMPLETE` is a dead end, not a retry state.** CloudFormation refuses to
  *update* out of it — you must delete the stack and recreate.
- **`read -p` is a bash-ism.** In `zsh` (the macOS default) `-p` means "read from a
  coprocess" and errors with `read: -p: no coprocess`. Use
  `printf "prompt"; read -rs VAR` — it works in both shells.

### Cost

≈**$0 idle**. AppSync, Lambda, and S3 are pay-per-use; Amplify Hosting build minutes and
bandwidth have generous free tiers. **Amazon Bedrock is the only meaningful per-call
cost** — and note the API is `publicApiKey` (no login), so anyone with the shipped key
can spend your Bedrock budget. Fine for a personal app; add throttling before sharing it
widely.

### Media assets

The app fetches its mascot, backgrounds, and music from a **public S3 bucket** that is
deliberately *not* part of any Amplify stack — so it survives `ampx sandbox delete` and
is shared by every environment. Set it up once with
[`scripts/setup-assets-bucket.sh`](./scripts/setup-assets-bucket.sh). See
[ASSETS.md](./ASSETS.md).

## Credits

- **Mascot & backgrounds** — generated with [Higgsfield](https://higgsfield.ai).
  Original characters; no third-party IP.
- **Music** — generated with Google Gemini/Lyria.
- **UI effects** — `ClickSpark` and `TiltCard` are adapted from
  [React Bits](https://reactbits.dev), Copyright (c) 2026 David Haz, licensed
  **MIT + Commons Clause**. Both are modified and used *as part of this application*,
  which the licence permits; the components are not resold or redistributed on their
  own. See the header of each file for the changes made.
