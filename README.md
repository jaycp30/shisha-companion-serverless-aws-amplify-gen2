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
4. **A fine-grained GitHub personal access token** (see below).

### Creating the GitHub token

CloudFormation **cannot** use the Amplify GitHub App (that OAuth handshake is
console-only), so connecting a repo via IaC requires a token.

GitHub → **Settings → Developer settings → Personal access tokens → Fine-grained
tokens → Generate new token**:

- **Expiration:** set one (90 days). This token is stored in AWS — a credential that
  never expires is a credential you can never stop worrying about.
- **Repository access:** *Only select repositories* → your fork.
- **Permissions → Repository:**

  | Permission | Access | Why |
  |---|---|---|
  | Contents | **Read-only** | Clone the repo to build it |
  | Metadata | **Read-only** | Mandatory; GitHub auto-adds it |
  | Webhooks | **Read and write** | Create the webhook so `git push` triggers a build |

- **Account permissions:** none.

> **Do not use a classic token.** A classic token with `repo` scope grants AWS
> read/write to *every repository you own*. A fine-grained token is scoped to one repo
> and revocable from GitHub.

### Deploy

[`infra/cf_amplify-hosting.yaml`](./infra/cf_amplify-hosting.yaml) provisions the
Amplify Hosting app, its branch, and the IAM role Amplify uses to deploy the backend.

Read the token into a shell variable — this keeps it out of your shell history and off
disk (works in both `zsh` and `bash`):

```bash
printf "Paste GitHub PAT then press Enter: "; read -rs GH_TOKEN; echo
echo "token length: ${#GH_TOKEN}"
```

Then deploy, from the same terminal:

```bash
aws cloudformation deploy \
  --template-file infra/cf_amplify-hosting.yaml \
  --stack-name shisha-companion-hosting \
  --region ap-northeast-1 \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides \
      AppName=shisha-companion \
      RepositoryUrl=https://github.com/YOUR-USER/YOUR-FORK \
      GitHubAccessToken="$GH_TOKEN" \
      BranchName=main
unset GH_TOKEN
```

`CAPABILITY_NAMED_IAM` is required because the template creates a *named* IAM role.
The `GitHubAccessToken` parameter is `NoEcho`, so CloudFormation masks it in the
console, in stack events, and in `describe-stacks`.

Get the live URL:

```bash
aws cloudformation describe-stacks \
  --stack-name shisha-companion-hosting \
  --region ap-northeast-1 \
  --query 'Stacks[0].Outputs' --output table
```

The branch is created with auto-build on, so the first build starts immediately and
takes **~10–15 minutes** — it deploys the entire Gen 2 backend *before* building the
frontend. Every subsequent `git push` to the branch does both again.

### Prefer the console?

Connecting the repo through the **Amplify console** installs the Amplify **GitHub App**
instead, which is scoped per-repository and needs no stored token — a better security
posture, at the cost of being click-ops rather than IaC. The CloudFormation route above
exists so the deployment is reproducible and forkable; pick whichever tradeoff you
prefer.

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
