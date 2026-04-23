# Signal Vault — Subscription Platform

GitHub Pages subscription site with Discord role verification and Stripe payment integration.

**Live URL:** https://pay.signalvault.com

---

## Architecture

| Layer | Technology |
|---|---|
| Hosting | GitHub Pages (static) |
| Payments | Stripe Payment Links + Customer Portal |
| Auth/Verification | Discord OAuth2 implicit flow (client-side) |
| Styling | Vanilla CSS with CSS custom properties |
| JavaScript | Vanilla JS — no frameworks, no build step |

No server required. All Discord authentication runs client-side using the OAuth2 implicit grant flow.

---

## Prerequisites

- GitHub repository with Pages enabled
- Custom domain configured (optional — see CNAME)
- Stripe account (paid plan for recurring subscriptions)
- Discord server with Developer Mode enabled
- Discord application created at https://discord.com/developers/applications

---

## Setup Guide

### Step 1 — Discord Application

1. Go to https://discord.com/developers/applications
2. Create a new application named "Signal Vault"
3. Navigate to **OAuth2 → General**
4. Copy your **Client ID**
5. Add your redirect URI: `https://pay.signalvault.com/` (exact match including trailing slash)
6. Also add `http://localhost:8080/` for local development

### Step 2 — Discord Server Setup

1. Enable Developer Mode: Discord Settings → Advanced → Developer Mode
2. Right-click your server → **Copy Server ID** → this is your `guildId`
3. Create three roles (if not already present):
   - `@Verified`
   - `@Disclaimer-Acknowledged`
   - `@ToS-Accepted`
4. Right-click each role → **Copy Role ID**

### Step 3 — Stripe Setup

1. Create products for each plan in Stripe Dashboard → Products:
   - PRO Monthly ($99), PRO Annual ($990)
   - ELITE Monthly ($150), ELITE Annual ($1,500)
   - PRO Monthly Early ($69), PRO Annual Early ($690)
   - ELITE Monthly Early ($105), ELITE Annual Early ($1,050)
   - Waitlist Deposits: Tier 2 ($50), Tier 3 ($75), Tier 4 ($100), Tier 5 ($125)

2. For each product, create a **Payment Link**:
   - Dashboard → Payment Links → Create
   - Set success URL: `https://pay.signalvault.com/success.html`
   - Set cancel URL: `https://pay.signalvault.com/cancel.html`
   - For subscription products, enable recurring billing

3. Configure **Customer Portal**:
   - Dashboard → Settings → Billing → Customer portal
   - Enable the portal and configure allowed actions
   - Copy the **portal link** (format: `https://billing.stripe.com/p/login/XXXXX`)

4. For Discord role automation on subscription:
   - Set up a Stripe webhook → listen for `customer.subscription.created` and `customer.subscription.deleted`
   - Use a serverless function (Netlify, Vercel, Cloudflare Workers) to call Discord's API to assign/remove roles
   - This step is optional for launch but recommended for automation

### Step 4 — Configure the Site

Edit `js/config.js` and replace all placeholder values:

```javascript
discord: {
  clientId:    'YOUR_ACTUAL_CLIENT_ID',
  guildId:     'YOUR_ACTUAL_SERVER_ID',
  redirectUri: 'https://pay.signalvault.com/',
  requiredRoles: {
    verified:   'ACTUAL_ROLE_ID',
    disclaimer: 'ACTUAL_ROLE_ID',
    tos:        'ACTUAL_ROLE_ID',
  },
  serverInvite: 'https://discord.gg/YOUR_ACTUAL_INVITE',
},
stripe: {
  customerPortalUrl: 'https://billing.stripe.com/p/login/YOUR_ACTUAL_ID',
  paymentLinks: {
    proMonthly: 'https://buy.stripe.com/YOUR_ACTUAL_LINK',
    // ... all other links
  },
},
capacity: {
  activeCurrent:    0,   // UPDATE this as members join
  earlyAdopterUsed: 0,   // UPDATE this as early adopter slots fill
},
```

Also update the Discord invite links in `success.html` and `cancel.html` (search for `YOUR_INVITE_CODE`).

### Step 5 — Deploy to GitHub Pages

```bash
# Create a new repository (or use existing)
git init
git add .
git commit -m "Initial Signal Vault subscription site"
git remote add origin https://github.com/YOUR_USERNAME/signal-vault-payments.git
git push -u origin main

# Enable GitHub Pages
# Repository Settings → Pages → Source: Deploy from branch → main → / (root)
```

If using a custom domain:
1. The `CNAME` file already contains `pay.signalvault.com`
2. Add a CNAME DNS record: `pay` → `YOUR_USERNAME.github.io`
3. Wait for DNS propagation (up to 48 hours)
4. GitHub will automatically provision HTTPS via Let's Encrypt

---

## Updating Member Capacity

Member counts are configured in `js/config.js` and must be updated manually:

```javascript
capacity: {
  activeCurrent:    12,  // Current active member count
  earlyAdopterUsed: 11,  // How many early adopter slots used
  waitlistCurrent:  0,   // Current waitlist depth (determines tier shown)
},
```

**Automation options:**
- GitHub Actions: Set up a workflow that updates `config.js` via Stripe webhook → GitHub API
- Netlify/Vercel function: Intercept Stripe webhook, update a JSON endpoint, have the site fetch from it
- Manual: Update after each new subscriber joins

---

## Local Development

```bash
# Serve locally (Python)
cd subscription_site
python3 -m http.server 8080

# Or with Node
npx serve . -p 8080
```

Open `http://localhost:8080`

> **Note:** Discord OAuth will redirect to `pay.signalvault.com` unless you also add `http://localhost:8080/` as a redirect URI in your Discord application settings.

---

## File Structure

```
subscription_site/
├── index.html          Main pricing page
├── account.html        Customer portal
├── success.html        Post-payment confirmation
├── cancel.html         Payment canceled
├── terms.html          Terms of Service
├── privacy.html        Privacy Policy
├── CNAME               Custom domain
├── robots.txt          SEO directives
├── .gitignore
├── README.md
├── css/
│   └── style.css       Complete design system
└── js/
    ├── config.js       All configuration (fill in before deploying)
    ├── discord-auth.js Discord OAuth2 client
    └── app.js          Application logic & UI rendering
```

---

## Security Notes

- **Never commit real API keys or secrets** — `config.js` uses placeholder values that must be filled in
- Discord tokens are stored in `sessionStorage` only — they expire with the browser session
- Stripe payment links are public but payment buttons are disabled until Discord verification passes
- The Discord OAuth implicit flow is appropriate here because we only need read-only role verification, not persistent server-side access

---

## Support

For setup help, open a ticket in the Signal Vault Discord server.
