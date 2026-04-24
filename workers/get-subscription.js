/**
 * Signal Vault — Cloudflare Worker: get-subscription
 *
 * Returns live Stripe subscription data for the authenticated Discord user.
 *
 * Flow:
 *   1. Verify Discord OAuth token → confirm user owns claimed discordUserId
 *   2. Look up Stripe customer ID from KV (written by stripe-webhook on checkout)
 *   3. Fetch active/past-due subscription from Stripe API
 *   4. Return structured plan data + isGrandfathered flag
 *
 * Deploy:
 *   wrangler deploy --config workers/get-subscription.toml
 *
 * Required secrets (wrangler secret put <NAME> --config workers/get-subscription.toml):
 *   STRIPE_SECRET_KEY — sk_test_... or sk_live_...
 *
 * Required KV (same namespace id as stripe-webhook.toml):
 *   DISCORD_STRIPE_KV — binding to the shared discord→customer mapping namespace
 *
 * Response shape (200):
 *   { found: true,  customerId, subscriptionId, status, plan, billing,
 *     amount, nextPaymentDate, cancelAtPeriodEnd, isGrandfathered }
 *
 * Response shape (subscription not found / no KV entry):
 *   { found: false }
 */

const DISCORD_API          = 'https://discord.com/api/v10';
const STRIPE_API           = 'https://api.stripe.com/v1';
const EARLY_ADOPTER_COUPON = '0Xg6FV0n';

// Status priority for selecting the "best" subscription when multiple exist
const STATUS_PRIORITY = { active: 0, trialing: 1, past_due: 2 };

// Only these statuses represent actual access — canceled/incomplete/etc. are excluded
const ACTIVE_STATUSES = new Set(['active', 'trialing', 'past_due']);

const ALLOWED_ORIGINS = new Set([
  'https://4sightproperties.github.io',
  'https://pay.signalvault.com',
]);

// ── CORS ──────────────────────────────────────────────────────────────────────

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

// ── Discord token verification ────────────────────────────────────────────────

async function verifyDiscordToken(token) {
  const res = await fetch(`${DISCORD_API}/users/@me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('Invalid Discord token');
  return res.json();
}

// ── Stripe helpers ────────────────────────────────────────────────────────────

async function fetchSubscriptions(env, customerId) {
  const params = new URLSearchParams({
    customer: customerId,
    status:   'all',
    limit:    '10',
  });
  params.append('expand[]', 'data.discount.coupon');  // older API compat
  params.append('expand[]', 'data.discounts');         // expand IDs → full objects (source.coupon)
  params.append('expand[]', 'data.latest_invoice');   // effective amount after discounts

  const res = await fetch(`${STRIPE_API}/subscriptions?${params}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe API ${res.status}`);
  }

  const { data } = await res.json();
  return data || [];
}

function selectSubscription(subscriptions) {
  const eligible = subscriptions.filter(s => ACTIVE_STATUSES.has(s.status));
  if (!eligible.length) return null;

  // Pick highest-priority status; within same status take most recently created
  return eligible.sort((a, b) => {
    const pa = STATUS_PRIORITY[a.status] ?? 99;
    const pb = STATUS_PRIORITY[b.status] ?? 99;
    if (pa !== pb) return pa - pb;
    return b.created - a.created;
  })[0];
}

function parsePlan(subscription) {
  const item     = subscription.items?.data?.[0];
  const price    = item?.price;
  const interval = price?.recurring?.interval; // 'month' | 'year'

  const plan    = subscription.metadata?.plan || 'pro';
  const billing = interval === 'year' ? 'annual' : 'monthly';

  // latest_invoice.total reflects actual charge after discounts; fall back to list price
  const invoiceTotal   = subscription.latest_invoice?.total;
  const unitAmount     = price?.unit_amount ?? 0;
  const effectiveCents = invoiceTotal != null ? invoiceTotal : unitAmount;

  return { plan, billing, amount: Math.round(effectiveCents / 100) };
}

function parseGrandfathered(subscription) {
  const singularMatch = subscription.discount?.coupon?.id === EARLY_ADOPTER_COUPON;
  const arrayMatch    = subscription.discounts?.some(
    d => d.coupon?.id === EARLY_ADOPTER_COUPON       // older API format
      || d.source?.coupon === EARLY_ADOPTER_COUPON   // newer API format (confirmed)
  );
  return singularMatch || arrayMatch || false;
}

// ── Main handler ──────────────────────────────────────────────────────────────

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

    const { discordToken, discordUserId } = body;

    if (!discordToken || !discordUserId) {
      return json({ error: 'Missing discordToken or discordUserId' }, 400, origin);
    }

    // ── Step 1: Verify Discord token ──────────────────────────────────────────
    let verifiedUser;
    try {
      verifiedUser = await verifyDiscordToken(discordToken);
    } catch (e) {
      return json({ error: e.message }, 401, origin);
    }

    if (verifiedUser.id !== discordUserId) {
      return json({ error: 'Discord token / userId mismatch' }, 403, origin);
    }

    // ── Step 2: Look up Stripe customer ID ────────────────────────────────────
    const customerId = await env.DISCORD_STRIPE_KV.get(discordUserId);
    if (!customerId) {
      return json({ found: false }, 200, origin);
    }

    // ── Step 3: Fetch subscriptions ───────────────────────────────────────────
    let subscriptions;
    try {
      subscriptions = await fetchSubscriptions(env, customerId);
    } catch (e) {
      console.error('[get-subscription] Stripe error:', e.message);
      return json({ error: 'Failed to fetch subscription data' }, 502, origin);
    }

    const subscription = selectSubscription(subscriptions);
    if (!subscription) {
      return json({ found: false }, 200, origin);
    }

    // ── Step 4: Build response ────────────────────────────────────────────────
    const { plan, billing, amount } = parsePlan(subscription);

    return json({
      found:              true,
      customerId,
      subscriptionId:     subscription.id,
      status:             subscription.status,
      plan,
      billing,
      amount,
      nextPaymentDate:    subscription.current_period_end
                       ?? subscription.items?.data?.[0]?.current_period_end
                       ?? null,
      cancelAtPeriodEnd:  subscription.cancel_at_period_end,
      isGrandfathered:    parseGrandfathered(subscription),
    }, 200, origin);
  },
};
