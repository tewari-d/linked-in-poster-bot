# Maintenance checklist

What expires or runs out, when, and what to do. Tick items off, and update the dates after each renewal.

_Last updated: 2026-11-04._

## Dated

- [ ] **27 Dec 2026 – 2 Jan 2027: renew LinkedIn access.** It expires on **3 Jan 2027 at 08:50 IST**. From 27 Dec the bot reminds you with each daily draft.
  1. In Telegram, send `/linkedin` and tap **Connect LinkedIn**. Sign in if asked, then tap **Allow**.
  2. The page after that won't load on your phone; that's expected. Copy the whole address from the browser and send it to the bot. It confirms the new date, then deletes your message.
  3. The new access lasts 60 days. Add the next renewal below (expiry minus 7 days), and send `/status` to see the exact date.
- [ ] **By 14 Jan 2027: put a new topic list live.** The 75 topics run out on 14 Jan 2027, and repeats start on 15 Jan. The CAP CDS topic you already posted comes back on 18 Jan. See [Adding new topics](#adding-new-topics).
- [ ] **Next LinkedIn renewal: about 60 days after the last one.** _(Write the date here after each renewal: \_\_\_\_\_\_\_\_\_\_)_
- [ ] **By 30 Apr 2027, only if the phone runs Node.js 22: upgrade Node.** Node 22 reaches end of life on 30 Apr 2027. Check with `node -v` in Termux. If it shows v22, run `pkg upgrade`, then `bash ~/linkedin-poster/deploy/termux/update.sh` with a fresh code bundle, so the tests run on the new version. Node v24 is fine until 30 Apr 2028.
- [ ] **By 30 Sep 2027: move to a newer LinkedIn API version.** The bot uses version `202610`. LinkedIn supports each version for at least a year, so this one ends around Oct–Nov 2027.
  1. Find the newest version on LinkedIn's versioning page (Microsoft Learn → LinkedIn API → Versioning).
  2. Put `LINKEDIN_API_VERSION=YYYYMM` in the phone's `.env`.
  3. Restart the bot, then make one real post to confirm it works.

## No fixed date: watch for these

| Symptom in Telegram | Cause | Fix |
|---|---|---|
| "Gemini model … not found" | The preview model `gemini-3-flash-preview` was withdrawn (preview models can disappear at short notice) | On the laptop, run `npm run models`. Pick a current Flash model and set `GEMINI_MODEL` in the phone's `.env`, then restart |
| "Gemini rate limit or quota reached" on most days | Google changed the free-tier limits | Wait for the daily reset (midnight US Pacific: 13:30 IST in winter, 12:30 IST in summer). If it keeps happening, try another free model |
| "LinkedIn access expired" | A renewal was missed | Send `/linkedin` and renew as above |
| No draft arrives at 09:00 | The phone or Termux stopped | In Termux, run `sv status linkedin-bot` and read the log: `tail -50 $PREFIX/var/log/sv/linkedin-bot/current` |

The Telegram bot token and the Gemini API key **don't expire**.

## Optional, one-time

- [ ] **Rotate the Gemini key and the Telegram token.** Both were synced to the company OneDrive before the folder moved.
  - Telegram: in @BotFather, send `/revoke`.
  - Gemini: create a new key in AI Studio.
  - Put both in `.env` on the machine that runs the bot, and restart it.
- [ ] **Delete the unused Cloudflare token.** In the Cloudflare dashboard, go to API Tokens. Then remove the two `CLOUDFLARE_` lines from `.env`.

## Monthly two-minute check

- [ ] Send `/status` in Telegram. It shows the latest draft, live or dry-run mode, and LinkedIn days left.
- [ ] Look at the phone: it's charging, the battery isn't swollen, and Termux is still in Recents.

## Adding new topics

Topics come from [data/topics.json](data/topics.json), and the date decides which one comes next. Adding topics to the existing list would bring old topics back mixed in with the new ones. To avoid that, **replace** the subtopics with new ones; git history keeps the old list.

1. On the laptop, write new subtopics in `data/topics.json`: 5 per category, as now. You can add or rename categories. Each subtopic must be unique. Claude can draft them for you.
2. Run `npm test`. It checks the file loads and has enough topics.
3. Pack and copy to the phone: `npm run phone:bundle`, copy over USB to the phone's Download folder, then run `bash ~/linkedin-poster/deploy/termux/update.sh`.
4. Do this **on 14 Jan 2027, after that day's post**, so no topic from the current list is skipped. Doing it a few days earlier only skips those last few topics.

You don't need to change `TOPIC_EPOCH_DATE`. A list of all-new topics won't repeat anything for as many days as it has topics, wherever in the list it starts.
