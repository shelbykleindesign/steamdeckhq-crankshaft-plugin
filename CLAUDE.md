# CLAUDE.md — Sport:80 ↔ Shopify Integration

This file orients Claude (and any human) working in this repo. Read it first.

> **Heads up on this repo:** Its history contains an unrelated project — the
> "SDHQ Ratings Indicator" Steam Deck *Crankshaft* plugin. That code is **not**
> part of this integration and can be ignored. The plan is to move this work
> into a **new, dedicated repository** (see "Repo migration" below). Until then,
> the Shopify app lives in its own subfolder and does not touch the old files.

---

## 1. What we're building (plain English)

We run the **USA Archery** store on **Shopify** (`shop.usarchery.org`). Our
members live in **Sport:80** (a sports membership / event-management platform;
our tenant is `usarchery.sport80.com`). We want the two to talk to each other
so that:

1. **SSO login** — a customer can sign in to our Shopify store using their
   **Sport:80 username and password**, instead of creating a separate account.
2. **Membership gating** — once we know who someone is in Sport:80 and whether
   their membership is active, we unlock **member-only discounts, pricing, or
   products** in the store.

Both features stand on the **same foundation**: *authenticate a person against
Sport:80, figure out their membership status, and connect that to a Shopify
customer record.* We build that foundation first; it makes both features
possible.

### Who this is for
The primary maintainer is **new to Shopify development**. Code, docs, and issues
should be written to teach as much as to ship. Prefer:
- Small, well-explained steps over clever one-liners.
- Comments that say *why*, and links to the relevant Shopify/Sport:80 docs.
- Calling out jargon the first time it appears (see the Glossary).

---

## 2. The hard truths (constraints that shape everything)

Read these before proposing an architecture. They are the reason the project is
phased the way it is.

| Constraint | What it means for us |
|---|---|
| **Shopify has no "plugins" — it has "Apps."** | We are building a Shopify *App*. There is no plugin format. See Glossary. |
| **Native "log in with your own provider" is Shopify Plus–only.** | Shopify's built-in external-identity-provider (IdP) login uses **OIDC** and requires the **Shopify Plus** plan. **Multipass** (the other native SSO shortcut) is also **Plus-only**. |
| **Sport:80 SSO is SAML, not OIDC.** | Even on Plus, Sport:80's identity system speaks **SAML**, while Shopify's native customer-account IdP wants **OIDC**. That protocol gap means a **bridge/broker** is required — they don't connect directly. |
| **Sport:80 *does* expose a documented REST API for our org.** | USA Archery's tenant publishes API docs at **`https://usarchery.sport80.com/api/doc`** (login-gated; automated fetches get 403). Access is **token-based** — the old API passes the token as an `access_token` query param (see `docs/sport80.md`). Issue #1 (the "spike") is: *get/obtain a token, read the doc, and confirm the auth scheme + the login and membership endpoints.* Ongoing API findings live in **`docs/sport80.md`**. |
| **We have a live store, so the plan is checkable.** | The store is `shop.usarchery.org`. Confirm its plan (Shopify admin → Settings → Plan) to pick the SSO branch. **Never develop against the live store** — build on a free development store, install on production only when ready. |

### Because of the above, the SSO story has two branches:
- **If the store is Shopify Plus:** Shopify → our small **OIDC broker** → Sport:80.
  The broker presents an OIDC face to Shopify and authenticates users against
  Sport:80's API/SAML behind the scenes.
- **If the store is *not* Plus:** native customer-account SSO isn't available.
  We provide login through **our app** (an app-proxy / theme-extension login
  form that checks Sport:80 credentials and maps the person to a Shopify
  customer). This is more custom but works on any plan.

We will not know which branch applies until we confirm the plan. **Data sync +
membership tagging (Phase 1) is identical in both branches**, so we build that
first and defer the branch decision.

---

## 3. Recommended tech stack

Chosen for the best-documented, most beginner-friendly path. Don't deviate
without a note in an issue.

- **Shopify App template: Remix** (`shopify app init`) — the official default,
  React-based, best docs.
- **Language: TypeScript.**
- **Backend runtime: Node.js.**
- **Tooling: Shopify CLI** (`shopify app dev` gives a live tunnel + install URL).
- **Database: Prisma + SQLite** for dev (the template default); a hosted
  Postgres later for production.
- **Hosting (later):** Fly.io / Render / Railway / Vercel — decide in Phase 3.
- **Membership gating:** Shopify **customer tags** (e.g. `sport80-active`) plus
  **Shopify Functions** (for discounts) and/or a **theme app extension** (to
  show/hide member content).

> Nothing above is installed yet. Phase 0, issue #2 scaffolds it.

---

## 4. Roadmap (phases → issues)

Work top-to-bottom. Each phase is small and reviewable. GitHub issues track the
detail; this is the map.

- **Phase 0 — Foundations**
  - Get Sport:80 API access + read `usarchery.sport80.com/api/doc`; confirm the
    login/user endpoints and auth scheme (the *spike*). ← **start here**
  - Scaffold the Shopify Remix app + local dev.
  - Confirm the store's Shopify plan (`shop.usarchery.org` → Settings → Plan).
- **Phase 1 — The backbone: authenticate + sync + tag**
  - Sport:80 API client (login, fetch member/status).
  - Map a Sport:80 member → a Shopify customer (create/update via Admin API).
  - Tag customers with membership status (e.g. `sport80-active`).
- **Phase 2 — Membership gating**
  - Member-only discount via Shopify Functions.
  - Show/hide member content via a theme app extension.
- **Phase 3 — SSO login**
  - Decide the branch (Plus/OIDC broker vs app-based login) from the plan.
  - Implement the chosen login flow on top of the Phase 1 backbone.
- **Phase 4 — Hardening**
  - Secrets handling, error/retry, logging, tests, deploy, docs.

---

## 5. Repo migration (planned)

This work will move to a **new dedicated repository**. Until then:
- Keep all new code under a dedicated subfolder (e.g. `shopify-app/`).
- Do **not** modify or depend on the old Steam Deck plugin files.
- When the new repo exists, move `shopify-app/` + this `CLAUDE.md` + the issues
  over, and archive/leave the old plugin here.

---

## 6. Working agreements

- **Branch:** develop on `claude/shopify-sport80-integration-fr9we4` (current).
- **Secrets:** never commit API keys, Sport:80 credentials, or Shopify tokens.
  Use `.env` (git-ignored) and document required vars in the app's README.
- **Small PRs:** one issue → one focused change where possible.
- **Explain as you go:** update this file and issue threads when a decision is
  made, so the next session (human or Claude) has context.

---

## 7. Glossary (Shopify/Sport:80 terms for newcomers)

- **Shopify App** — the thing we're building. An external program that Shopify
  authorizes to read/write store data and add storefront features. (Shopify has
  no "plugins.")
- **Admin API** — Shopify's API for managing store data (customers, orders,
  products). We use it to create/update/tag customers.
- **Storefront** — the customer-facing side of the store (the theme).
- **Theme App Extension** — how an app injects UI into the storefront theme
  without editing theme code directly.
- **App Proxy** — lets our app serve requests under the store's own domain
  (e.g. `store.com/apps/sport80/...`) — useful for a login form.
- **Customer Tags** — labels on a Shopify customer (e.g. `sport80-active`) we
  use to drive gating.
- **Shopify Functions** — custom backend logic (e.g. member discounts) that runs
  inside Shopify's checkout.
- **Multipass** — a Shopify Plus feature for logging a customer in from an
  external system via a signed token. **Plus-only.**
- **OIDC (OpenID Connect)** — the modern SSO protocol Shopify's native external
  login uses. **Plus-only** for customer accounts.
- **SAML** — an older SSO protocol; **what Sport:80 uses.** Needs a bridge to
  reach Shopify's OIDC.
- **IdP (Identity Provider)** — the system that vouches for who a user is. Here,
  Sport:80 is the IdP.
- **Spike** — a short, time-boxed investigation to reduce unknowns before
  committing to a build (Phase 0, issue #1).
- **Sport:80** — our membership/event platform and source of truth for members.
