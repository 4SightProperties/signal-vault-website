/**
 * Signal Vault — Cloudflare Worker: assign-tos-role
 *
 * Assigns the @ToS-Accepted Discord role to a verified user.
 * The bot token is stored as a Worker secret and never exposed client-side.
 *
 * Deploy:
 *   1. Install Wrangler: npm install -g wrangler
 *   2. wrangler login
 *   3. wrangler deploy workers/assign-tos-role.js --name sv-assign-tos-role
 *   4. Add secrets (never put these in code):
 *        wrangler secret put BOT_TOKEN
 *        wrangler secret put GUILD_ID
 *        wrangler secret put TOS_ROLE_ID
 *        wrangler secret put VERIFIED_ROLE_ID
 *        wrangler secret put DISCLAIMER_ROLE_ID
 *   5. Copy the deployed worker URL → CONFIG.discord.tosRoleEndpoint in config.js
 *
 * Environment variables (set via wrangler secret, not hardcoded here):
 *   BOT_TOKEN          — Discord bot token (Bot ... format)
 *   GUILD_ID           — Signal Vault server ID
 *   TOS_ROLE_ID        — @ToS-Accepted role ID
 *   VERIFIED_ROLE_ID   — @Verified role ID (prerequisite)
 *   DISCLAIMER_ROLE_ID — @Acknowledged Discl... role ID (prerequisite)
 */

const DISCORD_API = 'https://discord.com/api/v10';

// Allowed origin — lock this to your production domain
const ALLOWED_ORIGIN = 'https://pay.signalvault.com';

const CORS = (origin) => ({
  'Access-Control-Allow-Origin':  origin === ALLOWED_ORIGIN ? ALLOWED_ORIGIN : '',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Max-Age':       '86400',
});

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS(origin) },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    // Preflight
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    // Parse body
    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, origin);
    }

    const { token, userId } = body;
    if (!token || !userId || typeof token !== 'string' || typeof userId !== 'string') {
      return json({ error: 'Missing or invalid token / userId' }, 400, origin);
    }

    // ── Step 1: Verify the OAuth token belongs to the claimed userId ──────
    // This prevents a user from submitting someone else's userId to get their role assigned.
    let verifiedUser;
    try {
      const res = await fetch(`${DISCORD_API}/users/@me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) return json({ error: 'Invalid Discord token' }, 401, origin);
      verifiedUser = await res.json();
    } catch {
      return json({ error: 'Could not verify Discord token' }, 502, origin);
    }

    if (verifiedUser.id !== userId) {
      return json({ error: 'Token / userId mismatch' }, 403, origin);
    }

    // ── Step 2: Check prerequisites via bot ───────────────────────────────
    // User must already have @Verified and @Acknowledged Discl... before
    // we assign @ToS-Accepted.
    let member;
    try {
      const res = await fetch(`${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}`, {
        headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
      });
      if (res.status === 404) return json({ error: 'User is not a server member' }, 403, origin);
      if (!res.ok) throw new Error(`Discord API ${res.status}`);
      member = await res.json();
    } catch (e) {
      return json({ error: 'Could not fetch member data' }, 502, origin);
    }

    const memberRoles = member.roles || [];
    if (!memberRoles.includes(env.VERIFIED_ROLE_ID)) {
      return json({ error: 'Prerequisite @Verified role not present' }, 403, origin);
    }
    if (!memberRoles.includes(env.DISCLAIMER_ROLE_ID)) {
      return json({ error: 'Prerequisite @Acknowledged Discl... role not present' }, 403, origin);
    }

    // Already has @ToS-Accepted — idempotent success
    if (memberRoles.includes(env.TOS_ROLE_ID)) {
      return json({ success: true, alreadyAssigned: true }, 200, origin);
    }

    // ── Step 3: Assign @ToS-Accepted role ─────────────────────────────────
    try {
      const res = await fetch(
        `${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}/roles/${env.TOS_ROLE_ID}`,
        {
          method:  'PUT',
          headers: {
            Authorization: `Bot ${env.BOT_TOKEN}`,
            'X-Audit-Log-Reason': 'ToS accepted via Signal Vault website',
          },
        }
      );
      // 204 = success (no body), anything else is an error
      if (res.status !== 204) {
        const text = await res.text();
        throw new Error(`Discord API ${res.status}: ${text}`);
      }
    } catch (e) {
      console.error('[assign-tos-role] Role assignment failed:', e.message);
      return json({ error: 'Role assignment failed' }, 502, origin);
    }

    return json({ success: true, assignedAt: new Date().toISOString() }, 200, origin);
  },
};
