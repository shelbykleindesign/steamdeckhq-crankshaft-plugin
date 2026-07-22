# Sport:80 ↔ Shopify Integration — Project Kickoff

A single doc you can copy to your computer / new repo. It has two parts:

- **Part A — The plan** (same content as `CLAUDE.md`: vision, constraints, stack, roadmap).
- **Part B — The issues** (copy-paste-ready GitHub tickets, one per task).

> **Store:** `shop.usarchery.org` (USA Archery, on Shopify).
> **Sport:80 tenant:** `usarchery.sport80.com` — API docs at
> `https://usarchery.sport80.com/api/doc` (login-gated).
> **New repo:** this work is meant to move into a new dedicated repo
> (working name: `usarchery-store-bridge` — confirm exact spelling). Everything
> below is portable text; paste it into the new repo when ready.

---

# PART A — THE PLAN

## What we're building (plain English)

We run the **USA Archery** store on **Shopify** (`shop.usarchery.org`). Our
members live in **Sport:80** (sports membership / event platform; our tenant is
`usarchery.sport80.com`). We want:

1. **SSO login** — a customer signs in to Shopify with their **Sport:80
   username/password** instead of a separate account.
2. **Membership gating** — knowing who someone is in Sport:80 and whether their
   membership is active, we unlock **member-only discounts / pricing / products**.

Both features stand on the **same foundation**: authenticate a person against
Sport:80, determine membership status, and connect that to a Shopify customer.
Build the foundation first; it unlocks both features.

**Audience:** the maintainer is new to Shopify dev. Favor small, well-explained
steps, comments that say *why*, and links to docs.

## The hard truths (constraints that shape everything)

| Constraint | What it means for us |
|---|---|
| **Shopify has no "plugins" — only "Apps."** | We build a Shopify *App*. No plugin format exists. |
| **Native "log in with your own provider" is Shopify Plus–only.** | Shopify's external-identity-provider (IdP) login uses **OIDC** and needs the **Plus** plan. **Multipass** (other native SSO shortcut) is also **Plus-only**. |
| **Sport:80 SSO is SAML, not OIDC.** | Even on Plus, Sport:80 speaks **SAML** while Shopify's native login wants **OIDC** — a **bridge/broker** is required. |
| **Sport:80 *does* expose a documented REST API for our org.** | Docs live at **`https://usarchery.sport80.com/api/doc`** (Swagger/OpenAPI-style, login-gated). Access needs **credentials/API keys from Sport:80**. The spike (Issue 1) is now: get access, read the doc, confirm the auth scheme + login/membership endpoints. `euanwm/sport80_api` is a reference, not a dependency. |
| **We have a live store, so the plan is checkable.** | Store is `shop.usarchery.org`. Check its plan (admin → Settings → Plan). **Never build against the live store** — use a free dev store, install on production only when ready. |

**SSO has two branches (decided later, once plan is known):**
- **Shopify Plus:** Shopify → our small **OIDC broker** → Sport:80.
- **Not Plus:** native SSO unavailable → login through **our app** (app-proxy /
  theme-extension form that checks Sport:80 creds and maps to a Shopify customer).

**Data sync + membership tagging (Phase 1) is identical in both branches** — so
we build it first and defer the branch decision.

## Recommended tech stack

- **Shopify App template: Remix** (`shopify app init`) — official default, best docs.
- **Language: TypeScript** · **Runtime: Node.js** · **Tooling: Shopify CLI.**
- **DB:** Prisma + SQLite (dev) → hosted Postgres (prod).
- **Hosting (later):** Fly.io / Render / Railway / Vercel.
- **Gating:** Shopify **customer tags** (`sport80-active`) + **Shopify Functions**
  (discounts) and/or a **theme app extension** (show/hide member content).

## Roadmap

- **Phase 0 — Foundations:** confirm Sport:80 login API (spike) · scaffold Remix app · confirm Shopify plan.
- **Phase 1 — Backbone:** Sport:80 API client · map member → Shopify customer · tag membership.
- **Phase 2 — Gating:** member discount (Functions) · show/hide content (theme extension).
- **Phase 3 — SSO:** pick branch from plan · implement login on the backbone.
- **Phase 4 — Hardening:** secrets, retries, logging, tests, deploy, docs.

## Working agreements

- Never commit secrets (Sport:80 creds, Shopify tokens, API keys). Use git-ignored `.env`.
- Keep new code in a dedicated subfolder until the repo migration; don't touch old files.
- Small PRs: one issue → one focused change. Update docs when decisions are made.

## Glossary

- **Shopify App** — the external program we build; Shopify has no "plugins."
- **Admin API** — Shopify API for store data (customers/orders/products).
- **Storefront** — the customer-facing theme.
- **Theme App Extension** — how an app injects UI into the theme safely.
- **App Proxy** — serve app requests under the store's own domain (good for a login form).
- **Customer Tags** — labels on a customer (e.g. `sport80-active`) that drive gating.
- **Shopify Functions** — custom checkout logic (e.g. member discounts).
- **Multipass** — Plus-only: log a customer in from an external system via signed token.
- **OIDC** — modern SSO protocol Shopify's native external login uses (Plus-only for customers).
- **SAML** — older SSO protocol; **what Sport:80 uses**; needs a bridge to reach OIDC.
- **IdP (Identity Provider)** — vouches for who a user is; here, Sport:80.
- **Spike** — short time-boxed investigation to kill unknowns before building.

---

# PART B — THE ISSUES (copy-paste into GitHub)

Create these as issues in the new repo, in order. Suggested labels shown per
issue. Phase labels: `phase-0` … `phase-4`.

---

### Issue 1 — [Spike] Read the Sport:80 API and confirm login + member data
**Labels:** `phase-0`, `spike`

**Why:** Everything depends on how we authenticate against Sport:80 and read
membership status. Good news: our tenant has a **documented REST API** at
`https://usarchery.sport80.com/api/doc` — so this is about reading it and
getting access, not discovering whether an API exists.

**Tasks**
- [ ] Get API access from Sport:80 — request credentials / an API key for the
      USA Archery tenant. (The doc page is login-gated.)
- [ ] Open `https://usarchery.sport80.com/api/doc` and record the **auth scheme**
      (Bearer token? API key header? login endpoint returning a token?).
- [ ] Identify the **login / credential-verification** endpoint (path, method,
      request/response) — this powers SSO.
- [ ] Identify the **member / membership** endpoint(s) and the fields that prove
      **active membership** (status, expiry date, member ID, email, name).
- [ ] Note rate limits, sandbox/test data, and any terms of use.
- [ ] Review `github.com/euanwm/sport80_api` as a reference implementation.
- [ ] Write findings into `docs/sport80.md`.

**Done when:** we can describe, in writing, exactly how to (a) verify a
credential and (b) fetch membership status for a user — with real endpoint paths.

---

### Issue 2 — Scaffold the Shopify Remix app + local dev
**Labels:** `phase-0`, `setup`

**Why:** We need a running app skeleton before any feature work.

**Tasks**
- [ ] Create a Shopify **Partner** account and a **development store**.
- [ ] Install Node.js LTS and the **Shopify CLI**.
- [ ] `shopify app init` → choose the **Remix** template (TypeScript).
- [ ] Put the app in its subfolder (e.g. `shopify-app/`) until repo migration.
- [ ] `shopify app dev` and confirm you can install the app on the dev store.
- [ ] Commit the scaffold; add `.env` to `.gitignore`; document required env vars.

**Done when:** the blank app installs and loads on the dev store locally.

---

### Issue 3 — Confirm the store's Shopify plan (decides the SSO branch)
**Labels:** `phase-0`, `decision`

**Why:** Native external login / Multipass are **Plus-only**. The plan picks the
SSO branch (OIDC broker vs app-based login).

**Tasks**
- [ ] Identify the real store's plan (Basic/Shopify/Advanced vs **Plus**).
- [ ] Record the decision + implication in `CLAUDE.md` (Section 2).
- [ ] If Plus: note OIDC/Multipass are available. If not: plan for app-based login.

**Done when:** the SSO branch for Phase 3 is written down.

---

### Issue 4 — Build the Sport:80 API client (auth + fetch member/status)
**Labels:** `phase-1`, `backbone`
**Depends on:** Issue 1

**Tasks**
- [ ] A small typed module wrapping the `usarchery.sport80.com` API:
      `verifyCredentials(user, pass)` and `getMember(identifier)` returning
      normalized `{ memberId, email, name, status, expiresAt }`.
- [ ] Handle auth/session/token lifecycle per Issue 1's findings.
- [ ] Read secrets from env; never hardcode.
- [ ] Unit tests with mocked responses.

**Done when:** given valid creds we get back a normalized member object incl.
active/inactive status.

---

### Issue 5 — Map a Sport:80 member → a Shopify customer (Admin API)
**Labels:** `phase-1`, `backbone`
**Depends on:** Issues 2, 4

**Tasks**
- [ ] Given a Sport:80 member, find-or-create the matching **Shopify customer**
      (match on email) via the Admin API.
- [ ] Store the Sport:80 member ID on the customer (metafield) for a stable link.
- [ ] Idempotent: running twice makes no duplicate.

**Done when:** a Sport:80 member reliably resolves to exactly one Shopify customer.

---

### Issue 6 — Tag customers with membership status
**Labels:** `phase-1`, `backbone`
**Depends on:** Issue 5

**Tasks**
- [ ] Apply/remove a tag like `sport80-active` based on current status.
- [ ] Provide a way to refresh a single customer and (later) all customers.
- [ ] Log what changed.

**Done when:** an active member ends up tagged `sport80-active`; an expired one
does not.

---

### Issue 7 — Member-only discount via Shopify Functions
**Labels:** `phase-2`, `gating`
**Depends on:** Issue 6

**Tasks**
- [ ] Add a Shopify **Function** that applies a member discount when the customer
      has the `sport80-active` tag.
- [ ] Configure the discount in the app; test in checkout on the dev store.

**Done when:** a tagged member sees the member price at checkout; others don't.

---

### Issue 8 — Show/hide member content via a theme app extension
**Labels:** `phase-2`, `gating`
**Depends on:** Issue 6

**Tasks**
- [ ] Add a **theme app extension** block that reveals member-only content/links
      when the logged-in customer is tagged `sport80-active`.
- [ ] Graceful fallback for logged-out / non-members.

**Done when:** member-only content appears only for active members.

---

### Issue 9 — SSO login (implement the chosen branch)
**Labels:** `phase-3`, `sso`
**Depends on:** Issues 3, 4, 5

**Tasks (Plus branch):**
- [ ] Stand up an **OIDC broker** that authenticates users against Sport:80 and
      presents OIDC to Shopify; connect it as the store's customer IdP.

**Tasks (non-Plus branch):**
- [ ] Build an **app-proxy / theme-extension login form** that verifies Sport:80
      creds (Issue 4), then establishes a Shopify customer session (evaluate
      passwordless/customer-account options available on the plan).

**Common:**
- [ ] On login, run the Phase 1 backbone (map + tag) so gating works immediately.
- [ ] Security review: never store raw Sport:80 passwords; protect all secrets.

**Done when:** a member logs into the store using Sport:80 credentials and is
correctly tagged.

---

### Issue 10 — Hardening: secrets, retries, logging, tests, deploy
**Labels:** `phase-4`, `hardening`

**Tasks**
- [ ] Central secrets handling + `.env.example` documented.
- [ ] Retry/backoff + clear error messages for Sport:80 and Shopify API calls.
- [ ] Structured logging (no secrets/PII in logs).
- [ ] Test coverage for the backbone (Issues 4–6).
- [ ] Choose hosting and deploy; document the deploy steps.
- [ ] Update `CLAUDE.md` / README with final architecture + runbook.

**Done when:** the app runs in a hosted environment with secrets managed and a
documented deploy.

---

## Suggested labels to create first
`phase-0` `phase-1` `phase-2` `phase-3` `phase-4` · `spike` `setup` `decision`
`backbone` `gating` `sso` `hardening`
