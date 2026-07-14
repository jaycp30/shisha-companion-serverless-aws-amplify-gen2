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

## Credits

- **Mascot & backgrounds** — generated with [Higgsfield](https://higgsfield.ai).
  Original characters; no third-party IP.
- **Music** — generated with Google Gemini/Lyria.
- **UI effects** — `ClickSpark` and `TiltCard` are adapted from
  [React Bits](https://reactbits.dev), Copyright (c) 2026 David Haz, licensed
  **MIT + Commons Clause**. Both are modified and used *as part of this application*,
  which the licence permits; the components are not resold or redistributed on their
  own. See the header of each file for the changes made.
