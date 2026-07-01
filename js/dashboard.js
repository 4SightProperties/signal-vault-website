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

  let authToken    = null;
  let wsConn       = null;
  let wsRetries    = 0;
  let signalTimer      = null;
  let watchTimer       = null;
  let regimeTimer      = null;
  let flowTimer        = null;
  let panelHealthTimer = null;
  let positionsTimer   = null;

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
    loadRegime();
    loadSignals();
    loadWatchlist();
    loadFlow();
    loadPanelHealth();
    loadPositions();
    regimeTimer      = setInterval(loadRegime,      60_000);
    signalTimer      = setInterval(loadSignals,     30_000);
    watchTimer       = setInterval(loadWatchlist,   10_000);
    flowTimer        = setInterval(loadFlow,        90_000);
    panelHealthTimer = setInterval(loadPanelHealth, 90_000);
    positionsTimer   = setInterval(loadPositions,    5_000);

    setupCenterPanel();
    setupConsoleHandlers();
    setupHistoryTab();
    setupModal();
    setupHealthPopover();
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

  async function loadPositions() {
    try {
      const data = await apiFetch('/api/positions');
      renderPositions(data.positions || []);
    } catch (_) {}
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

  // ── Regime bar ────────────────────────────────────────────────────────────

  function _rcSetCell(cellId, valueEl, state, html, extraClass) {
    const cell = document.getElementById(cellId);
    const val  = document.getElementById(valueEl);
    if (!cell || !val) return;
    // Remove stale/error modifiers, re-apply as needed
    cell.classList.remove('rc-stale', 'rc-error');
    if (state === 'stale') cell.classList.add('rc-stale');
    if (state === 'error') cell.classList.add('rc-error');
    val.className = 'cmd-rc-value' + (extraClass ? ' ' + extraClass : '');
    val.innerHTML = html;
  }

  async function loadRegime() {
    try {
      const d = await apiFetch('/api/regime');

      // ── Directive ────────────────────────────────────────────────
      const dir   = d.directive || {};
      const dirV  = dir.value || 'STAY_CASH';
      const dirCls = dirV === 'TRADE_CALLS' ? 'cmd-rc-calls'
                   : dirV === 'TRADE_PUTS'  ? 'cmd-rc-puts'
                   : 'cmd-rc-cash';
      const dirLabel = dirV === 'TRADE_CALLS' ? 'TRADE CALLS'
                     : dirV === 'TRADE_PUTS'  ? 'TRADE PUTS'
                     : 'STAY CASH';
      const dirHtml = dir.state === 'empty' ? '— awaiting —'
                    : dir.state === 'error' ? '—'
                    : dirLabel;
      _rcSetCell('rcCellDirective', 'rcDirective', dir.state,
                 dirHtml, dir.state === 'empty' || dir.state === 'error' ? '' : dirCls);

      // ── Regime ───────────────────────────────────────────────────
      const reg  = d.regime || {};
      const regV = reg.value || {};
      const regHtml = reg.state === 'empty' || reg.state === 'error' ? '—'
                    : (regV.label || '—').toUpperCase()
                      + (regV.weight != null ? ` <span class="cmd-rc-sub">${regV.weight.toFixed(2)}×</span>` : '');
      _rcSetCell('rcCellRegime', 'rcRegime', reg.state, regHtml, '');

      // ── Opening move ─────────────────────────────────────────────
      const op  = d.opening || {};
      const opHtml = op.state === 'empty' ? 'posts at 9:50 ET'
                   : op.state === 'error' ? '—'
                   : (op.value || '—');
      _rcSetCell('rcCellOpening', 'rcOpening', op.state, opHtml, '');

      // ── VIX ──────────────────────────────────────────────────────
      const vx  = d.vix || {};
      const vxV = vx.value || {};
      let vixHtml = '—';
      if (vx.state !== 'empty' && vx.state !== 'error' && vxV.level != null) {
        const arrowCls = vxV.trend === 'up' ? 'up' : vxV.trend === 'down' ? 'down' : '';
        const arrowCh  = vxV.trend === 'up' ? '▲' : vxV.trend === 'down' ? '▼' : '—';
        vixHtml = `<span class="cmd-rc-with-arrow">${vxV.level.toFixed(1)}<span class="cmd-rc-arrow ${arrowCls}">${arrowCh}</span></span>`;
      }
      _rcSetCell('rcCellVix', 'rcVix', vx.state, vixHtml, '');

      // ── Breadth ──────────────────────────────────────────────────
      const br  = d.breadth || {};
      const brV = br.value || {};
      let breadthHtml = '—';
      if (br.state !== 'empty' && br.state !== 'error' && brV.pct_adv != null) {
        const pct     = brV.pct_adv;
        const fillCls = pct >= 55 ? 'bull' : pct <= 45 ? 'bear' : '';
        breadthHtml   = `<div class="cmd-rc-breadth-wrap">`
          + `<span>${pct}% adv</span>`
          + `<div class="cmd-breadth-bar-track"><div class="cmd-breadth-bar-fill ${fillCls}" style="width:${pct}%"></div></div>`
          + `</div>`;
      } else if (br.state === 'empty') {
        breadthHtml = '— awaiting —';
      }
      _rcSetCell('rcCellBreadth', 'rcBreadth', br.state, breadthHtml, '');

      // ── Today P/L ────────────────────────────────────────────────
      const pl  = d.pnl_today || {};
      const plHtml = pl.state === 'error' ? '—'
                   : pl.state === 'empty' ? '— awaiting —'
                   : fmtPnl$(pl.value);
      const plColor = pl.value == null ? '' : pl.value >= 0 ? 'cmd-rc-calls' : 'cmd-rc-puts';
      _rcSetCell('rcCellPnl', 'rcPnl', pl.state, plHtml, plColor);

      // ── Risk Left ────────────────────────────────────────────────
      const rl  = d.risk_left || {};
      const rlHtml = rl.state === 'error' ? '—'
                   : rl.state === 'empty' ? '—'
                   : '$' + (rl.value || 0).toFixed(0);
      const rlColor = rl.value != null && rl.value < 50 ? 'cmd-rc-puts' : '';
      _rcSetCell('rcCellRisk', 'rcRisk', rl.state, rlHtml, rlColor);

      // Health dot is driven by /api/panel-health (loadPanelHealth), not regime cells.

    } catch (_) {
      // Silently fail — don't disrupt the rest of the dashboard
    }
  }

  // ── Signals ───────────────────────────────────────────────────────────────

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

        // ATR reachability pill — WATCHING rows only, live-computed against current_price
        let reachPillHtml = '';
        const isWatching = (zoneKey === 'armed' || zoneKey === 'at_risk');
        if (isWatching && r.daily_atr > 0 && r.current_price > 0 && r.trigger > 0) {
          const atrDist = (r.trigger - r.current_price) / r.daily_atr;
          if (atrDist > 0) {
            const reachCls = atrDist <= 0.3 ? 'reach-green' : atrDist <= 0.5 ? 'reach-amber' : 'reach-red';
            reachPillHtml = `<span class="reach-pill ${reachCls}">${atrDist.toFixed(2)} ATR</span>`;
          }
        }

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
    <span class="${zoneCls}">${zoneLabel}</span>${reachPillHtml}
  </div>${gaugeHtml}
</div>`;
      }).join('');

      // If we already have a ticker focused, refresh its levels and header price.
      if (focusedTicker) { renderLevels(focusedTicker); _refreshFocusedPriceStrip(); }

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

  async function focusOn(ticker) {
    if (!ticker) return;
    const t = ticker.toUpperCase();
    focusedTicker = t;

    const searchInput = document.getElementById('tickerSearch');
    if (searchInput) searchInput.value = t;

    renderLevels(t);

    // Derive live price, trigger, bias, and day change from watchlist cache
    const wlRow    = watchlistDataCache.find(r => r.ticker === t);
    const trigger  = wlRow && wlRow.trigger       ? parseFloat(wlRow.trigger)       : 0;
    let livePrice  = wlRow && wlRow.current_price  ? parseFloat(wlRow.current_price) : 0;
    let changePct  = wlRow && wlRow.change_pct != null ? parseFloat(wlRow.change_pct) : null;
    const bias     = wlRow && (wlRow.direction || '').toLowerCase().includes('bear') ? 'bearish' : 'bullish';

    // Live-price fallback: off-watchlist tickers or cache missing current_price
    if (!livePrice) {
      try {
        const q = await apiFetch(`/api/quote?ticker=${encodeURIComponent(t)}`);
        if (q && q.last)       livePrice = parseFloat(q.last)       || 0;
        if (q && q.change_pct != null) changePct = parseFloat(q.change_pct);
      } catch (_) { /* leave livePrice=0 — chain guard will show the honest message */ }
    }

    // Update price-ref strip — live stock price as headline, trigger as secondary label
    buildPriceStrip(t, livePrice, trigger, changePct);

    // Seed bias selector from watchlist direction
    const biasEl = document.getElementById('chainBias');
    if (biasEl) biasEl.value = bias;

    // Show chain controls (including refresh button) and load expirations
    const controls = document.getElementById('chainControls');
    if (controls) controls.style.display = 'flex';

    loadChainExpirations(t, livePrice || trigger);
    loadMtf(t);
    loadAnalytics(t);
  }

  // ── MTF cloud alignment — fetches /api/mtf for the focused ticker ────────

  const _MTF_TF_IDS = {
    '10m':   { badge: 'mtfBadge10m',   cell: 'mtfCell10m'   },
    '30m':   { badge: 'mtfBadge30m',   cell: 'mtfCell30m'   },
    '1h':    { badge: 'mtfBadge1h',    cell: 'mtfCell1h'    },
    'daily': { badge: 'mtfBadgeDaily', cell: 'mtfCellDaily' },
  };

  function _setMtfCell(tf, cellData) {
    const ids     = _MTF_TF_IDS[tf];
    if (!ids) return;
    const badgeEl = document.getElementById(ids.badge);
    const cellEl  = document.getElementById(ids.cell);
    if (!badgeEl) return;

    const state = cellData && cellData.state;

    if (!cellData || state === 'error') {
      badgeEl.className   = 'cmd-mtf-badge blocked';
      badgeEl.textContent = '—';
      if (cellEl) cellEl.classList.remove('stale');
      return;
    }
    if (state === 'empty') {
      badgeEl.className   = 'cmd-mtf-badge blocked';
      badgeEl.textContent = '— awaiting —';
      if (cellEl) cellEl.classList.remove('stale');
      return;
    }

    const v    = cellData.value || {};
    const bias = v.bias || 'neutral';   // 'bull' | 'bear' | 'neutral'
    const arrow = v.arrow || '—';
    const cssClass = { bull: 'bull', bear: 'bear', neutral: 'mixed' }[bias] || 'blocked';

    badgeEl.className   = `cmd-mtf-badge ${cssClass}`;
    badgeEl.textContent = `${arrow} ${bias}`;
    if (cellEl) cellEl.classList.toggle('stale', state === 'stale');
  }

  function _resetMtfCells() {
    for (const tf of Object.keys(_MTF_TF_IDS)) {
      const ids = _MTF_TF_IDS[tf];
      const badgeEl = document.getElementById(ids.badge);
      const cellEl  = document.getElementById(ids.cell);
      if (badgeEl) { badgeEl.className = 'cmd-mtf-badge blocked'; badgeEl.textContent = '···'; }
      if (cellEl)  cellEl.classList.remove('stale');
    }
  }

  async function loadMtf(ticker) {
    _resetMtfCells();
    try {
      const data = await apiFetch(`/api/mtf?ticker=${encodeURIComponent(ticker)}`);
      if (!data || !data.timeframes) return;
      for (const [tf, cellData] of Object.entries(data.timeframes)) {
        _setMtfCell(tf, cellData);
      }
    } catch (_) {
      // Leave cells as reset (···) — silent fail, not worth surfacing
    }
  }

  // ── Bottom flow row — fetches /api/flow on load + every 90s ─────────────────

  function _flowStateClass(state) {
    return state === 'stale' ? 'stale' : '';
  }

  function _renderTide(cell) {
    const bodyEl = document.getElementById('flowTideBody');
    const metaEl = document.getElementById('flowTideMeta');
    const cellEl = document.getElementById('flowCellTide');
    if (!bodyEl) return;

    if (!cell || cell.state === 'error') {
      bodyEl.innerHTML = '<span class="flow-empty">—</span>';
      return;
    }
    if (cell.state === 'empty') {
      bodyEl.innerHTML = '<span class="flow-empty">— awaiting market hours —</span>';
      return;
    }

    const v   = cell.value || {};
    const bias = (v.bias || 'neutral').toUpperCase();
    const biasCls = v.bias === 'bullish' ? 'bull' : v.bias === 'bearish' ? 'bear' : '';
    const pc  = v.pc_ratio != null ? `P/C ${v.pc_ratio}×` : '';
    const vol = v.net_volume != null ? `vol ${v.net_volume > 0 ? '+' : ''}${(v.net_volume / 1000).toFixed(0)}k` : '';

    bodyEl.innerHTML = `
      <div class="flow-tide-row">
        <span class="flow-bias ${biasCls}">${bias}</span>
        <span class="flow-tide-nums">
          <span class="bull">▲ $${v.net_call_m != null ? v.net_call_m.toFixed(1) : '—'}M</span>
          <span class="bear">▼ $${v.net_put_m  != null ? Math.abs(v.net_put_m).toFixed(1) : '—'}M</span>
          ${pc   ? `<span class="flow-pc">${pc}</span>` : ''}
          ${vol  ? `<span class="flow-vol">${vol}</span>` : ''}
        </span>
      </div>`;
    if (metaEl) metaEl.textContent = cell.state === 'stale' ? 'stale' : 'live';
    if (cellEl) cellEl.classList.toggle('stale', cell.state === 'stale');
  }

  function _renderSector(cell) {
    const bodyEl = document.getElementById('flowSectorBody');
    const metaEl = document.getElementById('flowSectorMeta');
    const cellEl = document.getElementById('flowCellSector');
    if (!bodyEl) return;

    if (!cell || cell.state === 'error') {
      bodyEl.innerHTML = '<span class="flow-empty">—</span>';
      return;
    }
    if (cell.state === 'empty' || !Array.isArray(cell.value) || !cell.value.length) {
      bodyEl.innerHTML = '<span class="flow-empty">— awaiting market hours —</span>';
      return;
    }

    const rows = cell.value
      .map(s => {
        const chg = parseFloat(String(s.change).replace('%', '')) || 0;
        const cls = chg > 0 ? 'bull' : chg < 0 ? 'bear' : '';
        const barW = Math.min(Math.abs(chg) * 20, 100).toFixed(0);
        const sign = chg >= 0 ? '+' : '';
        const name = String(s.name).replace(/^Information /i, 'IT ').replace(/^Communication /i, 'Comm ');
        return `<div class="sector-bar-row">
          <span class="sector-name">${name}</span>
          <span class="sector-bar-track"><span class="sector-bar-fill ${cls}" style="width:${barW}%"></span></span>
          <span class="sector-val ${cls}">${sign}${chg.toFixed(1)}%</span>
        </div>`;
      })
      .join('');
    bodyEl.innerHTML = rows;
    if (metaEl) metaEl.textContent = cell.state === 'stale' ? 'stale' : '% 1d';
    if (cellEl) cellEl.classList.toggle('stale', cell.state === 'stale');
  }

  function _renderFlowGex(cell) {
    const bodyEl = document.getElementById('flowFlowBody');
    const metaEl = document.getElementById('flowFlowMeta');
    const cellEl = document.getElementById('flowCellFlow');
    if (!bodyEl) return;

    if (!cell || cell.state === 'error') {
      bodyEl.innerHTML = '<span class="flow-empty">—</span>';
      return;
    }
    if (cell.state === 'empty') {
      bodyEl.innerHTML = '<span class="flow-empty">— awaiting market hours —</span>';
      return;
    }

    const v  = cell.value || {};
    const sw = v.sweeps  || {};
    const dp = v.darkpool || {};
    const winMin = Math.round((sw.window_secs || 600) / 60);

    const sweepLine = sw.bull_count != null
      ? `<div class="flow-stat-row"><span class="flow-stat-label">Sweeps (${winMin}m)</span>
           <span class="bull">▲${sw.bull_count} $${(sw.bull_premium_m || 0).toFixed(1)}M</span>
           <span class="flow-sep">·</span>
           <span class="bear">▼${sw.bear_count} $${(sw.bear_premium_m || 0).toFixed(1)}M</span>
         </div>`
      : '';

    const dpLine = (dp.bull_count != null || dp.bear_count != null)
      ? `<div class="flow-stat-row"><span class="flow-stat-label">Dark Pool</span>
           <span class="bull">▲${dp.bull_count || 0} $${(dp.bull_premium_m || 0).toFixed(1)}M</span>
           <span class="flow-sep">·</span>
           <span class="bear">▼${dp.bear_count || 0} $${(dp.bear_premium_m || 0).toFixed(1)}M</span>
         </div>`
      : '';

    bodyEl.innerHTML = sweepLine + (dpLine || '<div class="flow-stat-row"><span class="flow-empty">dark pool: no data</span></div>');
    if (metaEl) metaEl.textContent = cell.state === 'stale' ? 'stale' : 'sweeps · dark pool';
    if (cellEl) cellEl.classList.toggle('stale', cell.state === 'stale');
  }

  async function loadFlow() {
    try {
      const data = await apiFetch('/api/flow');
      if (!data) return;
      _renderTide(data.tide);
      _renderSector(data.sector);
      _renderFlowGex(data.flow);
    } catch (_) {
      // Silent fail — flow row shows stale state from last render
    }
  }

  // ── Analytics strip — fetches /api/analytics on ticker focus ─────────────

  function _setAcCell(valueId, cellId, cellData, formatFn) {
    const valueEl = document.getElementById(valueId);
    const cellEl  = document.getElementById(cellId);
    if (!valueEl) return;

    const state = cellData && cellData.state;
    if (!cellData || state === 'error') {
      valueEl.textContent = '—';
      valueEl.style.color = 'var(--text-muted)';
      if (cellEl) cellEl.classList.remove('stale');
      return;
    }
    if (state === 'empty') {
      valueEl.textContent = cellData._emptyLabel || '— awaiting —';
      valueEl.style.color = 'var(--text-muted)';
      if (cellEl) cellEl.classList.remove('stale');
      return;
    }
    valueEl.textContent = formatFn(cellData.value);
    valueEl.style.color = '';
    if (cellEl) cellEl.classList.toggle('stale', state === 'stale');
  }

  function _resetAnalyticsCells() {
    const ids = ['acIvRank', 'acImpliedMove', 'acGexFlip', 'acPcFlow'];
    ids.forEach(id => {
      const el = document.getElementById(id);
      if (el) { el.textContent = '···'; el.style.color = 'var(--text-muted)'; }
    });
    ['acCellIvRank', 'acCellImpliedMove', 'acCellGexFlip', 'acCellPcFlow'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.classList.remove('stale');
    });
  }

  async function loadAnalytics(ticker) {
    _resetAnalyticsCells();
    try {
      const data = await apiFetch(`/api/analytics?ticker=${encodeURIComponent(ticker)}`);
      if (!data) return;

      // IV Rank — always empty (no 52-week history); label it honestly
      const ivCell = data.iv_rank || {};
      ivCell._emptyLabel = '— no history —';
      _setAcCell('acIvRank', 'acCellIvRank', ivCell, () => '— no history —');

      // Implied Move
      _setAcCell('acImpliedMove', 'acCellImpliedMove', data.implied_move, v =>
        v && v.pct != null ? `±${v.pct.toFixed(1)}%` : '—'
      );

      // GEX Flip
      _setAcCell('acGexFlip', 'acCellGexFlip', data.gex_flip, v => {
        if (!v || v.gamma_flip == null) return 'N/A';
        const envIcon = v.environment === 'positive' ? '▲' : v.environment === 'negative' ? '▼' : '';
        return `$${parseFloat(v.gamma_flip).toFixed(2)} ${envIcon}`.trim();
      });

      // P/C Flow
      _setAcCell('acPcFlow', 'acCellPcFlow', data.pc_flow, v => {
        if (!v || v.ratio == null) return '—';
        const label = v.direction === 'call-heavy' ? 'calls' : v.direction === 'put-heavy' ? 'puts' : 'neutral';
        return `${v.ratio}× ${label}`;
      });
    } catch (_) {
      // Silent fail — cells stay as reset (···)
    }
  }

  // Price-reference strip — live stock price as the headline, trigger as secondary label.
  // changePct: day change % (float) if available from the quote payload, else null.
  function buildPriceStrip(ticker, livePrice, trigger, changePct) {
    const placeholder = document.getElementById('priceStripPlaceholder');
    const dataEl      = document.getElementById('priceStripData');
    const tickerEl    = document.getElementById('priceStripTicker');
    const priceEl     = document.getElementById('priceStripPrice');
    const changeEl    = document.getElementById('priceStripChange');
    const noteEl      = document.getElementById('priceStripNote');
    const tvBtn       = document.getElementById('priceStripTvBtn');

    if (!dataEl) return;
    if (placeholder) placeholder.style.display = 'none';
    dataEl.style.display = 'flex';

    if (tickerEl) tickerEl.textContent = ticker;

    // Live price — colored by day change when available
    if (priceEl) {
      priceEl.textContent = livePrice > 0 ? fmtPrice(livePrice) : '—';
      const colorCls = changePct !== null ? (changePct >= 0 ? ' bull' : ' bear') : '';
      priceEl.className = 'price-strip-price' + colorCls;
    }

    // Day change % — hidden when not available
    if (changeEl) {
      if (changePct !== null) {
        const arrow = changePct >= 0 ? '▲' : '▼';
        const sign  = changePct >= 0 ? '+' : '';
        changeEl.textContent = `${arrow} ${sign}${changePct.toFixed(2)}%`;
        changeEl.className   = 'price-strip-change ' + (changePct >= 0 ? 'bull' : 'bear');
        changeEl.style.display = '';
      } else {
        changeEl.textContent   = '';
        changeEl.style.display = 'none';
      }
    }

    // Trigger secondary label with distance relationship
    if (noteEl) {
      if (livePrice > 0 && trigger > 0) {
        const diff    = livePrice - trigger;
        const absDiff = Math.abs(diff);
        let rel;
        if (absDiff < 0.01) {
          rel = 'at trigger';
        } else if (diff > 0) {
          rel = `+$${absDiff.toFixed(2)} above`;
        } else {
          rel = `−$${absDiff.toFixed(2)} below`;
        }
        noteEl.textContent = `trigger ${fmtPrice(trigger)} · ${rel}`;
      } else if (trigger > 0) {
        noteEl.textContent = `trigger ${fmtPrice(trigger)}`;
      } else if (livePrice > 0) {
        noteEl.textContent = 'live price';
      } else {
        noteEl.textContent = 'price unavailable';
      }
    }

    if (tvBtn) tvBtn.href = `https://www.tradingview.com/chart/?symbol=${ticker}&interval=10`;
  }

  // Refresh the focused header price on the watchlist poll cadence (~10s).
  // For watchlist tickers reads the freshly-updated cache; for off-watchlist
  // tickers fetches /api/quote (one call per poll, same Tradier load already incurred).
  async function _refreshFocusedPriceStrip() {
    if (!focusedTicker) return;
    const t      = focusedTicker;
    const wlRow  = watchlistDataCache.find(r => r.ticker === t);
    const trigger = wlRow && wlRow.trigger ? parseFloat(wlRow.trigger) : 0;

    if (wlRow) {
      const livePrice = wlRow.current_price  ? parseFloat(wlRow.current_price) : 0;
      const changePct = wlRow.change_pct != null ? parseFloat(wlRow.change_pct) : null;
      buildPriceStrip(t, livePrice, trigger, changePct);
    } else {
      try {
        const q         = await apiFetch(`/api/quote?ticker=${encodeURIComponent(t)}`);
        const livePrice = q && q.last       ? parseFloat(q.last)       || 0  : 0;
        const changePct = q && q.change_pct != null ? parseFloat(q.change_pct) : null;
        buildPriceStrip(t, livePrice, 0, changePct);
      } catch (_) { /* leave the header as-is on fetch failure */ }
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
    const cockpit0 = document.getElementById('chainCockpit');
    if (cockpit0) cockpit0.innerHTML = '';

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
    const cockpit1 = document.getElementById('chainCockpit');
    if (cockpit1) cockpit1.innerHTML = '';

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
    const cockpitEl = document.getElementById('chainCockpit');
    if (cockpitEl) cockpitEl.innerHTML = '';

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
    const chainCockpit = document.getElementById('chainCockpit');
    chainCockpit.innerHTML = '';

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

  <div class="cockpit-qty-target-row">
    <span class="chain-cost-label">Qty</span>
    <input class="chain-qty-input" id="chainQty" type="number" min="1" max="20" value="2">
    <span class="chain-cost-label">cost</span>
    <span class="chain-cost-value" id="chainCost">${fmtPrice(ask * 2 * 100)}</span>
    <span class="chain-cost-label">max loss</span>
    <span class="chain-cost-value" id="chainMaxLoss">${fmtPrice(ask * 2 * 100)}</span>
    <span class="cockpit-row-sep">|</span>
    <span class="chain-cost-label">Target $</span>
    <input class="cockpit-target-input" id="cockpitTarget" type="number" step="0.01" value="${defaultTarget}" placeholder="0.00">
    <button class="cockpit-apply-btn" id="cockpitApplyTarget">→</button>
    <span class="cockpit-target-src" id="cockpitTargetSrc">${targetSrc}</span>
  </div>

  <div class="cockpit-proj-wrap" id="cockpitProjWrap">
    <div class="dash-placeholder" style="padding:0.25rem 0">Loading projection…</div>
  </div>

  <div class="cockpit-verdict" id="cockpitVerdict" style="display:none"></div>

  <div class="cockpit-levels-section">
    <div class="cockpit-level-btns" id="cockpitLevelBtns">
      <span class="cockpit-section-label">Exit target</span>
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

    chainCockpit.innerHTML = cockpitHtml;

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

    const rowsHtml = rows.map(r => {
      const gainCls = r.gain_pct >= 0 ? 'positive' : 'negative';
      const dolSign = r.dollars >= 0 ? '+' : '';
      return `
<div class="proj-strip-cell">
  <div class="proj-strip-when">${r.horizon_label}</div>
  <div class="proj-strip-val">$${r.value.toFixed(2)}</div>
  <div class="proj-strip-gain ${gainCls}">${r.gain_pct >= 0 ? '+' : ''}${r.gain_pct.toFixed(1)}%</div>
  <div class="proj-strip-dol ${gainCls}">${dolSign}$${Math.abs(Math.round(r.dollars))}</div>
</div>`;
    }).join('');

    wrapEl.innerHTML = `<div class="cockpit-proj-strip">${rowsHtml}</div>`;

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

  // ── Panel health ──────────────────────────────────────────────────────────

  function _fmtAge(secs) {
    if (secs == null || secs < 0) return '';
    if (secs < 60)   return Math.round(secs) + 's';
    if (secs < 3600) return Math.round(secs / 60) + 'm';
    return Math.round(secs / 3600) + 'h';
  }

  async function loadPanelHealth() {
    const dot = document.getElementById('rcHealthDot');
    try {
      const d = await apiFetch('/api/panel-health');

      // Drive the dot from the overall rollup
      if (dot) {
        const cls = d.overall === 'healthy' ? 'live'
                  : d.overall === 'degraded' ? 'stale'
                  : 'error';
        dot.className = 'cmd-rc-health-dot ' + cls;
      }

      // Populate popover body
      const body = document.getElementById('rcHealthPopoverBody');
      if (!body || !d.panels) return;

      const SESSION_LABEL = {
        open:      'MARKET OPEN',
        closed:    'MARKET CLOSED',
        premarket: 'PRE-MARKET',
      };
      const sesHtml = `<div class="rc-health-session-row">${SESSION_LABEL[d.market_session] || d.market_session}</div>`;

      const rowsHtml = Object.entries(d.panels).map(([key, panel]) => {
        const state   = panel.state || 'error';
        const agePart = panel.age_secs != null ? ' · ' + _fmtAge(panel.age_secs) : '';
        const notePart = panel.note ? ` · ${panel.note}` : '';
        const label   = key.replace(/_/g, ' ');
        const badgeCls = state === 'n/a' ? 'na' : state;
        const badgeTxt = state === 'n/a' ? 'n/a' : state.toUpperCase() + agePart + notePart;
        return `<div class="rc-health-row">` +
          `<span class="rc-health-name">${label}</span>` +
          `<span class="rc-health-badge ${badgeCls}">${badgeTxt}</span>` +
          `</div>`;
      }).join('');

      body.innerHTML = sesHtml + rowsHtml;

    } catch (_) {
      if (dot) dot.className = 'cmd-rc-health-dot error';
    }
  }

  function setupHealthPopover() {
    const cell    = document.getElementById('rcHealthCell');
    const popover = document.getElementById('rcHealthPopover');
    if (!cell || !popover) return;

    function showPopover() {
      const r = cell.getBoundingClientRect();
      popover.style.top   = (r.bottom + 4) + 'px';
      popover.style.right = (window.innerWidth - r.right) + 'px';
      popover.classList.add('visible');
      popover.setAttribute('aria-hidden', 'false');
    }

    function hidePopover() {
      popover.classList.remove('visible');
      popover.setAttribute('aria-hidden', 'true');
    }

    cell.addEventListener('mouseenter', showPopover);
    cell.addEventListener('mouseleave', (e) => {
      if (!cell.contains(e.relatedTarget) && !popover.contains(e.relatedTarget)) {
        hidePopover();
      }
    });
    popover.addEventListener('mouseleave', (e) => {
      if (!cell.contains(e.relatedTarget) && !popover.contains(e.relatedTarget)) {
        hidePopover();
      }
    });

    // Toggle on click (also works on touch)
    cell.addEventListener('click', (e) => {
      e.stopPropagation();
      if (popover.classList.contains('visible')) {
        hidePopover();
      } else {
        showPopover();
      }
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!cell.contains(e.target) && !popover.contains(e.target)) {
        hidePopover();
      }
    });
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
