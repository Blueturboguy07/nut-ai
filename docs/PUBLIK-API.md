# publik API in Nut AI

Photo scans, label and receipt transcription, the branded-food lookup and the
"describe a workout" estimate all need an AI model. By default they run on
**publik API** (`https://publikhq.com/api/v1`): the phone mints its own
bounded key at the first start (Sign in with publik, below), and
every call counts toward the person's publik plan. A new install starts with
no free use (publik migration 0059), and every metered call answers 402
`insufficient_credit` until the phone is linked to a publik account, a plan
or pack is added, or the user pastes their own key. Linking gives some free
use to try it, once per publik account; it is the only free use publik API
gives. The app never shows an amount of money (see "No money in the app"). A user who prefers their own
Anthropic, OpenAI or Google key still gets the neutral vendor picker; a
user-entered key always wins and publik code never touches the vendor slots.

## Sign in with publik (the gate)

The gate is the publik module in `apps/mobile/src/inference/publik-core.ts`
(`ensureSignedIn`, the same screens, words and endpoints as publikhq.com's
`sdk/publik.ts.md`). `apps/mobile/src/inference/publik.ts` gives it the phone
(`runPublikGate`, `runPublikSignIn`), and
`apps/mobile/src/components/PublikGate.tsx` draws its screens.
`app/_layout.tsx` wraps the whole app in `PublikGate`.

### Two modes: `EXPO_PUBLIC_PUBLIK_GATE_MODE`

| Mode | What the person sees |
|---|---|
| `required` (default) | **Sign in with publik** before any screen: no tab, no onboarding step and no database read before the gate passes. |
| `optional` | No wall. Sign-in is asked when the person picks publik API (onboarding, Profile → AI provider) or taps Profile → publik account → **Sign in with publik** (`app/publik-sign-in.tsx`, the same screens with **Not now**). Nothing is counted before the sign-in. |

The flag is inlined by Metro at bundle time (`src/build-flags.ts`); nothing at
run time can change it. CI builds both (`ios-sim-app`, `ios-sim-app-optional`),
and a third simulator app built as the App Store build is built
(`ios-sim-app-store`, see CI below). Blind tests use `ios-sim-app-store`.

### What the gate does

1. loads this phone's `pk_` key, or mints one (`POST /api/v1/installs`). A
   key store that cannot be read counts as "no key" (a new key), never as a
   lockout;
2. reads `GET /api/v1/wallet` and shows **Sign in with publik** until
   `claim_state` is `claimed`. The button opens `claim_url` with `in_app=1`
   added (publik redirects it to its bare `/in-app/claim/<CODE>` page: no
   site navigation, no prices, no plan links) in an in-app
   browser sheet (`expo-web-browser`: SFSafariViewController on iOS, a Custom
   Tab on Android), never the Safari app. The gate checks `GET /wallet` every
   3 s while the app is in the foreground, for at most 10 minutes, and at once
   when the person comes back; the sheet closes when publik sees the sign-in.
   There is no other way past this screen;
3. asks once how Nut AI pays for AI: **Choose how to pay for AI** (**Get a
   plan** or **Use my own key**) or **Connect your plan** (**Connect your
   plan** or **Use my own key**). Only for an adult: the birth date from
   onboarding (`src/onboarding/adult.ts`); an unknown age counts as a minor,
   so the first start (before onboarding) never shows it, and the onboarding
   provider step offers publik API only to an adult. The answer is stored in
   `publik.install` (`choice`) and sets the app's `provider` setting;
4. starts usage counting: `app_opened`, then `active_session` every 30
   minutes while the app is in the foreground (`POST /api/v1/telemetry`,
   `Authorization: Bearer pk_...`). The timer stops in the background and on
   sign-out. Send and forget: no content, no health data, no name. Profile →
   publik account → **Count app use** turns it off. publik counts macos,
   windows and linux today, so it answers 400 to a phone's `os` until it
   counts phones.

What counts as "publik did not answer": no connection, no answer in 15 s, a
page that is not publik's JSON (a captive portal, a proxy), 408, 429 and 5xx.
Only a 401 **with publik's JSON error** forgets the key (then one new key; a
second 401 waits for **Retry**). A phone that signed in before opens offline
on that sign-in; a phone that never signed in shows **Retry**. Every write in
the gate is inside a `try`, so the gate never freezes: a failure is the Retry
screen.

### Profile → publik account

| Row | What it does |
|---|---|
| **Sign in with publik** | optional mode, not signed in: opens the gate screens |
| **Sign out** | confirm; the key is read into memory, the local copies are deleted, usage counting stops, and Sign in with publik shows again at once; the key is revoked in the background (best effort, 15 s; offline sign-out works) |
| **Delete account** | confirm (the publik account is for all publik apps); asks whether to delete the food log on this phone too; signs out as above; opens `https://publikhq.com/in-app/delete-account` in the in-app browser |
| **Count app use** | the usage counting switch |

Profile → AI provider keeps **Sign out of publik** and **Ask again at the next
start** (required mode). Keys live in SecureStore with
`WHEN_UNLOCKED_THIS_DEVICE_ONLY` (never in an iCloud backup), and
expo-secure-store's plugin (`configureAndroidBackup`) keeps them out of
Android Auto Backup.

### Consent before AI

Before the first call to an AI provider, the app asks **Send meal photos to
<provider>?** and names it (publik, Anthropic, OpenAI or Google;
`src/inference/ai-consent.ts`). One consent per provider: a photo or a
description never goes to a provider the person did not agree to.
**Not now** sends nothing.

App Store 5.1.2(i): the question names the company that gets the data. On
the publik path it names publik and publik's own list of companies, GET
/api/v1/wallet `ai_providers`, read each time the question shows (at most
4 s; else the list of the last wallet read): `publik (publikhq.com). publik
sends them to the AI provider that answers: OpenRouter, Amazon Web Services,
OpenAI or Google.` Without the field: `publik sends them to the AI provider
that answers.` with no company names. The list is never hard-coded
(`aiProvidersOf` in publik-core.ts, `publikProvidersSentence` in
ai-consent.ts, `publikAiProviders` in publik.ts). An own-key path names the
chosen provider only.

### Report a wrong result, How estimates work, Help and support

App Store 1.2 (AI content):

| Where | What |
|---|---|
| Every AI result: the scan result screen, the Describe exercise estimate | **Report a wrong result** (`app/report-result.tsx`): a short reason picker (Wrong food, Wrong amount, Wrong calories or nutrients, Something else), then publik's support page in the in-app sheet with `app`, `version`, `source` and `reason` only (`src/support.ts`). No photo and no meal data: the person adds them on that page only if they choose to. |
| Every AI result, Report a wrong result, Profile → Help | **How estimates work** (`app/how-estimates-work.tsx`): AI estimates can be wrong; how the numbers are made; you can correct every result; not medical advice. |
| Profile → Help | **Help and support**: publik's support page in the in-app sheet. |

### The publik pages the app opens

Every build opens publik pages only in the in-app browser sheet, and only
these bare in-app pages (no site navigation, no footer, no prices, no plan
links):

| Page | URL | Where |
|---|---|---|
| Sign in / claim | the server's `claim_url` + `in_app=1` (other query values kept) → `/in-app/claim/<CODE>` | the gate; the publik card and a 402 in optional mode (`inAppClaimUrl` in `src/inference/publik-core.ts`) |
| Privacy | `https://publikhq.com/in-app/privacy` | the publik disclosure (`PRIVACY_URL` in `src/inference/publik-copy.ts`) |
| Delete account | `https://publikhq.com/in-app/delete-account` | Profile → publik account (`PUBLIK_DELETE_ACCOUNT_URL`) |
| Support | `https://publikhq.com/in-app/support?app=nut-ai&version=<v>&source=<result\|exercise\|profile>[&reason=<id>]` | Profile → Help and support; Report a wrong result (`PUBLIK_SUPPORT_URL`, `supportUrl` in `src/support.ts`) |

With no claim link from publik, Sign in with publik opens nothing and asks
again. The purchase links below ("Get a plan", top-up) open the normal
site, and only where purchase links are allowed.

### No money in the app

Founder rule (Nov 14 2026): the app never shows how much money a person
spends — no amount, no price per scan (publik or own key), no balance in
dollars, no charges page, no amount in an error message (a gateway message
with one is replaced by the app's own words). AI use shows only as a
percent, with a bar, on the publik card (Profile → AI provider) and in
Profile under the AI provider row. The state is the TRUE one
(`planStatus`, publik-core.ts; blind test round 1, Nov 14 2026, B3/B5):

| GET /api/v1/wallet | State | The app shows |
|---|---|---|
| `plan.kind: "plan"`, `used_percent` (or `remaining_percent`), `resets_at` | plan | `62% of your plan used · resets Monday` and a bar of the percent used |
| until publik sends them: `week.used_micros` of `week.budget_micros`, `week.resets_at` | plan | the same line, computed |
| a plan with no percent | plan | `Plan active` (or `Plan limit reached`) |
| `plan.kind: "pack"`, or no plan with a balance left | prepaid | `40% of your prepaid balance left` and a bar of the percent left (`Prepaid balance active` with no percent, `Prepaid balance used up` at 0) |
| `plan.kind: "none"` and no balance | none | `No publik plan yet` |

The card's words follow the same state: `Your plan: <label>.`, `Your
prepaid pack: <label>.`, `You have a prepaid publik balance.`; never "Your
pack: publik." "Linked" is read once, by `publikClaimState` (the wallet's
claim state, else the install's), on the card and in Profile. After a
reinstall the publik key survives in the Keychain but the stored wallet does
not: the app keeps the sign-in and reads the wallet again at start
(`ensurePublikWallet`).

A 402 or a weekly limit shows "Limit reached": `Your publik plan limit is
reached. It resets Monday.`, then the storefront rule (US: a "Get a plan"
link; elsewhere `To get a plan, search for "publik" on Google.`) and a
"Use my own key" button. `planUse` (publik-core.ts) and `planUseLine` /
`planLimitMessage` (publik-copy.ts) hold the rule; `src/no-money.test.ts`
fails on any user-facing "$" followed by a digit, on the price phrases of
earlier versions ("list price", "Add a plan or pack", "Raise the cap", "of
free use"), and on any price word, purchase link or URL in a publik screen,
sentence or failure built with purchase links off (outside the US
storefront). The phone still keeps each scan's cost in its local scan log
(never shown).

### App Store build: `EXPO_PUBLIC_APP_STORE_BUILD`

On by default in an iOS release build. In an App Store build:

- **Purchase links only in the US storefront.** "Get a plan", the top-up
  link, "Link this phone & pick a plan" and the link of a 402 show only when StoreKit says the App Store storefront is the USA
  (`Storefront.current.countryCode`, read once per run by
  `modules/publik-launch`; `purchaseLinksFor` in
  `src/inference/publik-core.ts`). In every other storefront, and when the
  storefront cannot be read, there is no link, no button and no price: one
  plain sentence instead, `To get a plan, search for "publik" on Google.`
  "Connect your plan" and "Use my own key" show everywhere. A build that is
  not an App Store build (Android, dev, CI test builds) shows the links.
- **The gate is always required.** `EXPO_PUBLIC_PUBLIK_GATE_MODE=optional`
  is a CI test artifact only; an App Store build that asks for it fails.
- **No test hooks.** A build with `EXPO_PUBLIC_APP_STORE_BUILD` on and
  `PUBLIK_TEST_HOOKS=1` (or `EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1`) fails, on iOS
  and Android. CI test builds set `EXPO_PUBLIC_APP_STORE_BUILD=0`.

Claude subscription tokens (the **Claude CLI token** tab) work in a dev
build (Metro) only. Every other build, Android too, has no tab and refuses a
saved CLI token (Anthropic does not allow third-party apps to use Claude
subscription credentials). An Anthropic, OpenAI or Google API key works as
before.

### Name

`apps/mobile/app-identity.json`: `displayName` is **publik Nut AI**, the App
Store name and the name in every in-app text. `homeScreenName` (**Nut AI**)
is only the label under the icon, because iOS cuts a longer label. The
bundle id, slug and scheme do not change.

### Launch values (CI test-hooks builds only)

A phone app has no shell environment, so the module reads these from the
launch (`apps/mobile/modules/publik-launch`): on iOS an environment variable
(`SIMCTL_CHILD_<NAME>=... xcrun simctl launch`) or a launch argument
(`-<NAME> <value>`); on Android an intent extra
(`adb shell am start -n com.nutai.app/.MainActivity -e <NAME> <value>`).

They exist only in a **test-hooks build**: `PUBLIK_TEST_HOOKS=1` in the
environment of `pod install` (Swift compile condition) and Gradle
(`BuildConfig.PUBLIK_TEST_HOOKS`), and `EXPO_PUBLIC_PUBLIK_TEST_HOOKS=1` at
bundle time. A store build has neither: the native module reads no
environment, launch argument or intent extra, the JS side reads nothing, and
`EXPO_PUBLIC_PUBLIK_API_BASE_URL` is ignored outside a dev or test-hooks
build. No URL scheme or web page reaches them.

| Name | Effect |
|---|---|
| `PUBLIK_API_BASE_URL` | the whole module uses this publik (for example a local fake); its links open like publikhq.com's |
| `PUBLIK_SELF_TEST=1` | mint a key, `GET /wallet`, print `publik self-test: ok nut-ai <version>` on stdout, then the food database line `food-db self-test: ok <N> foods, <M> matches for egg (first: …)` (or `food-db self-test: failed: <why>`), exit |
| `DO_NOT_TRACK`, `PUBLIK_TELEMETRY=0` | no usage counting |
| `PUBLIK_TELEMETRY_DEBUG=1` | log each event and publik's answer |

The self-test on a simulator:

```sh
SIMCTL_CHILD_PUBLIK_SELF_TEST=1 xcrun simctl launch --console-pty booted com.nutai.app
```

### A release build needs the app token, from the build input only

A release build takes the app token ONLY from the build input
`PUBLIK_APP_TOKEN` (an environment variable of the native build).
`app.config.ts` puts it into `extra.publikAppToken`, and expo-constants
evaluates that file again at native build time (an Xcode build phase of
EXConstants, the Gradle task `createExpoConfig`), so the token of that
build's environment is the one in the app. The committed
`apps/mobile/publik-build.json` holds the placeholder; its token may serve a
dev build (Metro) only.

`plugins/withPublikTokenCheck.js` ("Check publik build settings" on iOS,
`preBuild` / `preReleaseBuild` on Android) stops:

1. a release build with no `PUBLIK_APP_TOKEN` (or the placeholder);
2. an App Store build with the test hooks;
3. an App Store build with the optional gate.

`src/publik-token-check.test.ts` runs the iOS script; the CI Android jobs
prove the Gradle checks fail. The checks never print the token.

### CI

`.github/workflows/mobile-build.yml` runs the unit tests and the typecheck,
then builds `ios-sim-app` (required mode) and `ios-sim-app-optional` (NutAI.app
for the simulator, arm64, no certificate: only the ad-hoc signature that the
simulator keychain needs) and `android-debug-apk` (the release variant,
debuggable, signed with the debug key, cleartext allowed). These three are
test-hooks builds with `EXPO_PUBLIC_APP_STORE_BUILD=0`.

`ios-sim-app-store` is the same simulator app built with the App Store
flags: `EXPO_PUBLIC_APP_STORE_BUILD=1`, the required gate, the test hooks
OFF, the app token from the secret. **Blind tests use this artifact.** A
test-hooks build is not an App Store build: it shows purchase links (blind
test round 1, Nov 14 2026: the tester used `ios-sim-app` and saw "Get a
plan"). In a store build, purchase links stay off until StoreKit reports
the US storefront; on an unknown or non-US storefront the only words are
`To get a plan, search for "publik" on Google.` It has no self-test (no
hooks); CI installs it on a simulator and checks that it still runs 25
seconds after launch.

A further job, `android-release-check`, makes a release build with the test
hooks off and uploads nothing.

Every app build bundles the food database. `apps/mobile/assets/nutrition.db`
is not in git: each build job runs `npm run data:build` (cached by the hash
of `tools/nutrition-data/src/**` and the schema) and checks that it has
foods and that "egg" matches. The app's bundle fails without the file (the
`require` in `src/db/expo-adapter.ts` is not optional any more). Blind test
round 1 (B2): CI never built it, so the Food Database was empty in every
CI build. The iOS jobs check that the database is inside the app, and the
self-test of the test-hooks builds searches it for "egg" in the built app.
The Android jobs check that it is inside the APK. **Any other workflow that
builds the app (for example `appstore-upload.yml`) must also run `npm run
data:build` after `npm ci`, or its bundle step fails.** The native build steps get the app token from the repo
secret `PUBLIK_APP_TOKEN` as the build input; nothing prints it. The iOS
jobs print the App Store settings of the built app (version, build number,
iPhone only, encryption, no Face ID string, privacy manifest) and check that
the app config inside the app has a token from the build input, then run
the self-test on a simulator. The Android jobs check the build rules, the
backup rules of the merged manifest, and the token in the APK's app config.

## The one value a build needs

The app token is the build input `PUBLIK_APP_TOKEN` (above).
`apps/mobile/publik-build.json` ships in the repo with the placeholder and
the other settings:

```json
{
  "appToken": "pat_nut-ai_REPLACE_ME",
  "appSlug": "nut-ai",
  "baseUrl": "https://publikhq.com/api/v1",
  "disclosureVersion": 1,
  "models": { "scan": "publik-fast", "text": "publik-fast" }
}
```

The app token is a **public app token**, not a credential. It names this
app to publikhq.com so an install can mint its own `pk_live_` key; it can
read nothing, spend nothing, and attribute nothing to anyone but Nut AI. It
ships inside every phone build. It is not committed: release builds take it
from the build input, so the token in a build is the one the builder chose.

A build with no token (the placeholder) behaves as if publik API did not
exist: no publik card in onboarding, no publik chip in settings, the vendor
picker is the whole screen. A release build with no token does not build.

### Filling it (publik side, once)

1. On the publik repo: `scripts/mint-app-token.mts nut-ai` (service role from
   `.env.local`). It prints the `pat_nut-ai_<32 base36>` value once.
2. Store it as the repo secret `PUBLIK_APP_TOKEN` (CI), or set it in the
   environment of a local release build. Never commit it.

A test (`apps/mobile/src/inference/publik-build.test.ts`) pins the
placeholder in this file and refuses any real `pk_`/`sk-` key or minted
`pat_nut-ai_` token anywhere under `apps/mobile` or `packages`.

## Models

Nut AI sends publik's tier aliases, never a vendor slug: `models.scan`
(default `publik-fast`) for anything with an image, `models.text` (default
`publik-fast`) for text-only calls. A user can also pick the model in
Profile → AI provider; `publik-smart` appears there only once the phone is
linked to a publik account (anonymous keys cannot use it).

Which tier a phone uses (`publikScanModel` in
`apps/mobile/src/inference/publik-core.ts`):

1. A tier tapped in Profile, stored as the `publik_model_pick` setting. Only
   that tap writes it.
2. Else a publik tier in the old `provider_model` setting, except
   `publik-balanced`. Builds up to 71ee482 wrote `publik-balanced` there by
   themselves when the phone connected, so that value is the old default,
   not a choice. A phone built at 71ee482 and rebuilt now moves to the
   fast tier; before this rule it kept the reasoning tier (72 s and $0.067
   for one plate, Nov 1 2026).
3. Else `models.scan` from `publik-build.json`.

Connecting publik (onboarding or Profile) writes no model, so a later change
of `models.scan` reaches every phone that did not pick one.

Why scans default to the fast tier (measured against the live gateway on
Nov 1 2026, with the app's own request bytes):

| tier | model behind it | one plate photo | charge | result |
|---|---|---|---|---|
| `publik-balanced` | a reasoning model | 53-113 s | $0.04-0.058 | hit the 4,096 cap on a busy plate; the app's old 45 s timeout gave up first, and the gateway still settled the charge |
| `publik-fast` | a non-reasoning model | ~10 s | ~$0.003-0.004 | `finish_reason: stop`, payload passes `validatePayload()` |

The listing says about $0.01 per use; only the fast tier makes that true.
The app also asks for `reasoning_effort: "low"` on publik mode (the tiers
default a reasoning model to "medium", whose thinking counts inside
`max_tokens`), sends `max_tokens` 8,192 for a scan, 2,048 for a label and
4,096 for a lookup, waits 240 s for a scan and 90 s for the smaller calls,
and names a `finish_reason: "length"` answer whose JSON does not parse as a
billed, cut-short call instead of "unexpected shape". A capped answer whose
JSON is complete (the gateway shrinks the cap to fit a low balance) is used.

The Responses `web_search` tool is **not** sent on publik mode (its surcharge
is not metered on the gateway yet): the branded-food lookup runs the same
instruction on Chat Completions without a tool, and the model is told to
answer `found: false` rather than guess. With a user's own OpenAI key the
tool is used exactly as before.

## Dev override

`EXPO_PUBLIC_PUBLIK_API_BASE_URL=https://<preview>/api/v1 npm run prebuild`
points a dev build at a preview gateway (Metro inlines `EXPO_PUBLIC_*` at
bundle time). `PUBLIK_API_BASE_URL` at launch (above) wins over it. There is deliberately no env override for the token: it is a
file so an Xcode GUI build, which does not inherit the shell, cannot silently
differ from a CLI build.

## What the phone stores

| What | Where | In a backup? |
|---|---|---|
| `pk_live_` key | SecureStore `key.publik` / `kind.publik`, beside the vendor keys | never |
| install identity (`install_id`, claim link, claim state, the gate's `choice`) | SecureStore `publik.install` | never |
| usage-counting ID (a random UUID, telemetry only) | kv-store `publik.telemetry_install_id` | never |
| wallet snapshot (balance, week, links) | kv-store `publik.wallet` | never |
| the choice of publik (`settings.provider = 'publik'`) | `settings` table | yes — a restore remembers the choice and mints a fresh install on Connect |
| the disclosure consent | `consents` table (`publik.disclosure`) | yes |

Profile → Start over revokes the phone's key on the server (best effort),
forgets all of it, and shows Sign in with publik again.
