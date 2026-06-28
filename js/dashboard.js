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
          const tier   = (s.conviction_tier || s.cf_tier || '').toUpperCase();
          const dirStr = (s.direction || 'bullish').toLowerCase().includes('bear') ? '🔴' : '🟢';
          return `
<div class="sig-card ${s.actionable ? '' : 'stale'}" data-ticker="${s.ticker || ''}">
  <div class="sig-card-top">
    <span class="sig-ticker">${dirStr} ${s.ticker || '?'}</span>
    <span class="sig-tier ${tier}">${tier || '—'}</span>
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
        const dirClass = (r.direction || '').toLowerCase().startsWith('bear') ? 'bear' : 'bull';
        const dirLabel = dirClass === 'bear' ? 'BEAR' : 'BULL';
        return `
<div class="wl-row" data-ticker="${r.ticker || ''}">
  <span class="wl-ticker">${r.ticker || '?'}</span>
  <span class="wl-dir ${dirClass}">${dirLabel}</span>
  <span class="wl-gate">${r.gate_n != null ? r.gate_n + '/4' : ''}</span>
  <span class="wl-arm">${r.arm_state || ''}</span>
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

    buildChart(t);
    renderLevels(t);

    const tvBtn = document.getElementById('tvPopoutBtn');
    if (tvBtn) {
      tvBtn.href = `https://www.tradingview.com/chart/?symbol=${t}&interval=10`;
      tvBtn.style.display = '';
    }

    // Derive price from watchlist data if available for chain loading
    const wlRow = watchlistDataCache.find(r => r.ticker === t);
    const price = wlRow && wlRow.trigger ? parseFloat(wlRow.trigger) : 0;
    const bias  = wlRow && (wlRow.direction || '').toLowerCase().includes('bear') ? 'bearish' : 'bullish';

    // Seed bias selector from watchlist direction
    const biasEl = document.getElementById('chainBias');
    if (biasEl) biasEl.value = bias;

    // Show chain controls and load expirations
    const controls = document.getElementById('chainControls');
    if (controls) controls.style.display = 'flex';

    loadChainExpirations(t, price);
  }

  // TradingView Advanced Chart: 10-min interval, dark theme, full toolbar.
  function buildChart(ticker) {
    const host = document.getElementById('chartHost');
    if (!host) return;

    const placeholder = document.getElementById('chartPlaceholder');
    if (placeholder) placeholder.style.display = 'none';

    // Remove previous chart widget
    const old = host.querySelector('.tv-widget-wrapper');
    if (old) old.remove();

    const containerId = 'tv_' + ticker.toLowerCase().replace(/[^a-z0-9]/g, '') + '_' + Date.now();

    const wrapper = document.createElement('div');
    wrapper.className    = 'tv-widget-wrapper';
    wrapper.style.cssText = 'width:100%;height:100%;';

    const inner = document.createElement('div');
    inner.id           = containerId;
    inner.style.cssText = 'width:100%;height:100%;';
    wrapper.appendChild(inner);
    host.appendChild(wrapper);

    function createWidget() {
      new window.TradingView.widget({
        autosize:            true,
        symbol:              ticker,
        interval:            '10',
        timezone:            'America/New_York',
        theme:               'dark',
        style:               '1',
        locale:              'en',
        toolbar_bg:          '#0a1210',
        enable_publishing:   false,
        allow_symbol_change: true,
        hide_side_toolbar:   false,
        container_id:        containerId,
      });
    }

    if (window.TradingView) {
      createWidget();
    } else if (!document.getElementById('tv-script')) {
      const script   = document.createElement('script');
      script.id      = 'tv-script';
      script.src     = 'https://s3.tradingview.com/tv.js';
      script.onload  = createWidget;
      document.head.appendChild(script);
    } else {
      // Script already injected but not yet loaded — poll until ready
      const poll = setInterval(() => {
        if (window.TradingView) { clearInterval(poll); createWidget(); }
      }, 100);
    }
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
      const params = new URLSearchParams({ ticker, expiry, bias, price, n_strikes: 6 });
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
  }

  function armContract(strike, bias) {
    armedContract = { ...strike, bias };

    const chainBody = document.getElementById('chainBody');
    const armed = chainBody.querySelector('.chain-armed');
    if (armed) armed.remove();

    const ask = parseFloat(strike.ask);
    const dir = bias === 'bullish' ? 'call' : 'put';
    const sym = strike.symbol || `${chainTicker} $${strike.strike}${dir[0].toUpperCase()} ${strike.expiration}`;

    const armedHtml = `
<div class="chain-armed" id="chainArmed">
  <div class="chain-armed-row">
    <span class="chain-armed-label">Armed</span>
    <span class="chain-armed-symbol">${sym}</span>
  </div>
  <div class="chain-qty-row">
    <span class="chain-armed-label">Qty</span>
    <input class="chain-qty-input" id="chainQty" type="number" min="1" max="20" value="2">
    <span class="chain-cost-label">est. cost</span>
    <span class="chain-cost-value" id="chainCost">${fmtPrice(ask * 2 * 100)}</span>
  </div>
  <button class="chain-open-btn" id="chainOpenBtn">
    Open Position (gated by kill-switch)
  </button>
</div>`;

    chainBody.insertAdjacentHTML('beforeend', armedHtml);

    // Update cost on qty change
    document.getElementById('chainQty').addEventListener('input', e => {
      const qty  = Math.max(1, parseInt(e.target.value, 10) || 1);
      const cost = ask * qty * 100;
      document.getElementById('chainCost').textContent = fmtPrice(cost);
    });

    // Open button — shows confirmation modal before placing any order
    document.getElementById('chainOpenBtn').addEventListener('click', () => {
      const qty     = Math.max(1, parseInt(document.getElementById('chainQty').value, 10) || 1);
      const cost    = ask * qty * 100;
      const cpLabel = dir === 'call' ? 'CALL' : 'PUT';

      showConfirmModal({
        title:   `Open ${chainTicker} ${cpLabel}`,
        body:    `<strong>${sym}</strong><br>` +
                 `Qty: <strong>${qty}</strong> contract${qty > 1 ? 's' : ''}<br>` +
                 `Est. cost: <strong>${fmtPrice(cost)}</strong> (${qty} × $${ask.toFixed(2)} × 100)<br><br>` +
                 `<span style="color:var(--text-muted);font-size:0.68rem">` +
                 `Gated by kill-switch. Order goes to your active env (verify sandbox before first live use).</span>`,
        okLabel: 'Place Order',
        okClass: '',
        onOk: async (setStatus) => {
          setStatus('Placing order…');
          try {
            const result = await apiPost('/api/v1/orders/open', {
              ticker:        chainTicker,
              option_symbol: strike.symbol,
              direction:     dir,
              strike:        strike.strike,
              expiry:        strike.expiration,
              qty,
              bid_price:     ask,
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
