# Meta App Review — DukAI

Internal runbook for submitting DukAI's production Meta app for **Advanced Access** and switching to **Live** mode.

**Legal entity:** Nextverse Solutions Limited (Nairobi, Kenya) — operates the DukAI platform.

## Business Verification (required before Advanced Access)

Meta Business Verification must pass under **Nextverse Solutions Limited** before App Review is likely to approve.

1. **Business Manager → Settings → Business info** — legal name exactly `Nextverse Solutions Limited`, website `https://dukai.app`.
2. **Website must list the legal entity** — confirm on live site (Ctrl+F on `/`, `/privacy_policy`, `/terms` for `Nextverse Solutions Limited`).
3. **Security Center → Business verification** — upload Kenya incorporation + address proof; resubmit after site update.
4. **Data handling questions** — data controller: **Nextverse Solutions Limited**, country: **Kenya**.
5. **Do not request** legacy Facebook Login permissions (`instagram_basic`, `instagram_manage_messages`) — DukAI uses Instagram Login (`instagram_business_*` only).

## Prerequisites checklist

### Meta Developer Console (production app)

| Setting | URL |
|---------|-----|
| App domain | `dukai.app` |
| Privacy Policy | `https://dukai.app/privacy_policy` |
| Terms of Service | `https://dukai.app/terms` |
| Data deletion instructions | `https://dukai.app/data-deletion` |
| Data deletion callback | `https://dukai.app/api/v1/meta/data-deletion` |
| OAuth redirect URI | `https://dukai.app/instagram/callback` |
| Deauthorize callback | `https://dukai.app/webhooks/meta/deauthorize` |
| Instagram webhook | `https://dukai.app/webhooks/instagram` |
| Webhook fields | `messages`, `messaging_postbacks`, `comments` |

### Production environment

```bash
INSTAGRAM_FAKE_MESSAGING=false
INSTAGRAM_SHOW_SIMULATE_DM=false
INSTAGRAM_APP_ID=<Instagram product app id>
INSTAGRAM_APP_SECRET=<secret>
META_APP_SECRET=<secret>
META_WEBHOOK_VERIFY_TOKEN=<random token>
INSTAGRAM_HUB_URL=https://dukai.app
DUKAI_PLATFORM=merchant
INSTAGRAM_REDIRECT_URI=https://dukai.app/instagram/callback
OAUTH_ALLOWED_RETURN_ORIGINS=https://merchants.dukai.app,https://uat.dukai.app
```

Run migration before deploy:

```bash
python backend/migrations/2026_06_21_160000_data_deletion_requests.py
```

## Pre-submission validation

Run on the target host:

```bash
cd backend && source .venv/bin/activate
python scripts/meta_app_review_check.py
```

Manual checks on `https://dukai.app`:

1. **Legal pages** — `/privacy_policy`, `/terms`, `/data-deletion` load over HTTPS and mention **Nextverse Solutions Limited**
2. **OAuth** — Log in with Instagram → Settings shows connected account
3. **Onboarding** — `GET /api/v1/onboarding` returns 6/6 checks passed
4. **Webhook** — Meta console → Instagram webhooks → "Send to My Server" → row in `webhook_events`
5. **DM round-trip** — Tester sends DM → appears in Messages → reply delivers
6. **Data deletion callback** — Meta console test tool or remove app as tester → callback returns `confirmation_code`

## Permissions to request (Advanced Access)

| Permission | Feature in DukAI |
|------------|------------------|
| `instagram_business_basic` | Instagram Login, profile in Settings |
| `instagram_business_manage_messages` | Inbox, webhooks, auto-replies, DM agent |
| `instagram_business_manage_comments` | Feeds comment management |
| `instagram_business_manage_insights` | Post/account insights in Feeds |
| `instagram_business_content_publish` | Compose and publish posts from Feeds |

## Screencast recording guide

Record each permission separately (1080p, with audio narration). Show the **production** app URL (`dukai.app`).

### `instagram_business_basic`

1. Open login page → click Log in with Instagram
2. Complete OAuth consent (show all permissions)
3. Land on Settings → show username and account type

### `instagram_business_manage_messages`

1. From a second Instagram tester account, send a DM to the connected business account
2. Show webhook delivery (optional: Meta test event)
3. Open DukAI Messages → show inbound thread
4. Send a manual reply → show delivery in Instagram app

### `instagram_business_manage_comments`

1. Link products to a feed post in DukAI Feeds
2. From a tester account, comment on that Instagram post (e.g. "How much is the spray?")
3. Show DukAI AI public reply under the comment with product options/prices
4. Show Feeds → post detail with linked products

### `instagram_business_manage_insights`

1. Open Feeds → show insights/metrics on a post or account view

### `instagram_business_content_publish`

1. Open Feeds → Compose → upload image, caption → Publish
2. Confirm post appears on Instagram

## Written justification template

Use for each permission in App Review:

> DukAI is an Instagram commerce platform for Kenyan merchants. We use **[permission]** to **[specific feature]**. Data is stored on our servers only to provide this feature to the merchant who connected their account. We do not sell or share inbox data with third parties for marketing. Users can revoke access via Instagram Website permissions, disconnect in Settings, or our data deletion endpoint at https://dukai.app/data-deletion.

## Test credentials for reviewers

Provide in the App Review submission:

- **Option A:** DukAI merchant email/password for a pre-connected test shop
- **Option B:** Steps to connect an Instagram tester account you add under Meta → Roles → Instagram Testers

Suggested steps text:

```
1. Log in at https://dukai.app/sign-in
2. Connect Instagram (Business/Creator account required)
3. Complete onboarding checklist at /onboarding
4. Open Messages to view inbox; send a test DM from a second tester account
```

## After approval

1. App Dashboard → switch app to **Live**
2. App Review → Permissions → confirm **Advanced Access** on all 5 scopes
3. Verify `INSTAGRAM_FAKE_MESSAGING=false` in production
4. Disable simulate-DM UI: `INSTAGRAM_SHOW_SIMULATE_DM=false`
5. Monitor `webhook_events` for failed processing

## UAT vs production

See `.env` at the repo root (UAT and prod hosts each have their own `.env` / Meta app).
