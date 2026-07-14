# Media assets

The mascot loops, background loops, BGM, and poster stills are **not committed to
this repo**. They live in a public, read-only S3 bucket and are fetched by the app at
runtime.

```
https://shisha-companion-assets-441342223857.s3.ap-northeast-1.amazonaws.com
```

| Prefix | Contents |
|---|---|
| `mascot/` | 11 **transparent** animation loops, one per mascot state — each as a `.webm` **and** a `.mov` pair |
| `bg/` | 3 scene loops (`lounge-hero.mp4`, `lounge-normal.mp4`, `village-dusk.mp4`) |
| `bgm/` | 7 ambient tracks + the "quest cleared" sting |
| `stills/` | 2 poster images |

34 objects, ~38 MB total (a browser only downloads one mascot format).

## The mascot is transparent video — read this before touching it

The original Higgsfield mascot clips were animated **character reference sheets**: every
frame also contained line-art sketches, a lantern icon, and colour-palette swatches on a
flat cream background. Dropped into the app they rendered as a picture-in-picture card,
not a character in the scene. Cropping could not fix it — the palette swatches sit at the
same horizontal range as the cat's tail.

The fix, in three steps:

1. **Matte.** Each clip went through Higgsfield's `video_background_remover` (**1 credit
   each**, 11 total). It isolates the cat and returns it on **pure black** — H.264 cannot
   carry an alpha channel.
2. **Key.** `ffmpeg colorkey=0x000000` lifts the black to transparency. The threshold is
   kept low (`0.06`) because the cat's outlines are dark **brown**, not pure black — a
   loose threshold would punch holes through the linework.
3. **Encode twice.** There is no single transparent video format that works everywhere:

   | Format | Codec | Browsers |
   |---|---|---|
   | `.mov` | HEVC + alpha (VideoToolbox) | Safari, iOS — **cannot** do alpha in WebM |
   | `.webm` | VP9 + alpha | Chrome, Firefox, Edge |

   The `<video>` element lists the **`.mov` first**. Safari takes it; browsers that can't
   decode `hvc1` skip to the WebM. **This ordering is load-bearing** — WebM first would
   make Safari play it happily and render a black box, which is the bug we fixed.

> `ffprobe` reports `pix_fmt=yuv420p` on the WebM and looks alpha-less. It isn't — VP9
> stores alpha in a side channel. The real signal is the container tag `alpha_mode=1`.
> ffmpeg's own filters can't composite VP9 alpha, so **verify in a browser, not ffmpeg**.

Alpha costs size: the WebM set is ~5.6 MB (vs 2.1 MB opaque), the MOV set ~15 MB.

## Why not in the repo

Git stores binaries forever and they don't diff, so committing ~19 MB of media would
be a permanent clone tax on every future checkout — and re-encoding would stack a new
copy in history each time. S3 keeps the repo to source only.

## Regenerating and uploading

```bash
bash scripts/fetch-assets.sh    # download originals -> re-encode -> assets/dist/
bash scripts/sync-assets.sh     # mirror assets/dist/ -> the S3 bucket
```

`assets/` is gitignored in full. `fetch-assets.sh` caches raw downloads, so re-running
it only re-encodes.

### Encoding rationale

The Higgsfield originals are ~5–6 Mbps, but all 11 mascot loops must **preload** so
state changes are instant. Shipping them untouched meant a ~43 MB download before the
cat could move. Sizing each asset to how it is actually *displayed* took the set from
**93 MB to ~19 MB** with no visible quality loss:

| Set | Encoding | Why |
|---|---|---|
| Mascot | 480px wide; VP9-alpha CRF 36 + HEVC-alpha | Renders ~250px wide. Transparent (see above) |
| Backgrounds | 1280px wide, CRF 30 | Sits behind a dim overlay — bitrate was the only problem |
| Stills | JPEG @ 960px | 1–3 MB PNGs become ~120 KB posters |
| BGM | 96 kbps | Ambient music at low volume; the 320 kbps sources were pure waste |

Audio is stripped from every clip (`-an`) — the source clips carry junk
AI-generated audio.

> **ffmpeg + bash gotcha:** the encode loop passes `-nostdin`. Without it, ffmpeg reads
> from stdin, eats the `while read` loop's input, and silently truncates filenames.

## Bucket security

The bucket is **deliberately world-readable**, and nothing more:

| Anonymous action | Result |
|---|---|
| Read a known object | ✅ allowed (this is the point) |
| List the bucket | ❌ `403` — `s3:ListBucket` is not granted, so contents can't be enumerated |
| Upload / delete | ❌ `403` — no public write, ever |

`BlockPublicAcls` and `IgnorePublicAcls` stay **on**, so nothing can be made public by
accident via an object ACL — only the explicit bucket policy opens reads. CORS allows
`GET`/`HEAD` because Howler plays audio through the Web Audio API, which fetches via
XHR.

**Never put anything non-public in this bucket.** It holds media and nothing else.

Setup is one-time via `scripts/setup-assets-bucket.sh`. The bucket is standalone (plain
AWS CLI, *not* part of the Amplify stack) so it survives `ampx sandbox delete`.

## Overriding the source

The app reads `VITE_ASSET_BASE_URL` and falls back to the bucket above
(`src/config/assets.ts`). Point it elsewhere to serve assets from a different bucket or
a local copy.

## Provenance

- **Clips/stills:** generated with Higgsfield (Kling). Original characters — no
  copyrighted designs or logos.
- **BGM:** generated with Google Gemini/Lyria under the owner's account; cleared to
  bundle.
