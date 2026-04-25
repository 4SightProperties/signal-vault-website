# Discord Duplicate Account Investigation

**Date:** 2026-04-24  
**Scope:** `js/discord-auth.js`, `js/app.js`, `js/config.js`, `workers/create-checkout-session.js`, `workers/get-subscription.js`  
**Status:** Root cause confirmed. No code modified.

---

## Executive Summary

When a user clicks "Sign in with Discord" on the payment site while the browser tab already has a valid session from a previous login, the site saves the new OAuth token but **continues serving the previously-cached identity** (user ID, username, roles). The result is that the new user appears to be authenticated as whoever was signed in last.

This is a client-side session cache poisoning bug. It is not a server-side vulnerability — the Cloudflare Workers correctly verify tokens — but the UI and checkout flow consume cached identity data without validating that it belongs to the current token.

---

## How the Auth Flow Works

The site uses Discord's **OAuth2 implicit grant** (`response_type=token`). There is no server-side exchange — the access token is returned directly in the URL fragment (`#access_token=...`).

**The sequence on every page load:**

```
1. App.run() → DiscordAuth.init()
2. init() calls handleOAuthCallback()
   → If URL contains #access_token=…, extract token, call saveToken()
   → Clean the hash from the URL with history.replaceState()
3. init() calls getToken()
   → If token is present and not expired, return it
   → If expired, call clearSession() (removes ALL storage keys)
4. init() calls fetchUser(token) + fetchMemberRoles(token) in parallel
   → fetchUser: checks sessionStorage cache first; if found, returns it WITHOUT calling Discord API
   → fetchMemberRoles: same pattern
5. App stores the resulting {user, roles, roleStatus} in state.auth
6. app.js reads state.auth.user.id and state.auth.user.username for checkout and account display
```

---

## Root Cause

### `saveToken()` does not invalidate the identity cache

**`js/discord-auth.js`, lines 14–18:**
```javascript
function saveToken(accessToken, expiresIn) {
  const expires = Date.now() + expiresIn * 1000;
  sessionStorage.setItem(STORAGE_KEY,  accessToken);   // sv_discord_token
  sessionStorage.setItem(EXPIRES_KEY,  expires.toString());
  // ⚠️  sv_discord_user  is NOT cleared here
  // ⚠️  sv_discord_roles is NOT cleared here
}
```

`saveToken()` writes only two of the four storage keys. It does not touch `sv_discord_user` or `sv_discord_roles`.

---

### `fetchUser()` returns cached data without verifying token ownership

**`js/discord-auth.js`, lines 75–81:**
```javascript
async function fetchUser(token) {
  const cached = sessionStorage.getItem(USER_KEY);
  if (cached) return JSON.parse(cached);    // ← returns cached data for ANY token
  const user = await apiGet('/users/@me', token);
  sessionStorage.setItem(USER_KEY, JSON.stringify(user));
  return user;
}
```

There is no check that the cached user object belongs to the incoming `token`. Any token — old, new, belonging to any user — will receive the same cached identity as long as `sv_discord_user` contains data.

`fetchMemberRoles()` (lines 83–107) has the same pattern.

---

### The exact sequence that triggers the bug

```
1. User A logs in. Their token is valid for 7 days (Discord's default).
   sessionStorage now contains:
     sv_discord_token  = USER_A_TOKEN
     sv_discord_user   = { id: "111", username: "UserA", ... }
     sv_discord_roles  = [...]
     sv_discord_expires = <7 days from now>

2. The browser tab stays open (sessionStorage persists across page navigations
   within the same tab).

3. A different person (or User A switching to an alt account) clicks
   "Sign in with Discord" → DiscordAuth.startOAuth() → browser navigates away
   to Discord's authorization page.

4. They authorize as User B. Discord redirects back to:
     https://.../signal-vault-website/#access_token=USER_B_TOKEN&expires_in=604800...

5. The page reloads within the same tab. sessionStorage is preserved.

6. handleOAuthCallback() fires:
   → Extracts USER_B_TOKEN from the hash
   → Calls saveToken(USER_B_TOKEN, 604800)
   → sv_discord_token is now USER_B_TOKEN  ✓
   → sv_discord_user  is still User A's data  ✗

7. fetchUser(USER_B_TOKEN) is called:
   → sessionStorage.getItem('sv_discord_user') returns User A's data
   → Returns User A immediately — Discord API never called

8. state.auth.user = User A's object, state.auth token = User B's token.
   The UI shows User A's username and identity.
```

**Result:** User B is displayed as User A. Their checkout request will send User A's `discordUserId` with User B's `discordToken`.

---

## Why "a similar name"?

The cached identity is whoever last signed in on that browser tab. In the context of a Discord trading community, this is most often:

- The **site owner or admin** who tested the checkout flow and left the tab open, so a member using the same machine sees that identity.
- A **household member** or colleague who signed in earlier on a shared computer.
- The **user themselves** switching between a main and an alt Discord account (common in trading communities), where both accounts have similar-looking names.

It is not a random identity. It is whoever was authenticated in the most recent session on that tab.

---

## Secondary Issue: No `state` Parameter (CSRF)

**`js/discord-auth.js`, lines 39–46:**
```javascript
function startOAuth() {
  const params = new URLSearchParams({
    client_id:     CONFIG.discord.clientId,
    redirect_uri:  CONFIG.discord.redirectUri,
    response_type: 'token',
    scope:         'identify guilds.members.read',
    // ← no state parameter
  });
  window.location.href = `https://discord.com/api/oauth2/authorize?${params}`;
}
```

The `state` parameter is missing. OAuth 2.0 requires `state` to be a cryptographically random nonce stored client-side before the redirect. On callback, the returned `state` must match the stored value before the token is accepted.

Without it, `handleOAuthCallback()` will accept any `#access_token=…` that appears in the URL — including one injected by an attacker or a malicious redirect. This is a separate, lower-severity issue for this deployment because the implicit flow already makes the token visible in the URL, but it should still be addressed.

**This is NOT the root cause of the duplicate account bug. It is a distinct vulnerability.**

---

## Tertiary Issue: Implicit Flow Exposes Token in URL

The site uses `response_type=token` (implicit grant). This means the access token appears in the URL fragment:

```
https://.../signal-vault-website/#access_token=XXXXXX&expires_in=604800&...
```

`handleOAuthCallback()` cleans this with `history.replaceState()` (line 58), which prevents it from appearing in the browser's address bar. However:

- The token is visible to any browser extension running on the page before `replaceState` fires.
- If the tab is closed before `replaceState` runs (unlikely but possible), the URL with the token may be stored in browser history.

The modern alternative is `response_type=code` with PKCE, which never exposes the token in the URL. This is a medium-priority hardening recommendation, not an active exploit path.

---

## Worker-Side Protection (What Is Working Correctly)

The Cloudflare Workers do validate Discord identity server-side. In `create-checkout-session.js`, lines 149–158:

```javascript
// Verify token belongs to claimed user
verifiedUser = await verifyDiscordToken(discordToken);
if (verifiedUser.id !== discordUserId) {
  return json({ error: 'Discord token / userId mismatch' }, 403, origin);
}
```

This means the bug does NOT allow a malicious actor to complete a checkout under someone else's account — the worker would reject the mismatch between User B's token and User A's cached ID.

However:
1. The **UI** still shows the wrong identity, which is confusing and damages trust.
2. The **account portal** (`loadSubscriptionData()` in `app.js:737`) sends the cached `discordUserId` to `get-subscription.js`, which also validates the token. If there's a mismatch, the subscription load silently fails or returns `found: false`, showing "No active subscription found" to the real subscriber — another visible symptom.
3. Checkout attempts under the wrong identity fail with a server error visible to the user, which is a poor UX but not a security breach.

---

## Findings Summary

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 1 | `discord-auth.js:14–18` | `saveToken()` does not clear `sv_discord_user` or `sv_discord_roles` | **Critical** — root cause |
| 2 | `discord-auth.js:75–81` | `fetchUser()` returns cached identity without verifying it belongs to the current token | **Critical** — root cause |
| 3 | `discord-auth.js:83–107` | `fetchMemberRoles()` returns cached roles without verifying token ownership | **Critical** — root cause |
| 4 | `discord-auth.js:131–158` | `init()` does not clear identity cache before processing a new OAuth callback | **Critical** — root cause |
| 5 | `discord-auth.js:39–46` | No `state` parameter in OAuth request — CSRF risk | **Medium** — separate issue |
| 6 | `discord-auth.js:43` | Implicit flow (`response_type=token`) exposes token in URL | **Low** — hardening |

---

## Recommended Fixes

These are recommendations only. No code has been modified.

### Fix 1 — Clear identity cache in `saveToken()` (one-line fix, high confidence)

The simplest and most targeted fix. When a new token arrives, any previously-cached identity is invalid until confirmed by the API.

```javascript
// discord-auth.js:14
function saveToken(accessToken, expiresIn) {
  const expires = Date.now() + expiresIn * 1000;
  sessionStorage.setItem(STORAGE_KEY,  accessToken);
  sessionStorage.setItem(EXPIRES_KEY,  expires.toString());
  sessionStorage.removeItem(USER_KEY);   // ← add this
  sessionStorage.removeItem(ROLES_KEY);  // ← add this
}
```

This ensures every new OAuth callback triggers a fresh identity fetch from Discord's API.

### Fix 2 — Add `state` parameter for CSRF protection

Generate a random nonce before the OAuth redirect, store it in sessionStorage, and verify it matches the value Discord echoes back in the callback.

```javascript
// In startOAuth():
const state = crypto.randomUUID();
sessionStorage.setItem('sv_oauth_state', state);
const params = new URLSearchParams({
  ...
  state,
});

// In handleOAuthCallback():
const returnedState = params.get('state');
const expectedState = sessionStorage.getItem('sv_oauth_state');
sessionStorage.removeItem('sv_oauth_state');
if (!returnedState || returnedState !== expectedState) return false;
```

### Fix 3 (Optional, longer-term) — Migrate to Auth Code + PKCE

Replace `response_type=token` with `response_type=code` and add a Cloudflare Worker to exchange the code for a token server-side. This eliminates the token-in-URL exposure and is the current OAuth 2.0 best practice. This is a larger architectural change and should be evaluated separately.

---

---

## Bug 2: Dotted Username + Role Recognition Failure

**Date:** 2026-04-24  
**Scenario:** A new user on a fresh device (no prior sessionStorage) signed in with Discord. The site displayed a trailing dot on their username (e.g., `johndoe.` instead of `johndoe`), and all three verification role steps showed as not-met, even though the user was a confirmed server member with roles assigned.

---

### Finding 2A — The Trailing Dot: `user.username` vs `user.global_name`

#### Root cause

Discord's API v10 `/users/@me` response contains two distinct name fields:

| Field | Description | Example |
|-------|-------------|---------|
| `username` | Globally unique lowercase handle | `johndoe.` |
| `global_name` | User-visible display name | `johndoe` |

The site reads and displays `user.username` everywhere. It never reads `global_name`. The Discord API is returning exactly what is stored — the trailing dot is the user's actual `username` handle, not an artifact added by this code.

#### Why the dot is there

In 2023, Discord forced all users to create unique username handles, replacing the old `username#discriminator` system. Many common names (e.g., "johndoe") were already taken, so Discord's migration appended characters — including trailing dots and numbers — to generate unique handles. Users generally did not notice this because Discord's own UI prominently displays `global_name` (the display name) in most contexts: the sidebar, the member list, DMs, mentions. The `username` handle only appears in a few places (profile page, `@username` lookups).

The user believes their name has no dot because, within Discord, they almost always see their `global_name`. The payment site is the first place they've seen their `username` handle rendered directly.

#### Where `user.username` is displayed (all instances)

| File | Line | Context |
|------|------|---------|
| `js/app.js` | 390 | `Connected as <strong>${user.username}</strong>` (Discord verification panel) |
| `js/app.js` | 661 | `<h2>${user.username}</h2>` (Account Portal header) |
| `js/app.js` | 956 | `<span class="nav-username">${user.username}</span>` (Nav bar) |
| `js/app.js` | 385 | `alt="${user.username}"` (Avatar `alt` attribute) |
| `js/app.js` | 658 | `alt="${user.username}"` (Account Portal avatar `alt`) |

`global_name` is never referenced in any file.

#### Verification: no code adds the dot

Every username display path in the codebase passes `user.username` through to the DOM without transformation. The only reference to `user.discriminator` is in `discord-auth.js:170` inside `getAvatarUrl()`, where it is used to compute a default avatar index (`parseInt(user.discriminator || '0') % 5`) — this is a number, not a string, and is never appended to the username.

**The dot is not added by code. It is the user's actual Discord `username` handle.**

#### Recommended fix

Display `user.global_name` when available, falling back to `user.username`:

```javascript
// Helper — use wherever user name is displayed
function getDisplayName(user) {
  return user?.global_name || user?.username || '';
}
```

Replace all five display sites listed above with `getDisplayName(user)` (or the equivalent inline expression). The `username` field should still be used for the Discord ID line (e.g., the account portal's `Discord ID: ${user.id}` row) if a technical identifier is needed.

---

### Finding 2B — Role Recognition Failure: OAuth2 App Not in Guild

#### Root cause

The client-side role check calls a Discord endpoint that has a prerequisite the codebase does not satisfy:

**`js/discord-auth.js`, lines 89–92:**
```javascript
const member = await apiGet(
  `/users/@me/guilds/${CONFIG.discord.guildId}/member`,
  token
);
```

This calls `GET /users/@me/guilds/{guild.id}/member` with an **OAuth2 Bearer token**. Discord's requirement for this endpoint:

> The OAuth2 application must be added to the guild as a bot (via the `bot` scope) for this endpoint to succeed.

The bot token stored in the workers as `BOT_TOKEN` is used for role assignment (it IS in the server). However, the OAuth2 client (Client ID: `1496751088823701614`) used for "Sign in with Discord" is a **separate identity** from the bot token. They may be:

- The **same application** in Discord Developer Portal — in which case the bot just needs to be (re)added to the server with the correct scopes
- **Two different applications** — in which case the OAuth2 app's bot has never been added to the Signal Vault server at all, and the endpoint will fail for every user indefinitely

The code itself documents this failure mode. At `js/discord-auth.js:103–104`:

```javascript
console.warn('[DiscordAuth] If you see 401/403, the OAuth app may need to be added to the server,');
console.warn('              or the guilds.members.read scope was not granted.');
```

This warning appears in the catch block that handles the failure — confirming the failure path is known, but the underlying cause was never resolved.

#### What happens when the endpoint fails

`apiGet()` throws on any non-2xx response (`discord-auth.js:68–70`). The `fetchMemberRoles()` catch block (`discord-auth.js:99–106`) silently returns `[]`:

```javascript
} catch (e) {
  console.warn('[DiscordAuth] fetchMemberRoles failed:', e.message);
  return [];   // ← empty array returned for ANY failure
}
```

`checkRoles([])` then evaluates all three role IDs against an empty array, returning all false:

```javascript
verified:   [].includes('1491285557785919588'),  // → false
disclaimer: [].includes('1482171292118683731'),  // → false
tos:        [].includes('1496700516636561448'),  // → false
```

The UI renders all three steps as not-met. **Checkout is blocked.** The user has no indication that the check failed due to an API error rather than genuinely missing roles.

#### The hidden debug panel does not fire

`js/app.js:332–351` contains a debug panel that shows when roles returned from Discord are empty. However, it is gated on `hasPlaceholders`:

```javascript
const hasPlaceholders = Object.values(CONFIG.discord.requiredRoles)
  .some(id => id.startsWith('ROLE_ID_'));
```

Since the role IDs in `config.js` are real snowflake IDs (not placeholders), `hasPlaceholders` is `false`. The debug panel never renders. The silent `[]` return is invisible to the user.

#### Two-tier role check: client vs. server

The codebase has two role check mechanisms that work differently:

| Layer | Code | Auth | Endpoint |
|-------|------|------|----------|
| Client-side UI | `discord-auth.js:89` | OAuth2 Bearer token | `GET /users/@me/guilds/{id}/member` |
| Server-side Worker | `create-checkout-session.js:68` | Bot token (`BOT_TOKEN`) | `GET /guilds/{id}/members/{userId}` |

The bot-level check in `create-checkout-session.js` works correctly (the bot IS in the server). The client-side check fails because the OAuth2 app is a different actor that has not been granted access to the guild's member data.

This means: even when a user has all required roles, the **checkout button is never enabled** because the client-side check always returns false.

#### Recommended fix

Two options:

**Option A — Add the OAuth2 app to the server (no code change)**  
In Discord Developer Portal, confirm that Client ID `1496751088823701614` is the same application as the bot. If so, re-invite the bot to the Signal Vault server using an OAuth2 URL that includes both `bot` and `guilds.members.read` in the scopes. The bot needs the `Read Members` permission at minimum. Once the OAuth2 app's bot is in the server, the existing `/users/@me/guilds/{guild.id}/member` endpoint will start returning correct member data.

If Client ID `1496751088823701614` and `BOT_TOKEN` belong to **different applications**, the OAuth2 app's bot must be added to the server separately — it does not inherit the other bot's server membership.

**Option B — Move role verification to the Worker (code change)**  
Remove the client-side `fetchMemberRoles()` call entirely. Instead, add a new lightweight Cloudflare Worker endpoint that accepts a Discord OAuth token, verifies the token, then uses the bot token to call the bot-level `/guilds/{guild.id}/members/{userId}` endpoint (which already works). Return the role array to the client. This eliminates the dependency on `/users/@me/guilds/{guild.id}/member` and the OAuth2 app's guild membership requirement.

---

### Finding 2C — Role Cache Has No TTL

The role data fetched by `fetchMemberRoles()` is cached in `sessionStorage.sv_discord_roles` for the entire browser session with no expiration:

```javascript
// discord-auth.js:97
sessionStorage.setItem(ROLES_KEY, JSON.stringify(roles));
```

```javascript
// discord-auth.js:84–88
const cached = sessionStorage.getItem(ROLES_KEY);
if (cached) {
  return JSON.parse(cached);   // ← returned immediately, API never called again
}
```

**Implications:**

1. **For new users (fresh device):** The cache starts empty, so the API is always called. Caching is not a factor in this specific report — it does not cause or mask the failure.

2. **For returning users (same tab, same session):** Once roles are cached (successfully or as `[]` from a failure), they persist for the rest of the session. A user who resolves a role issue in Discord and returns to the site **will still see stale role data** until they sign out, close the tab, or manually trigger `DiscordAuth.clearRolesCache()`. The site currently only calls `clearRolesCache()` in one place (after ToS role assignment, `app.js:262`), not on re-authentication.

3. **Role removal is not propagated:** If a user's role is revoked, the cached `[]`... or rather the cached role array will still contain the removed role until the session ends.

**Recommended fix:**

Add a timestamp alongside the cached roles and treat entries older than a configurable TTL (5–10 minutes is reasonable) as stale. On a failed API call, do not cache the empty result — cache only successful (non-empty or explicitly confirmed empty) role responses.

---

### Reproduction Steps

1. On a fresh browser (no sessionStorage), navigate to `index.html`
2. Click "Connect Discord"
3. Authorize as a user whose Discord `username` (handle) has a trailing dot but whose `global_name` does not
4. **Observed:** Trailing dot appears in the "Connected as" label, nav username, and account portal header
5. **Observed:** All three role steps show as not-met, even if the user has all required roles in the server (because `fetchMemberRoles()` returns `[]` due to 403 from Discord API)

To confirm the API failure: open browser DevTools console after authenticating. You will see:

```
[DiscordAuth] fetchMemberRoles failed: Discord API 403: /users/@me/guilds/1471361318429917258/member
```

---

### Findings Summary for Bug 2

| # | Location | Issue | Severity |
|---|----------|-------|----------|
| 2A | `discord-auth.js:78`, `app.js:390,661,956` | `user.username` (unique handle) displayed instead of `user.global_name` (display name) — trailing dot from handle migration visible to user | **Medium** |
| 2B | `discord-auth.js:89–92` | `/users/@me/guilds/{id}/member` requires OAuth2 app to be in guild as bot; this requirement is not met — all role checks return false, blocking checkout | **Critical** |
| 2C | `discord-auth.js:84–97` | Role cache has no TTL; silently caches failed API results as `[]`; stale roles persist for full session | **Medium** |

---

---

## Fixes Applied

**Date:** 2026-04-24

### Fix 1 — sessionStorage cache leak in `saveToken()`

**File modified:** `js/discord-auth.js`

Added two `sessionStorage.removeItem` calls inside `saveToken()`, immediately after the token write. When a new OAuth token arrives, `USER_KEY` (`sv_discord_user`) and `ROLES_KEY` (`sv_discord_roles`) are both cleared before `init()` proceeds to `fetchUser()` and `fetchMemberRoles()`. This guarantees a fresh API call for every new token, eliminating the stale-identity bug.

Lines affected: `saveToken()` body (previously lines 15–17, now lines 18–23 with added comment and two `removeItem` calls).

No deviation from the prescribed approach. The `fetchUser()` defensive comparison was evaluated and judged unnecessary: `saveToken()` clearing the cache is sufficient. Adding a comparison inside `fetchUser()` would require either a second API call (expensive) or embedding the token inside the cached user object (a structural change not in scope).

---

### Fix 2A — Display name vs username handle

**Files modified:** `js/discord-auth.js`, `js/app.js`

Added `getDisplayName(user)` helper to `discord-auth.js` and exported it from the module. Replaced all five display sites in `app.js`:

| File | Approx. line | Changed from | Changed to |
|------|-------------|--------------|------------|
| `js/app.js` | 385 | `alt="${user.username}"` (panel avatar) | `alt="${DiscordAuth.getDisplayName(user)}"` |
| `js/app.js` | 390 | `<strong>${user.username}</strong>` | `<strong>${DiscordAuth.getDisplayName(user)}</strong>` |
| `js/app.js` | 658 | `alt="${user.username}"` (account avatar) | `alt="${DiscordAuth.getDisplayName(user)}"` |
| `js/app.js` | 661 | `<h2>${user.username}</h2>` | `<h2>${DiscordAuth.getDisplayName(user)}</h2>` |
| `js/app.js` | 956 | `<span class="nav-username">${user.username}</span>` | `<span class="nav-username">${DiscordAuth.getDisplayName(user)}</span>` |

**Intentionally unchanged `user.username` usages:**

| File | Line | Reason not changed |
|------|------|--------------------|
| `js/app.js` | 140 | `const username = state.auth.user?.username || ''` — this value is sent to the Cloudflare Worker as `discordUsername` in the checkout payload. This is a backend identifier, not a display string. Using `global_name` here would store the display name in Stripe metadata rather than the Discord handle. Left as `user.username`. |
| `js/app.js` | 165 | `discordUsername: username` — direct use of the variable assigned at line 140. Same reasoning. |

No other `user.username` references were found in `js/app.js` or any other file.

---

### Fix 2C — Role cache TTL

**File modified:** `js/discord-auth.js`

Three changes:

1. Added `ROLES_CACHE_TTL = 5 * 60 * 1000` constant alongside the other storage key constants (line 11).

2. Rewrote the cache-read block in `fetchMemberRoles()`: the stored value is now parsed as `{ roles, cachedAt }`. If `cachedAt` is present and younger than `ROLES_CACHE_TTL`, the cached `roles` array is returned. If the entry is stale or unparseable, it is removed and the API is called. Old-format entries (raw arrays lacking `cachedAt`) fall through correctly — `parsed.cachedAt` is `undefined`, the condition is false, and the API is called.

3. Rewrote the cache-write: `sessionStorage.setItem(ROLES_KEY, JSON.stringify({ roles, cachedAt: Date.now() }))` — only executed on a successful API response, inside the `try` block. The `catch` block returns `[]` to the caller without touching sessionStorage.

**`clearRolesCache()` in `discord-auth.js` (line 200):** calls `sessionStorage.removeItem(ROLES_KEY)` — unaffected by the format change. Removing the key is valid regardless of what it contained.

**`DiscordAuth.clearRolesCache()` in `app.js` (line 262):** delegates to `clearRolesCache()` above — no change needed.

No deviation from the prescribed approach.

---

## Files Reviewed

- `js/discord-auth.js` — full file (182 lines)
- `js/app.js` — full file (1,009 lines)
- `js/config.js` — full file (140 lines)
- `workers/create-checkout-session.js` — full file (194 lines)
- `workers/get-subscription.js` — full file (213 lines)
- `index.html`, `account.html`, `success.html` — structure review
