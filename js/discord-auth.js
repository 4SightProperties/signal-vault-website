// js/discord-auth.js
// Discord OAuth2 implicit flow + role verification
// Works entirely client-side — no server required.

const DiscordAuth = (() => {
  const STORAGE_KEY      = 'sv_discord_token';
  const USER_KEY         = 'sv_discord_user';
  const ROLES_KEY        = 'sv_discord_roles';
  const EXPIRES_KEY      = 'sv_discord_expires';
  const API_BASE         = 'https://discord.com/api/v10';
  const ROLES_CACHE_TTL  = 5 * 60 * 1000; // 5 minutes — Bug 2C fix

  // ── Token management ──────────────────────────────────────────

  // Bug 1 fix: clear cached identity when token changes to prevent
  // stale-user data being served with a new user's token.
  // See DISCORD_DUPLICATE_INVESTIGATION.md
  function saveToken(accessToken, expiresIn) {
    const expires = Date.now() + expiresIn * 1000;
    localStorage.setItem(STORAGE_KEY,  accessToken);
    localStorage.setItem(EXPIRES_KEY,  expires.toString());
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLES_KEY);
  }

  function getToken() {
    const token   = localStorage.getItem(STORAGE_KEY);
    const expires = parseInt(localStorage.getItem(EXPIRES_KEY) || '0');
    if (!token || Date.now() > expires) {
      clearSession();
      return null;
    }
    return token;
  }

  function clearSession() {
    localStorage.removeItem(STORAGE_KEY);
    localStorage.removeItem(USER_KEY);
    localStorage.removeItem(ROLES_KEY);
    localStorage.removeItem(EXPIRES_KEY);
  }

  // ── OAuth redirect ────────────────────────────────────────────

  function startOAuth(redirectUri) {
    const params = new URLSearchParams({
      client_id:     CONFIG.discord.clientId,
      redirect_uri:  redirectUri || CONFIG.discord.redirectUri,
      response_type: 'token',
      scope:         'identify guilds.members.read',
    });
    window.location.href = `https://discord.com/api/oauth2/authorize?${params}`;
  }

  function handleOAuthCallback() {
    if (!window.location.hash) return false;
    const hash   = window.location.hash.substring(1);
    const params = new URLSearchParams(hash);
    const token  = params.get('access_token');
    const exp    = parseInt(params.get('expires_in') || '0');
    if (!token) return false;
    saveToken(token, exp);
    // Clean hash from URL without reload
    history.replaceState(null, '', window.location.pathname + window.location.search);
    return true;
  }

  // ── Discord API calls ─────────────────────────────────────────

  async function apiGet(endpoint, token) {
    const res = await fetch(`${API_BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      if (res.status === 401) clearSession();
      throw new Error(`Discord API ${res.status}: ${endpoint}`);
    }
    return res.json();
  }

  async function fetchUser(token) {
    const cached = localStorage.getItem(USER_KEY);
    if (cached) return JSON.parse(cached);
    const user = await apiGet('/users/@me', token);
    localStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  }

  async function fetchMemberRoles(token) {
    // Bug 2C fix: TTL-gated cache — only serve entries younger than ROLES_CACHE_TTL.
    // Failed API calls (empty []) are never written to the cache.
    const cached = localStorage.getItem(ROLES_KEY);
    if (cached) {
      try {
        const parsed = JSON.parse(cached);
        if (parsed && parsed.cachedAt && (Date.now() - parsed.cachedAt < ROLES_CACHE_TTL)) {
          console.log('[DiscordAuth] roles (cached):', parsed.roles);
          return parsed.roles;
        }
        localStorage.removeItem(ROLES_KEY); // stale — refetch
      } catch (e) {
        localStorage.removeItem(ROLES_KEY); // corrupt — refetch
      }
    }
    try {
      const member = await apiGet(
        `/users/@me/guilds/${CONFIG.discord.guildId}/member`,
        token
      );
      const roles = member.roles || [];
      console.log('[DiscordAuth] member roles from API:', roles);
      console.log('[DiscordAuth] config requiredRoles:', CONFIG.discord.requiredRoles);
      localStorage.setItem(ROLES_KEY, JSON.stringify({ roles, cachedAt: Date.now() }));
      return roles;
    } catch (e) {
      // Distinguish between "not in guild" and other errors
      console.warn('[DiscordAuth] fetchMemberRoles failed:', e.message);
      console.warn('[DiscordAuth] guild ID used:', CONFIG.discord.guildId);
      console.warn('[DiscordAuth] If you see 401/403, the OAuth app may need to be added to the server,');
      console.warn('              or the guilds.members.read scope was not granted.');
      return []; // do NOT cache failures
    }
  }

  // ── Role checks ───────────────────────────────────────────────

  function checkRoles(memberRoles) {
    const required = CONFIG.discord.requiredRoles;
    const result = {
      verified:   memberRoles.includes(required.verified),
      disclaimer: memberRoles.includes(required.disclaimer),
      tos:        memberRoles.includes(required.tos),
    };
    result.allMet = result.verified && result.disclaimer && result.tos;

    // Log matching detail so role ID mismatches are immediately visible
    console.log('[DiscordAuth] role check result:', result);
    if (!result.verified)   console.warn(`  @Verified not found — looking for "${required.verified}" in`, memberRoles);
    if (!result.disclaimer) console.warn(`  @Disclaimer not found — looking for "${required.disclaimer}" in`, memberRoles);
    if (!result.tos)        console.warn(`  @ToS not found — looking for "${required.tos}" in`, memberRoles);

    return result;
  }

  // ── Main auth flow ────────────────────────────────────────────

  async function init() {
    // Handle OAuth callback first
    const isCallback = handleOAuthCallback();
    const token      = getToken();

    if (!token) {
      return { state: 'unauthenticated', user: null, roles: null, roleStatus: null };
    }

    try {
      const [user, memberRoles] = await Promise.all([
        fetchUser(token),
        fetchMemberRoles(token),
      ]);
      const roleStatus = checkRoles(memberRoles);
      return {
        state: 'authenticated',
        user,
        roles: memberRoles,
        roleStatus,
        isCallback,
      };
    } catch (e) {
      console.error('[DiscordAuth] Init error:', e);
      clearSession();
      return { state: 'error', user: null, roles: null, roleStatus: null };
    }
  }

  function logout() {
    clearSession();
    window.location.reload();
  }

  function getAvatarUrl(user) {
    if (!user) return null;
    if (user.avatar) {
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64`;
    }
    const defaultIdx = (parseInt(user.discriminator || '0') % 5);
    return `https://cdn.discordapp.com/embed/avatars/${defaultIdx}.png`;
  }

  // Bug 2A fix: prefer global_name (display name) over username (unique handle).
  // Discord shows global_name in most UI contexts; username can differ (e.g., trailing dot
  // appended during the 2023 forced migration). Falls back to username if global_name absent.
  // See DISCORD_DUPLICATE_INVESTIGATION.md
  function getDisplayName(user) {
    return user?.global_name || user?.username || '';
  }

  // Clears only the cached roles so the next init() re-fetches fresh role data
  // without invalidating the OAuth token (used after ToS role assignment).
  function clearRolesCache() {
    localStorage.removeItem(ROLES_KEY);
  }

  return { init, startOAuth, logout, getToken, clearSession, clearRolesCache, getAvatarUrl, getDisplayName };
})();
