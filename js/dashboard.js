// dashboard.js — Signal Vault Monitor Cockpit (Phase 1, read-only)
// Authenticates via Discord OAuth, connects a WebSocket for live positions,
// and polls REST endpoints for watchlist + signals.

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

  // History tab state
  let isAdmin           = false;
  let histCurrentPeriod = 'all';
  let histCurrentScope  = 'me';   // 'me' | 'all' | 'user' — admin only
  let histCurrentUser   = null;   // discord_id when histCurrentScope === 'user'

  // ── Helpers (unchanged) ────────────────────────────────────────────────────

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

  async function apiFetch(path) {
    const res = await fetch(API + path, { headers: authHeaders() });
    if (!res.ok) throw new Error(res.status + ' ' + path);
    return res.json();
  }

  // ── Auth gate (unchanged) ──────────────────────────────────────────────────

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

    // Wire up center panel and position console (post-auth only)
    setupCenterPanel();
    setupConsoleHandlers();
    setupHistoryTab();
  }

  // ── WebSocket (unchanged) ─────────────────────────────────────────────────

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
  // Changed: caches currentPositions, adds data-pos-id, uses backend peak_pnl/peak_pnl_pct,
  // re-attaches management console after each re-render.

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

      // Use pre-computed backend values (peak_pnl / peak_pnl_pct from positions.py).
      // current_price is null in Phase 1 — do not render live P&L.
      const peakPnl  = pos.peak_pnl;
      const peakPct  = pos.peak_pnl_pct;
      const pnlClass = peakPnl == null ? 'neutral' : (peakPnl >= 0 ? 'positive' : 'negative');

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
  <div class="pos-pnl-row">
    <span class="pos-pnl-label">Peak P&amp;L</span>
    <span class="pos-pnl-value ${pnlClass}">
      ${peakPnl != null ? fmt$(Math.round(peakPnl)) + ' (' + fmtPct(peakPct) + ')' : '—'}
    </span>
  </div>
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
        wireConsoleButtons(card);
      } else {
        openConsoleId = null;
      }
    }
  }

  // ── Signals ────────────────────────────────────────────────────────────────
  // Changed: adds data-ticker on each sig-card for center panel focus delegation.

  async function loadSignals() {
    const body = document.getElementById('signalsBody');
    const meta = document.getElementById('signalsMeta');
    try {
      const data = await apiFetch('/api/signals');
      const sigs = data.signals || [];
      meta.textContent = sigs.length + ' signals';

      if (!sigs.length) {
        body.innerHTML = '<div class="dash-empty">No signals today</div>';
        return;
      }

      body.innerHTML = sigs.map(s => {
        // Real field: conviction_tier (cf_tier as fallback for CF-only signals)
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
    } catch (err) {
      meta.textContent = 'error';
      body.innerHTML   = '<div class="dash-placeholder">Could not load signals</div>';
    }
  }

  // ── Watchlist ──────────────────────────────────────────────────────────────
  // Changed: caches rows for levels panel, adds data-ticker on each wl-row,
  // refreshes levels if a ticker is already focused.

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
    // Search
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

    // Update chain stub to name the focused ticker
    const chainBody = document.getElementById('chainBody');
    if (chainBody) {
      chainBody.innerHTML = `
<span class="dash-coming-text">${t} option chain — Phase 4</span>
<span class="dash-coming-sub">Requires <code>/api/chain</code> backend endpoint (not yet deployed)</span>`;
    }
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
        autosize:           true,
        symbol:             ticker,
        interval:           '10',
        timezone:           'America/New_York',
        theme:              'dark',
        style:              '1',
        locale:             'en',
        toolbar_bg:         '#0a1210',
        enable_publishing:  false,
        allow_symbol_change: true,
        hide_side_toolbar:  false,
        container_id:       containerId,
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
  // Fields: trigger, vs, gate_n, arm_state, rank, direction — all from watchlist rows.
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

  // ── Position management console (stub — Phase 2) ──────────────────────────

  function setupConsoleHandlers() {
    document.getElementById('positionsBody').addEventListener('click', e => {
      // Clicks inside the console itself (non-button) should not re-toggle the card.
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
      wireConsoleButtons(card);
    }
  }

  function wireConsoleButtons(card) {
    card.querySelectorAll('.pos-console-btn[data-stub]').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation(); // prevent the delegation from toggling the card
        showStubPreview(btn);
      });
    });
  }

  // Builds the HTML for the inline management console.
  // All actions are stubs: they show what Phase 2 would POST, but make no API call.
  function buildConsoleHtml(pos) {
    const cts     = pos.contracts_open || 1;
    const halfCts = Math.max(1, Math.floor(cts / 2));
    // trail_width is a float 0–1 (e.g. 0.10 = 10%); display as integer percent
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
      <span class="pos-preview-tag">preview · Phase 2</span>
    </button>
    <button class="pos-console-btn"
            data-stub="rebase_trail" data-pos-id="${pos.position_id}">
      Rebase Trail
      <span class="pos-preview-tag">preview · Phase 2</span>
    </button>
    <button class="pos-console-btn danger"
            data-stub="close_all" data-pos-id="${pos.position_id}">
      Exit ${cts}x
      <span class="pos-preview-tag">preview · Phase 2</span>
    </button>
  </div>
</div>`;
  }

  // Shows (or toggles off) the inline stub preview below the clicked button.
  // Displays what Phase 2 would POST to /api/orders — no request is made.
  function showStubPreview(btn) {
    const next = btn.nextElementSibling;
    if (next && next.classList.contains('pos-stub-preview')) {
      next.remove();
      return;
    }

    const stub  = btn.dataset.stub;
    const posId = btn.dataset.posId;
    const cts   = btn.dataset.contracts;

    let payload;
    switch (stub) {
      case 'partial_close':
        payload = { type: 'partial_close', position_id: posId, contracts: Number(cts) };
        break;
      case 'close_all':
        payload = { type: 'close_all', position_id: posId };
        break;
      case 'rebase_trail':
        payload = { type: 'rebase_trail', position_id: posId };
        break;
      default:
        payload = { type: stub, position_id: posId };
    }

    const preview       = document.createElement('div');
    preview.className   = 'pos-stub-preview';
    preview.innerHTML   = `
<div class="pos-stub-badge">preview — Phase 2 only · no order placed</div>
<div class="pos-stub-endpoint">POST /api/orders</div>
<pre class="pos-stub-code">${JSON.stringify(payload, null, 2)}</pre>`;
    btn.insertAdjacentElement('afterend', preview);
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
        if (histCurrentScope === 'all')                              url += '&user=all';
        else if (histCurrentScope === 'user' && histCurrentUser)     url += '&user=' + encodeURIComponent(histCurrentUser);
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

  // ── History scope helpers ─────────────────────────────────────────────────

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

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
