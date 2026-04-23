// js/config.js
// ─────────────────────────────────────────────────────────────────
// Signal Vault Subscription Platform — Configuration
// Fill in YOUR values before deploying.
// ─────────────────────────────────────────────────────────────────

const CONFIG = {

  // ── Discord OAuth App ─────────────────────────────────────────
  discord: {
    clientId:    'YOUR_DISCORD_CLIENT_ID',        // Discord Developer Portal → OAuth2 → Client ID
    guildId:     'YOUR_DISCORD_SERVER_ID',         // Right-click server → Copy Server ID (dev mode on)
    redirectUri: 'https://pay.signalvault.com/',   // Must match exactly in Discord OAuth2 Redirects

    // Role IDs — right-click role → Copy Role ID (dev mode on)
    requiredRoles: {
      verified:   'ROLE_ID_VERIFIED',               // @Verified
      disclaimer: 'ROLE_ID_DISCLAIMER_ACKNOWLEDGED',// @Acknowledged Discl...
      tos:        'ROLE_ID_TOS_ACCEPTED',            // @ToS-Accepted
    },

    // Human-readable role names shown in the UI (match exact Discord role names)
    roleLabels: {
      verified:   '@Verified',
      disclaimer: '@Acknowledged Discl...',
      tos:        '@ToS-Accepted',
    },

    // Subscription tier role IDs — assigned after payment confirmed via webhook
    subscriptionRoles: {
      pro:   'ROLE_ID_PRO',    // ⚡ Pro
      elite: 'ROLE_ID_ELITE',  // 🏆 Elite
    },

    // Discord server invite (for users who need to join first)
    serverInvite: 'https://discord.gg/YOUR_INVITE_CODE',
  },

  // ── Stripe ────────────────────────────────────────────────────
  stripe: {
    // Publishable key — Stripe Dashboard → Developers → API Keys
    // Use pk_test_... for testing, pk_live_... for production
    publishableKey: 'pk_live_YOUR_PUBLISHABLE_KEY',

    // Customer self-service portal — Stripe Dashboard → Billing → Customer portal
    customerPortalUrl: 'https://billing.stripe.com/p/login/YOUR_PORTAL_ID',

    // Price IDs — Stripe Dashboard → Products → [product] → Pricing → Copy price ID
    prices: {
      proMonthly:   'price_REPLACE_ME',   // $99/month
      proAnnual:    'price_REPLACE_ME',   // $990/year
      eliteMonthly: 'price_REPLACE_ME',   // $150/month
      eliteAnnual:  'price_REPLACE_ME',   // $1,500/year
    },

    // Early adopter coupon — Stripe Dashboard → Products → Coupons → Create (30% off, forever)
    // Applied automatically for first 15 subscribers
    earlyAdopterCoupon: 'COUPON_ID_30PCT_OFF',

    // Payment Links (fallback — used if price IDs are not yet configured)
    // Create in Stripe Dashboard → Payment Links
    paymentLinks: {
      // Regular pricing
      proMonthly:              'https://buy.stripe.com/REPLACE_ME',
      proAnnual:               'https://buy.stripe.com/REPLACE_ME',
      eliteMonthly:            'https://buy.stripe.com/REPLACE_ME',
      eliteAnnual:             'https://buy.stripe.com/REPLACE_ME',

      // Early Adopter pricing (30% off — separate links with coupon pre-applied)
      proMonthlyEarly:         'https://buy.stripe.com/REPLACE_ME',
      proAnnualEarly:          'https://buy.stripe.com/REPLACE_ME',
      eliteMonthlyEarly:       'https://buy.stripe.com/REPLACE_ME',
      eliteAnnualEarly:        'https://buy.stripe.com/REPLACE_ME',

      // Waitlist deposits (applied as credit toward first month)
      tier2Deposit:            'https://buy.stripe.com/REPLACE_ME',
      tier3Deposit:            'https://buy.stripe.com/REPLACE_ME',
      tier4Deposit:            'https://buy.stripe.com/REPLACE_ME',
      tier5Deposit:            'https://buy.stripe.com/REPLACE_ME',
    },
  },

  // ── Capacity & Availability ───────────────────────────────────
  // IMPORTANT: totalSold is a one-way counter — it only goes up.
  // Cancellations do NOT reopen slots. Once 20 are sold, the tier is closed forever.
  // Update totalSold and earlyAdopterUsed manually after each confirmed subscription
  // (or automate via a Stripe webhook → serverless function → GitHub API commit).
  capacity: {
    activeMax:          20,   // Hard lifetime cap — once reached, closed forever
    earlyAdopterMax:    15,   // First 15 subscribers get 30% off automatically
    totalSold:           0,   // UPDATE: total subscriptions ever sold (never decreases)
    earlyAdopterUsed:    0,   // UPDATE: how many of the 15 early adopter slots claimed
    waitlistCurrent:     0,   // UPDATE: current waitlist position (determines tier)
  },

  // ── Pricing ───────────────────────────────────────────────────
  pricing: {
    active: {
      pro:   { monthly: 99,  annual: 990  },
      elite: { monthly: 150, annual: 1500 },
    },
    earlyAdopter: {
      pro:   { monthly: 69,  annual: 690  },
      elite: { monthly: 105, annual: 1050 },
    },
    waitlist: {
      tier2: { deposit: 50,  monthly: 125, annual: 1275 },
      tier3: { deposit: 75,  monthly: 155, annual: 1581 },
      tier4: { deposit: 100, monthly: 195, annual: 1989 },
      tier5: { deposit: 125, monthly: 245, annual: 2499 },
    },
  },

  // ── Site ─────────────────────────────────────────────────────
  site: {
    name:        'Signal Vault',
    tagline:     'Institutional-Grade Signals for the Individual Trader',
    domain:      'pay.signalvault.com',
    discordBot:  'https://discord.gg/YOUR_INVITE_CODE',
    successUrl:  'https://pay.signalvault.com/success.html',
    cancelUrl:   'https://pay.signalvault.com/cancel.html',
  },
};
