# Agent notes for Nut AI

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Sign in with publik: the publik module's gate (apps/mobile/src/inference/publik-core.ts `ensureSignedIn` / `gateAtStart`, drawn by apps/mobile/src/components/PublikGate.tsx). EXPO_PUBLIC_PUBLIK_GATE_MODE=required (default: before the first screen) or optional (no wall; app/publik-sign-in.tsx asks at the AI plan choice or in Profile). It also sends usage telemetry after sign-in only
- Key: per-install `pk_` from POST /installs, stored in SecureStore (`key.publik`, `publik.install`); the launch values (PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST) exist only in a CI test-hooks build (PUBLIK_TEST_HOOKS=1 + EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1, see docs/PUBLIK-API.md)
- Build flags: apps/mobile/src/build-flags.ts (APP_STORE_BUILD, PUBLIK_GATE_MODE, PUBLIK_TEST_HOOKS). Display name: apps/mobile/app-identity.json
- Profile → publik account: Sign out, Delete account, Count app use. AI consent per provider: apps/mobile/src/inference/ai-consent.ts
- App token: apps/mobile/publik-build.json (public by design, committed); CI builds take it from the PUBLIK_APP_TOKEN secret
- 402: show error.message plus error.top_up_url only
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
