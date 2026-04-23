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

    // Subscription tier role IDs — assigned after payment confirmed
    subscriptionRoles: {
      pro:   'ROLE_ID_PRO',    // ⚡ Pro
      elite: 'ROLE_ID_ELITE',  // 🏆 Elite
    },

    // Discord server invite (for users who need to join first)
    serverInvite: 'https://discord.gg/YOUR_INVITE_CODE',
  },

  // ── Stripe Payment Links ──────────────────────────────────────
  // Create each product in Stripe → Products, then create Payment Links.
  // Add ?prefilled_email={DISCORD_EMAIL} if you collect email via Discord OAuth.
  stripe: {
    // Customer self-service portal — Stripe Dashboard → Billing → Customer portal
    customerPortalUrl: 'https://billing.stripe.com/p/login/YOUR_PORTAL_ID',

    paymentLinks: {
      // Active Members — Regular pricing
      proMonthly:              'https://buy.stripe.com/REPLACE_ME',
      proAnnual:               'https://buy.stripe.com/REPLACE_ME',
      eliteMonthly:            'https://buy.stripe.com/REPLACE_ME',
      eliteAnnual:             'https://buy.stripe.com/REPLACE_ME',

      // Active Members — Early Adopter pricing (30% off)
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
  // Update these manually (or via a small backend/GitHub Action) as members join.
  capacity: {
    activeMax:          20,   // Hard cap on active members
    earlyAdopterMax:    15,   // Total early adopter coupons available
    activeCurrent:       0,   // UPDATE: current active member count
    earlyAdopterUsed:    0,   // UPDATE: how many early adopter slots used
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
    name:      'Signal Vault',
    tagline:   'Institutional-Grade Signals for the Individual Trader',
    domain:    'pay.signalvault.com',
    discordBot: 'https://discord.gg/YOUR_INVITE_CODE',
    successUrl: 'https://pay.signalvault.com/success.html',
    cancelUrl:  'https://pay.signalvault.com/cancel.html',
  },
};
