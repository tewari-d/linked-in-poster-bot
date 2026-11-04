# SAP LinkedIn Auto-Poster

A personal bot that drafts one SAP-technical LinkedIn post every morning, sends it to its owner on Telegram, and publishes it to LinkedIn only after an explicit ✅ Post tap.

- **Text:** Google Gemini (free tier), in an emoji-rich creator style. The same call also returns the text for the image.
- **Image:** the bot draws a portrait infographic (1080×1350 PNG) from a template, so every word on it is spelled exactly. No AI image model is involved, and no network is needed for this step. The owner can still send their own image instead.
- **Approval:** a Telegram bot with Post / Skip / Regenerate buttons.
- **Publishing:** LinkedIn's official Posts and Images APIs, with an AI disclaimer line on every post.
- **Hosting:** one Node.js process on a laptop or an old Android phone (Termux). Every connection is outbound; nothing is exposed to the internet.
- **Cost:** ₹0. Free API tiers and owned hardware only.

Diagrams and a full reference: [`assets/sap-auto-poster-architecture.pdf`](assets/sap-auto-poster-architecture.pdf) and [`assets/sap-auto-poster-tech-reference.pdf`](assets/sap-auto-poster-tech-reference.pdf). Working notes and decisions: [`CLAUDE.md`](CLAUDE.md).

## Setup

Requires Node.js 22 or newer.

```
npm ci
copy .env.example .env      (cp on Linux/Termux), then fill in the keys
git config core.hooksPath .githooks
npm test
```

`.env.example` explains every setting: the Gemini key, the Telegram bot token and owner chat id, the LinkedIn app's client id and secret, the send time, and `DRY_RUN`.

## Commands

| Command | What it does |
| --- | --- |
| `npm start` | Runs the bot: Telegram and the daily timer. Add `-- --mock` for offline drafts |
| `npm test` | Runs the tests; every external API is faked, nothing is sent |
| `npm run draft` | Writes one draft to the terminal only. Add `-- --image preview.png` to draw its image too |
| `npm run models` | Lists the Gemini models your key can use |
| `npm run telegram:setup` | Checks the bot token and shows your chat id |
| `npm run phone:bundle` | Packs the bot for the phone (`-- --with-secrets` for the first install) |
| `npm run secrets:check -- --all` | Confirms no key or token is in any file git would upload |

In Telegram: `/draft`, `/draft YYYY-MM-DD`, `/status`, `/linkedin`, `/help`.

## Keeping secrets out of git

The API keys live in `.env` and the LinkedIn access token in `data/state.json`. Both are gitignored, as are phone bundles (`*.tgz`). The pre-commit hook in `.githooks/` also blocks any commit that contains those files, this machine's actual key values, or strings shaped like a Telegram token or Google API key. Enable it once per clone with `git config core.hooksPath .githooks` (on Linux, also `chmod +x .githooks/pre-commit`).

## Maintenance

[`MAINTENANCE.md`](MAINTENANCE.md) lists what expires and when: LinkedIn access every 60 days, the topic list, the LinkedIn API version and Node.js. It says what to do for each.

## Third-party assets

`src/image/fonts/` contains Inter and JetBrains Mono (SIL Open Font License 1.1; licence texts alongside). `src/image/icons.js` contains icon shapes from Lucide (ISC licence, quoted in the file).

## Running on an Android phone

See `deploy/termux/` and section 5 of `CLAUDE.md`: Termux and Termux:Boot from F-Droid, the bot as a `termux-services` service that restarts on crash and starts at boot, and updates copied over USB.
