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

Nut AI opens with **Sign in with publik**, like every app on publik. The gate
is the publik module in `apps/mobile/src/inference/publik-core.ts`
(`ensureSignedIn`, the same screens, words and endpoints as publikhq.com's
`sdk/publik.ts.md`). `apps/mobile/src/inference/publik.ts` gives it the phone
(`runPublikGate`), and `apps/mobile/src/components/PublikGate.tsx` draws its
screens. `app/_layout.tsx` wraps the whole app in `PublikGate`, so no tab, no
onboarding step and no database read happens before the gate passes.

At each start the gate:

1. loads this phone's `pk_` key, or mints one (`POST /api/v1/installs`);
2. reads `GET /api/v1/wallet` and shows **Sign in with publik** until
   `claim_state` is `claimed`. The button opens `claim_url` in the system
   browser. The gate checks `GET /wallet` every 3 s while the app is in the
   foreground, for at most 10 minutes, and at once when the person comes back
   from the browser. There is no other way past this screen. With no
   connection: "publik is not reachable. Check your connection." and
   **Retry**;
3. asks once how Nut AI pays for AI: **Choose how to pay for AI** (no plan,
   no balance: **Get a plan** or **Use my own key**) or **Connect your plan**
   (**Connect your plan** or **Use my own key**). The answer is stored in
   `publik.install` (`choice`) and sets the app's `provider` setting:
   `publik`, or the person's own key (the vendor picker, exactly as before);
4. starts usage counting: `app_opened`, then `active_session` every 30
   minutes (`POST /api/v1/telemetry`, `Authorization: Bearer pk_...`). Send
   and forget: no content, no health data, no name. `DO_NOT_TRACK=1` or
   `PUBLIK_TELEMETRY=0` turns it off. publik counts macos, windows and linux
   today, so it answers 400 to a phone's `os` until it counts phones.

Profile → AI provider has **Sign out of publik** (revoke the key, then the
gate again) and **Ask again at the next start** (clears the choice). Picking
publik or saving an own key there also stores the choice. A revoked key (401)
is forgotten and minted again once.

Offline: the gate needs publik once per start. Without a connection it shows
the Retry screen; nothing of the app opens until publik answers.

### Launch values (tests only)

A phone app has no shell environment, so the module reads these from the
launch (`apps/mobile/modules/publik-launch`): on iOS an environment variable
(`SIMCTL_CHILD_<NAME>=... xcrun simctl launch`) or a launch argument
(`-<NAME> <value>`); on Android an intent extra
(`adb shell am start -n com.nutai.app/.MainActivity -e <NAME> <value>`), read
only by a debuggable build such as the CI test APK.

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

### CI

`.github/workflows/mobile-build.yml` runs the unit tests and the typecheck,
then builds `ios-sim-app` (NutAI.app for the simulator, arm64, no
certificate: only the ad-hoc signature that the simulator keychain needs) and
`android-debug-apk` (the release variant, debuggable, signed with the debug
key, cleartext allowed). Both builds take the app token from the repo secret
`PUBLIK_APP_TOKEN` (`.github/scripts/publik-build-token.mjs`, which never
prints it). The iOS job runs the self-test on a simulator.

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
