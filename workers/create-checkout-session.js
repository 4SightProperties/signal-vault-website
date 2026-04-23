/**
 * Signal Vault — Cloudflare Worker: create-checkout-session
 *
 * Creates a Stripe Checkout session server-side and returns the session ID.
 * The client calls stripe.redirectToCheckout({ sessionId }) to redirect.
 *
 * Deploy:
 *   wrangler deploy --config workers/create-checkout-session.toml
 *
 * Required secrets (wrangler secret put <NAME>):
 *   STRIPE_SECRET_KEY  — sk_test_... or sk_live_... (never expose client-side)
 *   BOT_TOKEN          — Discord bot token (for role verification)
 *   GUILD_ID           — Signal Vault server ID
 *   VERIFIED_ROLE_ID   — @Verified role ID
 *   DISCLAIMER_ROLE_ID — @Acknowledged Discl... role ID
 *   TOS_ROLE_ID        — @ToS-Accepted role ID
 */

const DISCORD_API = 'https://discord.com/api/v10';
const STRIPE_API  = 'https://api.stripe.com/v1';

// ── Allowed origins ──────────────────────────────────────────────────────────
const ALLOWED_ORIGINS = new Set([
  'https://4sightproperties.github.io',
  'https://pay.signalvault.com',
]);

// ── Price IDs (not secrets — safe to hardcode) ───────────────────────────────
const PRICE_IDS = {
  proMonthly:   'price_1TO8h8CAG23wiziiMeAbfz3r',
  proAnnual:    'price_1TO94ACAG23wiziiB0bWOQee',
  eliteMonthly: 'price_1TO91iCAG23wiziiodJ71huV',
  eliteAnnual:  'price_1TO90mCAG23wiziiPQlTMGKF',
};

const EARLY_ADOPTER_COUPON = 'OKeQCnao';

const SUCCESS_URL = 'https://4sightproperties.github.io/signal-vault-website/success.html?session_id={CHECKOUT_SESSION_ID}';
const CANCEL_URL  = 'https://4sightproperties.github.io/signal-vault-website/cancel.html';

// ── CORS helper ──────────────────────────────────────────────────────────────
function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin':  ALLOWED_ORIGINS.has(origin) ? origin : '',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Max-Age':       '86400',
  };
}

function json(data, status = 200, origin = '') {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

// ── Discord helpers ──────────────────────────────────────────────────────────

async function verifyDiscordToken(token) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid Discord token');
  return res.json();
}

async function fetchMemberRoles(env, userId) {
  const res = await fetch(`${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
  });
  if (res.status === 404) throw new Error('User is not a server member');
  if (!res.ok) throw new Error(`Discord member fetch failed: ${res.status}`);
  const member = await res.json();
  return member.roles || [];
}

// ── Stripe helper ────────────────────────────────────────────────────────────

async function createSession(env, { priceId, plan, earlyAdopter, discordUserId, discordUsername }) {
  const params = new URLSearchParams({
    mode:                                    'subscription',
    'line_items[0][price]':                  priceId,
    'line_items[0][quantity]':               '1',
    success_url:                             SUCCESS_URL,
    cancel_url:                              CANCEL_URL,
    client_reference_id:                     discordUserId,
    'metadata[discord_user_id]':             discordUserId,
    'metadata[discord_username]':            discordUsername || '',
    'metadata[plan]':                        plan,
    // Metadata on the subscription itself (accessible in webhooks)
    'subscription_data[metadata][discord_user_id]': discordUserId,
    'subscription_data[metadata][discord_username]': discordUsername || '',
    'subscription_data[metadata][plan]':     plan,
  });

  if (earlyAdopter) {
    params.set('discounts[0][coupon]', EARLY_ADOPTER_COUPON);
  }

  const res = await fetch(`${STRIPE_API}/checkout/sessions`, {
    method:  'POST',
    headers: {
      Authorization:  `Bearer ${env.STRIPE_SECRET_KEY}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe API ${res.status}`);
  }

  return res.json();
}

// ── Main handler ─────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }

    if (request.method !== 'POST') {
      return json({ error: 'Method not allowed' }, 405, origin);
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return json({ error: 'Invalid JSON body' }, 400, origin);
    }

    const { plan, billing, earlyAdopter, discordToken, discordUserId, discordUsername } = body;

    if (!plan || !billing || !discordToken || !discordUserId) {
      return json({ error: 'Missing required fields: plan, billing, discordToken, discordUserId' }, 400, origin);
    }

    // ── Resolve price ID ─────────────────────────────────────────────────────
    const priceKey = plan + (billing === 'monthly' ? 'Monthly' : 'Annual');
    const priceId  = PRICE_IDS[priceKey];
    if (!priceId) {
      return json({ error: `Unknown plan/billing combination: ${plan}/${billing}` }, 400, origin);
    }

    // ── Step 1: Verify Discord OAuth token belongs to claimed user ────────────
    let verifiedUser;
    try {
      verifiedUser = await verifyDiscordToken(discordToken);
    } catch (e) {
      return json({ error: e.message }, 401, origin);
    }

    if (verifiedUser.id !== discordUserId) {
      return json({ error: 'Discord token / userId mismatch' }, 403, origin);
    }

    // ── Step 2: Confirm all 3 required roles are present ─────────────────────
    let memberRoles;
    try {
      memberRoles = await fetchMemberRoles(env, discordUserId);
    } catch (e) {
      return json({ error: e.message }, 403, origin);
    }

    const missing = [];
    if (!memberRoles.includes(env.VERIFIED_ROLE_ID))   missing.push('@Verified');
    if (!memberRoles.includes(env.DISCLAIMER_ROLE_ID)) missing.push('@Acknowledged Discl...');
    if (!memberRoles.includes(env.TOS_ROLE_ID))        missing.push('@ToS-Accepted');

    if (missing.length > 0) {
      return json({ error: `Missing required roles: ${missing.join(', ')}` }, 403, origin);
    }

    // ── Step 3: Create Stripe Checkout session ────────────────────────────────
    let session;
    try {
      session = await createSession(env, {
        priceId,
        plan,
        earlyAdopter: !!earlyAdopter,
        discordUserId,
        discordUsername: discordUsername || verifiedUser.username || '',
      });
    } catch (e) {
      console.error('[create-checkout-session] Stripe error:', e.message);
      return json({ error: e.message }, 502, origin);
    }

    return json({ sessionId: session.id }, 200, origin);
  },
};
