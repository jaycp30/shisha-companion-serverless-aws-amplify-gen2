# Multi-page menu analysis — async job design

## The problem (verified, not guessed)

Uploading 3 pages failed. CloudWatch showed the real story, which the UI hid:

- Lambda ran **41.9s** (under its 60s limit — it did NOT time out).
- It threw `SyntaxError: Unterminated string in JSON at position 6594`.
- Position ~6594 chars ≈ **2000 output tokens** = our old `MAX_TOKENS`. The model's JSON
  was cut off mid-string, so `JSON.parse` failed.
- The UI said "Execution timed out" because the request goes through **AppSync**, which
  has a hard **~30s** request ceiling (not configurable). AppSync gave up at ~30s while
  the Lambda kept running to 42s.

So there were TWO problems, pulling in opposite directions:

| Problem | Fix direction |
|---|---|
| Truncated JSON | need MORE output tokens |
| AppSync 30s ceiling | need LESS time — but more tokens = more time |

You can't win this synchronously. That's why the transport has to change.

## Fix 1 — truncation (DONE)

`menu_items` echoed every item on the menu back to us and **nothing read it** (not the
recommendations UI, not chat). For a 5-page menu that unused array was the biggest,
*unbounded* part of the response — exactly what overflowed 2000 tokens.

- Removed `menu_items` from the prompt, the Zod validator, and the TS type.
- Raised `MAX_TOKENS` 2000 → 4096. Safe now because (a) the response is bounded by
  pick/mix/pairing counts, and (b) async removes the latency penalty of a bigger budget.

## Fix 2 — transport: synchronous query → async job (CHOSEN: B-full)

### Flow

1. Frontend `create`s a **MenuAnalysis** record (status `PENDING`, plus `s3Keys` +
   `userContext`) and gets back a job **id**. Returns instantly — no 30s exposure.
2. The record's DynamoDB table has a **stream**; on INSERT it triggers the worker Lambda
   (the existing analyze-menu function, restructured).
3. Worker reads the pages, calls Bedrock (one vision call, all pages), then writes the
   result back onto the same record: status `DONE` + `result`, or `ERROR` + `errorMessage`.
4. Frontend **subscribes** to that record (`onUpdate`, filtered to its id) and renders
   when status flips. The "thinking" cat plays until then.

### Why this shape

- **DynamoDB stream trigger** (not a custom "starter" mutation): the frontend uses the
  model's built-in `create`, so there's no extra Lambda just to open the job. One worker.
- **Worker writes back via the Amplify data client** (not raw DynamoDB `UpdateItem`):
  guarantees the `a.json()` serialization matches what the subscription expects. Writing
  raw items risks a shape the client can't parse.
- **Subscription, not polling**: Amplify gives real-time subscriptions on models for
  free; no interval, instant update.

### What this buys over the simpler "Function URL" option

Survives the user closing the tab mid-analysis, and leaves room to add "notify when
ready" later. (Accepted the extra moving parts for that.)

### Auth / privacy note

`MenuAnalysis` is `publicApiKey` (no accounts in this app). Two consequences, both
acceptable for now, both worth remembering:
- Anyone with the API key could read any job record. Contents are low-sensitivity
  (UUID S3 keys, user-typed mood text, flavour picks).
- `onUpdate` with no owner auth would notify on *any* record; the client filters by id.

## API points — verified against Amplify Gen 2 docs

- [x] **Stream already exists.** Amplify model tables enable DynamoDB streams by default
      (subscriptions depend on them). Just attach an `EventSourceMapping` to
      `backend.data.resources.tables['MenuAnalysis'].tableStreamArn`, `filters` → `INSERT`
      only, plus a stream-read IAM policy on the worker role.
- [x] **Worker data access:** grant at schema level with
      `allow.resource(analyzeMenu).to(['mutate'])`; in the handler,
      `getAmplifyDataClientConfig(env)` + `generateClient<Schema>()`.
- [x] **Circular-dependency fix (critical):** the worker both reads data AND hangs off the
      data table's stream. Set `resourceGroupName: 'data'` on its `defineFunction` so it
      lands in the data stack instead of deadlocking against it.

### Two traps this design must avoid

- **Infinite loop:** the worker's write-back is itself a stream event (MODIFY). The
  `EventSourceMapping` filter (`INSERT` only) + handler guard means we never re-trigger on
  our own writes.
- **Subscribe-after-done race:** if the worker finished between `create` and the client
  subscribing, `onUpdate` never fires. Mitigate with an initial `get()` after subscribing.
  (Near-impossible at ~30–50s analysis time, but cheap insurance.)

## Gotcha hit during the build: strict tsconfig

The frontend failed to typecheck with a baffling error — `status: 'PENDING'` reported as
"Type 'string' is not assignable to type 'string[]'". Root cause: `tsconfig.app.json` was
missing `strict`. Amplify Data's `ClientSchema` model types are built from deep conditional
types that **require `strictNullChecks`**; without it they silently collapse to a useless
`{ [x: string]: string[] }` index signature. Custom queries/mutations use simpler types, so
this stayed hidden until the first real `a.model()`. Enabling `strict: true` fixed it — and
the existing code passes clean under full strict (0 errors), so it's a pure win.

## Files this will touch

- `amplify/data/resource.ts` — add `MenuAnalysis` model; drop the old `analyzeMenu` query.
- `amplify/backend.ts` — stream → worker wiring; data-write grant to worker.
- `amplify/functions/analyze-menu/{resource,handler}.ts` — become the stream worker.
- `src/lib/analyzeMenu.ts` — create job + subscribe instead of one query call.
- `src/components/MenuUpload.tsx` — unchanged UX, new call underneath.
