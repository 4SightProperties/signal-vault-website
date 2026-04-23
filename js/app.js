// js/app.js
// Main application logic — page detection, state management, UI rendering

const App = (() => {

  // ── State ─────────────────────────────────────────────────────
  let state = {
    auth:        { state: 'unauthenticated', user: null, roleStatus: null },
    billing:     'monthly',   // 'monthly' | 'annual'
    earlyAdopter: false,
    activeMode:  true,        // true = lifetime cap not reached; false = waitlist
    capacity:    CONFIG.capacity,
    tosAssigning: false,      // true while awaiting Worker response
  };

  // ── Derived state ─────────────────────────────────────────────

  // One-way gate: checks total ever sold, not active count
  function isActiveMode() {
    return state.capacity.totalSold < state.capacity.activeMax;
  }

  function hasEarlyAdopterSlots() {
    return state.capacity.earlyAdopterUsed < state.capacity.earlyAdopterMax;
  }

  function getSlotsRemaining() {
    return Math.max(0, state.capacity.activeMax - state.capacity.totalSold);
  }

  function getEarlyAdopterRemaining() {
    return Math.max(0, state.capacity.earlyAdopterMax - state.capacity.earlyAdopterUsed);
  }

  function getCurrentWaitlistTier() {
    const n = state.capacity.waitlistCurrent;
    if (n < 50)  return 'tier2';
    if (n < 150) return 'tier3';
    if (n < 300) return 'tier4';
    return 'tier5';
  }

  // ── Price helpers ─────────────────────────────────────────────

  function getPrice(plan, billing, early) {
    const src = early
      ? CONFIG.pricing.earlyAdopter[plan]
      : CONFIG.pricing.active[plan];
    return src ? src[billing] : 0;
  }

  function getPaymentLink(plan, billing, early) {
    const links = CONFIG.stripe.paymentLinks;
    const key = early
      ? `${plan}${billing === 'monthly' ? 'Monthly' : 'Annual'}Early`
      : `${plan}${billing === 'monthly' ? 'Monthly' : 'Annual'}`;
    return links[key] || '#';
  }

  function getWaitlistLink(tier) {
    return CONFIG.stripe.paymentLinks[`${tier}Deposit`] || '#';
  }

  // ── UI helpers ────────────────────────────────────────────────

  function formatPrice(cents) {
    return '$' + cents.toLocaleString();
  }

  function el(id) {
    return document.getElementById(id);
  }

  function setHTML(id, html) {
    const e = el(id);
    if (e) e.innerHTML = html;
  }

  function setText(id, text) {
    const e = el(id);
    if (e) e.textContent = text;
  }

  function show(id) {
    const e = el(id);
    if (e) e.classList.remove('hidden');
  }

  function hide(id) {
    const e = el(id);
    if (e) e.classList.add('hidden');
  }

  function addClass(id, cls) {
    const e = el(id);
    if (e) e.classList.add(cls);
  }

  function removeClass(id, cls) {
    const e = el(id);
    if (e) e.classList.remove(cls);
  }

  // ── Capacity display ──────────────────────────────────────────

  function renderCapacityBar() {
    const bar = el('capacity-bar-fill');
    const label = el('capacity-label');
    const earlyLabel = el('early-adopter-label');

    const pct = (state.capacity.totalSold / state.capacity.activeMax) * 100;

    if (bar)   bar.style.width = Math.min(100, pct) + '%';
    if (label) {
      const rem = getSlotsRemaining();
      label.textContent = isActiveMode()
        ? `${state.capacity.totalSold} of ${state.capacity.activeMax} lifetime slots claimed`
        : 'All 20 lifetime slots claimed — Waitlist open';
    }
    if (earlyLabel) {
      const rem = getEarlyAdopterRemaining();
      earlyLabel.textContent = hasEarlyAdopterSlots()
        ? `Early Adopter: ${rem} of ${state.capacity.earlyAdopterMax} discounted slots remaining`
        : 'Early Adopter pricing closed — regular rates apply';
    }
  }

  // ── Stripe Checkout ───────────────────────────────────────────

  async function startCheckout(plan, billing) {
    // One-way capacity gate
    if (!isActiveMode()) {
      el('discord-panel')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      return;
    }

    const early        = hasEarlyAdopterSlots();
    const token        = DiscordAuth.getToken();
    const userId       = state.auth.user?.id;
    const username     = state.auth.user?.username || '';
    const endpoint     = CONFIG.discord.checkoutEndpoint;

    if (!endpoint || endpoint.includes('YOUR')) {
      _setCheckoutBtn(plan, 'error', 'Checkout endpoint not configured.');
      return;
    }
    if (!token || !userId) {
      _setCheckoutBtn(plan, 'error', 'Please connect Discord first.');
      return;
    }

    _setCheckoutBtn(plan, 'loading', 'Preparing checkout…');

    try {
      // ── Step 1: Create session server-side via Cloudflare Worker ─────────
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          plan,
          billing,
          earlyAdopter: early,
          discordToken:    token,
          discordUserId:   userId,
          discordUsername: username,
        }),
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `Server returned ${res.status}`);
      if (!data.sessionId) throw new Error('No session ID returned from server.');

      // ── Step 2: Redirect to Stripe-hosted Checkout ───────────────────────
      if (typeof Stripe === 'undefined') throw new Error('Stripe.js failed to load.');
      const stripe = Stripe(CONFIG.stripe.publishableKey);
      const result = await stripe.redirectToCheckout({ sessionId: data.sessionId });

      // redirectToCheckout only returns if it fails (otherwise it navigates away)
      if (result.error) throw new Error(result.error.message);

    } catch (e) {
      console.error('[Checkout]', e.message);
      _setCheckoutBtn(plan, 'error', e.message || 'Checkout failed. Please try again.');
    }
  }

  // Update a checkout button's visual state without re-rendering the whole section.
  function _setCheckoutBtn(plan, state, message) {
    const btn = document.getElementById(`checkout-btn-${plan}`);
    if (!btn) return;

    if (state === 'loading') {
      btn.disabled    = true;
      btn.textContent = message;
      return;
    }

    // Reset button text
    btn.disabled    = false;
    btn.textContent = plan === 'pro' ? 'Get ⚡ Pro Access' : 'Get 🏆 Elite Access';

    if (state === 'error') {
      const card = btn.closest('.card-actions');
      if (!card) return;
      let err = card.querySelector('.checkout-error');
      if (!err) {
        err = document.createElement('p');
        err.className = 'checkout-error';
        err.style.cssText = 'font-size:12px;color:#ef4444;margin-top:8px;text-align:center;line-height:1.5;';
        card.appendChild(err);
      }
      err.textContent = message;
      setTimeout(() => err?.remove(), 7000);
    }
  }

  // ── ToS Acceptance ────────────────────────────────────────────

  // Called when the ToS checkbox changes — enables/disables the Accept button.
  window.onTosCheckboxChange = function() {
    const cb  = document.getElementById('tos-checkbox');
    const btn = document.getElementById('tos-accept-btn');
    if (btn) btn.disabled = !cb?.checked;
  };

  // Called when user clicks "Accept & Complete Verification".
  // Sends the user's OAuth token to the Cloudflare Worker, which validates it
  // and uses the bot token (stored server-side) to assign @ToS-Accepted.
  window.acceptTos = async function() {
    if (state.tosAssigning) return;

    const token  = DiscordAuth.getToken();
    const userId = state.auth.user?.id;
    if (!token || !userId) return;

    const endpoint = CONFIG.discord.tosRoleEndpoint;
    if (!endpoint || endpoint.includes('YOUR_SUBDOMAIN')) {
      _setTosStatus('error', 'Role assignment endpoint not configured. Deploy the Cloudflare Worker first.');
      return;
    }

    state.tosAssigning = true;
    _setTosStatus('loading', 'Assigning role…');

    const btn = document.getElementById('tos-accept-btn');
    if (btn) { btn.disabled = true; btn.textContent = 'Assigning…'; }

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ token, userId }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        throw new Error(data.error || `Server returned ${res.status}`);
      }

      // Success — clear cached roles and re-init so the panel picks up @ToS-Accepted
      DiscordAuth.clearRolesCache();
      state.auth = await DiscordAuth.init();
      state.tosAssigning = false;
      renderDiscordPanel();
      renderPricingSection();

    } catch (e) {
      state.tosAssigning = false;
      _setTosStatus('error', e.message || 'Role assignment failed. Please try again.');
      const btn2 = document.getElementById('tos-accept-btn');
      if (btn2) { btn2.disabled = false; btn2.textContent = 'Accept & Complete Verification'; }
    }
  };

  function _setTosStatus(type, msg) {
    const el = document.getElementById('tos-status');
    if (!el) return;
    el.textContent = msg;
    el.className = type === 'error' ? 'tos-status tos-status-error'
                 : type === 'loading' ? 'tos-status tos-status-loading'
                 : 'tos-status';
  }

  // ── Discord verification UI ───────────────────────────────────

  function renderDiscordPanel() {
    const panel = el('discord-panel');
    if (!panel) return;

    const { state: authState, user, roleStatus } = state.auth;
    const verified = authState === 'authenticated';

    if (!verified) {
      panel.innerHTML = `
        <div class="discord-panel-inner">
          <div class="discord-panel-header">
            <div class="discord-icon">
              <svg width="24" height="18" viewBox="0 0 24 18" fill="none">
                <path d="M20.317 1.492a19.825 19.825 0 0 0-4.885-1.515.074.074 0 0 0-.079.037c-.21.375-.444.864-.608 1.25a18.27 18.27 0 0 0-5.487 0 12.64 12.64 0 0 0-.617-1.25.077.077 0 0 0-.079-.037A19.736 19.736 0 0 0 3.677 1.492a.07.07 0 0 0-.032.027C.533 6.093-.32 10.555.099 14.961a.08.08 0 0 0 .031.055 19.9 19.9 0 0 0 5.993 3.03.078.078 0 0 0 .084-.028c.462-.63.874-1.295 1.226-1.994a.076.076 0 0 0-.041-.106 13.107 13.107 0 0 1-1.872-.892.077.077 0 0 1-.008-.128 10.2 10.2 0 0 0 .372-.292.074.074 0 0 1 .077-.01c3.928 1.793 8.18 1.793 12.062 0a.074.074 0 0 1 .078.01c.12.098.246.198.373.292a.077.077 0 0 1-.006.127 12.299 12.299 0 0 1-1.873.892.077.077 0 0 0-.041.107c.36.698.772 1.362 1.225 1.993a.076.076 0 0 0 .084.028 19.839 19.839 0 0 0 6.002-3.03.077.077 0 0 0 .032-.054c.5-5.177-.838-9.674-3.549-13.66a.061.061 0 0 0-.031-.03z" fill="#5865F2"/>
              </svg>
            </div>
            <div>
              <h3>3-Step Discord Verification</h3>
              <p>Complete verification in our Discord community before checkout.</p>
            </div>
          </div>
          <div class="verify-steps">
            <div class="verify-step"><span class="step-num">1</span> Join the Signal Vault community server</div>
            <div class="verify-step"><span class="step-num">2</span> Read &amp; acknowledge the educational disclaimer</div>
            <div class="verify-step"><span class="step-num">3</span> Accept the Terms of Service</div>
          </div>
          <div class="discord-panel-actions">
            <button class="btn btn-discord" onclick="DiscordAuth.startOAuth()">
              Connect Discord
            </button>
          </div>
        </div>`;
      return;
    }

    // Authenticated — show role status
    const allMet     = roleStatus?.allMet;
    const step1      = roleStatus?.verified   || false;
    const step2      = roleStatus?.disclaimer || false;
    const step3      = roleStatus?.tos        || false;
    const prereqsMet = step1 && step2;

    // Debug panel — shown when role IDs are still placeholders.
    // Displays the actual snowflake IDs returned from Discord so they can be
    // pasted directly into config.js requiredRoles.
    const hasPlaceholders = Object.values(CONFIG.discord.requiredRoles)
      .some(id => id.startsWith('ROLE_ID_'));
    const rawRoles = state.auth.roles || [];
    const debugHtml = hasPlaceholders && rawRoles.length > 0 ? `
      <div style="margin-top:16px;padding:14px 16px;background:rgba(245,158,11,0.08);border:1px solid rgba(245,158,11,0.3);border-radius:8px;font-size:12px;">
        <strong style="color:#f59e0b;">⚠ Role IDs not configured</strong>
        <p style="color:#94a3b8;margin:6px 0 8px;">
          Discord returned ${rawRoles.length} role(s) for this user.
          Copy the IDs below into <code>config.js → requiredRoles</code>:
        </p>
        <code style="display:block;white-space:pre-wrap;color:#4ade80;font-size:11px;line-height:1.8;">${rawRoles.map(id => `"${id}"`).join('\n')}</code>
        <p style="color:#64748b;margin:8px 0 0;">Check Discord (Developer Mode → right-click role → Copy ID) to match IDs to role names.</p>
      </div>` : hasPlaceholders && rawRoles.length === 0 ? `
      <div style="margin-top:16px;padding:14px 16px;background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.25);border-radius:8px;font-size:12px;">
        <strong style="color:#ef4444;">⚠ No roles returned from Discord API</strong>
        <p style="color:#94a3b8;margin:6px 0 0;">
          The member endpoint returned an empty role list. Check the browser console for the specific error.
          Common causes: OAuth app not in the server, or <code>guilds.members.read</code> scope not granted.
        </p>
      </div>` : '';
    const avatarUrl  = DiscordAuth.getAvatarUrl(user);

    // Step 3 can be completed on-site once steps 1 & 2 are done.
    // Steps 1 & 2 still require Discord actions.
    const steps = [
      {
        key:    'verified',
        met:    step1,
        label:  'Step 1 — Community Member',
        action: !step1
          ? `<a href="${CONFIG.discord.serverInvite}" target="_blank" class="role-action">Complete in Discord →</a>`
          : '',
      },
      {
        key:    'disclaimer',
        met:    step2,
        label:  'Step 2 — Disclaimer Acknowledged',
        action: !step2
          ? `<a href="${CONFIG.discord.serverInvite}" target="_blank" class="role-action">Complete in Discord →</a>`
          : '',
      },
      {
        key:    'tos',
        met:    step3,
        label:  'Step 3 — Terms of Service Accepted',
        action: (!step3 && prereqsMet) ? '<span class="role-action role-action-here">Accept below ↓</span>' : '',
      },
    ];

    panel.innerHTML = `
      <div class="discord-panel-inner ${allMet ? 'verified' : ''}">
        <div class="discord-panel-header">
          <div class="discord-user-avatar">
            ${avatarUrl ? `<img src="${avatarUrl}" alt="${user.username}" onerror="this.style.display='none'">` : ''}
            <div class="online-dot"></div>
          </div>
          <div>
            <h3>${allMet ? '✓ Verification Complete' : prereqsMet && !step3 ? 'One Step Remaining' : 'Verification Pending'}</h3>
            <p>Connected as <strong>${user.username}</strong></p>
          </div>
          <button class="btn-ghost btn-sm" onclick="DiscordAuth.logout()">Disconnect</button>
        </div>

        <div class="role-checklist">
          ${steps.map(({ met, label, action }) => `
            <div class="role-item ${met ? 'role-met' : prereqsMet || met !== false ? 'role-missing' : 'role-pending'}">
              <span class="role-check">${met ? '✓' : '○'}</span>
              <span>${label}</span>
              ${action}
            </div>
          `).join('')}
        </div>

        ${debugHtml}

        ${prereqsMet && !step3 ? `
          <div class="tos-acceptance" id="tos-acceptance">
            <p class="tos-acceptance-intro">Steps 1 &amp; 2 complete. Accept the Terms of Service to unlock checkout:</p>
            <label class="tos-checkbox-label">
              <input type="checkbox" id="tos-checkbox" onchange="onTosCheckboxChange()">
              <span>I have read and agree to the <a href="./terms.html" target="_blank">Terms of Service</a></span>
            </label>
            <button id="tos-accept-btn" class="btn btn-primary btn-sm" disabled onclick="acceptTos()">
              Accept &amp; Complete Verification
            </button>
            <p class="tos-status" id="tos-status"></p>
          </div>
        ` : ''}

        ${!prereqsMet ? `
          <p class="panel-note">
            Complete Steps 1 &amp; 2 in the
            <a href="${CONFIG.discord.serverInvite}" target="_blank">Signal Vault Discord</a>,
            then return here to accept the Terms of Service.
          </p>
        ` : allMet ? `
          <p class="panel-note panel-note-success">✓ All steps complete. You may now proceed to checkout.</p>
        ` : ''}
      </div>`;
  }

  // ── Pricing cards ─────────────────────────────────────────────

  function renderPricingSection() {
    const section = el('pricing-section');
    if (!section) return;

    const active  = isActiveMode();
    const early   = hasEarlyAdopterSlots();
    const billing = state.billing;
    const locked  = !state.auth.roleStatus?.allMet;

    if (active) {
      section.innerHTML = renderActivePricing(billing, early, locked);
    } else {
      section.innerHTML = renderWaitlistPricing(locked);
    }

    // Re-attach toggle listener
    const toggle = el('billing-toggle');
    if (toggle) {
      toggle.addEventListener('change', () => {
        state.billing = toggle.checked ? 'annual' : 'monthly';
        renderPricingSection();
      });
      toggle.checked = state.billing === 'annual';
    }
  }

  function renderActivePricing(billing, early, locked) {
    const p   = CONFIG.pricing;
    const src  = early ? p.earlyAdopter : p.active;

    const proPrice     = billing === 'monthly' ? src.pro.monthly   : src.pro.annual;
    const elitePrice   = billing === 'monthly' ? src.elite.monthly : src.elite.annual;
    const proLink      = getPaymentLink('pro',   billing, early);
    const eliteLink    = getPaymentLink('elite', billing, early);

    // Base (regular) prices for strikethrough display when in early adopter mode
    const basePro   = billing === 'monthly' ? p.active.pro.monthly   : p.active.pro.annual;
    const baseElite = billing === 'monthly' ? p.active.elite.monthly : p.active.elite.annual;

    const proSavings   = billing === 'annual'
      ? ` <span class="savings-badge">2 months free</span>` : '';
    const eliteSavings = billing === 'annual'
      ? ` <span class="savings-badge">2 months free</span>` : '';

    const earlyBadge = early ? '<span class="badge badge-early">Early Adopter — 30% Off</span>' : '';
    const earlyRem   = early
      ? `<p class="early-countdown">${getEarlyAdopterRemaining()} early adopter slots remaining — grandfathered forever</p>` : '';

    // Pricing display: strikethrough base + discounted price when early adopter
    function priceBlock(price, basePrice, period, savings, equiv) {
      if (early) {
        return `
          <div class="plan-price">
            <span class="price-was">${formatPrice(basePrice)}</span>
            <span class="price-amount">${formatPrice(price)}</span>
            <span class="price-period">${period}${savings}</span>
          </div>
          <p class="early-note">Early Adopter 30% Off — locked forever</p>
          ${equiv ? `<p class="price-equiv">${equiv}</p>` : ''}`;
      }
      return `
        <div class="plan-price">
          <span class="price-amount">${formatPrice(price)}</span>
          <span class="price-period">${period}${savings}</span>
        </div>
        ${equiv ? `<p class="price-equiv">${equiv}</p>` : ''}`;
    }

    const period = billing === 'monthly' ? '/month' : '/year';

    return `
      <div class="pricing-toggle-wrap">
        <span class="${billing === 'monthly' ? 'toggle-label active' : 'toggle-label'}">Monthly</span>
        <label class="toggle-switch">
          <input type="checkbox" id="billing-toggle" ${billing === 'annual' ? 'checked' : ''}>
          <span class="toggle-slider"></span>
        </label>
        <span class="${billing === 'annual' ? 'toggle-label active' : 'toggle-label'}">
          Annual <span class="toggle-savings">Save 2 months</span>
        </span>
      </div>

      ${earlyRem}

      <div class="pricing-grid">

        <div class="pricing-card card-pro ${early ? 'card-early' : ''}">
          <div class="card-top">
            ${earlyBadge}
            <h3 class="plan-name">⚡ Pro</h3>
            ${priceBlock(
              proPrice, basePro, period, proSavings,
              billing === 'annual' ? `$${Math.round(proPrice/12)}/month billed annually` : ''
            )}
          </div>
          <ul class="feature-list">
            <li>Real-time scanner alerts via Discord</li>
            <li>⚡ Pro signal channels</li>
            <li>Morning market brief (9:15 AM ET)</li>
            <li>Dark pool flow alerts</li>
            <li>Opening Move signals (9:38 AM ET)</li>
            <li>Trade management tools</li>
            <li>Educational trade recaps</li>
          </ul>
          <div class="card-actions">
            <button
               id="checkout-btn-pro"
               class="btn btn-primary btn-block ${locked ? 'btn-locked' : ''}"
               onclick="${locked ? 'return handleLockedClick(event)' : `App.checkout('pro','${billing}')`}">
              ${locked ? '🔒 Verify Discord First' : 'Get ⚡ Pro Access'}
            </button>
          </div>
        </div>

        <div class="pricing-card card-elite ${early ? 'card-early' : ''} card-featured">
          <div class="card-badge-top">MOST POPULAR</div>
          <div class="card-top">
            ${earlyBadge}
            <h3 class="plan-name">🏆 Elite</h3>
            ${priceBlock(
              elitePrice, baseElite, period, eliteSavings,
              billing === 'annual' ? `$${Math.round(elitePrice/12)}/month billed annually` : ''
            )}
          </div>
          <ul class="feature-list">
            <li>Everything in ⚡ Pro</li>
            <li>Priority signal alerts</li>
            <li>🏆 Elite-only high-conviction setups</li>
            <li>Live position monitoring alerts</li>
            <li>Advanced confidence scoring</li>
            <li>Backtested strategy insights</li>
            <li>Direct access channel</li>
          </ul>
          <div class="card-actions">
            <button
               id="checkout-btn-elite"
               class="btn btn-elite btn-block ${locked ? 'btn-locked' : ''}"
               onclick="${locked ? 'return handleLockedClick(event)' : `App.checkout('elite','${billing}')`}">
              ${locked ? '🔒 Verify Discord First' : 'Get 🏆 Elite Access'}
            </button>
          </div>
        </div>

      </div>`;
  }

  function renderWaitlistPricing(locked) {
    const tiers  = CONFIG.pricing.waitlist;
    const tier   = getCurrentWaitlistTier();
    const active = tiers[tier];

    return `
      <div class="waitlist-header">
        <div class="waitlist-badge">Waitlist Open</div>
        <h2>Active Capacity Reached</h2>
        <p>All ${CONFIG.capacity.activeMax} active member slots are filled. Join the waitlist to secure your position and lock in your tier rate.</p>
      </div>

      <div class="waitlist-tiers">
        ${Object.entries(tiers).map(([key, t]) => {
          const isCurrent = key === tier;
          return `
          <div class="waitlist-card ${isCurrent ? 'waitlist-current' : ''}" data-tier="${key}">
            ${isCurrent ? '<div class="current-badge">Your Tier</div>' : ''}
            <h4>${key.replace('tier', 'Tier ')}</h4>
            <div class="deposit-amount">$${t.deposit} deposit</div>
            <div class="waitlist-rates">
              <span>$${t.monthly}/mo</span>
              <span class="sep">·</span>
              <span>$${t.annual}/yr <em>15% off</em></span>
            </div>
            <p class="deposit-note">Deposit applied as credit toward first payment</p>
            <a href="${locked ? '#' : CONFIG.stripe.paymentLinks[key+'Deposit']}"
               class="btn ${isCurrent ? 'btn-primary' : 'btn-outline'} btn-block btn-sm ${locked ? 'btn-locked' : ''}"
               ${locked ? 'onclick="return handleLockedClick(event)"' : ''}>
               ${locked ? '🔒 Verify Discord First' : `Secure ${key.replace('tier','Tier ')} Position`}
            </a>
          </div>`;
        }).join('')}
      </div>

      <p class="waitlist-note">
        Waitlist tier is determined by signup position. Earlier signup = lower rate, locked for life.
        Deposits are non-refundable but fully applied to your first month.
      </p>`;
  }

  // ── Lock click handler ────────────────────────────────────────

  window.handleLockedClick = function(e) {
    e.preventDefault();
    const panel = el('discord-panel');
    if (panel) {
      panel.scrollIntoView({ behavior: 'smooth', block: 'center' });
      panel.classList.add('panel-shake');
      setTimeout(() => panel.classList.remove('panel-shake'), 600);
    }
    return false;
  };

  // ── Page: Account Portal ──────────────────────────────────────

  function renderAccountPage() {
    const { state: authState, user, roleStatus } = state.auth;

    if (authState !== 'authenticated') {
      setHTML('account-content', `
        <div class="account-gate">
          <div class="gate-icon">🔐</div>
          <h2>Sign In with Discord</h2>
          <p>Connect your Discord account to access your subscription portal.</p>
          <button class="btn btn-discord" onclick="DiscordAuth.startOAuth()">
            Connect Discord
          </button>
        </div>`);
      return;
    }

    const avatarUrl = DiscordAuth.getAvatarUrl(user);

    setHTML('account-content', `
      <div class="account-header">
        <div class="account-avatar">
          ${avatarUrl ? `<img src="${avatarUrl}" alt="${user.username}">` : '<div class="avatar-placeholder"></div>'}
        </div>
        <div class="account-user-info">
          <h2>${user.username}</h2>
          <p class="text-muted">Discord ID: ${user.id}</p>
        </div>
        <button class="btn-ghost btn-sm" onclick="DiscordAuth.logout()">Sign Out</button>
      </div>

      <div class="account-grid">

        <div class="account-card">
          <h3>Discord Roles</h3>
          <div class="role-checklist">
            ${[
              { key: 'verified',   met: roleStatus?.verified   },
              { key: 'disclaimer', met: roleStatus?.disclaimer  },
              { key: 'tos',        met: roleStatus?.tos         },
            ].map(({ key, met }) => `
              <div class="role-item ${met ? 'role-met' : 'role-missing'}">
                <span class="role-check">${met ? '✓' : '✗'}</span>
                <span>${CONFIG.discord.roleLabels[key]}</span>
              </div>`).join('')}
          </div>
          ${!roleStatus?.allMet ? `
            <a href="${CONFIG.discord.serverInvite}" target="_blank" class="btn btn-outline btn-sm mt-2">
              Complete Verification →
            </a>` : '<p class="text-success mt-2">✓ All roles verified</p>'}
        </div>

        <div class="account-card">
          <h3>Subscription Management</h3>
          <p class="text-secondary">Access your billing portal to view invoices, update payment methods, or manage your subscription.</p>
          <div class="portal-actions">
            <a href="${CONFIG.stripe.customerPortalUrl}" target="_blank" class="btn btn-primary">
              Open Billing Portal
            </a>
            <p class="portal-note">Opens Stripe's secure billing portal. Enter your email to receive a login link.</p>
          </div>
        </div>

        <div class="account-card" id="plan-info-card">
          <h3>Plan Information</h3>
          <div id="plan-info-body">
            <div class="plan-info-loading">
              <div class="skeleton-row skeleton"></div>
              <div class="skeleton-row skeleton" style="width:80%"></div>
              <div class="skeleton-row skeleton" style="width:65%"></div>
              <div class="skeleton-row skeleton" style="width:75%"></div>
            </div>
          </div>
        </div>

        <div class="account-card">
          <h3>Quick Links</h3>
          <div class="quick-links">
            <a href="${CONFIG.discord.serverInvite}" target="_blank" class="quick-link">
              <span>💬</span> Signal Vault Discord
            </a>
            <a href="/terms.html" class="quick-link">
              <span>📄</span> Terms of Service
            </a>
            <a href="/privacy.html" class="quick-link">
              <span>🔒</span> Privacy Policy
            </a>
            <a href="mailto:support@signalvault.com" class="quick-link">
              <span>✉️</span> Contact Support
            </a>
          </div>
        </div>

      </div>`);

    // Populate Plan Information card async — never blocks initial render
    loadSubscriptionData();
  }

  // ── Subscription data fetch + render helpers ──────────────────────

  async function loadSubscriptionData() {
    const token    = DiscordAuth.getToken();
    const userId   = state.auth.user?.id;
    const endpoint = CONFIG.stripe.subscriptionEndpoint;

    if (!token || !userId) return;

    if (!endpoint || endpoint.includes('YOUR')) {
      _renderPlanFallback();
      return;
    }

    try {
      const res = await fetch(endpoint, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ discordToken: token, discordUserId: userId }),
      });

      if (res.status === 401 || res.status === 403) {
        _renderPlanError();
        return;
      }

      if (!res.ok) throw new Error(`Server returned ${res.status}`);

      const data = await res.json();
      if (!data.found) {
        _renderPlanNotFound();
        return;
      }

      _renderPlanData(data);

    } catch (e) {
      console.error('[account] subscription fetch error:', e.message);
      _renderPlanError();
    }
  }

  function _planInfoBody() {
    return document.getElementById('plan-info-body');
  }

  function _renderPlanData(data) {
    const body = _planInfoBody();
    if (!body) return;

    const planLabel    = data.plan === 'elite' ? '🏆 Elite' : '⚡ Pro';
    const billingLabel = data.billing === 'annual' ? 'Annual' : 'Monthly';
    const amountFmt    = '$' + (data.amount || 0).toLocaleString();
    const periodLabel  = data.billing === 'annual' ? '/yr' : '/mo';

    const nextTs   = data.nextPaymentDate;
    const nextDate = nextTs
      ? new Date(nextTs * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
      : '—';
    const nextLabel = data.cancelAtPeriodEnd ? 'Cancels' : 'Next Payment';

    const statusPill = {
      active:   '<span class="plan-status-pill pill-active">Active</span>',
      trialing: '<span class="plan-status-pill pill-active">Trialing</span>',
      past_due: '<span class="plan-status-pill pill-past-due">Past Due</span>',
    }[data.status] || '<span class="plan-status-pill pill-canceled">Inactive</span>';

    const gfBadge = data.isGrandfathered
      ? '<span class="plan-status-pill pill-grandfathered">Protected</span>'
      : '<span class="plan-status-pill pill-standard">Standard</span>';

    body.innerHTML = `
      <div class="plan-info-list">
        <div class="plan-info-row">
          <span>Current Plan</span>
          <span class="plan-value">${planLabel}</span>
        </div>
        <div class="plan-info-row">
          <span>Status</span>
          <span>${statusPill}</span>
        </div>
        <div class="plan-info-row">
          <span>Billing</span>
          <span class="plan-value">${billingLabel} · ${amountFmt}${periodLabel}</span>
        </div>
        <div class="plan-info-row">
          <span>${nextLabel}</span>
          <span class="plan-value">${nextDate}</span>
        </div>
        <div class="plan-info-row">
          <span>Grandfathered Pricing</span>
          <span>${gfBadge}</span>
        </div>
      </div>
      ${data.isGrandfathered ? '<p class="plan-note mt-2">Early adopter rates are grandfathered and will not increase regardless of plan changes.</p>' : ''}
    `;
  }

  function _renderPlanNotFound() {
    const body = _planInfoBody();
    if (!body) return;
    body.innerHTML = `
      <div class="plan-info-empty">
        <p class="text-secondary" style="font-size:14px;">No active subscription found.</p>
        <a href="./index.html#pricing" class="btn btn-primary btn-sm">Subscribe to activate</a>
      </div>
    `;
  }

  function _renderPlanError() {
    const body = _planInfoBody();
    if (!body) return;
    body.innerHTML = `
      <p class="text-muted" style="font-size:13px;line-height:1.6;">
        Unable to load subscription data —
        <a href="#" onclick="App.loadSubscription();return false;">refresh to retry</a>
      </p>
    `;
  }

  function _renderPlanFallback() {
    const body = _planInfoBody();
    if (!body) return;
    body.innerHTML = `
      <div class="plan-info-list">
        <div class="plan-info-row">
          <span>Current Plan</span>
          <span class="plan-value">Managed in Stripe Portal</span>
        </div>
        <div class="plan-info-row">
          <span>Billing</span>
          <span class="plan-value">View in Billing Portal</span>
        </div>
      </div>
    `;
  }

  // ── Particles ─────────────────────────────────────────────────

  function initParticles() {
    const canvas = el('particles-canvas');
    if (!canvas) return;
    const ctx  = canvas.getContext('2d');
    let W, H, particles = [];

    function resize() {
      W = canvas.width  = window.innerWidth;
      H = canvas.height = window.innerHeight;
    }

    function makeParticle() {
      return {
        x:   Math.random() * W,
        y:   Math.random() * H,
        vx:  (Math.random() - 0.5) * 0.3,
        vy:  (Math.random() - 0.5) * 0.3,
        r:   Math.random() * 1.5 + 0.5,
        a:   Math.random() * 0.5 + 0.1,
      };
    }

    function init() {
      resize();
      particles = Array.from({ length: 70 }, makeParticle);
    }

    function draw() {
      ctx.clearRect(0, 0, W, H);

      // Connection lines
      for (let i = 0; i < particles.length; i++) {
        for (let j = i + 1; j < particles.length; j++) {
          const dx   = particles[i].x - particles[j].x;
          const dy   = particles[i].y - particles[j].y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < 120) {
            ctx.beginPath();
            ctx.strokeStyle = `rgba(74,222,128,${0.08 * (1 - dist / 120)})`;
            ctx.lineWidth   = 0.5;
            ctx.moveTo(particles[i].x, particles[i].y);
            ctx.lineTo(particles[j].x, particles[j].y);
            ctx.stroke();
          }
        }
      }

      // Dots
      particles.forEach(p => {
        p.x += p.vx;
        p.y += p.vy;
        if (p.x < 0 || p.x > W) p.vx *= -1;
        if (p.y < 0 || p.y > H) p.vy *= -1;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(74,222,128,${p.a})`;
        ctx.fill();
      });

      requestAnimationFrame(draw);
    }

    window.addEventListener('resize', resize);
    init();
    draw();
  }

  // ── Nav user area ─────────────────────────────────────────────

  function renderNav() {
    const navUser = el('nav-user');
    if (!navUser) return;
    const { state: authState, user } = state.auth;
    if (authState === 'authenticated' && user) {
      navUser.innerHTML = `
        <span class="nav-username">${user.username}</span>
        <a href="/account.html" class="btn btn-outline btn-sm">Portal</a>`;
    } else {
      navUser.innerHTML = `
        <button class="btn btn-ghost btn-sm" onclick="DiscordAuth.startOAuth()">
          Connect Discord
        </button>
        <a href="/account.html" class="btn btn-outline btn-sm">Sign In</a>`;
    }
  }

  // ── Page routing ──────────────────────────────────────────────

  async function run() {
    // Init particles
    initParticles();

    // Init Discord auth
    state.auth = await DiscordAuth.init();
    state.activeMode = isActiveMode();

    // Render nav
    renderNav();

    const page = document.body.dataset.page;

    if (page === 'index') {
      renderCapacityBar();
      renderDiscordPanel();
      renderPricingSection();

      // Billing toggle (re-rendered inside renderPricingSection, but set initial)
      const bt = el('billing-toggle');
      if (bt) bt.addEventListener('change', () => {
        state.billing = bt.checked ? 'annual' : 'monthly';
        renderPricingSection();
      });
    }

    if (page === 'account') {
      renderAccountPage();
    }

    if (page === 'success') {
      renderNav();
    }
  }

  return { run, checkout: startCheckout, loadSubscription: loadSubscriptionData };
})();

// Boot
document.addEventListener('DOMContentLoaded', App.run);
