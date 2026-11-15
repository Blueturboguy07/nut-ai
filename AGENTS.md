# Agent notes for Nut AI

## publik API
- Base URL: https://publikhq.com/api/v1 (OpenAI Chat Completions, Responses, Anthropic Messages)
- Models: publik-fast, publik-balanced, publik-smart only; never a vendor model name
- Sign in with publik: the publik module's gate (apps/mobile/src/inference/publik-core.ts `ensureSignedIn` / `gateAtStart`, drawn by apps/mobile/src/components/PublikGate.tsx). EXPO_PUBLIC_PUBLIK_GATE_MODE=required (default: before the first screen; ALWAYS in an App Store build) or optional (a CI test artifact only: no wall; app/publik-sign-in.tsx asks at the AI plan choice or in Profile). It also sends usage telemetry after sign-in only
- Key: per-install `pk_` from POST /installs, stored in SecureStore (`key.publik`, `publik.install`); the launch values (PUBLIK_API_BASE_URL, PUBLIK_SELF_TEST) exist only in a CI test-hooks build (PUBLIK_TEST_HOOKS=1 + EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1, see docs/PUBLIK-API.md)
- Build flags: apps/mobile/src/build-flags.ts (APP_STORE_BUILD, PUBLIK_GATE_MODE, PUBLIK_TEST_HOOKS, CLAUDE_SUBSCRIPTION_TOKENS). An App Store build never has the test hooks or the optional gate (the native build fails: apps/mobile/plugins/withPublikTokenCheck.js)
- Name: apps/mobile/app-identity.json `displayName` "publik Nut AI" (App Store and in-app); `homeScreenName` "Nut AI" is only the label under the icon. Never name another app in code or UI
- Purchase links ("Get a plan", top-up, "Add a plan or pack", the 402 link): in an App Store build only in the US storefront (StoreKit); elsewhere no link, no button, no price, only the sentence 'To get a plan, search for "publik" on Google.' (publik-core.ts purchaseLinksFor)
- publik pages: the in-app sheet opens only publik's bare in-app pages for sign-in (claim_url + in_app=1, publik-core.ts inAppClaimUrl), privacy (/in-app/privacy) and Delete account (/in-app/delete-account); only the US purchase links open the normal site.
- Profile → publik account: Sign out, Delete account, Count app use. AI consent per provider: apps/mobile/src/inference/ai-consent.ts
- App token: ONLY the build input PUBLIK_APP_TOKEN (app.config.ts extra.publikAppToken; CI passes the repo secret to the native build steps). apps/mobile/publik-build.json holds the placeholder; its token serves a dev build (Metro) only. A release build without the input fails
- 402: show error.message plus error.top_up_url only (with purchase links on; else the plain sentence)
- Never print or log a key
- Docs: https://publikhq.com/llms.txt, https://publikhq.com/developers, https://publikhq.com/skills/api.md
