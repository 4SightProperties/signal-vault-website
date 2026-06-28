// dashboard.js — Signal Vault Monitor Cockpit
// Authenticates via Discord OAuth, connects a WebSocket for live positions,
// and polls REST endpoints for watchlist + signals.
//
// Phase 0  — Live/Stale/Peak P&L badges, engine-down banner
// Part 2   — Chain panel: loadChainExpirations, loadChain, renderChain, armContract
// Part 3   — Close wire: console "Exit Nx" button → real POST /api/v1/orders/close
// Part 4   — Open wire: "Open" button in chain armed panel → POST /api/v1/orders/open
// History  — History tab: setupHistoryTab, loadHistory, renderHistory, admin scope selector
//
// Execution (close/open) is gated by WEB_TRADING_ENABLED kill-switch on the backend.
// A confirmation modal is shown for BOTH actions before any order is placed.

(() => {
  'use strict';

  const API    = CONFIG.backendUrl;
  const WS_URL = API.replace(/^https/, 'wss').replace(/^http/, 'ws');

  let authToken   = null;
  let wsConn      = null;
  let wsRetries   = 0;
  let signalTimer = null;
  let watchTimer  = null;

  // Center panel + console state
  let currentPositions   = [];   // last positions array from WS — used by console delegation
  let watchlistDataCache = [];   // last watchlist rows — used by levels panel
  let focusedTicker      = null; // ticker currently loaded in center column
  let openConsoleId      = null; // position_id of the currently expanded management console

  // Chain state
  let chainTicker       = null;  // ticker for which chain is loaded
  let chainCurrentPrice = 0.0;   // stock price at chain load time
  let armedContract     = null;  // {symbol, strike, direction, expiry, ask, delta, dte}

  // History tab state
  let isAdmin           = false;
  let histCurrentPeriod = 'all';
  let histCurrentScope  = 'me';   // 'me' | 'all' | 'user' — admin only
  let histCurrentUser   = null;   // discord_id when histCurrentScope === 'user'

  // ── Helpers ────────────────────────────────────────────────────────────────

  function fmt$(n) {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
  }

  function fmtPct(n) {
    if (n == null) return '—';
    const sign = n >= 0 ? '+' : '';
    return sign + n.toFixed(1) + '%';
  }

  function fmtPrice(n) {
    if (n == null) return '—';
    return '$' + parseFloat(n).toFixed(2);
  }

  function fmtPnl$(n) {
    if (n == null) return '—';
    const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
    return (n >= 0 ? '+' : '-') + '$' + abs;
  }

  function fmtRelTime(ts) {
    if (!ts) return '—';
    const diff = Date.now() / 1000 - ts;
    if (diff < 60)    return 'just now';
    if (diff < 3600)  return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    return Math.floor(diff / 86400) + 'd ago';
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + authToken };
  }

  async function apiFetch(path, opts) {
    const res = await fetch(API + path, { headers: authHeaders(), ...opts });
    if (!res.ok) throw new Error(res.status + ' ' + path);
    return res.json();
  }

  async function apiPost(path, body) {
    const res = await fetch(API + path, {
      method:  'POST',
      headers: { ...authHeaders(), 'Content-Type': 'application/json' },
      body:    JSON.stringify(body),
    });
    let data;
    try { data = await res.json(); } catch (_) { data = {}; }
    if (!res.ok) throw Object.assign(new Error(data.detail || res.status + ' ' + path), { data, status: res.status });
    return data;
  }

  // ── Auth gate ──────────────────────────────────────────────────────────────

  const overlay  = document.getElementById('authOverlay');
  const authBtn  = document.getElementById('authBtn');
  const authNote = document.getElementById('authNote');

  authBtn.addEventListener('click', () => {
    DiscordAuth.startOAuth(CONFIG.discord.dashboardRedirectUri);
  });

  document.getElementById('logoutBtn').addEventListener('click', () => {
    DiscordAuth.clearSession();
    window.location.reload();
  });

  async function checkHealth() {
    try {
      const h = await fetch(API + '/api/health');
      if (!h.ok) return;
      const data = await h.json();
      const badge = document.getElementById('envBadge');
      const env   = data.env || 'unknown';
      badge.textContent = env;
      badge.className   = 'dash-env-badge ' + (env === 'production' ? 'production' : 'sandbox');
    } catch (_) {}
  }

  function showOverlay(note) {
    overlay.style.display  = 'flex';
    authNote.textContent   = note || '';
  }

  function hideOverlay() {
    overlay.style.display = 'none';
  }

  async function init() {
    await checkHealth();

    const auth = await DiscordAuth.init();

    if (auth.state !== 'authenticated') {
      showOverlay('');
      return;
    }

    // Check subscriber role client-side (fast UX gate)
    const subRoles = CONFIG.discord.subscriptionRoles;
    const hasSub   = auth.roles.includes(subRoles.pro) || auth.roles.includes(subRoles.elite);
    if (!hasSub) {
      showOverlay('Pro or Elite role required. Visit the-signalvault.com to subscribe.');
      authBtn.textContent = 'Subscribe';
      authBtn.onclick     = () => window.location.href = 'index.html';
      return;
    }

    // Server-side validation (the real gate)
    try {
      authToken  = DiscordAuth.getToken();
      const me   = await apiFetch('/api/me');
      isAdmin = !!me.is_admin;
      document.getElementById('dashUser').textContent =
        (me.username || 'subscriber') + ' · ' + (me.tier || '');
      if (me.active_env) {
        const badge = document.getElementById('envBadge');
        badge.textContent = me.active_env;
        badge.className   = 'dash-env-badge ' + (me.active_env === 'production' ? 'production' : 'sandbox');
      }
      hideOverlay();
    } catch (err) {
      if (String(err).includes('403')) {
        showOverlay('Server: subscriber role not confirmed. Contact support.');
      } else {
        showOverlay('Auth error: ' + err.message);
      }
      return;
    }

    // All good — start the cockpit
    startWebSocket();
    loadSignals();
    loadWatchlist();
    signalTimer = setInterval(loadSignals,   30_000);
    watchTimer  = setInterval(loadWatchlist, 60_000);

    setupCenterPanel();
    setupConsoleHandlers();
    setupHistoryTab();
    setupModal();
  }

  // ── WebSocket ─────────────────────────────────────────────────────────────

  function setWsStatus(state, text) {
    const dot  = document.getElementById('wsDot');
    const span = document.getElementById('wsStatus');
    dot.className    = 'ws-dot ' + state;
    span.textContent = text;
  }

  function startWebSocket() {
    if (wsConn) { try { wsConn.close(); } catch (_) {} }

    setWsStatus('', 'Connecting…');
    const url = WS_URL + '/ws?token=' + encodeURIComponent(authToken);
    wsConn    = new WebSocket(url);

    wsConn.onopen = () => {
      wsRetries = 0;
      setWsStatus('connected', 'Live');
    };

    wsConn.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(ev.data); } catch (_) { return; }

      if (msg.type === 'positions_init' || msg.type === 'positions') {
        renderPositions(msg.data || []);
      }
      // ping — no action needed (WS heartbeat only)
    };

    wsConn.onclose = (ev) => {
      setWsStatus('error', 'Disconnected — reconnecting…');
      if (ev.code === 4001 || ev.code === 4003) {
        setWsStatus('error', 'Auth error — refresh to reconnect');
        return;
      }
      const delay = Math.min(30_000, 2_000 * Math.pow(1.5, wsRetries++));
      setTimeout(startWebSocket, delay);
    };

    wsConn.onerror = () => {
      setWsStatus('error', 'Connection error');
    };
  }

  // ── Positions render ───────────────────────────────────────────────────────
  // Shows LIVE / STALE / PEAK P&L badges based on whether the backend is
  // streaming a current_price for the position.

  function renderPositions(positions) {
    currentPositions = positions;

    const body  = document.getElementById('positionsBody');
    const count = document.getElementById('positionCount');
    const total = document.getElementById('totalCost');

    count.textContent = positions.length;

    const totalCostVal = positions.reduce((s, p) => s + (p.total_cost || 0), 0);
    total.textContent  = totalCostVal > 0 ? fmtPrice(totalCostVal) : '—';

    if (!positions.length) {
      body.innerHTML = '<div class="dash-empty">No open positions</div>';
      return;
    }

    body.innerHTML = positions.map(pos => {
      const dir      = (pos.direction || '').toLowerCase().includes('put') ? 'put' : 'call';
      const dirLabel = dir === 'put' ? 'PUT' : 'CALL';

      const isLive  = pos.current_price != null;
      const isStale = !isLive && pos.price_age_secs != null;

      let livePnlHtml;
      if (isLive) {
        const cls = pos.unrealized_pnl >= 0 ? 'positive' : 'negative';
        livePnlHtml = `
  <div class="pos-pnl-row">
    <span class="pos-pnl-label">Current P&amp;L <span class="pnl-badge live">LIVE</span></span>
    <span class="pos-pnl-value ${cls}">${fmt$(Math.round(pos.unrealized_pnl))} (${fmtPct(pos.unrealized_pnl_pct)})</span>
  </div>`;
      } else if (isStale) {
        const ageSecs = pos.price_age_secs;
        const ageStr  = ageSecs < 60
          ? Math.round(ageSecs) + 's'
          : Math.floor(ageSecs / 60) + 'm' + Math.round(ageSecs % 60) + 's';
        livePnlHtml = `
  <div class="pos-pnl-row stale-row">
    <span class="pos-pnl-label">Current P&amp;L <span class="pnl-badge stale">STALE · ${ageStr} old</span></span>
    <span class="pos-pnl-value neutral">—</span>
  </div>`;
      } else {
        livePnlHtml = `
  <div class="pos-pnl-row stale-row">
    <span class="pos-pnl-label">Current P&amp;L <span class="pnl-badge stale">NO PRICE</span></span>
    <span class="pos-pnl-value neutral">—</span>
  </div>`;
      }

      const peakPnl  = pos.peak_pnl;
      const peakPct  = pos.peak_pnl_pct;
      const peakCls  = peakPnl == null ? 'neutral' : (peakPnl >= 0 ? 'positive' : 'negative');
      const peakPnlHtml = `
  <div class="pos-pnl-row peak-row">
    <span class="pos-pnl-label">Peak P&amp;L <span class="pnl-badge peak">PEAK</span></span>
    <span class="pos-pnl-value ${peakCls}">${peakPnl != null ? fmt$(Math.round(peakPnl)) + ' (' + fmtPct(peakPct) + ')' : '—'}</span>
  </div>`;

      const trailArmed = pos.trail_armed;

      return `
<div class="pos-card" data-pos-id="${pos.position_id || ''}">
  <div class="pos-card-top">
    <span class="pos-ticker">${pos.ticker || '?'}</span>
    <span class="pos-direction ${dir}">${dirLabel}</span>
  </div>
  <div class="pos-contract">
    $${pos.strike} · ${pos.expiry || ''} · ${pos.contracts_open}x · entry ${fmtPrice(pos.entry_price)}
  </div>
  ${livePnlHtml}
  ${peakPnlHtml}
  <div class="pos-trail-row">
    <span class="trail-badge ${trailArmed ? 'armed' : 'waiting'}">
      ${trailArmed ? '⬆ Trail Armed' : '⭕ Awaiting Arm'}
    </span>
    ${pos.trail_stop_price ? '<span>stop ' + fmtPrice(pos.trail_stop_price) + '</span>' : ''}
  </div>
  <div class="pos-levels">
    <div class="pos-level-item">
      <span class="pos-level-label">TP1 stock</span>
      <span class="pos-level-value">${pos.tp1_stock_price ? fmtPrice(pos.tp1_stock_price) : '—'}</span>
    </div>
    <div class="pos-level-item">
      <span class="pos-level-label">SL stock</span>
      <span class="pos-level-value">${pos.sl_stock_price ? fmtPrice(pos.sl_stock_price) : '—'}</span>
    </div>
    <div class="pos-level-item">
      <span class="pos-level-label">Peak opt</span>
      <span class="pos-level-value">${fmtPrice(pos.peak_price)}</span>
    </div>
    <div class="pos-level-item">
      <span class="pos-level-label">Opened</span>
      <span class="pos-level-value">${fmtRelTime(pos.opened_at)}</span>
    </div>
  </div>
</div>`;
    }).join('');

    // Re-attach console for any position that had it open before this WS refresh.
    if (openConsoleId) {
      const card = body.querySelector(`.pos-card[data-pos-id="${openConsoleId}"]`);
      const pos  = currentPositions.find(p => p.position_id === openConsoleId);
      if (card && pos) {
        card.insertAdjacentHTML('beforeend', buildConsoleHtml(pos));
        card.classList.add('expanded');
        wireConsoleButtons(card, pos);
      } else {
        openConsoleId = null;
      }
    }
  }

  // ── Signals ────────────────────────────────────────────────────────────────
  // Shows an engine-down banner when market is open but no recent signal has fired.

  function _marketMinutesOpen() {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York',
      weekday:  'short',
      hour:     '2-digit',
      minute:   '2-digit',
      hour12:   false,
    });
    const parts = Object.fromEntries(
      fmt.formatToParts(new Date()).map(p => [p.type, p.value])
    );
    if (['Sat', 'Sun'].includes(parts.weekday)) return 0;
    const hour  = parseInt(parts.hour,   10) % 24;
    const min   = parseInt(parts.minute, 10);
    const total = hour * 60 + min;
    if (total < 570 || total >= 960) return 0;
    return total - 570;
  }

  async function loadSignals() {
    const body = document.getElementById('signalsBody');
    const meta = document.getElementById('signalsMeta');
    try {
      const data      = await apiFetch('/api/signals');
      const sigs      = data.signals       || [];
      const lastSigTs = data.last_signal_ts || 0;

      const nowSecs    = Date.now() / 1000;
      const sigAgeMins = lastSigTs > 0 ? (nowSecs - lastSigTs) / 60 : null;

      const ageLabel = lastSigTs > 0 ? ' · last ' + fmtRelTime(lastSigTs) : '';
      meta.textContent = sigs.length + ' signals' + ageLabel;

      const minsOpen = _marketMinutesOpen();
      let bannerHtml = '';
      if (minsOpen > 30 && sigAgeMins != null && sigAgeMins > 30) {
        bannerHtml = `<div class="sig-engine-banner alarm">` +
          `⚠ Engine may be offline · last signal ${fmtRelTime(lastSigTs)}</div>`;
      } else if (minsOpen === 0 && sigAgeMins != null && sigAgeMins > 30) {
        bannerHtml = `<div class="sig-engine-banner closed">` +
          `Market closed · last signal ${fmtRelTime(lastSigTs)}</div>`;
      }

      let cardsHtml;
      if (!sigs.length) {
        cardsHtml = '<div class="dash-empty">No signals today</div>';
      } else {
        cardsHtml = sigs.map(s => {
          const tier      = (s.conviction_tier || s.cf_tier || '').toUpperCase();
          const dirStr    = (s.direction || 'bullish').toLowerCase().includes('bear') ? '🔴' : '🟢';
          const starHtml  = s.prime_star ? ' <span class="sig-star">★</span>' : '';
          const score     = s.conviction_score || 0;
          const scorePct  = Math.min(100, score * 10);
          const setupStr  = s.setup_type ? `<span class="sig-setup">${s.setup_type}</span>` : '';
          return `
<div class="sig-card ${s.actionable ? '' : 'stale'}" data-ticker="${s.ticker || ''}">
  <div class="sig-card-top">
    <span class="sig-ticker">${dirStr} ${s.ticker || '?'}${starHtml}</span>
    <span class="sig-tier ${tier}">${tier || '—'}</span>
  </div>
  <div class="sig-score-row">
    <div class="sig-score-bar-wrap"><div class="sig-score-bar" style="width:${scorePct}%"></div></div>
    <span class="sig-score-val">${score}</span>
    ${setupStr}
  </div>
  <div class="sig-meta">
    <span>${s.recommended_strike ? '$' + s.recommended_strike + ' strike' : '—'}</span>
    <span>${s.dte != null ? s.dte + 'DTE' : ''}</span>
    <span>${s.ask ? 'ask $' + parseFloat(s.ask).toFixed(2) : ''}</span>
    <span class="sig-time">${fmtRelTime(s.fire_time)}</span>
  </div>
</div>`;
        }).join('');
      }

      body.innerHTML = bannerHtml + cardsHtml;
    } catch (err) {
      meta.textContent = 'error';
      body.innerHTML   = '<div class="dash-placeholder">Could not load signals</div>';
    }
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────

  async function loadWatchlist() {
    const body = document.getElementById('watchlistBody');
    const meta = document.getElementById('watchlistMeta');
    try {
      const data = await apiFetch('/api/watchlist');
      if (!data.available) {
        meta.textContent   = 'pending';
        body.innerHTML     = '<div class="dash-placeholder">Board posts at 9:50 ET</div>';
        watchlistDataCache = [];
        return;
      }

      const rows         = data.rows || [];
      watchlistDataCache = rows;
      meta.textContent   = rows.length + ' tickers · ' + (data.date || '');

      if (!rows.length) {
        body.innerHTML = '<div class="dash-empty">No watchlist entries</div>';
        return;
      }

      body.innerHTML = rows.map(r => {
        const isLong   = !(r.direction || '').toLowerCase().startsWith('short');
        const dirClass = isLong ? 'bull' : 'bear';
        const dirArrow = isLong ? '▲' : '▼';
        const dirLabel = isLong ? 'CALL' : 'PUT';

        // Zone state badge
        const zoneKey   = r.arm_state || 'armed';
        const zoneLabel = { armed: 'armed', at_risk: 'at risk', fired: 'fired', invalidated: 'invalid', deactivated: 'inactive' }[zoneKey] || zoneKey;
        const zoneCls   = 'wl-zone wl-zone-' + zoneKey.replace('_', '-');

        // Level gauge: for calls → low=vs, high=trigger; for puts → low=trigger, high=vs
        const low  = isLong ? (r.vs || 0) : (r.trigger || 0);
        const high = isLong ? (r.trigger || 0) : (r.vs || 0);
        const cur  = r.current_price || 0;
        let gaugeHtml = '';
        if (low && high && high > low) {
          const pct     = Math.min(100, Math.max(0, ((cur - low) / (high - low)) * 100));
          const marker  = cur > 0 ? `<div class="wl-gauge-marker" style="left:${pct.toFixed(1)}%"></div>` : '';
          gaugeHtml = `
  <div class="wl-gauge">
    <span class="wl-gauge-label">${fmtPrice(low)}</span>
    <div class="wl-gauge-track ${dirClass}">
      <div class="wl-gauge-fill" style="width:${cur > 0 ? pct.toFixed(1) : 0}%"></div>
      ${marker}
    </div>
    <span class="wl-gauge-label">${fmtPrice(high)}</span>
  </div>`;
        }

        return `
<div class="wl-row" data-ticker="${r.ticker || ''}">
  <div class="wl-row-header">
    <span class="wl-ticker">${r.ticker || '?'}</span>
    <span class="wl-dir ${dirClass}">${dirArrow} ${dirLabel}</span>
    <span class="${zoneCls}">${zoneLabel}</span>
  </div>${gaugeHtml}
</div>`;
      }).join('');

      // If we already have a ticker focused, refresh its levels from the new data.
      if (focusedTicker) renderLevels(focusedTicker);

    } catch (err) {
      meta.textContent = 'error';
      body.innerHTML   = '<div class="dash-placeholder">Could not load watchlist</div>';
    }
  }

  // ── Center panel — chart, levels, chain ───────────────────────────────────

  function setupCenterPanel() {
    const searchBtn   = document.getElementById('tickerSearchBtn');
    const searchInput = document.getElementById('tickerSearch');
    if (searchBtn)   searchBtn.addEventListener('click', handleSearch);
    if (searchInput) searchInput.addEventListener('keydown', e => { if (e.key === 'Enter') handleSearch(); });

    // Watchlist row click → focus ticker
    document.getElementById('watchlistBody').addEventListener('click', e => {
      const row = e.target.closest('.wl-row');
      if (row && row.dataset.ticker) focusOn(row.dataset.ticker);
    });

    // Signal card click → focus ticker
    document.getElementById('signalsBody').addEventListener('click', e => {
      const card = e.target.closest('.sig-card');
      if (card && card.dataset.ticker) focusOn(card.dataset.ticker);
    });

    // Chain bias / expiry selector changes
    document.getElementById('chainBias').addEventListener('change', () => {
      if (chainTicker) loadChain(chainTicker, chainCurrentPrice);
    });
    document.getElementById('chainExpiry').addEventListener('change', () => {
      if (chainTicker) loadChain(chainTicker, chainCurrentPrice);
    });

    // Chain refresh button
    const chainRefreshBtn = document.getElementById('chainRefreshBtn');
    if (chainRefreshBtn) {
      chainRefreshBtn.addEventListener('click', () => {
        if (chainTicker) loadChain(chainTicker, chainCurrentPrice);
      });
    }
  }

  function handleSearch() {
    const input  = document.getElementById('tickerSearch');
    const ticker = (input ? input.value : '').trim().toUpperCase();
    if (ticker) focusOn(ticker);
  }

  function focusOn(ticker) {
    if (!ticker) return;
    const t = ticker.toUpperCase();
    focusedTicker = t;

    const metaEl = document.getElementById('focusMeta');
    if (metaEl) metaEl.textContent = t;

    const searchInput = document.getElementById('tickerSearch');
    if (searchInput) searchInput.value = t;

    renderLevels(t);

    // Derive price and bias from watchlist cache
    const wlRow = watchlistDataCache.find(r => r.ticker === t);
    const price = wlRow && wlRow.trigger ? parseFloat(wlRow.trigger) : 0;
    const bias  = wlRow && (wlRow.direction || '').toLowerCase().includes('bear') ? 'bearish' : 'bullish';

    // Update price-ref strip
    buildPriceStrip(t, price);

    // Also update topbar TV link (legacy; price strip has the prominent button)
    const tvPopout = document.getElementById('tvPopoutBtn');
    if (tvPopout) {
      tvPopout.href = `https://www.tradingview.com/chart/?symbol=${t}&interval=10`;
      tvPopout.style.display = '';
    }

    // Seed bias selector from watchlist direction
    const biasEl = document.getElementById('chainBias');
    if (biasEl) biasEl.value = bias;

    // Show chain controls (including refresh button) and load expirations
    const controls = document.getElementById('chainControls');
    if (controls) controls.style.display = 'flex';

    loadChainExpirations(t, price);
  }

  // Price-reference strip — replaces the TradingView embed.
  // Shows the watchlist trigger price + a prominent TV link-out. Read-only.
  function buildPriceStrip(ticker, price) {
    const placeholder = document.getElementById('priceStripPlaceholder');
    const dataEl      = document.getElementById('priceStripData');
    const tickerEl    = document.getElementById('priceStripTicker');
    const priceEl     = document.getElementById('priceStripPrice');
    const noteEl      = document.getElementById('priceStripNote');
    const tvBtn       = document.getElementById('priceStripTvBtn');

    if (!dataEl) return;
    if (placeholder) placeholder.style.display = 'none';
    dataEl.style.display = 'flex';

    if (tickerEl) tickerEl.textContent = ticker;
    if (priceEl)  priceEl.textContent  = price > 0 ? fmtPrice(price) : '—';
    if (noteEl)   noteEl.textContent   = price > 0 ? 'watchlist trigger' : 'price unavailable';
    if (tvBtn)    tvBtn.href = `https://www.tradingview.com/chart/?symbol=${ticker}&interval=10`;
  }

  // Levels panel: shows watchlist-derived context for the focused ticker.
  function renderLevels(ticker) {
    const titleEl  = document.getElementById('levelsTicker');
    const sourceEl = document.getElementById('levelsSource');
    const gridEl   = document.getElementById('levelsGrid');
    if (!titleEl || !gridEl) return;

    titleEl.textContent = ticker || '—';

    const row = watchlistDataCache.find(r => r.ticker === ticker);
    if (!row) {
      if (sourceEl) sourceEl.textContent = 'not on today\'s watchlist';
      gridEl.innerHTML = '<div class="dash-placeholder" style="font-size:0.68rem;padding:0.5rem">—</div>';
      return;
    }

    if (sourceEl) sourceEl.textContent = 'watchlist board';

    const dirClass = (row.direction || '').toLowerCase().startsWith('bear') ? 'bear' : 'bull';

    const cells = [
      { label: 'Direction', value: (row.direction || '—').replace(/_/g, ' ').toUpperCase(), cls: dirClass },
      { label: 'Trigger',   value: row.trigger  != null ? fmtPrice(row.trigger) : '—' },
      { label: 'vs',        value: row.vs       != null ? fmtPrice(row.vs)      : '—' },
      { label: 'Gates',     value: row.gate_n   != null ? row.gate_n + ' / 4'   : '—' },
      { label: 'Arm',       value: row.arm_state || '—'                              },
      { label: 'Rank',      value: row.rank     != null ? '#' + row.rank         : '—' },
    ];

    gridEl.innerHTML = cells.map(c => `
<div class="dash-level-cell">
  <span class="dash-level-cell-label">${c.label}</span>
  <span class="dash-level-cell-value${c.cls ? ' ' + c.cls : ''}">${c.value}</span>
</div>`).join('');
  }

  // ── Chain — Part 2 ─────────────────────────────────────────────────────────

  async function loadChainExpirations(ticker, price) {
    const chainBody = document.getElementById('chainBody');
    const expiryEl  = document.getElementById('chainExpiry');
    if (!chainBody || !expiryEl) return;

    chainBody.innerHTML = '<div class="dash-placeholder">Loading expirations…</div>';
    expiryEl.innerHTML  = '<option value="">— loading —</option>';
    armedContract       = null;

    try {
      const data = await apiFetch(`/api/chain/expirations?ticker=${encodeURIComponent(ticker)}`);
      const exps = data.expirations || [];

      if (!exps.length) {
        chainBody.innerHTML = '<div class="dash-placeholder">No near-term expirations (market closed or illiquid)</div>';
        return;
      }

      expiryEl.innerHTML = exps.map(e =>
        `<option value="${e.date}">${e.date} (${e.dte}DTE)</option>`
      ).join('');

      // Load chain for the first expiry
      chainTicker       = ticker;
      chainCurrentPrice = price;
      await loadChain(ticker, price);
    } catch (err) {
      if (String(err).includes('403')) {
        chainBody.innerHTML = '<div class="dash-placeholder">Chain requires admin access</div>';
      } else {
        chainBody.innerHTML = '<div class="dash-placeholder">Could not load expirations</div>';
      }
    }
  }

  async function loadChain(ticker, price) {
    const chainBody = document.getElementById('chainBody');
    const expiryEl  = document.getElementById('chainExpiry');
    const biasEl    = document.getElementById('chainBias');
    if (!chainBody || !expiryEl || !biasEl) return;

    const expiry = expiryEl.value;
    const bias   = biasEl.value;
    if (!expiry || !ticker || !price) {
      chainBody.innerHTML = '<div class="dash-placeholder">Select expiry and ensure ticker price is available</div>';
      return;
    }

    chainBody.innerHTML = '<div class="dash-placeholder">Loading chain…</div>';
    armedContract = null;

    try {
      const params = new URLSearchParams({ ticker, expiry, bias, price, n_strikes: 13 });
      const data   = await apiFetch(`/api/chain?${params}`);
      renderChain(data.strikes || [], bias);
    } catch (err) {
      if (String(err).includes('403')) {
        chainBody.innerHTML = '<div class="dash-placeholder">Chain requires admin access</div>';
      } else {
        chainBody.innerHTML = '<div class="dash-placeholder">Could not load chain</div>';
      }
    }
  }

  function renderChain(strikes, bias) {
    const chainBody = document.getElementById('chainBody');
    if (!strikes.length) {
      chainBody.innerHTML = '<div class="dash-placeholder">No liquid strikes (market closed or try different expiry)</div>';
      return;
    }

    const dirLabel = bias === 'bullish' ? 'CALL' : 'PUT';

    const rows = strikes.map((s, i) => `
<tr data-idx="${i}" class="${s.is_target ? 'chain-atm' : ''}">
  <td>
    <span class="chain-badge ${s.badge}">${s.badge}</span>
    $${s.strike}
  </td>
  <td>${s.delta.toFixed(2)}</td>
  <td>${s.ask.toFixed(2)}</td>
  <td>${s.bid.toFixed(2)}</td>
  <td>${s.iv > 0 ? (s.iv * 100).toFixed(0) + '%' : '—'}</td>
  <td>${s.tp1_val > 0 ? s.tp1_val.toFixed(2) : '—'}</td>
</tr>`).join('');

    chainBody.innerHTML = `
<table class="chain-table">
  <thead>
    <tr>
      <th>${dirLabel}</th>
      <th>Δ</th>
      <th>Ask</th>
      <th>Bid</th>
      <th>IV</th>
      <th>@TP1</th>
    </tr>
  </thead>
  <tbody>${rows}</tbody>
</table>`;

    // Click-to-select a row
    chainBody.querySelectorAll('table tbody tr').forEach((row, i) => {
      row.addEventListener('click', () => {
        chainBody.querySelectorAll('table tbody tr').forEach(r => r.classList.remove('chain-selected'));
        row.classList.add('chain-selected');
        armContract(strikes[i], bias);
      });
    });

    // Scroll ATM row into view so the center strike is always visible
    const atmRow = chainBody.querySelector('tr.chain-atm');
    if (atmRow) atmRow.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }

  async function armContract(strike, bias) {
    armedContract = { ...strike, bias };

    const chainBody = document.getElementById('chainBody');
    const old = chainBody.querySelector('.chain-armed');
    if (old) old.remove();

    const dir = bias === 'bullish' ? 'call' : 'put';
    const sym = strike.symbol || `${chainTicker} $${strike.strike}${dir[0].toUpperCase()} ${strike.expiration}`;
    const ask = parseFloat(strike.ask);
    const iv  = parseFloat(strike.iv)  || 0;
    const dte = parseInt(strike.dte,10) || 0;

    const defaultTarget = chainCurrentPrice > 0 ? chainCurrentPrice.toFixed(2) : '';
    const targetSrc     = chainCurrentPrice > 0 ? 'watchlist trigger' : 'enter target';

    const cockpitHtml = `
<div class="chain-armed" id="chainArmed">
  <div class="cockpit-header">
    <div class="cockpit-header-left">
      <span class="cockpit-symbol">${sym}</span>
      <span class="cockpit-meta" id="cockpitMeta">${dir.toUpperCase()} · ask $${ask.toFixed(2)} · ${dte}DTE${iv > 0 ? ' · IV ' + (iv * 100).toFixed(0) + '%' : ''}<span class="cockpit-quote-age" id="cockpitQuoteAge"></span></span>
    </div>
    <button class="cockpit-refresh-btn" id="cockpitRefreshBtn" title="Re-fetch live quote + projection">↻</button>
  </div>

  <div class="chain-qty-row">
    <span class="chain-armed-label">Qty</span>
    <input class="chain-qty-input" id="chainQty" type="number" min="1" max="20" value="2">
    <span class="chain-cost-label">cost</span>
    <span class="chain-cost-value" id="chainCost">${fmtPrice(ask * 2 * 100)}</span>
    <span class="chain-cost-label" style="margin-left:0.25rem">max loss</span>
    <span class="chain-cost-value" id="chainMaxLoss">${fmtPrice(ask * 2 * 100)}</span>
  </div>

  <div class="cockpit-target-row">
    <span class="chain-armed-label">Target $</span>
    <input class="cockpit-target-input" id="cockpitTarget" type="number" step="0.01" value="${defaultTarget}" placeholder="0.00">
    <button class="cockpit-apply-btn" id="cockpitApplyTarget">→</button>
    <span class="cockpit-target-src" id="cockpitTargetSrc">${targetSrc}</span>
  </div>

  <div class="cockpit-proj-wrap" id="cockpitProjWrap">
    <div class="dash-placeholder" style="padding:0.4rem 0">Loading projection…</div>
  </div>

  <div class="cockpit-verdict" id="cockpitVerdict" style="display:none"></div>

  <div class="cockpit-levels-section">
    <div class="cockpit-section-label">Exit target — wired later</div>
    <div class="cockpit-level-btns" id="cockpitLevelBtns">
      <button class="cockpit-level-btn active" data-mode="profit">Profit-only</button>
      <button class="cockpit-level-btn" data-mode="stop">+ Stop</button>
      <button class="cockpit-level-btn" data-mode="manual">Full manual</button>
    </div>
  </div>

  <div class="cockpit-actions">
    <button class="cockpit-action-btn" id="cockpitLimitBtn" disabled>
      Set limit
      <span class="pos-preview-tag">wired later</span>
    </button>
    <button class="chain-open-btn" id="chainOpenBtn">
      Open Position
      <span class="pos-preview-tag">gated by kill-switch</span>
    </button>
  </div>
</div>`;

    chainBody.insertAdjacentHTML('beforeend', cockpitHtml);

    // Qty → update cost + max-loss (cost = max-loss for long options)
    document.getElementById('chainQty').addEventListener('input', () => {
      const qty  = Math.max(1, parseInt(document.getElementById('chainQty').value, 10) || 1);
      const cost = armedContract.ask * qty * 100;
      document.getElementById('chainCost').textContent    = fmtPrice(cost);
      document.getElementById('chainMaxLoss').textContent = fmtPrice(cost);
    });

    // Exit level mode buttons (UI only — no backend wiring in this task)
    document.getElementById('cockpitLevelBtns').addEventListener('click', e => {
      const btn = e.target.closest('.cockpit-level-btn');
      if (!btn) return;
      document.querySelectorAll('#cockpitLevelBtns .cockpit-level-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    // Target override apply
    document.getElementById('cockpitApplyTarget').addEventListener('click', () => {
      const tgt = parseFloat(document.getElementById('cockpitTarget').value);
      if (tgt > 0) {
        document.getElementById('cockpitTargetSrc').textContent = 'manual override';
        loadProjection();
      }
    });
    // Also apply on Enter key in target input
    document.getElementById('cockpitTarget').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('cockpitApplyTarget').click();
    });

    // Cockpit refresh: re-fetch live quote then re-run projection
    document.getElementById('cockpitRefreshBtn').addEventListener('click', async () => {
      await refreshArmedQuote();
      loadProjection();
    });

    // Open Position button — existing kill-switch gated behavior
    document.getElementById('chainOpenBtn').addEventListener('click', () => {
      const qty     = Math.max(1, parseInt(document.getElementById('chainQty').value, 10) || 1);
      const cost    = armedContract.ask * qty * 100;
      const cpLabel = dir === 'call' ? 'CALL' : 'PUT';
      showConfirmModal({
        title:   `Open ${chainTicker} ${cpLabel}`,
        body:    `<strong>${sym}</strong><br>` +
                 `Qty: <strong>${qty}</strong> contract${qty > 1 ? 's' : ''}<br>` +
                 `Est. cost: <strong>${fmtPrice(cost)}</strong> (${qty} × $${armedContract.ask.toFixed(2)} × 100)<br><br>` +
                 `<span style="color:var(--text-muted);font-size:0.68rem">` +
                 `Gated by kill-switch. Order goes to your active env (verify sandbox before first live use).</span>`,
        okLabel: 'Place Order',
        okClass: '',
        onOk: async (setStatus) => {
          setStatus('Placing order…');
          try {
            const result = await apiPost('/api/v1/orders/open', {
              ticker:        chainTicker,
              option_symbol: armedContract.symbol,
              direction:     dir,
              strike:        armedContract.strike,
              expiry:        armedContract.expiration,
              qty,
              bid_price:     armedContract.ask,
            });
            if (result.status === 'filled') {
              setStatus(`Filled @ $${result.fill_price.toFixed(2)} · position_id ${result.position_id}`, 'ok');
            } else {
              setStatus(`Status: ${result.status} — ${result.detail || ''}`, 'ok');
            }
          } catch (err) {
            const detail = err.data && err.data.detail ? err.data.detail : err.message;
            setStatus(`Error: ${detail}`, 'error');
          }
        },
      });
    });

    // Auto-refresh quote then load projection on arm
    await refreshArmedQuote();
    loadProjection();
  }

  // Re-fetches the live quote for the armed contract from /api/chain/quote.
  // Updates armedContract.ask / .iv / .dte in place so subsequent projection
  // calls and the Open button use fresh data.
  async function refreshArmedQuote() {
    if (!armedContract || !chainTicker) return;
    const ageEl = document.getElementById('cockpitQuoteAge');
    if (ageEl) ageEl.textContent = ' · refreshing…';

    try {
      const optionType = armedContract.option_type ||
        (armedContract.bias === 'bullish' ? 'call' : 'put');
      const params = new URLSearchParams({
        ticker:      chainTicker,
        strike:      armedContract.strike,
        expiry:      armedContract.expiration,
        option_type: optionType,
        price:       chainCurrentPrice > 0 ? chainCurrentPrice : armedContract.strike,
      });
      const fresh = await apiFetch(`/api/chain/quote?${params}`);

      // Update in-place so qty handler and Open button use fresh ask
      armedContract.ask = fresh.ask;
      armedContract.iv  = fresh.iv;
      armedContract.dte = fresh.dte;

      // Refresh meta label
      const dir    = armedContract.bias === 'bullish' ? 'CALL' : 'PUT';
      const metaEl = document.getElementById('cockpitMeta');
      if (metaEl) {
        metaEl.innerHTML =
          `${dir} · ask $${fresh.ask.toFixed(2)} · ${fresh.dte}DTE` +
          (fresh.iv > 0 ? ` · IV ${(fresh.iv * 100).toFixed(0)}%` : '') +
          ` <span class="cockpit-quote-age" id="cockpitQuoteAge"> · live</span>`;
      }

      // Refresh cost display with current qty
      const qtyEl = document.getElementById('chainQty');
      if (qtyEl) {
        const qty  = Math.max(1, parseInt(qtyEl.value, 10) || 1);
        const cost = fresh.ask * qty * 100;
        const costEl = document.getElementById('chainCost');
        const mlEl   = document.getElementById('chainMaxLoss');
        if (costEl) costEl.textContent = fmtPrice(cost);
        if (mlEl)   mlEl.textContent   = fmtPrice(cost);
      }
    } catch (_) {
      if (ageEl) ageEl.textContent = ' · refresh failed';
    }
  }

  // Calls /api/projection with the current armed contract data + target override.
  async function loadProjection() {
    const wrapEl = document.getElementById('cockpitProjWrap');
    const verdEl = document.getElementById('cockpitVerdict');
    if (!wrapEl || !armedContract) return;

    const targetEl = document.getElementById('cockpitTarget');
    const target   = targetEl && parseFloat(targetEl.value) > 0
      ? parseFloat(targetEl.value)
      : chainCurrentPrice;

    if (!target || target <= 0) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">Enter a target price above to see projection</div>';
      return;
    }

    if (!armedContract.iv || armedContract.iv <= 0) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">IV unavailable — projection requires market hours data</div>';
      return;
    }

    wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">Loading projection…</div>';

    try {
      const optionType = armedContract.option_type ||
        (armedContract.bias === 'bullish' ? 'call' : 'put');
      const params = new URLSearchParams({
        ticker:      chainTicker,
        strike:      armedContract.strike,
        expiry:      armedContract.expiration,
        target,
        option_type: optionType,
        iv:          armedContract.iv,
        premium:     armedContract.ask,
        dte:         armedContract.dte,
        iv_crush:    0,
      });
      const proj = await apiFetch(`/api/projection?${params}`);
      renderProjection(proj, wrapEl, verdEl);
    } catch (err) {
      const detail = String(err).includes('403') ? 'Admin access required' : 'Projection unavailable';
      wrapEl.innerHTML = `<div class="dash-placeholder" style="padding:0.4rem 0">${detail}</div>`;
    }
  }

  // Renders the projection matrix table + verdict banner.
  function renderProjection(proj, wrapEl, verdEl) {
    const rows = proj.rows || [];
    if (!rows.length) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">No projection data</div>';
      return;
    }

    const maxAbsGain = Math.max(1, ...rows.map(r => Math.abs(r.gain_pct)));

    const rowsHtml = rows.map(r => {
      const gainCls = r.gain_pct >= 0 ? 'positive' : 'negative';
      const barPct  = Math.min(100, (Math.abs(r.gain_pct) / maxAbsGain) * 100);
      const barCls  = r.gain_pct >= 0 ? 'proj-bar-pos' : 'proj-bar-neg';
      const dolSign = r.dollars >= 0 ? '+' : '';
      return `
<tr>
  <td class="proj-col-when">${r.horizon_label}</td>
  <td class="proj-col-val">$${r.value.toFixed(2)}</td>
  <td class="proj-col-gain ${gainCls}">${r.gain_pct >= 0 ? '+' : ''}${r.gain_pct.toFixed(1)}%</td>
  <td class="proj-col-dol ${gainCls}">${dolSign}$${Math.abs(Math.round(r.dollars))}</td>
  <td class="proj-col-bar"><div class="proj-bar ${barCls}" style="width:${barPct.toFixed(0)}%"></div></td>
</tr>`;
    }).join('');

    wrapEl.innerHTML = `
<table class="cockpit-proj-table">
  <thead><tr><th>When</th><th>Value</th><th>Gain%</th><th>$/ct</th><th></th></tr></thead>
  <tbody>${rowsHtml}</tbody>
</table>`;

    // Verdict banner
    const verdictMap = {
      worthless_at_expiry: { cls: 'verdict-red',   icon: '✗', text: 'Worthless at expiry — expires OTM even if stock hits target' },
      theta_dominated:     { cls: 'verdict-amber',  icon: '⚡', text: 'Theta dominated — most value lost by expiry; move must happen soon' },
      survives_slow_move:  { cls: 'verdict-green',  icon: '✓', text: 'Survives slow move — retains value at target even near expiry' },
    };
    const v = verdictMap[proj.verdict] || { cls: '', icon: '?', text: proj.verdict };
    if (verdEl) {
      verdEl.innerHTML     = `${v.icon} ${v.text}`;
      verdEl.className     = `cockpit-verdict ${v.cls}`;
      verdEl.style.display = '';
    }
  }

  // ── Position management console (Part 3 — close wired) ───────────────────

  function setupConsoleHandlers() {
    document.getElementById('positionsBody').addEventListener('click', e => {
      // Clicks inside the console itself should not re-toggle the card.
      if (e.target.closest('.pos-console')) return;
      const card = e.target.closest('.pos-card');
      if (!card) return;
      const posId = card.dataset.posId;
      const pos   = currentPositions.find(p => p.position_id === posId);
      if (pos) toggleConsole(card, pos);
    });
  }

  function toggleConsole(card, pos) {
    const posId = pos.position_id;

    // Close any other open console first
    if (openConsoleId && openConsoleId !== posId) {
      const prev = document.querySelector(`.pos-card[data-pos-id="${openConsoleId}"]`);
      if (prev) {
        const c = prev.querySelector('.pos-console');
        if (c) c.remove();
        prev.classList.remove('expanded');
      }
    }

    const existing = card.querySelector('.pos-console');
    if (existing) {
      existing.remove();
      card.classList.remove('expanded');
      openConsoleId = null;
    } else {
      card.insertAdjacentHTML('beforeend', buildConsoleHtml(pos));
      card.classList.add('expanded');
      openConsoleId = posId;
      wireConsoleButtons(card, pos);
    }
  }

  function wireConsoleButtons(card, pos) {
    // Close button — real POST /api/v1/orders/close behind a confirmation modal
    const closeBtn = card.querySelector('.pos-console-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', e => {
        e.stopPropagation();
        const posId = closeBtn.dataset.posId;
        const cts   = parseInt(closeBtn.dataset.contracts, 10);
        const sym   = closeBtn.dataset.symbol;
        const entry = parseFloat(closeBtn.dataset.entry);
        showConfirmModal({
          title:   `Close ${pos.ticker} position`,
          body:    `<strong>${sym}</strong><br>` +
                   `Qty: <strong>${cts} contract${cts !== 1 ? 's' : ''}</strong> · entry $${entry.toFixed(2)}<br><br>` +
                   `<span style="color:var(--text-muted);font-size:0.68rem">` +
                   `Market order. Fill price may differ from current mid. Gated by kill-switch.</span>`,
          okLabel: `Close ${cts}x at market`,
          okClass: 'danger',
          onOk: async (setStatus) => {
            setStatus('Placing close order…');
            try {
              const result = await apiPost('/api/v1/orders/close', { position_id: posId });
              if (result.status === 'closed') {
                setStatus(`Closed @ $${result.fill_price.toFixed(2)}`, 'ok');
              } else if (result.status === 'closing_pending') {
                setStatus('Close order placed — fill pending. Verify in Tradier.', 'ok');
              } else if (result.status === 'pdt_protected') {
                setStatus('PDT protected — close manually in your broker.', 'error');
              } else {
                setStatus(`Status: ${result.status || JSON.stringify(result)}`, 'ok');
              }
            } catch (err) {
              const detail = err.data && err.data.detail ? err.data.detail : err.message;
              if (err.status === 503) {
                setStatus('Kill-switch is OFF — web trading disabled', 'error');
              } else if (err.status === 403) {
                setStatus('Admin access required', 'error');
              } else {
                setStatus(`Error: ${detail}`, 'error');
              }
            }
          },
        });
      });
    }
  }

  // Builds the HTML for the inline management console.
  // Scale and Rebase are stubs (not yet wired). Exit is wired via Part 3.
  function buildConsoleHtml(pos) {
    const cts     = pos.contracts_open || 1;
    const halfCts = Math.max(1, Math.floor(cts / 2));
    const tw      = pos.trail_width != null ? (pos.trail_width * 100).toFixed(0) + '%' : '—';

    const tp2Row = pos.tp2_stock_price ? `
    <div class="pos-target-row">
      <span class="pos-target-type">TP2 Stock</span>
      <span class="pos-target-price">${fmtPrice(pos.tp2_stock_price)}</span>
      <span class="pos-target-badge system">SYSTEM</span>
    </div>` : '';

    const trailStkRow = pos.trail_stop_stock_price ? `
    <div class="pos-target-row">
      <span class="pos-target-type">Trail stk</span>
      <span class="pos-target-price">${fmtPrice(pos.trail_stop_stock_price)}</span>
    </div>` : '';

    const sym   = pos.option_symbol || `${pos.ticker} $${pos.strike} ${pos.direction}`;
    const entry = pos.entry_price || 0;

    return `<div class="pos-console">
  <div class="pos-console-section">
    <div class="pos-console-label">System exits — read-only</div>
    <div class="pos-target-row">
      <span class="pos-target-type">TP1 Stock</span>
      <span class="pos-target-price">${pos.tp1_stock_price ? fmtPrice(pos.tp1_stock_price) : '—'}</span>
      <span class="pos-target-badge system">SYSTEM</span>
    </div>${tp2Row}
    <div class="pos-target-row">
      <span class="pos-target-type">SL Stock</span>
      <span class="pos-target-price">${pos.sl_stock_price ? fmtPrice(pos.sl_stock_price) : '—'}</span>
      <span class="pos-target-badge system">SYSTEM</span>
    </div>
  </div>
  <div class="pos-console-section">
    <div class="pos-console-label">Trail</div>
    <div class="pos-target-row">
      <span class="pos-target-type">Width</span>
      <span class="pos-target-price">${tw}</span>
    </div>${trailStkRow}
  </div>
  <div class="pos-console-actions">
    <button class="pos-console-btn"
            data-stub="partial_close" data-contracts="${halfCts}" data-pos-id="${pos.position_id}">
      Scale ${halfCts}x
      <span class="pos-preview-tag">stub · not wired</span>
    </button>
    <button class="pos-console-btn"
            data-stub="rebase_trail" data-pos-id="${pos.position_id}">
      Rebase Trail
      <span class="pos-preview-tag">stub · not wired</span>
    </button>
    <button class="pos-console-btn danger pos-console-close-btn"
            data-pos-id="${pos.position_id}"
            data-contracts="${cts}"
            data-symbol="${sym}"
            data-entry="${entry}">
      Exit ${cts}x
      <span class="pos-preview-tag">real · gated by kill-switch</span>
    </button>
  </div>
</div>`;
  }

  // ── History tab ───────────────────────────────────────────────────────────

  function setupHistoryTab() {
    const tabPos   = document.getElementById('tabPositions');
    const tabHist  = document.getElementById('tabHistory');
    const posBody  = document.getElementById('positionsBody');
    const histView = document.getElementById('historyView');
    if (!tabPos || !tabHist) return;

    tabPos.addEventListener('click', () => {
      tabPos.classList.add('active');
      tabHist.classList.remove('active');
      posBody.style.display  = '';
      histView.style.display = 'none';
      document.getElementById('positionsMeta').textContent = 'live';
    });

    tabHist.addEventListener('click', () => {
      tabHist.classList.add('active');
      tabPos.classList.remove('active');
      posBody.style.display  = 'none';
      histView.style.display = '';
      document.getElementById('positionsMeta').textContent = 'closed';
      loadHistory(histCurrentPeriod);
    });

    histView.querySelectorAll('.hist-period-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        histView.querySelectorAll('.hist-period-btn').forEach(b => b.classList.remove('active'));
        btn.classList.add('active');
        loadHistory(btn.dataset.period);
      });
    });

    if (isAdmin) {
      const scopeBar = document.getElementById('histScopeBar');
      if (scopeBar) scopeBar.style.display = '';
      fetchHistoryUsers();
      histView.querySelectorAll('.hist-scope-btn').forEach(btn => {
        btn.addEventListener('click', () => setHistScope(btn.dataset.scope, null));
      });
      const sel = document.getElementById('histUserSelect');
      if (sel) {
        sel.addEventListener('change', () => {
          if (sel.value) setHistScope('user', sel.value);
        });
      }
    }
  }

  async function loadHistory(period) {
    histCurrentPeriod = period;
    const histBody    = document.getElementById('histBody');
    const histSummary = document.getElementById('histSummary');
    histBody.innerHTML    = '<div class="dash-placeholder">Loading…</div>';
    histSummary.innerHTML = '';
    try {
      let url = '/api/history?period=' + encodeURIComponent(period);
      if (isAdmin) {
        if (histCurrentScope === 'all')                          url += '&user=all';
        else if (histCurrentScope === 'user' && histCurrentUser) url += '&user=' + encodeURIComponent(histCurrentUser);
        // 'me': no ?user= — backend defaults to admin's own trades
      }
      const data = await apiFetch(url);
      renderHistory(data);
    } catch (err) {
      histBody.innerHTML = '<div class="dash-placeholder">Could not load history</div>';
    }
  }

  function renderHistory(data) {
    const summary     = data.summary || {};
    const trades      = data.trades  || [];
    const histSummary = document.getElementById('histSummary');
    const histBody    = document.getElementById('histBody');

    const winRateStr = summary.win_rate != null ? summary.win_rate.toFixed(1) + '%' : '—';
    const pnlTotal   = summary.total_pnl || 0;
    const pnlClass   = pnlTotal >= 0 ? 'positive' : 'negative';

    histSummary.innerHTML = `
<div class="hist-summary-row">
  <div class="hist-stat">
    <span class="hist-stat-label">Win Rate</span>
    <span class="hist-stat-value">${winRateStr}</span>
  </div>
  <div class="hist-stat">
    <span class="hist-stat-label">Total P&amp;L</span>
    <span class="hist-stat-value ${pnlClass}">${fmtPnl$(pnlTotal)}</span>
  </div>
  <div class="hist-stat">
    <span class="hist-stat-label">Trades</span>
    <span class="hist-stat-value">${summary.count || 0}</span>
  </div>
</div>`;

    if (!trades.length) {
      histBody.innerHTML = '<div class="dash-empty">No closed trades for this period</div>';
      return;
    }

    const showUser = isAdmin && histCurrentScope !== 'me';
    const userHdr  = showUser ? '<span class="hist-cell hist-col-user hist-hdr">User</span>' : '';
    const header   = `
<div class="hist-row hist-header">
  ${userHdr}
  <span class="hist-cell hist-col-date  hist-hdr">Date</span>
  <span class="hist-cell hist-col-tkr   hist-hdr">Ticker</span>
  <span class="hist-cell hist-col-dir   hist-hdr">Dir</span>
  <span class="hist-cell hist-col-entry hist-hdr">Entry</span>
  <span class="hist-cell hist-col-exit  hist-hdr">Exit</span>
  <span class="hist-cell hist-col-pnl   hist-hdr">P&amp;L</span>
  <span class="hist-cell hist-col-pct   hist-hdr">%</span>
  <span class="hist-cell hist-col-wl    hist-hdr">W/L</span>
</div>`;

    const rows = trades.map(t => {
      const dir    = (t.direction || '').toLowerCase().includes('put') ? 'put' : 'call';
      const pnlCls = t.realized_pnl >= 0 ? 'positive' : 'negative';
      const dt     = t.closed_at
        ? new Date(t.closed_at * 1000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
        : '—';
      const userCell = showUser
        ? `<span class="hist-cell hist-col-user hist-uid hist-uid-link" data-uid="${t.user_id || ''}">${(t.user_id || '').slice(-6) || '—'}</span>`
        : '';
      const wlLabel = t.outcome === 'win' ? 'W' : t.outcome === 'loss' ? 'L' : '~';
      return `
<div class="hist-row">
  ${userCell}
  <span class="hist-cell hist-col-date">${dt}</span>
  <span class="hist-cell hist-col-tkr hist-ticker">${t.ticker || '?'}</span>
  <span class="hist-cell hist-col-dir"><span class="hist-dir ${dir}">${dir === 'put' ? 'P' : 'C'}</span></span>
  <span class="hist-cell hist-col-entry">${fmtPrice(t.entry_premium)}</span>
  <span class="hist-cell hist-col-exit">${fmtPrice(t.exit_premium)}</span>
  <span class="hist-cell hist-col-pnl ${pnlCls}">${fmtPnl$(t.realized_pnl)}</span>
  <span class="hist-cell hist-col-pct ${pnlCls}">${fmtPct(t.pnl_pct)}</span>
  <span class="hist-cell hist-col-wl"><span class="hist-outcome ${t.outcome}">${wlLabel}</span></span>
</div>`;
    }).join('');

    histBody.innerHTML = header + rows;

    if (showUser) {
      histBody.querySelectorAll('.hist-uid-link').forEach(cell => {
        cell.addEventListener('click', () => {
          const uid = cell.dataset.uid;
          if (uid) setHistScope('user', uid);
        });
      });
    }
  }

  function setHistScope(scope, userId) {
    histCurrentScope = scope;
    histCurrentUser  = userId || null;
    document.querySelectorAll('.hist-scope-btn').forEach(b =>
      b.classList.toggle('active', b.dataset.scope === scope && scope !== 'user'));
    const sel = document.getElementById('histUserSelect');
    if (sel) sel.value = (scope === 'user' && userId) ? userId : '';
    loadHistory(histCurrentPeriod);
  }

  async function fetchHistoryUsers() {
    try {
      const data = await apiFetch('/api/history/users');
      const sel  = document.getElementById('histUserSelect');
      if (!sel) return;
      (data.users || []).forEach(u => {
        const opt       = document.createElement('option');
        opt.value       = u.discord_id;
        opt.textContent = u.label;
        sel.appendChild(opt);
      });
    } catch (_) {}
  }

  // ── Confirmation modal (Part 3 + 4) ───────────────────────────────────────

  function setupModal() {
    document.getElementById('confirmCancel').addEventListener('click', closeModal);
  }

  function showConfirmModal({ title, body, okLabel, okClass, onOk }) {
    document.getElementById('confirmTitle').textContent  = title;
    document.getElementById('confirmBody').innerHTML     = body;
    document.getElementById('confirmStatus').textContent = '';
    document.getElementById('confirmStatus').className   = 'dash-modal-status';

    const okBtn = document.getElementById('confirmOk');
    okBtn.textContent = okLabel || 'Confirm';
    okBtn.className   = 'dash-modal-btn dash-modal-btn-ok' + (okClass ? ' ' + okClass : '');

    // Replace the button node to shed any stale event listener from a previous call
    const newOk = okBtn.cloneNode(true);
    okBtn.parentNode.replaceChild(newOk, okBtn);
    newOk.textContent = okLabel || 'Confirm';
    newOk.className   = 'dash-modal-btn dash-modal-btn-ok' + (okClass ? ' ' + okClass : '');
    newOk.addEventListener('click', async () => {
      newOk.disabled = true;
      const setStatus = (msg, cls) => {
        const el = document.getElementById('confirmStatus');
        el.textContent = msg;
        el.className   = 'dash-modal-status' + (cls ? ' ' + cls : '');
        if (cls === 'ok') setTimeout(closeModal, 2500);
      };
      try {
        await onOk(setStatus);
      } catch (err) {
        const el = document.getElementById('confirmStatus');
        el.textContent = 'Unexpected error: ' + err.message;
        el.className   = 'dash-modal-status error';
      } finally {
        newOk.disabled = false;
      }
    });

    document.getElementById('confirmModal').style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('confirmModal').style.display = 'none';
  }

  // Close modal when clicking the overlay backdrop
  document.getElementById('confirmModal').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmModal')) closeModal();
  });

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
