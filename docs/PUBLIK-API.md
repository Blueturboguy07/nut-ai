# publik API in Nut AI

Photo scans, label and receipt transcription, the branded-food lookup and the
"describe a workout" estimate all need an AI model. By default they run on
**publik API** (`https://publikhq.com/api/v1`): the phone mints its own
bounded key at the first start (Sign in with publik, below), and
every call is metered at 50% of the model's published list price against a
publik balance. A new install starts at $0.00 (publik migration 0059), and
every metered call answers 402 `insufficient_credit` until the phone is linked
to a publik account, a plan or pack is added, or the user pastes their own
key. Linking gives $0.05 of free use, once per publik account; it is the only
free use publik API gives. A user who prefers their own
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
run time can change it. CI builds both (`ios-sim-app`, `ios-sim-app-optional`).

### What the gate does

1. loads this phone's `pk_` key, or mints one (`POST /api/v1/installs`). A
   key store that cannot be read counts as "no key" (a new key), never as a
   lockout;
2. reads `GET /api/v1/wallet` and shows **Sign in with publik** until
   `claim_state` is `claimed`. The button opens `claim_url` in an in-app
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
| **Sign out** | confirm; the key is read into memory, the local copies are deleted, usage counting stops, then the key is revoked (best effort, 15 s) |
| **Delete account** | confirm (the publik account is for all publik apps); asks whether to delete the food log on this phone too; signs out as above; opens `https://publikhq.com/settings/profile#delete-account-title` in the in-app browser |
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

### App Store build: `EXPO_PUBLIC_APP_STORE_BUILD`

On by default in an iOS release build. It removes the **Claude CLI token**
tab and refuses a saved CLI token (Anthropic does not allow third-party apps
to use Claude subscription credentials). An Anthropic, OpenAI or Google API
key works as before. Set `EXPO_PUBLIC_APP_STORE_BUILD=0` to keep the tab in
a build that is not for the App Store.

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
| `PUBLIK_SELF_TEST=1` | mint a key, `GET /wallet`, print `publik self-test: ok nut-ai <version>` on stdout, exit |
| `DO_NOT_TRACK`, `PUBLIK_TELEMETRY=0` | no usage counting |
| `PUBLIK_TELEMETRY_DEBUG=1` | log each event and publik's answer |

The self-test on a simulator:

```sh
SIMCTL_CHILD_PUBLIK_SELF_TEST=1 xcrun simctl launch --console-pty booted com.nutai.app
```

### A release build needs the app token

`plugins/withPublikTokenCheck.js` stops a release build that has no `pat_`
token in `apps/mobile/publik-build.json` (or still has the placeholder): an
Xcode build phase for the Release configuration, and a check before
`preReleaseBuild` on Android. `src/publik-token-check.test.ts` runs the iOS
script; the CI Android job proves the Gradle check fails with no token.

### CI

`.github/workflows/mobile-build.yml` runs the unit tests and the typecheck,
then builds `ios-sim-app` (required mode) and `ios-sim-app-optional` (NutAI.app
for the simulator, arm64, no certificate: only the ad-hoc signature that the
simulator keychain needs) and `android-debug-apk` (the release variant,
debuggable, signed with the debug key, cleartext allowed). All three are
test-hooks builds. They take the app token from the repo secret
`PUBLIK_APP_TOKEN` (`.github/scripts/publik-build-token.mjs`, which never
prints it). The iOS jobs print the App Store settings of the built app
(version, build number, iPhone only, encryption, privacy manifest) and run the
self-test on a simulator. The Android job prints the backup rules of the
merged manifest.

## The one value a build needs

`apps/mobile/publik-build.json` ships in the repo:

```json
{
  "appToken": "pat_nut-ai_REPLACE_ME",
  "appSlug": "nut-ai",
  "baseUrl": "https://publikhq.com/api/v1",
  "disclosureVersion": 1,
  "models": { "scan": "publik-fast", "text": "publik-fast" }
}
```

`appToken` is a **public app token**, not a credential. It names this app to
publikhq.com so an install can mint its own `pk_live_` key; it can read
nothing, spend nothing, and attribute nothing to anyone but Nut AI. It ships
inside every phone build, and every phone build is compiled from this public
repository, so committing it exposes nothing a build does not (the same
exposure as any packaged binary). Rotating it is a commit.

While the value is the placeholder `pat_nut-ai_REPLACE_ME`, the app behaves
as if publik API did not exist: no publik card in onboarding, no publik chip
in settings, the vendor picker is the whole screen.

### Filling it (publik side, once)

1. On the publik repo: `scripts/mint-app-token.mts nut-ai` (service role from
   `.env.local`). It prints the `pat_nut-ai_<32 base36>` value once.
2. Paste it as `appToken` in `apps/mobile/publik-build.json`, commit, push.
3. Bump the publik install guide's pinned SHA (`~/publik/lib/guides/nut-ai.ts`)
   to that commit. Phones built from the pinned commit provision against the
   new token; the old token stays valid 90 days.

A test (`apps/mobile/src/inference/publik-build.test.ts`) pins the shape of
this file and refuses any real `pk_`/`sk-` key anywhere under `apps/mobile`
or `packages`.

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
