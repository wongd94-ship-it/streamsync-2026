# Refreshing the Support-Chat Knowledge Blocks

The StreamSync AI Support chat answers setup + troubleshooting questions
using two static knowledge files:

- `functions/src/throneSupportKnowledge.ts` — distilled from
  https://support.thronescience.com
- `functions/src/appleHealthKnowledge.ts` — distilled from
  https://support.apple.com (Apple Watch + Health app articles)

Both files are imported by `functions/src/supportChat.ts` and embedded in
the system prompt sent to Claude on every chat turn. They are **not**
auto-fetched per turn — they're pre-distilled so each Anthropic call stays
fast and cheap. When Throne or Apple updates an article, these go stale.

## When to refresh

- **Quarterly** as a baseline, both files at once.
- **Whenever a participant in a support chat reports steps that don't match
  reality** — that's the canary.
- **Before each new study cohort starts** so onboarding troubleshooting is
  current.
- **When iOS or watchOS ships a major version** — Apple often re-shuffles
  Settings paths, which breaks step-by-step instructions in the Apple
  knowledge file.

## Refresh procedure

This is intentionally a manual / Claude-Code-driven workflow rather than a
scheduled cron job. Distilling vendor prose into a tight, factually-correct
knowledge block requires editorial judgment that a bare scraper does
poorly. The cost is ~30 minutes once a quarter; the alternative is a dozen
wrong answers in real chats.

### To refresh BOTH files in one pass

Spin up Claude Code in this repo and ask:

> Refresh `functions/src/throneSupportKnowledge.ts` and
> `functions/src/appleHealthKnowledge.ts` from their respective vendor
> support sites. For Throne: visit Getting Started, Your Throne Device,
> and Troubleshooting collections at https://support.thronescience.com.
> For Apple: re-fetch each URL listed at the bottom of
> `functions/src/appleHealthKnowledge.ts`. Bump
> `THRONE_KNOWLEDGE_REFRESHED_ON` and `APPLE_KNOWLEDGE_REFRESHED_ON` to
> today's date. Diff against the previous version and tell me what
> changed in plain English.

Claude Code will fetch each article (it's done both before — the
conversation history that produced v1 of these files is the template),
then propose edits.

### To refresh just ONE file

Substitute "and `<the-other-file>`" out of the prompt above, and limit the
URLs accordingly.

### Manual review of the diff

**Always review.** Watch especially for:

- Steps that changed order (rare but happens).
- LED color / pattern changes (Throne One has had hardware revisions).
- Apple's Settings paths shifting between iOS versions.
- Pairing precondition changes (Wi-Fi band, app version requirements).
- New articles appearing in Throne's Troubleshooting collection — add if
  relevant.
- Apple deprecating an article URL. They redirect, but the URL change is
  worth catching so the citation in the prompt isn't stale.

### Deploy

```bash
cd functions && npm run build
cd .. && firebase deploy --only functions:claudeSupportChat \
  --project streamsync-8ae79
```

### Smoke-test on the iOS app

Open the support chat and ask one question per refreshed knowledge block:

- *"How do I pair my Throne for the first time?"* — verifies Throne block
- *"My Apple Watch isn't syncing — what should I do?"* — verifies Apple
  block
- *"How do I update my Apple Watch?"* — verifies the Apple block's
  watchOS-update procedure (this is a frequent answer that gets
  user-Settings-paths wrong if stale)

If any answer is off, edit the relevant knowledge file directly and
redeploy.

## Why static blocks instead of live fetch?

Considered. Trade-offs:

| Approach | Latency | Cost | Accuracy | Complexity |
|---|---|---|---|---|
| Static block (current) | 0ms | Tokens billed once per turn | Stale between refreshes | Low |
| Tool-use fetch on demand | +1–2 sec | +HTML→tokens per relevant turn | Always current | High |
| Scheduled scrape into Firestore | 0ms | One Firestore read per turn | Mostly current (cron lag) | Medium |

Static block is right until we have empirical evidence that participants
are getting wrong answers. At that point the right move is to add a
vendor-fetcher tool and let Claude consult it when uncertain — not replace
the static block wholesale.

## Source articles

### Throne (`throneSupportKnowledge.ts`)

| Section | Article |
|---|---|
| Account creation | https://support.thronescience.com/en/articles/12774385-how-to-create-a-throne-account |
| Pairing | https://support.thronescience.com/en/articles/12813831-step-1-connect-your-throne |
| Bluetooth troubleshooting | https://support.thronescience.com/en/articles/12986974-troubleshooting-bluetooth-connection-issues |
| Factory reset | https://support.thronescience.com/en/articles/13317491-how-to-reset-your-throne-device |
| LED indicators | https://support.thronescience.com/en/articles/12884998-understanding-throne-one-led-indicators |
| Hands-free mode | https://support.thronescience.com/en/articles/12814840-step-3-use-throne-hands-free |
| Notification settings | https://support.thronescience.com/en/articles/12815325-how-to-adjust-your-throne-device-notification-settings |
| Deleting a session | https://support.thronescience.com/en/articles/12986957-how-to-delete-a-session-in-the-throne-app |

### Apple (`appleHealthKnowledge.ts`)

| Section | Article |
|---|---|
| Watch–iPhone connection troubleshooting | https://support.apple.com/en-us/108360 |
| Re-pairing trouble / Watch reset | https://support.apple.com/en-us/111821 |
| Updating watchOS | https://support.apple.com/en-us/108926 |
| Health-app permissions, Apple Watch fitness tracking | https://support.apple.com/en-us/108779 |
| Heart-rate accuracy / Watch fit / wrist detection | https://support.apple.com/en-us/105002 |
| Health Records privacy + security | https://support.apple.com/en-us/111755 |
| Health Records prerequisites | https://support.apple.com/guide/healthregister/prerequisites-apd37a16fe14/web |
| Participating institution directory | https://institutions.healthrecords.apple.com |

If a new article appears that's relevant to a participant's Watch / Health
issue, pull it in too.
