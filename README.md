# UZEX Assist

A formal, Uzbek-first, voice and text service assistant for an UzEx hackathon. No login. Two roles: **Mijoz** (buyer) and **Sotuvchi** (seller). Gemini calls server-side tools against a real SQLite database containing artificial exchange inventory. Confirmed demo orders debit a demo balance and update stock; seller confirmations save demo listings.

## Run locally

Requires **Node.js 22.13+** (Node 24 recommended). There is no build step. Run `npm ci` to install the WebSocket server dependency; the browser Markdown parser is bundled locally under `public/vendor/`.

```powershell
Copy-Item .env.example .env
# Edit .env and replace GEMINI_API_KEY. Never commit the real key.
npm ci
npm run dev
```

Open **http://localhost:3000**. Restart the server after changing `.env`. The server binds to localhost intentionally. Without a key, the interface works in a clearly labeled, limited deterministic demo mode. With a key, Gemini handles natural conversation and tool selection. Set `AI_MODE=demo` to force offline mode. `GEMINI_MODEL` is configurable; the default is `gemini-flash-latest`. Model access and availability depend on your Google project. No OpenAI key is needed.

## A two-minute presentation

1. Start as **Mijoz**. Say or type: `Toshkentdan 20 tonna sement topib bering`.
2. Compare the demo offers. Choose a lot and submit: `LOT-1001 dan 20 tonna olaman`.
3. Review quantity, price and total. Click **So‘rovni tasdiqlash**. Ask `Hisobim va buyurtmalar holati` to see the saved purchase and reduced balance.
4. Switch to **Sotuvchi**. Submit: `Toshkentda 100 tonna M-400 sement sotaman, tonnasi 720000 so‘m`.
5. Confirm the listing and ask `Hisobim va e’lonlarim holati`.
6. Ask `UZEX xizmatlarini ko‘rsating` to open the official service directory.

You can supply seller fields across multiple turns. The offline parser supports representative Uzbek demo phrases, not arbitrary language understanding; Gemini mode supports free-form conversation. No configured-key failure is silently replaced by a demo answer.

## Voice behavior

There are three separate input modes:

- **Text:** type into the composer and send.
- **Diktovka:** browser SpeechRecognition with `uz-UZ` transcribes into the composer. Review the text, then send. Browser recognition may need an internet connection; Uzbek support varies by browser/OS. Ordinary text replies remain text-only; spoken replies are part of the live voice session.
- **Jonli suhbat:** the primary action is a large, fixed launcher above the message composer's right edge. It opens a full-window voice workspace using native streaming audio through **Gemini Live**, not browser dictation or browser TTS. Microphone PCM16 audio is resampled to 16 kHz in an AudioWorklet, sent through a same-origin WebSocket proxy, and streamed replies are played using Web Audio (normally 24 kHz). Automatic voice activity detection handles turns and interruptions. Includes independently scrolling transcripts and result cards, microphone mute/unmute, stop playback, transcript visibility, role indicator, call timer, Escape/close and end-call controls. Cards stay visible while transcript deltas arrive. Select a lot within the call to continue discussing it, or use the card's spoken-review button to hear its terms and confirm with **“Ha, tasdiqlayman”** or cancel with **“Bekor qiling”**. Button confirmation remains available. Server-validated results update both the voice card and the ordinary chat record.

Live voice requires a valid `GEMINI_API_KEY`, a Live-capable model configured as `GEMINI_LIVE_MODEL` (default `gemini-3.1-flash-live-preview`), microphone permission, and localhost or HTTPS. `GEMINI_LIVE_VOICE` defaults to `Kore`. Live-model availability and quotas depend on the Google project; `GEMINI_MODEL` only controls ordinary text chat. Configure the Live model independently if Google changes its preview models. The no-key offline walkthrough does not provide live voice. There is no silent downgrade from native audio to dictation.

Browser providers may process dictation audio. During a live call audio and transcripts are processed by Google; with Gemini text enabled, conversation text, instructions and tool data are sent to Google. The permanent key remains on the server. Calls are limited to 15 minutes, are not automatically reconnected after failures, and stop microphone tracks when ended. Ending a voice call preserves transcripts as text context for subsequent chat. Echo cancellation is requested; headphones improve interruption behavior. The UI uses concise transaction messages; prototype limitations are documented here and in the rules dialog. The “Loyiha haqida” link and model connection label have been removed.

## Implemented workflows

- Search/filter demo lots by product, region, quantity and maximum unit price.
- Compare demo stock and price ranges, inspect session balance and operations.
- Prepare and explicitly confirm/cancel demo purchases and seller listings.
- Role checks, session ownership, authoritative server totals, atomic stock and balance checks, and duplicate confirmation protection.
- Separate conversation histories for seller/buyer; one demo account per anonymous browser session.
- Inline tool results, offer cards, confirmation cards, error/retry states, and a focused two-column responsive layout.
- Official service links: exchange, state procurement, logistics, yarmarka, agro and business procurement.

Inventory, seller names, quantities, balances, delivery estimates and transactions are **synthetic**. The eight demo lot prices now use explicitly mapped public weekly benchmarks (their product names match the reference); they are not executable exchange offers. Seed balance: 500,000,000 UZS; quantities: tonnes; prices: UZS/tonne. Totals exclude transport, taxes and fees. Seller listings are stored separately from the reference demo inventory; they are not published to the buyer catalogue. This is a demonstration of orchestration, not a full exchange matching engine.

## Rules and extension points

`lib/instructions.mjs` contains the assistant's DOs and DON'Ts. `lib/store.mjs` implements allowlisted tools with parameterized SQLite queries; the model cannot execute SQL or arbitrary code. Text-chat tools can only **prepare** actions. Card buttons use a separate confirmation endpoint. Live voice additionally exposes `resolve_action`; `lib/voice-actions.mjs` requires a fresh, direct transcript decision for the exact currently reviewed pending card before allowing a commit. Selecting a card, prior consent, ambiguous or conditional speech, and a model function call alone are insufficient. Session/role ownership, stock, balance and duplicate-submission checks remain enforced by the store. `lib/assistant.mjs` implements the Gemini REST tool loop and offline walkthrough.

For a production integration, replace each demo tool adapter with an authorized UzEx service integration. Procurement and logistics are presently **directory links only**. Actual payments, bids, E-IMZO, document submission, official accounts and live prices are not integrated. Full UzEx automation requires service APIs, authentication, permissions and official integration arrangements.

`data/uzex-demo.sqlite` is created automatically and ignored by Git. Database records survive server restarts, but anonymous sessions and conversation history are in memory: restarting creates a fresh browser session and prior session records will no longer be accessible through that session. Inactive sessions expire after 24 hours. “Yangi suhbat” clears the current role's conversation, not its demo transactions. Demo inventory is shared across sessions. To restore original stock for a presentation, stop the server, remove the generated `data` directory, then restart. Do not use this prototype as a public multiuser production system.

## Verification

```powershell
npm run check
npm test
```

Tests cover role restrictions, session ownership, cancellation, duplicate submissions, stock conflicts, balance rollback, multi-turn demo workflows, and a mocked Gemini function-call roundtrip. A real Gemini request requires your key and is not covered by the mock test.

Live tests use a local mock WebSocket provider to check server-only setup, PCM forwarding, transcripts, role restrictions, confirmation notifications and teardown. Audio tests check PCM playback and interruption, microphone cleanup when a permission request is pending, and 48 kHz → 16 kHz worklet resampling. Migration tests preserve existing orders, pending actions, stock and balances when `DEMO-` IDs become `LOT-` IDs. Actual microphone permission, device playback, visual layout, network latency and Uzbek pronunciation still require a browser check.

The neon palette and live voice animations use the supplied cyan/blue/violet references, copied into `public/assets/voice/`; the original reference directory is not needed at runtime. `public/neon.css` applies the navy theme across chat, navigation, cards, Markdown and dialogs. The right process panel and the former sidebar demo/profile blocks have been removed.

## References

- [UzEx official service ecosystem](https://uzex.uz/)
- [State procurement portal](https://xarid.uzex.uz/)
- [Gemini generateContent API](https://ai.google.dev/api/generate-content)
- [Gemini function calling](https://ai.google.dev/gemini-api/docs/function-calling)
- [Gemini Live WebSocket API](https://ai.google.dev/api/live)

Independent hackathon prototype; not an official UzEx application.



## Public UZEX weekly price catalogue

The checked-in snapshot imports **5,384 rows across all eight periods published in the period selector**, including **1,327 domestic products** and **3 export products** in the latest selected week, 26–30 October 2026. Individual rows can be dated earlier. Collected 8 November 2026 from [UZEX WeeklyQuotes](https://uzex.uz/WeeklyQuotes?ImportId=102); pagination was followed through the final page for every period.

`data/quotes/manifest.json` records source URLs, row counts and retrieval time. Raw source names, prices, signed price changes, percentage text and row dates are retained. `weekly_quotes` is populated in SQLite on startup for both new and existing databases. The `market_quotes` assistant tool supports product search, period selection and pagination (`offset`, `limit`, maximum 100). Try “Sement narxlari” or “Karbamid haftalik kotirovkalari”. Text and live voice show source-backed result tables.

These are published weekly quotations, **not today's live prices or available stock**. Names may specify litres, pieces, cubic metres or foreign currency; the weekly table has no separate unit/currency column. Missing units/currencies remain unspecified, and source anomalies are retained rather than silently corrected. The separate current contracts page lists base prices and lot sizes, which cannot safely be treated as weekly per-unit execution prices; it is not imported into this snapshot.

The eight benchmark mappings live in `lib/quotes.mjs`. Startup updates their names/prices once, preserves stock, balances and completed orders, and cancels pending orders for those lots so users review new prices. Other listings are untouched. Quantities, sellers and regions remain demonstration data. Reference products are searchable as quotes, not fabricated purchasable inventory.

Refresh the published weekly snapshot with Python 3: `python scripts/import-quotes.py`, then restart the app. The importer discovers the period selector, follows all pages and validates consecutive row numbers before writing the manifest. It fails on missing/invalid data. No API key is required. Review source changes before committing a refresh; benchmark mappings are deliberately explicit and versioned.
