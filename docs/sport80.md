# Sport:80 API — working notes

Living notes on how USA Archery's Sport:80 API works. This is the destination
for the **Issue #1 spike**. Update it as we confirm things; mark guesses clearly.

- **Tenant / base URL:** `https://usarchery.sport80.com/api/`
- **Interactive docs:** `https://usarchery.sport80.com/api/doc` (login-gated —
  open it in a browser signed in to Sport:80; automated fetches get a 403).
- **Reference client:** `github.com/euanwm/sport80_api` (community, unofficial).

---

## Authentication

**Confirmed:** access is **token-based**. On the *older* API, the token is passed
as a **query-string parameter** named `access_token`.

Example (old API — a club directory lookup):

```
GET https://usarchery.sport80.com/api/club_finder
      ?access_token=<TOKEN>
      &id_add_on=245
      &limit=<N>
      &page=<N>
      <&extra filter params>
```

> ⚠️ **Security — tokens in the URL.** Passing a secret token as a query
> parameter is risky: URLs get written to server logs, proxy logs, and browser
> history. For our Shopify app this means:
> - Keep the token **server-side only** (in the app backend / `.env`) — **never**
>   send it to the storefront or expose it in browser-visible requests.
> - Prefer the newer API's header-based auth if it offers one (to confirm).
> - Be careful not to log full request URLs that contain the token.

### Open questions (confirm from `/api/doc`)
- [ ] **How is a token obtained?** Is there a login endpoint (username/password →
      token)? A pre-issued API key? What's the token's lifetime / refresh?
- [ ] **Does the newer API accept an `Authorization: Bearer <token>` header**
      instead of a query param? (Strongly preferred if so.)
- [ ] **Is there a "verify these credentials" endpoint** we can use for SSO login?
- [ ] **Which endpoint returns a member + their membership status**, and what
      fields mark "active" (status, expiry date, member ID, email, name)?
- [ ] Rate limits, sandbox/test data, terms of use.

---

## Conventions observed

- **Pagination:** `limit` (page size) + `page` (1-based, to confirm).
- **Add-on / module IDs:** numeric `id_add_on` selects a feature/module
  (example uses `245` — record what each ID we use maps to).
- **Filters:** additional query params appended to the request.

---

## Known endpoints

| Endpoint | Method | Auth | Notes |
|---|---|---|---|
| `/api/club_finder` | GET | `access_token` query param | Old API. Lists clubs; takes `id_add_on`, `limit`, `page`, extra filters. Not core to SSO/gating, but **needed later** (e.g. club directory / mapping members to clubs). |

_Add rows here as we confirm the login and member/membership endpoints._

---

## How this maps to our project

- **Issue #4 (Sport:80 API client)** will wrap this API: obtain/hold a token
  server-side, then expose `verifyCredentials()` and `getMember()` returning a
  normalized `{ memberId, email, name, status, expiresAt }`.
- The **old** `club_finder`-style endpoints (query-param token, `id_add_on`,
  pagination) are a useful reference for the request shape even if we target the
  newer documented API for auth + membership.
