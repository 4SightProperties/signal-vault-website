/**
 * Signal Vault — One-time backfill: Discord ID → Stripe customer ID mapping
 *
 * Run ONCE after deploying the updated stripe-webhook (which writes new mappings
 * automatically going forward). This fills in existing sandbox subscribers.
 *
 * Deploy to a temporary worker (or reuse sv-get-subscription.toml with a
 * different main entry), trigger via HTTP GET with a secret key, then delete.
 *
 * Trigger:
 *   curl "https://<worker-url>/?secret=<BACKFILL_SECRET>"
 *
 * Required secrets:
 *   STRIPE_SECRET_KEY — sk_test_... or sk_live_...
 *   BACKFILL_SECRET   — any random string; guards the endpoint
 *
 * Required KV:
 *   DISCORD_STRIPE_KV — same namespace as stripe-webhook + get-subscription
 *
 * Strategy:
 *   1. Page through all Stripe customers
 *   2. For each customer, check customer.metadata.discord_user_id
 *   3. If not on customer, expand subscriptions and check subscription.metadata.discord_user_id
 *   4. Write KV entry for all found mappings
 *   5. Log orphans (customers with no Discord ID anywhere) for manual reconciliation
 *
 * Deploy as a temporary worker:
 *   wrangler deploy --config workers/backfill-mapping.toml   (create this toml)
 *   # then after running:
 *   wrangler delete sv-backfill-mapping
 */

const STRIPE_API = 'https://api.stripe.com/v1';

async function stripeGet(env, path) {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error?.message || `Stripe ${res.status} at ${path}`);
  }
  return res.json();
}

// Iterates all Stripe customers using cursor pagination
async function* listAllCustomers(env) {
  let startingAfter = null;
  while (true) {
    const params = new URLSearchParams({ limit: '100', 'expand[]': 'data.subscriptions' });
    if (startingAfter) params.set('starting_after', startingAfter);

    const page = await stripeGet(env, `/v1/customers?${params}`);
    for (const customer of page.data) yield customer;

    if (!page.has_more) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
}

function extractDiscordId(customer) {
  // Check customer-level metadata first (set by some checkout flows)
  const fromCustomer = customer.metadata?.discord_user_id;
  if (fromCustomer) return fromCustomer;

  // Fall back to subscription metadata (set by create-checkout-session.js)
  const subs = customer.subscriptions?.data || [];
  for (const sub of subs) {
    const fromSub = sub.metadata?.discord_user_id;
    if (fromSub) return fromSub;
  }

  return null;
}

export default {
  async fetch(request, env) {
    // Guard — require secret to prevent accidental triggering
    const url    = new URL(request.url);
    const secret = url.searchParams.get('secret');
    if (!secret || secret !== env.BACKFILL_SECRET) {
      return new Response('Unauthorized', { status: 401 });
    }

    if (request.method !== 'GET') {
      return new Response('Use GET', { status: 405 });
    }

    const mapped  = [];  // { discordId, customerId }
    const orphans = [];  // { customerId, email } — no Discord ID found anywhere

    let processed = 0;

    try {
      for await (const customer of listAllCustomers(env)) {
        processed++;
        const discordId = extractDiscordId(customer);

        if (discordId) {
          await env.DISCORD_STRIPE_KV.put(discordId, customer.id);
          mapped.push({ discordId, customerId: customer.id, email: customer.email || '' });
          console.log(`[backfill] Mapped ${discordId} → ${customer.id}`);
        } else {
          orphans.push({ customerId: customer.id, email: customer.email || '' });
          console.warn(`[backfill] Orphan (no discord_user_id): ${customer.id} ${customer.email || ''}`);
        }
      }
    } catch (e) {
      return new Response(JSON.stringify({
        error:     e.message,
        processed,
        mapped:    mapped.length,
        orphans:   orphans.length,
      }), { status: 500, headers: { 'Content-Type': 'application/json' } });
    }

    const report = {
      processed,
      mapped:       mapped.length,
      orphanCount:  orphans.length,
      mappings:     mapped,
      orphans,
    };

    console.log(`[backfill] Done. ${mapped.length} mapped, ${orphans.length} orphans.`);

    return new Response(JSON.stringify(report, null, 2), {
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
