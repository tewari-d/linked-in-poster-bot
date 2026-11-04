# CLAUDE.md: SAP LinkedIn Auto-Poster

Guidance for Claude Code working in this repo. Read this first in every session. Keep it current: update **Status** and **Decisions** whenever something changes, with the date.

_Last updated: 2026-11-04 (live on the laptop; new post style + AI disclaimer; M4 phone tooling ready, owner setting up the M30)._

---

## 1. What we're building

A personal automation that drafts one **SAP-technical LinkedIn post** every morning at **09:00 IST**, sends it to the owner on **Telegram** for approval, and publishes it to the owner's **LinkedIn profile** only when they tap **Post**.

- Text and image prompt come from the **Gemini API (free tier)**.
- The image is made **manually** by the owner and sent to the bot in Telegram.
- Everything runs on the **laptop first** (end-to-end rehearsal), then on an **old Samsung Galaxy M30 at home** (Termux + Node.js), with a JSON file for storage.
- **Nothing needs to be reachable from the internet.** The bot long-polls Telegram, and the LinkedIn OAuth redirect goes to `localhost` (a server on 127.0.0.1 only), with a paste-the-address fallback.

### Daily flow
1. The **timer** (checked every 30s) sees it's 09:00 IST, or later up to the 12:00 catch-up cutoff, with no draft delivered today.
2. **Topic picker** chooses today's topic from the topic bank by date (§8).
3. **Gemini** returns `hook, text, hashtags, imagePrompt` as structured JSON. It is validated locally.
4. The **bot** sends two messages: the post, then the image idea with buttons **✅ Post / ⏭ Skip / 🔄 Regenerate**.
5. The owner sends an image (ideally as a File). It attaches to the waiting draft, and the bot replies with fresh buttons.
6. **Post** → download the image from Telegram → upload to LinkedIn → create the post → reply with the link. With `DRY_RUN` on (the default) it is a **dry run**.
7. **Skip** marks the draft skipped. **Regenerate** writes a new version of the same topic. Any new draft **expires** the previous waiting one.

### Hard rules
- **Nothing is posted to LinkedIn without an explicit Post tap for that exact draft.** A stale button on an old message must not post a different or expired draft.
- **A draft is posted at most once.** Status becomes `POSTING` before publishing, and every action re-checks the status.
- **Official APIs only**: Telegram Bot API, LinkedIn's official API, Gemini API. No scraping or browser automation.
- **Free only (₹0 running cost).** No paid domains, hosting, subscriptions or paid API tiers.
- **LinkedIn credentials and tokens never leave the owner's devices.** The app never sees the LinkedIn password. The token comes from LinkedIn directly and lives only in `data/state.json`.
- **The bot obeys only `TELEGRAM_OWNER_CHAT_ID`.** Everyone else is ignored. Their button taps are answered (so the spinner stops) but do nothing.

### Architecture
```
   Laptop now → Samsung Galaxy M30 later · Node.js · one process (npm start)
 ┌────────────────────────────────────────────────────────────────────┐
 │ timer (30s) ─► is a daily draft due? ─► createDraft ─► Gemini (JSON) │
 │                                              │                     │
 │ long polling ◄─► Telegram Bot API            ▼                     │
 │   (getUpdates)    commands, taps,    data/state.json               │
 │                   images             (drafts, offset, LinkedIn token)│
 │ serial queue: every state change runs one at a time                 │
 │ publisher: dry run (DRY_RUN on) → LinkedIn API (DRY_RUN=false)      │
 └────────────────────────────────────────────────────────────────────┘
 All connections are outbound. Nothing listens on the internet.
```

---

## 2. Decisions

| Date | Decision |
|---|---|
| 2026-11-04 | Human approval of each post via chat buttons. One SAP-technical post per day. |
| 2026-11-04 | **Runtime: Node.js ≥ 22, plain JavaScript, CommonJS** (owner's conventions, `cap-fiori-engineering` skill). No framework. Dependencies: `@google/genai` only. |
| 2026-11-04 | **Messaging: Telegram bot** (created via @BotFather), replacing WhatsApp. Meta refused a developer account (the owner rarely uses Facebook). Bot API is called with plain `fetch`; **long polling**, so no public URL. No 24h window, templates or per-message cost. Messaging stays behind a module, so WhatsApp could be added later. |
| 2026-11-04 | **Host: laptop for the end-to-end rehearsal, then Samsung Galaxy M30** (Android 10 / One UI 2, Termux). BTP was dropped (owner doesn't want LinkedIn credentials there). iPhone 6 ruled out (iOS 12, background suspension). |
| 2026-11-04 | **Storage: `data/state.json`** (atomic writes, retried on Windows file locks). No database. |
| 2026-11-04 | **LLM: Gemini API free tier, model `gemini-3-flash-preview`** (owner's pick from `npm run models`). Preview models can be withdrawn at short notice; switch via `GEMINI_MODEL`. |
| 2026-11-04 | **Image: manual.** The owner sends it in Telegram. An AI image provider (with a free quota) may come later. |
| 2026-11-04 | **Send time 09:00 Asia/Kolkata, catch-up until 12:00.** A polled due-check, not a cron, so a sleeping laptop or rebooted phone still sends the day's draft. |
| 2026-11-04 | **`DRY_RUN` is on unless it is exactly `false`.** `DRY_RUN=false` needs `LINKEDIN_CLIENT_ID` and `LINKEDIN_CLIENT_SECRET`. |
| 2026-11-04 | **Topic bank is JSON** (`data/topics.json`), rotated by date. |
| 2026-11-04 | **LinkedIn OAuth runs inside the bot** (`/linkedin` → link → Allow). Redirect `http://localhost:8765/auth/linkedin/callback`, served on 127.0.0.1 only. If it can't load (link opened on another device), the owner pastes the browser address into Telegram; the bot uses it and deletes the message. The single-use code (30 min, useless without the secret) may pass through Telegram; **the token never does**. Redirects to hosts other than localhost are refused at startup. |
| 2026-11-04 | **LinkedIn API: `/rest/posts` + `/rest/images`, `LinkedIn-Version: 202610`** (newest on 2026-11-04, supported for at least a year; 202511 sunsets 2026-11-16). Scopes `openid profile w_member_social`. Hashtags use the documented template `{hashtag\|\#\|tag}`. |
| 2026-11-04 | **Uncertain outcome = status `UNKNOWN`.** A timeout, a network drop after connecting, or a 5xx on create-post (or a `POSTING` draft found at startup) asks the owner: **It's on LinkedIn** (`seen`) / **Not there** (`notposted` → back to `SENT`). Failures before create-post, 4xx, and DNS or connection-refused errors are definite and return the draft to `SENT`. |
| 2026-11-04 | **Token expiry reminder** comes with the daily draft during the token's last 7 days. None in dry run before LinkedIn was ever connected. |

**Open:** AI image provider (later; must have a free API quota).

---

## 3. Telegram bot behaviour

**Commands** (also registered with `setMyCommands`, so they appear in Telegram's menu):
- `/draft`: create today's draft now. `/draft YYYY-MM-DD` previews another day's topic. Refused if a draft for that date is already waiting.
- `/status`: the latest draft and its status, the send time, dry-run or live mode, and the LinkedIn connection.
- `/linkedin`: the connection status plus a **Connect LinkedIn** link, with a fresh single-use `state` each time. Also works in dry run.
- A pasted address containing `state=` plus `code=` or `error=` is treated as the LinkedIn redirect.
- `/start`, `/help`: how it works.

**Buttons.** Their `callback_data` is `action:draftId` (well under Telegram's 64-byte limit):

| Button | Action |
|---|---|
| `post` | Without an image, asks first: **📝 Post text only** (`posttext`) / **⏳ Wait** (`wait`). With an image: status `POSTING` → publish → `POSTED` (+ `dryRun`, `linkedinUrl`). If publishing fails, back to `SENT` with `error` set and fresh buttons |
| `skip` | `SKIPPED` |
| `regen` | New draft for the same date/topic, with a "different angle than <old hook>" instruction. The old draft keeps its buttons until the new one exists |
| `draft:<date>` | The **Try again** button after a failed generation. **No automatic retries** (free Gemini quota) |
| `seen` | On an `UNKNOWN` draft: the owner saw it on LinkedIn → `POSTED` (no URL) |
| `notposted` | On an `UNKNOWN` draft: not on LinkedIn → `SENT` with fresh buttons, so Post can be tapped again |

- **Images:** a photo (compressed by Telegram; the bot suggests sending as a File) or a JPG/PNG document, ≤ 20 MB (the Bot API download limit). It attaches to the latest `SENT` draft. Sending again replaces it. Only the Telegram `file_id` is stored; the file is downloaded at Post time.
- **Stale buttons** are removed when a draft is posted, skipped or replaced (`editMessageReplyMarkup`). Status checks guard them anyway.
- **Formatting:** `parse_mode: HTML`, with every dynamic value passed through `escapeHtml`. The image prompt is in `<code>`, so it copies with a tap.

---

## 4. Platform notes and costs

These change over time. **Check the current official docs** before coding anything version-sensitive.

### Running cost: ₹0
Telegram Bot API, the Gemini free tier, the LinkedIn API, and owned hardware are all free.

### Telegram Bot API
- Long polling with `getUpdates` (timeout 30s). The offset is stored in `state.telegramOffset` after each update is handled. A crash mid-update redelivers it, and the status checks make that harmless.
- **Only one process may poll a bot.** A second one gets **409 Conflict**, and the app stops with a clear message. Never run the bot on the laptop and the phone at the same time.
- A bot can't message a user first. The owner must have pressed Start once. After that there is no messaging window.
- Bot chats are not end-to-end encrypted (Telegram cloud chats). That's acceptable: the content becomes public on LinkedIn anyway, and no LinkedIn secrets go through Telegram.
- **The token is in every API URL**, so `telegramApi.js` never puts URLs into errors or logs.
- File download: `getFile` → `https://api.telegram.org/file/bot<token>/<file_path>`, 20 MB maximum.

### Gemini API (free tier)
- SDK `@google/genai` v2.32. CommonJS `require` works. `responseJsonSchema` needs `responseMimeType: 'application/json'`.
- `httpOptions.retryOptions` unset means no retries; we set `{ attempts: 1 }` explicitly.
- **Never spend model calls on retries or self-repair** (~5 calls/minute). Failures go to the owner with a **Try again** button. Clean-up is local (`normalizeDraft`).
- Limits are per project and change often. The daily quota resets at midnight Pacific time.
- Unpaid-tier prompts may be used by Google to improve its products. Never put secrets or personal data in prompts.

### LinkedIn (checked against the Microsoft Learn docs on 2026-11-04)
- Needs a developer app associated with a **LinkedIn Page** (a free placeholder is fine).
- Products (both self-serve "open permissions", no review): **Share on LinkedIn** (`w_member_social`) + **Sign In with LinkedIn using OpenID Connect** (`openid profile`). The member id comes from `/v2/userinfo` (`sub`); the author is `urn:li:person:{sub}`.
- OAuth: `https://www.linkedin.com/oauth/v2/authorization` → code (valid 30 min) → `POST /oauth/v2/accessToken` (form, secret in the body). The scope in the response may be comma-separated.
- **Tokens last 60 days; self-serve apps get no refresh token.** Opening the link again while still logged in, before expiry, skips the consent screen.
- Redirect URI: `http://localhost:8765/auth/linkedin/callback`. The docs only show https examples, but the portal **accepted it (confirmed 2026-11-04)**. If a future portal change refuses it, register `https://localhost:8765/auth/linkedin/callback`, set `LINKEDIN_REDIRECT_URI` to it, and use the paste route (no server runs for https).
- Posts: `POST /rest/posts` with `LinkedIn-Version` and `X-Restli-Protocol-Version: 2.0.0`. Success is 201 with `x-restli-id` (`urn:li:share:…`). Post URL: `https://www.linkedin.com/feed/update/<urn>/`.
- Images: `POST /rest/images?action=initializeUpload` (owner = person URN) → `PUT` the bytes to `uploadUrl` **with the Bearer token** → `content.media.id = urn:li:image:…`. JPG/PNG/GIF, under 36M pixels. `w_member_social` can upload images but not GET them, so the upload status isn't polled. **Watch in the live test** whether the image shows: the docs warn that a post created before processing finishes may not render it.
- **Commentary uses "little text" format.** Reserved characters (`\ | { } @ [ ] ( ) < > # * _ ~`) are backslash-escaped (`src/linkedin/littleText.js`, unit-tested), or the post is **silently truncated**.
- Max 3000 chars, checked on the escaped commentary before any API call. About 210 chars show before "…see more".
- Rate limit (Share on LinkedIn): 150 requests per member per day.

**Owner setup (one time):**
1. Create a placeholder LinkedIn Page if there's none: linkedin.com → For Business → Create a Company Page.
2. https://www.linkedin.com/developers/apps/new: app name, that Page, a logo, accept the terms.
3. App → Settings: **Verify** the Page link (the owner is its admin).
4. App → Products: request **Share on LinkedIn** and **Sign In with LinkedIn using OpenID Connect**.
5. App → Auth: add the redirect URL `http://localhost:8765/auth/linkedin/callback`. Check that the scopes list shows `openid`, `profile` and `w_member_social`.
6. Copy the Client ID and Primary Client Secret into `.env` (never into a chat).
7. `npm start` → `/linkedin` in Telegram → open the link in the laptop browser → Allow → the bot confirms. Then set `DRY_RUN=false` for the first real post.

### Images
- Prompts ask for a portrait 4:5 (1080×1350) infographic with exact quoted text taken from the post (§6). **Never SAP logos or trademarks**; product names as plain text are fine.

---

## 5. Host: Samsung Galaxy M30 (Termux), after the laptop rehearsal

Exynos 7904 (arm64), **Android 10 / One UI 2**. That is older than the Android 12+ "phantom process killer". Samsung's battery manager must be configured.

**Decided 2026-11-04 (owner):** code goes over **USB as a `.tgz` bundle** (not GitHub, not SSH). **No healthchecks.io alert for now.**

Phone prep (owner):
1. Optional: factory reset, so it's a dedicated device. Connect to home Wi-Fi. No SIM needed.
2. Install **F-Droid** (f-droid.org), then **Termux** and **Termux:Boot** from F-Droid. **They must come from the same source**: the signature keys differ per source. Open Termux:Boot once.
3. Samsung battery settings:
   - Settings → Apps → ⋮ → Special access → Optimise battery usage → All → turn **off** for Termux and Termux:Boot.
   - Device care → Battery → App power management: add both apps to **"Apps that won't be put to sleep"**, and turn off "Put unused apps to sleep" and "Adaptive battery".
   - Lock Termux in the Recents screen.
4. In Termux: `pkg update && pkg upgrade -y`, then `termux-setup-storage` (gives `~/storage/downloads`).

Deploy (scripts in `deploy/termux/`, verified on the laptop: bundle builds with Windows `tar` in ustar format, unpacks warning-free with GNU tar, scripts LF and `bash -n` clean):
5. Laptop: **stop the bot for good** (409 rule; from now on the phone owns `state.json`). Then `npm run phone:bundle -- --with-secrets` → `dist/linkedin-poster.tgz` (code + `.env` + `data/state.json`; no `node_modules`). Copy it over USB to the phone's Download folder, then delete it on the laptop.
6. Termux: `mkdir -p ~/linkedin-poster && tar -xzf ~/storage/downloads/linkedin-poster.tgz -C ~/linkedin-poster && rm ~/storage/downloads/linkedin-poster.tgz`
7. `bash ~/linkedin-poster/deploy/termux/setup.sh`. It installs `nodejs-lts` and `termux-services` (checks Node ≥ 22), runs `npm ci --omit=dev`, runs the tests, fixes CRLF in `.env`, and creates service `linkedin-bot`, **left off via a `down` file**. Its run script waits 20 s and then runs `node src/app.js`, so a restart loop is gentle. svlogger writes the log to `$PREFIX/var/log/sv/linkedin-bot/current`. It also installs `~/.termux/boot/start-services` (wake lock + `start-services.sh`, per the Termux:Boot README).
8. `exit`, reopen Termux, `sv-enable linkedin-bot`, `tail -f $PREFIX/var/log/sv/linkedin-bot/current`. Then `/status` in Telegram, and a reboot test.

Updates later: laptop `npm run phone:bundle` (code only) → USB → Download folder → `bash ~/linkedin-poster/deploy/termux/update.sh`. It refuses a bundle that contains `.env` or `state.json`, stops the bot, unpacks, runs `npm ci`, runs the tests (stays stopped if they fail), then starts the bot. Control: `sv up|down|status linkedin-bot`.

Other rules:
- No tunnel is needed: Telegram is long-polled. LinkedIn renewal from the owner's own phone uses the paste-the-address route (the callback server listens on the M30's own 127.0.0.1).
- **Battery safety:** batteries on permanent charge can swell. Keep the phone ventilated and check it occasionally.

---

## 6. Content guidelines

These live in `prompts/post-system.md`. Keep that file and this list in sync.
- **Accuracy beats cleverness.** Never invent SAP features, transaction codes, APIs, product names, versions or dates. Code snippets are short and valid.
- **Never invent personal stories, projects, clients, metrics or quotes**, since posts go out under the owner's real name. **No percentages or claimed savings** unless documented (Gemini invented "80% of apps" on the first try); `validateDraft` warns on any `%`.
- **Creator style (owner request, 2026-11-04: the first posts were "very plain, general text"):** hook starts with an emoji and a bold claim, contrast, mistake, number or question, never a definition. Optional stakes line ("👇"). 1–2 sentences per paragraph. A 3–5 point list with emoji markers (✅ 🔹 ⚡ 💡 🚫 👉 1️⃣). 5–10 emojis, each with a job (`validateDraft` warns below 4 or above 12). One "why it matters" line. A 🎯/📌 takeaway, then a 💬 question.
- Hook ≤ 150 chars, one line. 800–1500 chars. 3–5 hashtags, always `#SAP` plus specific established tags.
- No Markdown and no `-`/`*` bullets (LinkedIn shows them literally). No AI clichés.
- **Image prompt (owner request, 2026-11-04, modelled on a sample infographic):** a portrait 4:5 (1080×1350) infographic of the post: a headline of ≤ 6 words, a subtitle, a labelled diagram of the actual concept, 3–4 takeaway cards with icons, glossy 3D style on a cinematic background. All on-image text in double quotes, under 40 words. Product names as plain text are OK; **no logos or trademarked artwork**. 120–220 words; `IMAGE_PROMPT_MAX` is 2000 chars.
- **No signature on images** (owner, 2026-11-04: tried one with their name, "no need"). Don't add the owner's name to image prompts.
- **AI disclaimer on every post** (owner-approved wording, 2026-11-04): `🤖 AI Generated Content, curated by a human. Spot something off? Tell me in the comments 👇`. The bot adds it, not Gemini, so it is exact: between the text and the hashtags on LinkedIn (`buildCommentary`) and in the Telegram preview (`postMessage`). Default in `config.js`; `POST_DISCLAIMER` in `.env` overrides it (empty turns it off).

## 7. State (`data/state.json`, gitignored)

- `drafts[]` (last 60 kept):
  - `id` (`YYYY-MM-DD-xxxxxxxx`), `date`, `category`, `subtopic`, `format`
  - content: `hook`, `text`, `hashtags`, `imagePrompt`
  - lifecycle: `status`, `provider`, `createdAt`, `sentAt`, `decidedAt`, `error`
  - Telegram: `telegram: { postMessageId, controlMessageId }`, `image: { fileId, kind, mimeType, width?, height?, fileName?, fileSize }`
  - outcome: `dryRun`, `linkedinUrl`
- `lastAutoRunDate`: the timer runs once per day.
- `telegramOffset`
- `linkedin: { accessToken, expiresAt, memberUrn, name, scope, connectedAt }` (the only copy of the token).
- `linkedinAuthState`: the pending OAuth `state`. Each `/linkedin` replaces it; a successful connection removes it.
- Status: `GENERATED` (made, not yet sent) → `SENT` → `POSTING` → `POSTED`. `SENT` can also become `SKIPPED` or `EXPIRED` (replaced by a newer draft). `POSTING` becomes `UNKNOWN` when the outcome is uncertain; the owner then moves `UNKNOWN` to `POSTED` or back to `SENT`.
- The timer counts a day as done only if a draft for it has `sentAt`. Drafts from `npm run draft` don't block it.

## 8. Topic bank and rotation

`data/topics.json` holds 8 `formats` and 15 categories × 5 subtopics = 75 topics.
- Categories are interleaved round-robin.
- **Topic and format are pure functions of the date** (`daysSince(TOPIC_EPOCH_DATE) mod length`). No history, no repeats within 75 days.
- **Regenerate** keeps the topic and passes a different-angle instruction through `{{extra}}` in `prompts/post-request.md`.

---

## 9. Code layout
```
src/
  app.js                    bot process: wiring, startup checks, scheduler + polling (npm start [-- --mock])
  config.js                 .env loading (env vars win over .env), assertEnv with remedy hints
  time.js                   dateInZone, timeInZone, daysBetween, assertIsoDate, assertHhMm
  topics/rotation.js        loadTopicBank, interleave, pickForDate
  generation/prompts.js     loadPrompts, renderTemplate, buildRequest
  generation/draftSchema.js DRAFT_SCHEMA, LIMITS, normalizeDraft, validateDraft
  generation/geminiProvider.js  createGeminiProvider (no retries), listGenerateModels
  generation/mockProvider.js    offline drafts (tests, --mock)
  jobs/createDraft.js       pick → prompt → generate → validate → save; expires older pending drafts
  store/fileStore.js        atomic state.json load/save with Windows lock retry
  store/queue.js            serial task queue
  messaging/telegramApi.js  Bot API via fetch (token never logged), downloadFile, privateChatsFrom
  bot/bot.js                commands, buttons, images, daily run, owner lock
  bot/messages.js           texts, keyboards, HTML escaping, callback parsing
  bot/schedule.js           isDailyRunDue (pure), startScheduler
  bot/polling.js            getUpdates loop, offset persistence, 409 detection
  publish/dryRunPublisher.js    DRY_RUN stand-in (downloads the image to prove the path)
  publish/linkedinPublisher.js  download → upload image → create post; UncertainPublishError for ambiguous create-post failures
  linkedin/linkedinApi.js   OAuth, userinfo, images, posts via fetch (token, secret, upload URL never in errors); ambiguous flag
  linkedin/auth.js          connect link + state, completeAuth, getConnection (no token), requireToken, parsePastedRedirect
  linkedin/callbackServer.js    redirect receiver on 127.0.0.1 only (node:http)
  linkedin/littleText.js    escapeLittleText, buildCommentary (hashtag templates), MAX_COMMENTARY
  cli/draft.js, cli/models.js, cli/telegramSetup.js
  cli/phoneBundle.js        dist/linkedin-poster.tgz for the phone (--with-secrets adds .env + state.json; refuses CRLF scripts)
deploy/termux/setup.sh, update.sh, start-services   phone-side install/update/boot (must stay LF; .gitattributes)
prompts/post-system.md, prompts/post-request.md
data/topics.json
tests/*.test.js             node:test, all external APIs faked (69 tests)
```

**Config** (`.env`, see `.env.example`). Real environment variables override `.env`, which tests and smoke runs rely on.
- `GEMINI_API_KEY`, `GEMINI_MODEL`
- `TELEGRAM_BOT_TOKEN`, `TELEGRAM_OWNER_CHAT_ID`
- `TIMEZONE`, `SEND_TIME`, `CATCHUP_CUTOFF`, `TOPIC_EPOCH_DATE`, `DATA_DIR`, `DRY_RUN`
- `LINKEDIN_CLIENT_ID`, `LINKEDIN_CLIENT_SECRET`. Optional: `LINKEDIN_REDIRECT_URI` (default `http://localhost:8765/auth/linkedin/callback`) and `LINKEDIN_API_VERSION` (default `202610`; bump it yearly).

## 10. Engineering conventions
- Follow the `cap-fiori-engineering` skill:
  - CommonJS
  - multi-argument functions take one options object
  - validate first, and throw messages that name the problem and the remedy
  - `?.` / `??` for defensive reads
  - **comments explain why, not what**
  - leave git changes uncommitted unless asked
- **Never trigger real LinkedIn posts, or send Telegram messages to the owner, unless the owner asks for it in that session.** Smoke tests use a fake token via an environment variable, which overrides `.env`.
- Put each external provider (LLM, messaging, publisher) behind a small interface so it can be swapped or faked.
- **Pure-JS dependencies only** (must run on Termux/arm64).
- The same code runs on Windows and Termux. Use `path` utilities and no OS-specific shell calls.
- Tests use `node:test` and fake every external API. **Don't call Gemini or Telegram from tests.**
- Keep secrets out of logs and prompts.

### Owner's standing preferences (from 2026-11-04; they apply on every machine)
- **No claude.ai artifacts or Claude Docs unless the owner explicitly asks.** Deliver diagrams and docs as files, by default PDFs in `assets/`. Headless Edge is blocked on the company laptop, so PDFs there are built with PDFKit.
- **Post reviews: flag only clear factual errors.** No completeness nitpicks (e.g. a missing `using` line when the text mentions the import) and no new prompt rules for them. Readers are technical, and the AI disclaimer invites corrections.
- **No signature or name on images.**
- **Confirm before anything outward-facing**: commits, pushes, real posts, Telegram messages. The owner creates and pushes the GitHub repo themselves.

## 11. Dev environment (laptops)
**Personal laptop (from 2026-11-04):** `git clone`, then `npm ci`, then `git config core.hooksPath .githooks` (the secret guard is per clone). `.env` and `data/state.json` are **not in git**; copy them over USB only if this laptop must run the bot or make the phone's `--with-secrets` bundle. Never use email, cloud or chat for them. **Only one machine may run the bot** (409 rule); once the phone is live, no laptop runs it.

**Company laptop:**
- Windows 11, Node 24, npm 11, git 2.51. The owner's terminal is **cmd** (`set VAR=x`); PowerShell and Git Bash are also available.
- **Company-managed laptop (Nagarro).**
  - The repo was in the company OneDrive folder until 2026-11-04, when the owner moved it out so `.env` (keys) and the future LinkedIn token in `data/state.json` don't sync to the company cloud.
  - `.env` with the Gemini key and Telegram token *was* synced while it lived there. Optionally rotate both: BotFather `/revoke`, and a new key in AI Studio.
  - Code uses only relative paths (`__dirname`, `DATA_DIR=./data`), so the move needs no code change.
- `api.telegram.org` is reachable from this network (checked 2026-11-04).
- Git repo initialised 2026-11-04; the owner makes the first commit and pushes it to a personal GitHub repo. `core.autocrlf=true` here; `.gitattributes` keeps the phone scripts and the hook LF.
- npm 11 skipped install scripts for `@google/genai` (no-op) and `protobufjs`; not needed.

## 12. Commands
```
npm start                     run the bot (Telegram + daily timer). Ctrl+C stops it
npm start -- --mock           same, with offline drafts (no Gemini quota used)
npm test                      unit tests (no network)
npm run draft [-- --mock] [-- --date YYYY-MM-DD]   generate a draft in the terminal only (never sent)
npm run models                list Gemini models for GEMINI_API_KEY
npm run phone:bundle [-- --with-secrets]   pack the bot for the phone (dist/linkedin-poster.tgz)
npm run secrets:check [-- --all]   no keys/token in staged files (or in everything git would upload); also the pre-commit hook
npm run telegram:setup        check the bot token and show the chat id of whoever pressed Start
                              (only finds messages the running bot hasn't already consumed)
```
In Telegram: `/draft`, `/draft YYYY-MM-DD`, `/status`, `/linkedin`, `/help`.

**Testing the daily timer** (passed 2026-11-04, fired at 11:10:15 IST unprompted). A day already counts as done once any draft for it was sent (e.g. via `/draft`), so test against an empty temporary data folder. Env vars override `.env` for that terminal only. The owner's terminal is **cmd**, so `set`, not `$env:`:
```bat
set SEND_TIME=<a few minutes ahead>
set CATCHUP_CUTOFF=23:59
set DATA_DIR=%TEMP%\linkedin-timer-test
set DRY_RUN=true
npm start
```
Stop the normal bot first (409 rule). Afterwards close that window and run `npm start` in a new one. Delete `%TEMP%\linkedin-timer-test` before the next test, or that day will count as done there too.

## 13. Alternatives considered
- **WhatsApp Cloud API:** Meta refused a developer account. It also needs a template, a 24h window, paid templates and a public webhook (ngrok).
- **SAP BTP Cloud Foundry trial / Free Tier:** the owner doesn't want LinkedIn credentials there. Trial: daily stops, 90-day deletion. Free Tier: needs a credit card.
- **Claude API for text:** no free tier.
- **iPhone 6 as server:** iOS 12, background suspension.
- **ngrok / Cloudflare tunnels:** not needed with Telegram long polling.

---

## 14. Status

> **Next session: start here.**
> 1. `npm test` (80 tests).
> 2. Ask where the owner is in the phone setup (§5 steps 1–8). Help with whatever step they're on; Termux errors usually come with the exact message.
> 3. Once the phone runs: a reboot test, then confirm the next 09:00 draft came from the phone. **Never start the bot on the laptop again** (409; the phone owns `state.json`).
- [x] 2026-11-04: Project defined. Decisions recorded.
- [x] 2026-11-04: **M1**: topic rotation, prompts, Gemini provider, validation, file store, CLIs. First real draft via `gemini-3-flash-preview` was technically accurate.
- [x] 2026-11-04: Telegram bot created by the owner; token and owner chat id in `.env`.
- [x] 2026-11-04: **M2 built**: Telegram bot (long polling, owner lock, `/draft`, `/status`, `/help`, Post/Skip/Regenerate, image attach, text-only confirm, stale-button removal), daily timer with catch-up, serial queue, dry-run publisher, 36 passing tests. Startup was smoke-tested with a fake token.
- [x] 2026-11-04: **M2 live check** passed (owner): `/draft` → dry-run Post (text only). Image, Skip, Regenerate and a timer run weren't tried live; the laptop rehearsal covers them.
- [x] 2026-11-04: Repo moved out of OneDrive to `C:\Documents\AI Stuff\LinkedIn`. Tests pass there; no copy found left in OneDrive (its online recycle bin wasn't checked).
- [x] 2026-11-04: Owner created the LinkedIn developer app + Page (both products added). The portal **accepted `http://localhost:8765/auth/linkedin/callback`**. Connected via `/linkedin` as Deepak Tewari, scopes `openid,profile,w_member_social`; the **token expires 2027-01-03** (reminders from 2026-12-27).
- [x] 2026-11-04: **M3 code**: OAuth in the bot (`/linkedin`, localhost callback, pasted-address fallback), token storage, expiry reminder, little-text escaping, image upload, create post, `UNKNOWN` handling + startup recovery, `DRY_RUN=false` allowed. 69 tests. Startup checks smoke-tested with fake tokens.
- [x] 2026-11-04: **M3 live test passed**: `DRY_RUN=false`, first real post with an image published to LinkedIn, driven from Telegram on the owner's phone. Owner: "everything worked well".
- [x] 2026-11-04: Owner docs as PDFs: `assets/sap-auto-poster-architecture.pdf` (system map, daily sequence, draft lifecycle, secrets, stack, code map) and `assets/sap-auto-poster-tech-reference.pdf` (services + URLs, `.env` settings, what to edit for posts, renewals/limits, key rotation, commands, endpoints). **Owner rule: no claude.ai artifacts or Claude Docs unless explicitly asked; deliver files in `assets/`.** The architecture PDF is built with PDFKit from the diagram SVGs (headless Edge is blocked here by the company's forced-sign-in policy, `BrowserSignin=2`). **Regenerate both when services, settings, endpoints or the flow change.**
- [x] 2026-11-04: **Post + image style changed** at the owner's request (§6): emoji-rich creator style; portrait infographic image prompts with exact text (a signature was tried, then removed at the owner's request); `%` and emoji-count warnings. 74 tests. Owner tried `/draft` live: "this time it was better". AI disclaimer line added (owner picked the wording and the before-hashtags position). 77 tests. Two previews via `npm run draft -- --date 2026-11-05` (2 Gemini calls); the second was clean. **The running bot must be restarted to load the new prompts.** `assets/sap-auto-poster-tech-reference.pdf` still describes the old rules (emoji limit 3, abstract landscape images).
- [ ] **Laptop end-to-end rehearsal** (owner requirement): the timer at a near-future time → Telegram → image → Post → live LinkedIn post, plus the Skip and Regenerate paths. **Phone work starts only after this passes.**
- [x] 2026-11-04: **Laptop end-to-end rehearsal passed**: live post, the new style, the timer fired unprompted (test data folder), dry-run Post. Owner: "worked fine".
- [x] 2026-11-04: **M4 prep**: USB bundle tooling + Termux setup/update/boot scripts (§5). 80 tests.
- [x] 2026-11-04: **GitHub-ready** (the owner creates and pushes the personal repo themselves). Added:
  - stricter `.gitignore`: `.env.*` except `.env.example`, and `*.tgz`
  - a pre-commit guard, `.githooks/pre-commit` → `src/cli/checkSecrets.js`. It blocks secret files by name, this machine's real key values and key-shaped strings, and prints file names only. Enabled via `git config core.hooksPath .githooks`.
  - `npm run secrets:check -- --all`, and `README.md`.

  Verified: the full scan of the 56 upload files is clean, and the hook blocked a test commit in a throwaway repo. 84 tests. CLAUDE.md mentions the employer laptop and OneDrive; trim them if the repo goes public.
- [ ] **M4 (owner, on the phone):** §5 steps 1–8, then a reboot test and a 09:00 morning check from the phone.
- [ ] M5: polish (log rotation, more tests as needed).
