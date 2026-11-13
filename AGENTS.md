# Agent notes for Nut AI

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Sign in with publik: the publik module's gate runs at start-up, before the first screen; it also sends usage telemetry (apps/mobile/src/inference/publik-core.ts `ensureSignedIn`, started by apps/mobile/src/components/PublikGate.tsx)
- Key: per-install `pk_` from POST /installs, stored in SecureStore (`key.publik`, `publik.install`); the launch value PUBLIK_API_BASE_URL overrides the base URL (tests only, see docs/PUBLIK-API.md)
- App token: apps/mobile/publik-build.json (public by design, committed); CI builds take it from the PUBLIK_APP_TOKEN secret
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
