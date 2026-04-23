/**
 * Signal Vault — Cloudflare Worker: stripe-webhook
 *
 * Handles Stripe webhook events to assign/remove Discord subscription roles.
 *
 * Events handled:
 *   checkout.session.completed  → assign @Pro or @Elite based on session.metadata.plan
 *   customer.subscription.deleted → remove @Pro / @Elite role
 *
 * Deploy:
 *   wrangler deploy --config workers/stripe-webhook.toml
 *
 * Required secrets (wrangler secret put <NAME> --config workers/stripe-webhook.toml):
 *   STRIPE_WEBHOOK_SECRET — whsec_... from Stripe Dashboard → Webhooks → signing secret
 *   BOT_TOKEN             — Discord bot token
 *   GUILD_ID              — Signal Vault server ID
 *   PRO_ROLE_ID           — @Pro role ID
 *   ELITE_ROLE_ID         — @Elite role ID
 *
 * Stripe Dashboard → Webhooks → Add endpoint:
 *   URL: <deployed worker URL>
 *   Events: checkout.session.completed, customer.subscription.deleted
 */

const DISCORD_API = 'https://discord.com/api/v10';

// ── Stripe signature verification (Web Crypto — no SDK needed) ───────────────

async function verifyStripeSignature(rawBody, sigHeader, secret) {
  const parts = Object.fromEntries(
    sigHeader.split(',').map(p => p.split('='))
  );
  const timestamp = parts['t'];
  const v1        = parts['v1'];

  if (!timestamp || !v1) throw new Error('Malformed Stripe-Signature header');

  // Reject webhooks older than 5 minutes
  const age = Math.abs(Date.now() / 1000 - Number(timestamp));
  if (age > 300) throw new Error('Webhook timestamp too old');

  const signed  = `${timestamp}.${rawBody}`;
  const encoder = new TextEncoder();
  const key     = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const sig     = await crypto.subtle.sign('HMAC', key, encoder.encode(signed));
  const hex     = Array.from(new Uint8Array(sig)).map(b => b.toString(16).padStart(2, '0')).join('');

  if (hex !== v1) throw new Error('Stripe signature mismatch');
}

// ── Discord helpers ───────────────────────────────────────────────────────────

async function addRole(env, userId, roleId) {
  const res = await fetch(
    `${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method:  'PUT',
      headers: {
        Authorization:       `Bot ${env.BOT_TOKEN}`,
        'X-Audit-Log-Reason': 'Signal Vault subscription confirmed',
      },
    }
  );
  if (res.status !== 204) {
    const text = await res.text();
    throw new Error(`Discord addRole ${res.status}: ${text}`);
  }
}

async function removeRole(env, userId, roleId) {
  const res = await fetch(
    `${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}/roles/${roleId}`,
    {
      method:  'DELETE',
      headers: {
        Authorization:       `Bot ${env.BOT_TOKEN}`,
        'X-Audit-Log-Reason': 'Signal Vault subscription cancelled',
      },
    }
  );
  // 204 = removed, 404 = user doesn't have the role (both are fine)
  if (res.status !== 204 && res.status !== 404) {
    const text = await res.text();
    throw new Error(`Discord removeRole ${res.status}: ${text}`);
  }
}

async function fetchMemberRoles(env, userId) {
  const res = await fetch(`${DISCORD_API}/guilds/${env.GUILD_ID}/members/${userId}`, {
    headers: { Authorization: `Bot ${env.BOT_TOKEN}` },
  });
  if (res.status === 404) return null; // not in server
  if (!res.ok) throw new Error(`Discord member fetch ${res.status}`);
  const member = await res.json();
  return member.roles || [];
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(env, session) {
  const discordUserId = session.client_reference_id || session.metadata?.discord_user_id;
  const plan          = session.metadata?.plan; // 'pro' or 'elite'

  if (!discordUserId) {
    console.error('[webhook] checkout.session.completed missing discord_user_id');
    return;
  }
  if (!plan) {
    console.error('[webhook] checkout.session.completed missing plan in metadata');
    return;
  }

  const roleId = plan === 'elite' ? env.ELITE_ROLE_ID : env.PRO_ROLE_ID;
  if (!roleId) {
    console.error(`[webhook] No role ID configured for plan: ${plan}`);
    return;
  }

  try {
    await addRole(env, discordUserId, roleId);
    console.log(`[webhook] Assigned @${plan} (${roleId}) to user ${discordUserId}`);
  } catch (e) {
    console.error(`[webhook] Failed to assign role: ${e.message}`);
    throw e; // rethrow so Stripe retries
  }

  // Persist Discord ID → Stripe customer ID for subscription lookups.
  const customerId = session.customer;
  if (customerId && env.DISCORD_STRIPE_KV) {
    await env.DISCORD_STRIPE_KV.put(discordUserId, customerId);
    console.log(`[webhook] Mapped ${discordUserId} → ${customerId}`);
  }
}

async function handleSubscriptionDeleted(env, subscription) {
  const discordUserId = subscription.metadata?.discord_user_id;
  if (!discordUserId) {
    console.error('[webhook] customer.subscription.deleted missing discord_user_id');
    return;
  }

  // Remove both roles — safe since removeRole ignores 404
  const errors = [];
  for (const roleId of [env.PRO_ROLE_ID, env.ELITE_ROLE_ID]) {
    if (!roleId) continue;
    try {
      await removeRole(env, discordUserId, roleId);
    } catch (e) {
      errors.push(e.message);
    }
  }
  if (errors.length) throw new Error(errors.join('; '));
  console.log(`[webhook] Removed subscription roles from user ${discordUserId}`);
}

// ── Main handler ──────────────────────────────────────────────────────────────

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method not allowed', { status: 405 });
    }

    const sigHeader = request.headers.get('Stripe-Signature');
    if (!sigHeader) {
      return new Response('Missing Stripe-Signature', { status: 400 });
    }

    const rawBody = await request.text();

    try {
      await verifyStripeSignature(rawBody, sigHeader, env.STRIPE_WEBHOOK_SECRET);
    } catch (e) {
      console.error('[webhook] Signature verification failed:', e.message);
      return new Response(`Unauthorized: ${e.message}`, { status: 401 });
    }

    let event;
    try {
      event = JSON.parse(rawBody);
    } catch {
      return new Response('Invalid JSON', { status: 400 });
    }

    try {
      switch (event.type) {
        case 'checkout.session.completed':
          await handleCheckoutCompleted(env, event.data.object);
          break;
        case 'customer.subscription.deleted':
          await handleSubscriptionDeleted(env, event.data.object);
          break;
        default:
          // Unhandled event type — acknowledge without action
          break;
      }
    } catch (e) {
      console.error(`[webhook] Handler error for ${event.type}:`, e.message);
      // Return 500 so Stripe retries
      return new Response(`Handler error: ${e.message}`, { status: 500 });
    }

    return new Response(JSON.stringify({ received: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  },
};
