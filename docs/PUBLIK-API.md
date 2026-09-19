# publik API in Nut AI

Photo scans, label and receipt transcription, the branded-food lookup and the
"describe a workout" estimate all need an AI model. By default they run on
**publik API** (`https://publikhq.com/api/v1`): the phone mints its own
bounded key on first run, after the user accepts a two-part disclosure, and
every call is metered at 50% of the model's published list price against a
publik balance that starts with $0.25 free. A user who prefers their own
Anthropic, OpenAI or Google key still gets the neutral vendor picker; a
user-entered key always wins and publik code never touches the vendor slots.

## The one value a build needs

`apps/mobile/publik-build.json` ships in the repo:

```json
{
  "appToken": "pat_nut-ai_REPLACE_ME",
  "appSlug": "nut-ai",
  "baseUrl": "https://publikhq.com/api/v1",
  "disclosureVersion": 1,
  "models": { "scan": "publik-balanced", "text": "publik-fast" }
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
(default `publik-balanced`) for anything with an image, `models.text`
(default `publik-fast`) for text-only calls. Vision on the fast tier is not
verified yet — once it is, flipping `models.scan` to `publik-fast` is the
whole change. A user can also pick the model in Profile → AI provider;
`publik-smart` appears there only once the phone is linked to a publik
account (anonymous keys cannot use it).

The Responses `web_search` tool is **not** sent on publik mode (its surcharge
is not metered on the gateway yet): the branded-food lookup runs the same
instruction on Chat Completions without a tool, and the model is told to
answer `found: false` rather than guess. With a user's own OpenAI key the
tool is used exactly as before.

## Dev override

`EXPO_PUBLIC_PUBLIK_API_BASE_URL=https://<preview>/api/v1 npm run prebuild`
points a dev build at a preview gateway (Metro inlines `EXPO_PUBLIC_*` at
bundle time). There is deliberately no env override for the token: it is a
file so an Xcode GUI build, which does not inherit the shell, cannot silently
differ from a CLI build.

## What the phone stores

| What | Where | In a backup? |
|---|---|---|
| `pk_live_` key | SecureStore `key.publik` / `kind.publik`, beside the vendor keys | never |
| install identity (`install_id`, claim link, claim state) | SecureStore `publik.install` | never |
| wallet snapshot (balance, week, links) | kv-store `publik.wallet` | never |
| the choice of publik (`settings.provider = 'publik'`) | `settings` table | yes — a restore remembers the choice and mints a fresh install on Connect |
| the disclosure consent | `consents` table (`publik.disclosure`) | yes |

Profile → Start over revokes the phone's key on the server (best effort) and
forgets all of it.
