// js/discord-auth.js
// Discord OAuth2 implicit flow + role verification
// Works entirely client-side — no server required.

const DiscordAuth = (() => {
  const STORAGE_KEY   = 'sv_discord_token';
  const USER_KEY      = 'sv_discord_user';
  const ROLES_KEY     = 'sv_discord_roles';
  const EXPIRES_KEY   = 'sv_discord_expires';
  const API_BASE      = 'https://discord.com/api/v10';

  // ── Token management ──────────────────────────────────────────

  function saveToken(accessToken, expiresIn) {
    const expires = Date.now() + expiresIn * 1000;
    sessionStorage.setItem(STORAGE_KEY,  accessToken);
    sessionStorage.setItem(EXPIRES_KEY,  expires.toString());
  }

  function getToken() {
    const token   = sessionStorage.getItem(STORAGE_KEY);
    const expires = parseInt(sessionStorage.getItem(EXPIRES_KEY) || '0');
    if (!token || Date.now() > expires) {
      clearSession();
      return null;
    }
    return token;
  }

  function clearSession() {
    sessionStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(USER_KEY);
    sessionStorage.removeItem(ROLES_KEY);
    sessionStorage.removeItem(EXPIRES_KEY);
  }

  // ── OAuth redirect ────────────────────────────────────────────

  function startOAuth() {
    const params = new URLSearchParams({
      client_id:     CONFIG.discord.clientId,
      redirect_uri:  CONFIG.discord.redirectUri,
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
    const cached = sessionStorage.getItem(USER_KEY);
    if (cached) return JSON.parse(cached);
    const user = await apiGet('/users/@me', token);
    sessionStorage.setItem(USER_KEY, JSON.stringify(user));
    return user;
  }

  async function fetchMemberRoles(token) {
    const cached = sessionStorage.getItem(ROLES_KEY);
    if (cached) return JSON.parse(cached);
    try {
      const member = await apiGet(
        `/users/@me/guilds/${CONFIG.discord.guildId}/member`,
        token
      );
      const roles = member.roles || [];
      sessionStorage.setItem(ROLES_KEY, JSON.stringify(roles));
      return roles;
    } catch (e) {
      // User not in guild
      return [];
    }
  }

  // ── Role checks ───────────────────────────────────────────────

  function checkRoles(memberRoles) {
    const required = CONFIG.discord.requiredRoles;
    return {
      verified:   memberRoles.includes(required.verified),
      disclaimer: memberRoles.includes(required.disclaimer),
      tos:        memberRoles.includes(required.tos),
      allMet:     memberRoles.includes(required.verified) &&
                  memberRoles.includes(required.disclaimer) &&
                  memberRoles.includes(required.tos),
    };
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

  return { init, startOAuth, logout, getToken, clearSession, getAvatarUrl };
})();
