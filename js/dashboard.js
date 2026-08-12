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
  let newsTimer        = null;

  // Center panel + console state
  let currentPositions   = [];   // last positions array from WS — used by console delegation
  let watchlistDataCache  = [];   // last watchlist rows — used by levels panel
  let signalTickersToday  = {};   // ticker -> most recent fire_time for today (ET) — used by watchlist row markers
  let focusedTicker      = null; // ticker currently loaded in center column
  let openConsoleId      = null; // position_id of the currently expanded management console
  let _restingInterval   = null; // setInterval handle for the resting-orders poll
  let _restingOpenSym    = null; // option_symbol whose resting orders are being polled
  let _t2State           = null; // tier-2 console state {staged,broker,mark,changelog,initialFetchDone}
  let _workingInterval   = null; // setInterval handle for the account-level working-orders poll
  let _lastOrdersData    = { ok: null, orders: null, fetchedAt: null }; // last /api/orders/working result
  let _pnlToday = { state: 'empty', value: null };

  // ── SELL NOW state ──────────────────────────────────────────────────────────
  const _sellNowInFlight = new Set();   // position_ids with a modify in flight
  const _sellNowState    = new Map();   // position_id → {status, mid?, msg?} — persists across re-renders

  // ── Close (limit) resting state ──────────────────────────────────────────────
  // Tracks the broker-confirmed resting price after a limit close is placed so the
  // button can show "Resting $X.XX · reprice" without a round-trip to /api/orders/resting.
  // Keyed by position_id. Entries are harmless for closed positions (GC'd naturally).
  const _closeRestingState = new Map(); // position_id → { price: number }
  let   _sellNowHoldTimer    = null;
  let   _sellNowHoldInterval = null;
  let   _sellNowHoldBtn      = null;

  // ── SELL ALL state ──────────────────────────────────────────────────────────
  let _sellAllInFlight = false;   // true while sequential execution loop is running

  // Universe screener state (authenticated members)
  let universeMode      = false;
  let journalMode       = false;
  let journalMonth      = null;  // 'YYYY-MM' currently displayed
  let journalSelDate    = null;  // 'YYYY-MM-DD' currently selected cell
  let journalCalCache   = null;  // last calendar API response
  let universeDataCache = null;  // last /api/scan-universe payload
  let universeTimer     = null;
  let univSortCol       = 'ticker';
  let univSortDir       = 1;
  let univFilters       = { cloud_10m: null, cloud_1h: null, cloud_1d: null, pm_break_state: null };

  // Right-column drawer state
  let drawerActive   = null;     // 'news' | 'ladder' | 'calendar' | 'ta' | null
  let newsInnerTab   = 'ticker'; // 'ticker' | 'market' — active tab within news drawer
  // Static exchange map — avoids CORS-blocked symbol_search API
  const _TV_EXCHANGE = (() => {
    const m = {};
    const NASDAQ = [
      'AAPL','NVDA','AMD','AVGO','ARM','SMCI','PLTR','MSFT','GOOGL','AMZN',
      'META','NFLX','TSLA','MU','MRVL','COIN','MSTR','QQQ','CRWD','DDOG',
      'SOFI','MARA','AFRM','IONQ','SNDK','CRDO','ENVX','ALAB','ASTS','IREN',
      'ONDS','TTD','RKLB','PYPL','HOOD',
      // corrected from NYSE: confirmed NASDAQ-listed
      'DKNG','ABNB','APP','TEM','VKTX','NBIS','AAOI','POET',
    ];
    const NYSE = [
      'LLY','DELL','NET','NOW','CRM','GEV','NVO','UBER',
      'HIMS','TSM','CAVA','VRT','SE','NU',
      'RBRK','DECK','RDDT','ANET','XYZ','GS','JPM','BAC','BE',
      'U','PATH','OSCR','PL','MP',
    ];
    // NYSE Arca ETFs — TradingView addresses these as AMEX:TICKER
    const AMEX = ['SPY','IWM','XLE','GLD','XBI','XLK','SOXL'];
    NASDAQ.forEach(t => { m[t] = 'NASDAQ'; });
    NYSE.forEach(t   => { m[t] = 'NYSE'; });
    AMEX.forEach(t   => { m[t] = 'AMEX'; });
    return m;
  })();
  function _tvSymbol(ticker) {
    const t = ticker.toUpperCase();
    const ex = _TV_EXCHANGE[t];
    return ex ? `${ex}:${t}` : t;
  }

  // GEX analysis modal state
  let gexModalPos  = null;  // position object for the open GEX pop-out
  let gexData      = null;  // fetched /api/gex result for the current modal ticker
  let gexModalIv   = null;  // IV fetched once from /api/chain/quote for projection reuse
  let gexProjTimer = null;  // debounce timer for projection fetch on target input
  let gexLastProj  = null;  // last projection result, drives exit-section auto-fill

  // Chain state
  let chainTicker          = null;  // ticker for which chain is loaded
  let chainCurrentPrice    = 0.0;   // live stock price — updated on every quote refresh
  let chainArmStock        = 0.0;   // stock price at arm time — frozen, feeds oneAtrX
  let armedContract        = null;  // {symbol, strike, direction, expiry, ask, delta, dte}
  let _lastBaskets         = null;  // sorted basket array from last _renderBaskets call
  let _lastBasketsTimeframe = '?'; // timeframe string from last baskets payload
  let chainLastStrikesData = null;  // {strikes, bias, srCtx} — saved for compact-strip expand
  let cockpitEntryMode     = 'auto';   // entry price mode: 'auto' | 'take_ask' | 'your_price'
  let cockpitExitLayer     = 'default'; // exit layer: 'default' | 'tight_trail' | 'cloud_break' | 'oco_bracket'
  let _tif                 = 'day';     // TIF for order open: 'day' | 'gtc'; reset on re-arm
  let srLevelsCache        = null;  // /api/sr_levels result for focused ticker
  let chainArmedCloudLevels = null; // five cloud SR edges frozen at arm (direction-appropriate)
  let focusGexCache        = null;  // /api/gex result for focused ticker (admin)
  let matrixProjCache      = null;  // {levels, projResults} — for qty-only rerenders
  let payoutCurveCache     = null;  // range-mode response — for qty/as-of rerenders
  let chainAtr             = null;  // Wilder EWM ATR14 from _sr_atr_context at chain load
  let chainDayRange        = null;  // today's RTH hi-lo range; updated on ↻ via chain/quote
  let chainDayOpen         = null;  // today's session open — first RTH bar open from Polygon (same basis as chainDayRange)
  let chainDayHigh         = null;  // session high from Polygon (same basis as chainDayRange)
  let chainDayLow          = null;  // session low from Polygon (same basis as chainDayRange)
  let lastRiskLeft         = null;  // latest risk_left.value from regime poll; null until first poll
  let _armedRefreshTimer   = null;  // interval handle — ticks refreshArmedQuote every 30s while armed
  let _armedQuoteRefreshing = false; // in-flight guard — prevents overlapping /api/chain/quote calls
  let _rrProfitSide       = null;  // profit-side SR levels hoisted from renderRrLine; read by OCO buttons
  let _ocoButtonRefreshFn = null;  // set by armContract so renderRrLine can trigger OCO button re-render

  // History tab state
  let isAdmin           = false;
  let isElite           = false;
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

  // Single source of truth for option-price availability state.
  // Returns { state: 'live'|'stale'|'none', label: string }
  // label is the human-readable badge/field text for non-live states.
  function priceState(current_price, price_age_secs) {
    if (current_price != null) return { state: 'live', label: 'LIVE' };
    if (price_age_secs != null) {
      const a = price_age_secs;
      const ageStr = a < 60
        ? Math.round(a) + 's'
        : Math.floor(a / 60) + 'm' + Math.round(a % 60) + 's';
      return { state: 'stale', label: 'STALE · ' + ageStr + ' old' };
    }
    return { state: 'none', label: 'NO PRICE' };
  }

  function optionMid(bid, ask) {
    return (bid + ask) / 2;
  }

  // Returns true when within regular trading hours (9:30–16:00 ET).
  function _isMarketHours() {
    const fmt = new Intl.DateTimeFormat('en-US', {
      timeZone: 'America/New_York', hour: '2-digit', minute: '2-digit', hour12: false,
    });
    const p = Object.fromEntries(fmt.formatToParts(new Date()).map(x => [x.type, x.value]));
    const t = parseInt(p.hour, 10) * 60 + parseInt(p.minute, 10);
    return t >= 570 && t < 960;
  }

  // Returns a string reason when SELL NOW must be disabled, or null when it is enabled.
  function _sellNowDisableReason(positionId, pos) {
    if (_sellNowInFlight.has(positionId)) return 'In flight';
    if (_lastOrdersData.ok === null)      return 'Checking…';
    if (_lastOrdersData.ok === false)     return 'Orders unreadable';
    const tpLeg = (_lastOrdersData.orders || []).find(o =>
      o.classification === 'take_profit' &&
      String(o.bracket_position_id) === String(positionId)
    );
    if (!tpLeg)                                              return 'No bracket resting';
    if (!_isMarketHours() || tpLeg.status === 'pending')    return 'Market closed — order suspended';
    if (pos && priceState(pos.current_price, pos.price_age_secs).state !== 'live')
                                                             return 'No price data';
    return null;
  }

  // Returns the inner HTML for the rs-sell-slot / card SELL NOW slot.
  // Reads _sellNowState for transient status; falls back to disable-reason check.
  function _sellSlotContent(positionId, pos) {
    const st = _sellNowState.get(positionId);
    if (st) {
      if (st.status === 'fetching') {
        return '<button class="rs-sell-btn" disabled>Fetching…</button>';
      }
      if (st.status === 'sent') {
        return '<button class="rs-sell-btn" disabled>Sent…</button>';
      }
      if (st.status === 'confirmed') {
        const p = parseFloat(st.mid).toFixed(2);
        return '<span class="pnl-badge rs-sell-result">Repriced $' + p + '</span>';
      }
      if (st.status === 'unverified') {
        return '<span class="pnl-badge stale rs-sell-result" title="Modify sent but price unverified — check broker">⚠ unverified</span>';
      }
      if (st.status === 'error') {
        const safeMsg = (st.msg || 'error').replace(/"/g, '&quot;');
        return '<button class="rs-sell-btn rs-sell-err" data-sell-pid="' + positionId + '" title="' + safeMsg + '">SELL NOW ⚠</button>';
      }
    }
    const reason = _sellNowDisableReason(positionId, pos);
    if (reason !== null) {
      const safe = reason.replace(/"/g, '&quot;');
      return '<button class="rs-sell-btn" disabled title="' + safe + '">SELL NOW<small class="rs-sell-reason"> — ' + safe + '</small></button>';
    }
    return '<button class="rs-sell-btn" data-sell-pid="' + positionId + '">SELL NOW</button>';
  }

  function _etDateStr() {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
    const [m, d, y] = f.format(new Date()).split('/');
    return `${y}-${m}-${d}`;
  }

  function _fmtClockET(unixSecs) {
    return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit', hour12: true })
      .format(new Date(unixSecs * 1000)).toLowerCase().replace(/\s/g, '');
  }

  function authHeaders() {
    return { Authorization: 'Bearer ' + authToken };
  }

  async function apiFetch(path, opts) {
    const res = await fetch(API + path, { headers: authHeaders(), ...opts });
    if (!res.ok) throw Object.assign(new Error(res.status + ' ' + path), { status: res.status });
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
      isElite = (me.tier === 'elite');
      document.getElementById('dashUser').textContent =
        (me.username || 'subscriber') + ' · ' + (me.tier || '');
      const badge = document.getElementById('envBadge');
      if (isAdmin && me.active_env) {
        badge.textContent = me.active_env;
        badge.className   = 'dash-env-badge ' + (me.active_env === 'production' ? 'production' : 'sandbox');
      } else if (!isAdmin) {
        badge.style.display = 'none';
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
    setupGexModal();
    setupHealthPopover();
    setupBasketTooltip();
    setupDrawer();
    _pollOrders();
    _workingInterval = setInterval(_pollOrders, 30_000);
    _wireSellAllBtn();
    _injectUniverseView();
    _injectUniverseToggle();
    loadUniverse();
    universeTimer = setInterval(loadUniverse, 65_000);
    if (isAdmin) {
      _injectJournalView();
      _injectJournalToggle();
    }
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
      body.innerHTML = _renderSummaryHdHtml(positions) +
        '<div class="dash-empty">No open positions</div>' +
        _renderOrphanSection();
      _wireOrderHandlers(body);
      openConsoleId = null;
      return;
    }

    // Detach the open console before the DOM wipe so interactive state
    // (mode tab, typed prices, cursor position) survives continuous WS re-renders.
    // The same node is re-appended to the rebuilt card below; listeners survive with it.
    let savedConsole = null;
    if (openConsoleId) {
      const live = body.querySelector(`.pos-card[data-pos-id="${openConsoleId}"] .pos-console`);
      if (live) { live.remove(); savedConsole = live; }
    }

    body.innerHTML = _renderSummaryHdHtml(positions) + positions.map(pos => {
      const dir      = (pos.direction || '').toLowerCase().includes('put') ? 'put' : 'call';
      const dirLabel = dir === 'put' ? 'PUT' : 'CALL';

      const ps = priceState(pos.current_price, pos.price_age_secs);

      let livePnlHtml;
      if (ps.state === 'live') {
        const cls = pos.unrealized_pnl >= 0 ? 'positive' : 'negative';
        livePnlHtml = `
  <div class="pos-pnl-row">
    <span class="pos-pnl-label">Current P&amp;L <span class="pnl-badge live">LIVE</span></span>
    <span class="pos-pnl-value ${cls}">${fmt$(Math.round(pos.unrealized_pnl))} (${fmtPct(pos.unrealized_pnl_pct)})</span>
  </div>`;
      } else {
        livePnlHtml = `
  <div class="pos-pnl-row stale-row">
    <span class="pos-pnl-label">Current P&amp;L <span class="pnl-badge stale">${ps.label}</span></span>
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
      const isClosingPending = pos.state === 'closing_pending';

      return `
<div class="pos-card${isClosingPending ? ' closing-pending' : ''}" data-pos-id="${pos.position_id || ''}">
  <div class="pos-card-top">
    <span class="pos-ticker">${pos.ticker || '?'}</span>
    <span class="pos-direction ${dir}">${dirLabel}</span>
  </div>
  ${isClosingPending ? '<div class="pos-closing-pending-banner">Close pending — order placed, fill unconfirmed. GTC stop active.</div>' : ''}
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
      <span class="pos-level-label">Peak opt</span>
      <span class="pos-level-value">${fmtPrice(pos.peak_price)}</span>
    </div>
    <div class="pos-level-item">
      <span class="pos-level-label">Opened</span>
      <span class="pos-level-value">${fmtRelTime(pos.opened_at)}</span>
    </div>
  </div>
  ${isAdmin ? '<button class="pos-gex-btn" title="GEX terrain + option projection">GEX ▸</button>' : ''}
  ${_renderOrdersForPosition(pos.position_id)}
</div>`;
    }).join('');

    body.insertAdjacentHTML('beforeend', _renderOrphanSection());
    _wireOrderHandlers(body);

    // Re-attach the preserved console — same node, no DOM destruction, no state loss.
    if (openConsoleId) {
      const card = body.querySelector(`.pos-card[data-pos-id="${openConsoleId}"]`);
      const pos  = currentPositions.find(p => p.position_id === openConsoleId);
      if (card && pos) {
        if (savedConsole) {
          // Hot path: reattach the preserved node. Event listeners survived with the node —
          // do NOT re-run wireConsoleButtons (every handler would be double-bound).
          card.appendChild(savedConsole);
          updateConsoleLiveFields(savedConsole, pos);
        } else {
          // Cold path: no saved node (position was re-opened from scratch). Build fresh.
          card.insertAdjacentHTML('beforeend', buildConsoleHtml(pos));
          wireConsoleButtons(card, pos);
          // Restart the resting poll — the interval may have died with the old node.
          _restingOpenSym = pos.option_symbol || null;
          if (_restingOpenSym && !_restingInterval) {
            const consoleEl = card.querySelector('.pos-console');
            fetchRestingOrders(_restingOpenSym, consoleEl);
            _restingInterval = setInterval(() => {
              const c = document.querySelector(`.pos-card[data-pos-id="${openConsoleId}"] .pos-console`);
              if (c) fetchRestingOrders(_restingOpenSym, c);
              else { clearInterval(_restingInterval); _restingInterval = null; }
            }, 30000);
          }
        }
        card.classList.add('expanded');
      } else {
        // Position gone — let the detached savedConsole be GC'd.
        openConsoleId = null;
        clearInterval(_restingInterval);
        _restingInterval = null;
        _restingOpenSym  = null;
        _t2State         = null;
      }
    }
  }

  async function loadPositions() {
    try {
      const data = await apiFetch('/api/positions');
      renderPositions(data.positions || []);
    } catch (_) {}
  }

  // Layers that have orders resting at the broker.
  const _BROKER_LAYERS = new Set(['oco_bracket', 'tp_only', 'stop_only']);

  // Updates the realised-today P&L span in the POSITIONS summary header.
  // Called from loadRegime() when the regime poll returns fresh P&L data.
  function _updateSummaryPnl() {
    const el = document.getElementById('posSummaryPnl');
    if (!el) return;
    const { state, value } = _pnlToday;
    el.className = 'pos-summary-pnl';
    if (state === 'error' || state === 'empty' || value == null) {
      el.textContent = '—';
      el.removeAttribute('data-state');
      return;
    }
    el.textContent = fmtPnl$(value);
    if (state === 'stale') {
      el.setAttribute('data-state', 'stale');
    } else if (value > 0) {
      el.setAttribute('data-state', 'pos');
    } else if (value < 0) {
      el.setAttribute('data-state', 'neg');
    } else {
      el.setAttribute('data-state', 'flat');
    }
  }

  // Returns the HTML string for the POSITIONS summary header.
  // Inlined into body.innerHTML by renderPositions() so it lives inside #positionsBody
  // and hides for free whenever that element is hidden (History/Order tab active).
  function _renderSummaryHdHtml(positions) {
    const open = positions.filter(p => p.state === 'open' || p.state === 'closing_pending');
    const n    = open.length;

    let costHtml  = '';
    let nakedHtml = '';
    let sellAllHtml = '';

    if (n > 0) {
      const tc = open.reduce((s, p) => s + (p.total_cost || 0), 0);
      const costStr = tc > 0 ? fmtPrice(tc) : '—';
      costHtml = '<span class="pos-summary-sep">·</span>' +
                 '<span class="pos-summary-stat">' + costStr + '</span>';

      const nakedCount = open.filter(p => !_BROKER_LAYERS.has(p.exit_layer || 'default')).length;
      if (nakedCount > 0) {
        nakedHtml = '<span class="pos-summary-naked">⚠ ' + nakedCount + ' bot-held only</span>';
      }

      sellAllHtml = '<button id="sellAllBtn" class="rs-sell-all-btn">SELL ALL</button>';
    }

    const { state, value } = _pnlToday;
    let pnlText = '—';
    let pnlAttr = '';
    if (state !== 'error' && state !== 'empty' && value != null) {
      pnlText = fmtPnl$(value);
      if (state === 'stale')  pnlAttr = ' data-state="stale"';
      else if (value > 0)     pnlAttr = ' data-state="pos"';
      else if (value < 0)     pnlAttr = ' data-state="neg"';
      else                    pnlAttr = ' data-state="flat"';
    }

    return '<div class="pos-summary-hd">' +
      '<div class="pos-summary-stats">' +
        '<span class="pos-summary-count">' + n + ' open</span>' +
        costHtml +
        '<span class="pos-summary-sep">·</span>' +
        '<span class="pos-summary-pnl-label">Realised today</span>' +
        '<span id="posSummaryPnl" class="pos-summary-pnl"' + pnlAttr + '>' + pnlText + '</span>' +
        nakedHtml +
      '</div>' +
      sellAllHtml +
    '</div>';
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
      _pnlToday = { state: pl.state, value: pl.value ?? null };
      _updateSummaryPnl();

      // ── Risk Left ────────────────────────────────────────────────
      const rl  = d.risk_left || {};
      lastRiskLeft = rl.value != null ? rl.value : null;
      const rlHtml = rl.state === 'error' ? '—'
                   : rl.state === 'empty' ? '—'
                   : '$' + (rl.value || 0).toFixed(0);
      const rlColor = rl.value != null && rl.value < 50 ? 'cmd-rc-puts' : '';
      _rcSetCell('rcCellRisk', 'rcRisk', rl.state, rlHtml, rlColor);

      // Health dot is driven by /api/panel-health (loadPanelHealth), not regime cells.

    } catch (_) {
      // Silently fail — don't disrupt the rest of the dashboard
    }

    // Piggyback index proximity on the same 60s cadence — no second timer.
    loadIndexLevels();
  }

  // ── Index proximity strip — admin-only ────────────────────────────────────

  async function loadIndexLevels() {
    if (!isAdmin) return;

    const strip  = document.getElementById('idxStrip');
    const pnlCell = document.getElementById('rcCellPnl');
    if (!strip) return;

    try {
      const data = await apiFetch('/api/index-levels');
      // Show strip and hand the flex-grow role to it.
      strip.style.display = 'flex';
      if (pnlCell) pnlCell.classList.remove('cmd-rc-grow');

      const tickers = data.tickers || [];
      tickers.forEach(t => {
        const cell = strip.querySelector(`.idx-cell[data-idx="${t.ticker}"]`);
        if (cell) _renderIdxCell(cell, t);
      });
    } catch (err) {
      if (err.status === 403) {
        // Non-admin: hide strip, restore flex-grow to P/L cell.
        strip.style.display = 'none';
        if (pnlCell) pnlCell.classList.add('cmd-rc-grow');
      } else {
        console.error('loadIndexLevels:', err);
      }
    }
  }

  function _renderIdxCell(cell, t) {
    const barEl   = cell.querySelector('.idx-bar');
    const pxEl    = cell.querySelector('.idx-px');
    const stateEl = cell.querySelector('.idx-state');
    const fillEl  = cell.querySelector('.idx-fill');
    const markEl  = cell.querySelector('.idx-mark');
    const ghostEl = cell.querySelector('.idx-ghost');
    const capL    = cell.querySelector('.idx-cap-l');
    const capR    = cell.querySelector('.idx-cap-r');
    const supEl   = cell.querySelector('.idx-sup');
    const resEl   = cell.querySelector('.idx-res');

    // Reset — pxEl first so a null barEl throw doesn't leave a stale price visible
    pxEl.textContent      = '—';
    stateEl.textContent   = '—';
    stateEl.className     = 'idx-state';
    fillEl.className      = 'idx-fill';
    fillEl.style.left     = '';
    fillEl.style.width    = '0';
    markEl.style.display  = 'none';
    ghostEl.style.display = 'none';
    capL.className        = 'idx-cap idx-cap-l';
    capL.style.left       = '';
    capL.style.width      = '';
    capL.style.transform  = '';
    capL.style.display    = '';
    capR.className        = 'idx-cap idx-cap-r';
    capR.style.left       = '';
    capR.style.width      = '';
    capR.style.transform  = '';
    capR.style.display    = '';
    supEl.className       = 'idx-sup';
    supEl.textContent     = '—';
    resEl.className       = 'idx-res';
    resEl.textContent     = '—';
    if (barEl) barEl.className = 'idx-bar';

    if (!t.available) return;

    const pfx    = t.ticker === 'VIX' ? '' : '$';
    const hasSup = t.support    != null;
    const hasRes = t.resistance != null;

    if (t.price != null) pxEl.textContent = pfx + t.price.toFixed(2);

    if (!hasSup) capL.style.display = 'none';
    if (!hasRes) capR.style.display = 'none';

    // Labels: support shows low (or low–high if zone); resistance shows low
    if (hasSup) {
      const s = t.support;
      supEl.textContent = s.is_zone
        ? pfx + s.low.toFixed(2) + '–' + s.high.toFixed(2)
        : pfx + s.low.toFixed(2);
    }
    if (hasRes) {
      resEl.textContent = pfx + t.resistance.low.toFixed(2);
    }

    // Unified price axis: domain = support.low → resistance.high
    // Every element (caps, fill, marker) uses x() so coordinate spaces never diverge.
    const domainLow  = hasSup ? t.support.low    : (hasRes ? t.resistance.low  : null);
    const domainHigh = hasRes ? t.resistance.high : (hasSup ? t.support.high   : null);
    const domainSpan = (domainLow != null && domainHigh != null) ? domainHigh - domainLow : 0;
    const x = p => domainSpan > 0 ? (p - domainLow) / domainSpan * 100 : 50;

    // Fused: price inside a single zone (support === resistance object)
    const fused = t.in_support_zone && t.in_resistance_zone;
    if (fused && hasSup) {
      const z = t.support;
      if (barEl) barEl.classList.add('idx-bar-fused');
      // In fused case domainLow=z.low, domainHigh=z.high, so x(z.low)=0 and x(z.high)=100
      fillEl.style.left  = domainSpan > 0 ? x(z.low)  + '%' : '0%';
      fillEl.style.width = domainSpan > 0 ? (x(z.high) - x(z.low)) + '%' : '100%';
      fillEl.classList.add('idx-fill-gray');
      markEl.style.display = '';
      markEl.style.left    = Math.min(100, Math.max(0, x(t.price))) + '%';
      capL.style.display   = 'none';
      capR.style.display   = 'none';
      stateEl.textContent  = 'in zone';
      stateEl.classList.add('idx-state-amber');
      if (t.next_above != null) ghostEl.style.display = '';
      return;
    }

    // Normal: position caps and fill on the unified axis
    if (hasSup) supEl.classList.add('idx-lbl-green');
    if (hasRes) resEl.classList.add('idx-lbl-red');

    function applyCap(capEl, bnd) {
      if (!bnd || !capEl) return;
      const lx = x(bnd.low);
      if (bnd.is_zone) {
        // Area band: left=x(low), width=x(high)-x(low), translucent fill treatment
        capEl.style.left      = lx + '%';
        capEl.style.width     = Math.max(0, x(bnd.high) - lx) + '%';
        capEl.style.transform = '';
        capEl.classList.add('idx-cap-zone');
        if (bnd.witnesses > 1) capEl.classList.add('idx-cap-strong');
      } else {
        // Line cap: 2px edge centered on x(low) via translateX(-50%)
        capEl.style.left      = lx + '%';
        capEl.style.width     = '';   // CSS default: 2px
        capEl.style.transform = 'translateX(-50%)';
        if (bnd.witnesses > 1) capEl.classList.add('idx-cap-thick');
      }
    }

    if (hasSup) { applyCap(capL, t.support);   capL.classList.add('idx-cap-green'); }
    if (hasRes) { applyCap(capR, t.resistance); capR.classList.add('idx-cap-red');   }

    // Fill: corridor portion traversed = support.high → price
    if (hasSup && domainSpan > 0) {
      const fillLeft  = x(t.support.high);
      const fillRight = Math.min(100, Math.max(fillLeft, x(t.price)));
      fillEl.style.left  = Math.max(0, fillLeft) + '%';
      fillEl.style.width = (fillRight - Math.max(0, fillLeft)) + '%';
    }

    // Marker at price position on the unified axis
    if (domainSpan > 0) {
      markEl.style.display = '';
      markEl.style.left    = Math.min(100, Math.max(0, x(t.price))) + '%';
    }

    // State from booleans
    if (t.in_support_zone) {
      stateEl.textContent = 'at S';
      stateEl.classList.add('idx-state-amber');
      capL.classList.add('idx-cap-green');
    } else if (t.in_resistance_zone) {
      stateEl.textContent = 'at R';
      stateEl.classList.add('idx-state-amber');
      capR.classList.add('idx-cap-red');
    } else {
      stateEl.textContent = 'mid';
    }

    if (t.next_above != null) ghostEl.style.display = '';
  }

  // ── Signals ───────────────────────────────────────────────────────────────

  async function loadSignals() {
    const body = document.getElementById('signalsBody');
    const meta = document.getElementById('signalsMeta');
    try {
      const data      = await apiFetch('/api/signals');
      const sigs      = data.signals       || [];
      const lastSigTs = data.last_signal_ts || 0;
      const isStale   = !!data.stale;

      // Build signalTickersToday: ticker -> most recent fire_time on today's ET date
      const todayET = _etDateStr();
      const _sigMap = {};
      sigs.forEach(s => {
        if (!s.ticker || !s.fire_time) return;
        const f = new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', year: 'numeric', month: '2-digit', day: '2-digit' });
        const [sm, sd, sy] = f.format(new Date(s.fire_time * 1000)).split('/');
        if (`${sy}-${sm}-${sd}` !== todayET) return;
        if (!_sigMap[s.ticker] || s.fire_time > _sigMap[s.ticker]) _sigMap[s.ticker] = s.fire_time;
      });
      signalTickersToday = _sigMap;

      const nowSecs    = Date.now() / 1000;
      const sigAgeMins = lastSigTs > 0 ? (nowSecs - lastSigTs) / 60 : null;

      const ageLabel = lastSigTs > 0 ? ' · last ' + fmtRelTime(lastSigTs) : '';
      meta.textContent = sigs.length + ' signals' + ageLabel;

      const minsOpen = _marketMinutesOpen();
      let bannerHtml = '';
      if (isStale) {
        bannerHtml = `<div class="sig-engine-banner stale">` +
          `⚠ Signal data may be stale — showing last known state · last signal ${fmtRelTime(lastSigTs)}</div>`;
      } else if (minsOpen > 30 && sigAgeMins != null && sigAgeMins > 30) {
        bannerHtml = `<div class="sig-engine-banner alarm">` +
          `⚠ Engine may be offline · last signal ${fmtRelTime(lastSigTs)}</div>`;
      } else if (minsOpen === 0 && sigAgeMins != null && sigAgeMins > 30) {
        bannerHtml = `<div class="sig-engine-banner closed">` +
          `Market closed · last signal ${fmtRelTime(lastSigTs)}</div>`;
      }

      let cardsHtml;
      if (!sigs.length) {
        cardsHtml = '<div class="dash-empty">No signals in the last 30 min</div>';
      } else {
        cardsHtml = sigs.map(s => {
          const tier      = (s.conviction_tier || s.cf_tier || '').toUpperCase();
          const dirStr    = (s.direction || 'bullish').toLowerCase().includes('bear') ? '🔴' : '🟢';
          const starHtml  = s.prime_star ? ' <span class="sig-star">★</span>' : '';
          const score     = s.conviction_score || 0;
          const scorePct  = Math.min(100, score * 10);
          const setupStr  = s.setup_type ? `<span class="sig-setup">${s.setup_type}</span>` : '';
          // Saty ATR badge — fire-time snapshot; updated live by _updateSatyBadges()
          const satyCall  = s.saty_call_trigger != null ? String(s.saty_call_trigger) : '';
          const satyPut   = s.saty_put_trigger  != null ? String(s.saty_put_trigger)  : '';
          const satySt    = s.saty_cross_state  || '';
          let satyHtml = '';
          if (satyCall) {
            const scls  = satySt === 'above_call' ? 'above-call' : satySt === 'below_put' ? 'below-put' : 'neutral';
            const stxt  = satySt === 'above_call' ? '▲' : satySt === 'below_put' ? '▼' : '—';
            const stitle = `Saty ATR (at fire-time): call $${parseFloat(satyCall).toFixed(2)} / put $${parseFloat(satyPut).toFixed(2)}`;
            satyHtml = `<span class="sig-saty ${scls}" title="${stitle}">${stxt}</span>`;
          }
          // Watched tag — ticker was on today's watchlist board
          const watchedHtml = watchlistDataCache.some(r => r.ticker === s.ticker)
            ? ' <span class="sig-watched">👁 WL</span>' : '';
          return `
<div class="sig-card ${s.actionable ? '' : 'stale'}" data-ticker="${s.ticker || ''}"${satyCall ? ` data-saty-call="${satyCall}" data-saty-put="${satyPut}"` : ''}>
  <div class="sig-card-top">
    <span class="sig-ticker">${dirStr} ${s.ticker || '?'}${starHtml}${satyHtml}${watchedHtml}</span>
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
      // Seed live Saty badges from watchlist cache immediately after render
      _updateSatyBadges();
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
        const isLong   = !_isShortSetup(r.direction);
        const dirClass = isLong ? 'bull' : 'bear';
        const dirArrow = isLong ? '▲' : '▼';
        const dirLabel = isLong ? 'CALL' : 'PUT';

        // Zone state badge
        const zoneKey   = r.arm_state || 'armed';
        const zoneLabel = { armed: 'armed', at_risk: 'at risk', fired: 'fired', invalidated: 'invalid', deactivated: 'inactive' }[zoneKey] || zoneKey;
        const zoneCls   = 'wl-zone wl-zone-' + zoneKey.replace('_', '-');

        // Signal marker — distinct from FIRED zone badge: shows when a posted signal exists for this ticker today
        const sigFireTs = signalTickersToday[r.ticker];
        const signalMarkerHtml = sigFireTs
          ? `<span class="wl-signal-marker">⚡ ${_fmtClockET(sigFireTs)}</span>` : '';

        // Direction-conflict badge — distinct from terminal INVALIDATED; display-only
        let conflictBadgeHtml = '';
        if (r.direction_conflict_confirmed) {
          conflictBadgeHtml = '<span class="wl-conflict wl-conflict--confirmed">⚠⚠ px break</span>';
        } else if (r.direction_conflict) {
          conflictBadgeHtml = '<span class="wl-conflict wl-conflict--tentative">⚠ px break</span>';
        }

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
    <span class="${zoneCls}">${zoneLabel}</span>${conflictBadgeHtml}${reachPillHtml}${signalMarkerHtml}
  </div>${gaugeHtml}
</div>`;
      }).join('');

      // If we already have a ticker focused, refresh its levels and header price.
      if (focusedTicker) { renderLevels(focusedTicker); _refreshFocusedPriceStrip(); }
      // Update Saty badges on signal cards using fresh live prices
      _updateSatyBadges();

    } catch (err) {
      meta.textContent = 'error';
      body.innerHTML   = '<div class="dash-placeholder">Could not load watchlist</div>';
    }
  }

  // ── Saty ATR live badge updater ────────────────────────────────────────────
  // Runs after each watchlist load (10s tick). For each signal card that has
  // data-saty-call/put attributes, looks up the current price from the watchlist
  // cache and recomputes the ▲/▼/— badge in-place without re-rendering the card.
  function _updateSatyBadges() {
    document.querySelectorAll('.sig-card[data-saty-call]').forEach(card => {
      const ticker   = card.dataset.ticker;
      const callTrig = parseFloat(card.dataset.satyCall) || 0;
      const putTrig  = parseFloat(card.dataset.satyPut)  || 0;
      if (!callTrig || !putTrig || !ticker) return;

      const wlRow     = (watchlistDataCache || []).find(r => r.ticker === ticker);
      const livePrice = wlRow && wlRow.current_price ? parseFloat(wlRow.current_price) : 0;
      if (!livePrice) return;

      const badge = card.querySelector('.sig-saty');
      if (!badge) return;

      let cls, txt, lbl;
      if (livePrice > callTrig) {
        cls = 'above-call'; txt = '▲';
        lbl = `▲ above call $${callTrig.toFixed(2)} | put $${putTrig.toFixed(2)} · live $${livePrice.toFixed(2)}`;
      } else if (livePrice < putTrig) {
        cls = 'below-put'; txt = '▼';
        lbl = `▼ below put $${putTrig.toFixed(2)} | call $${callTrig.toFixed(2)} · live $${livePrice.toFixed(2)}`;
      } else {
        cls = 'neutral'; txt = '—';
        lbl = `— neutral · call $${callTrig.toFixed(2)} / put $${putTrig.toFixed(2)} · live $${livePrice.toFixed(2)}`;
      }
      badge.className = `sig-saty ${cls}`;
      badge.textContent = txt;
      badge.title = lbl;
    });
  }

  // ── Center panel — chart, levels, chain ───────────────────────────────────

  function _syncBiasButtons() {
    const val     = (document.getElementById('chainBias') || {}).value;
    const callBtn = document.getElementById('chainBiasCall');
    const putBtn  = document.getElementById('chainBiasPut');
    if (!callBtn || !putBtn) return;
    callBtn.className = val === 'bullish' ? 'chain-bias-btn active-call' : 'chain-bias-btn inactive';
    putBtn.className  = val === 'bearish' ? 'chain-bias-btn active-put'  : 'chain-bias-btn inactive';
  }

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
      _updateDirectionWarning();
      if (chainTicker) loadChain(chainTicker, chainCurrentPrice);
    });
    document.getElementById('chainExpiry').addEventListener('change', () => {
      if (chainTicker) loadChain(chainTicker, chainCurrentPrice);
    });

    // Bias toggle buttons — set hidden select then fire its change handler; sync visual state
    document.getElementById('chainBiasCall').addEventListener('click', () => {
      document.getElementById('chainBias').value = 'bullish';
      document.getElementById('chainBias').dispatchEvent(new Event('change'));
      _syncBiasButtons();
    });
    document.getElementById('chainBiasPut').addEventListener('click', () => {
      document.getElementById('chainBias').value = 'bearish';
      document.getElementById('chainBias').dispatchEvent(new Event('change'));
      _syncBiasButtons();
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

    srLevelsCache         = null;
    chainArmedCloudLevels = null;
    focusGexCache         = null;
    matrixProjCache       = null;
    payoutCurveCache = null;
    chainAtr         = null;
    chainDayRange    = null;
    chainDayOpen     = null;
    chainDayHigh     = null;
    chainDayLow      = null;

    const searchInput = document.getElementById('tickerSearch');
    if (searchInput) searchInput.value = t;

    renderLevels(t);

    // Derive live price, trigger, bias, and day change from watchlist cache
    const wlRow    = watchlistDataCache.find(r => r.ticker === t);
    _setPmBadge(_computePmBreak(t));
    const trigger  = wlRow && wlRow.trigger       ? parseFloat(wlRow.trigger)       : 0;
    let livePrice  = wlRow && wlRow.current_price  ? parseFloat(wlRow.current_price) : 0;
    let changePct  = wlRow && wlRow.change_pct != null ? parseFloat(wlRow.change_pct) : null;
    const bias     = wlRow && _isShortSetup(wlRow.direction) ? 'bearish' : 'bullish';

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
    _syncBiasButtons();
    _updateDirectionWarning();

    // Show chain controls (including refresh button) and load expirations
    const controls = document.getElementById('chainControls');
    if (controls) controls.style.display = 'flex';

    loadChainExpirations(t, livePrice || trigger);
    loadMtf(t);
    loadAnalytics(t);
    if (drawerActive === 'news' && newsInnerTab === 'ticker') {
      loadTickerNewsIntoDrawer(t);
      updateDrawerTitle();
    }
    if (drawerActive === 'ta') {
      renderTaDrawer();
      updateDrawerTitle();
    } else if (drawerActive === 'fundamentals') {
      renderFundamentalsDrawer();
      updateDrawerTitle();
    } else if (drawerActive === 'info') {
      renderInfoDrawer();
      updateDrawerTitle();
    }
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

  function _computePmBreak(ticker) {
    const uRows = universeDataCache && universeDataCache.rows;
    const uRow  = uRows && uRows.find(r => r.ticker === ticker);
    const wlRow = watchlistDataCache.find(r => r.ticker === ticker);
    const livePrice = (wlRow && wlRow.current_price ? parseFloat(wlRow.current_price) : 0)
                   || (uRow  && uRow.price           ? parseFloat(uRow.price)           : 0);
    if (uRow && livePrice > 0 && uRow.pm_high != null && uRow.pm_low != null) {
      if (livePrice > uRow.pm_high)  return 'bull_break';
      if (livePrice < uRow.pm_low)   return 'bear_break';
      return 'chop';
    }
    return (uRow && uRow.pm_break_state) || (wlRow && wlRow.pm_break_state) || null;
  }

  function _setPmBadge(pmBreakState) {
    const badgeEl = document.getElementById('mtfBadgePm');
    if (!badgeEl) return;
    const MAP = {
      bull_break: { cls: 'bull',  text: '▲ BULL' },
      bear_break: { cls: 'bear',  text: '▼ BEAR' },
      chop:       { cls: 'mixed', text: '— CHOP' },
    };
    const entry = MAP[pmBreakState];
    if (entry) {
      badgeEl.className   = `cmd-mtf-badge ${entry.cls}`;
      badgeEl.textContent = entry.text;
    } else {
      badgeEl.className   = 'cmd-mtf-badge blocked';
      badgeEl.textContent = '—';
    }
  }

  // ── Bottom flow row — fetches /api/flow on load + every 90s ─────────────────

  function _flowStateClass(state) {
    return state === 'stale' ? 'stale' : '';
  }

  function _renderTide(cell, indexGex) {
    const bodyEl = document.getElementById('flowTideBody');
    const metaEl = document.getElementById('flowTideMeta');
    const cellEl = document.getElementById('flowCellTide');
    if (!bodyEl) return;

    const igx = indexGex || {};
    const gexRow = '<div class="flow-gex-row">' +
      '<span class="flow-gex-label">GEX γ</span>' +
      ['SPY', 'QQQ', 'IWM'].map(tk => {
        const st  = igx[tk] || null;
        const dot = st === 'Expansion' ? '🟢' : st === 'Compression' ? '🔵' : '⚪';
        return `<span class="univ-gex-chip">${dot} ${tk} ${st || '—'}</span>`;
      }).join('') +
      '</div>';

    if (!cell || cell.state === 'error') {
      bodyEl.innerHTML = '<span class="flow-empty">—</span>' + gexRow;
      return;
    }
    if (cell.state === 'empty') {
      bodyEl.innerHTML = '<span class="flow-empty">— awaiting market hours —</span>' + gexRow;
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
      </div>` + gexRow;
    if (metaEl) metaEl.textContent = cell.state === 'stale' ? 'stale' : 'live';
    if (cellEl) cellEl.classList.toggle('stale', cell.state === 'stale');
  }

  function _renderBaskets(cell) {
    const bodyEl = document.getElementById('flowSectorBody');
    const metaEl = document.getElementById('flowSectorMeta');
    const cellEl = document.getElementById('flowCellSector');
    if (!bodyEl) return;

    if (!cell) {
      bodyEl.innerHTML = '<span class="flow-empty">Loading baskets…</span>';
      return;
    }
    if (cell.state === 'error') {
      bodyEl.innerHTML = '<span class="flow-empty">—</span>';
      return;
    }
    if (cell.state === 'empty') {
      bodyEl.innerHTML = '<span class="flow-empty">file absent or not today\'s</span>';
      return;
    }

    const val      = cell.value || {};
    const raw      = Array.isArray(val.baskets) ? val.baskets : [];
    const timeframe = val.timeframe || '?';

    if (!raw.length) {
      bodyEl.innerHTML = '<span class="flow-empty">Loading baskets…</span>';
      return;
    }

    const sorted = [...raw].sort((a, b) => (b.rs_vs_spy ?? -Infinity) - (a.rs_vs_spy ?? -Infinity));
    _lastBaskets = sorted;
    _lastBasketsTimeframe = timeframe;

    const hasWatchlist = watchlistDataCache.length > 0;
    const armedSet = hasWatchlist
      ? new Set(watchlistDataCache.filter(r => r.arm_state === 'armed').map(r => r.ticker))
      : null;

    function rowHtml(b, idx) {
      const etfLabel = b.etf
        ? `<span class="basket-etf">${b.etf}</span>`
        : `<span class="basket-n">n=${b.total}</span>`;
      const rsVal = b.rs_vs_spy != null ? b.rs_vs_spy : null;
      const rsStr = rsVal != null ? (rsVal >= 0 ? '+' : '') + rsVal.toFixed(1) : '—';
      const rsCls = rsVal == null ? '' : rsVal > 0 ? 'bull' : rsVal < 0 ? 'bear' : '';
      const glyph = b.aligned > b.bearish ? '▲' : b.bearish > b.aligned ? '▼' : '—';
      const alignCls = b.aligned > b.bearish ? 'bull' : b.bearish > b.aligned ? 'bear' : '';
      const ac = armedSet ? (b.members || []).filter(m => armedSet.has(m.ticker)).length : null;
      const armedSpan = `<span class="basket-armed">${(ac !== null && ac > 0) ? `${ac} armed` : ''}</span>`;
      return `<div class="basket-row">
        <span class="basket-name" data-bidx="${idx}">${b.name}</span>
        ${etfLabel}
        <span class="basket-rs ${rsCls}">${rsStr}</span>
        <span class="basket-align ${alignCls}">${b.aligned}/${b.total} ${glyph}</span>
        ${armedSpan}
      </div>`;
    }

    const leftCol  = sorted.slice(0, 5).map((b, i) => rowHtml(b, i)).join('');
    const rightCol = sorted.slice(5).map((b, i) => rowHtml(b, i + 5)).join('');

    bodyEl.innerHTML = `<div class="basket-grid">
      <div class="basket-col">${leftCol}</div>
      <div class="basket-col">${rightCol}</div>
    </div>`;

    if (metaEl) metaEl.textContent = cell.state === 'stale' ? 'stale' : `clouds ${timeframe}`;
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
      _renderTide(data.tide, data.index_gex);
      _renderBaskets(data.baskets);
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

      // GEX stat row — admin only
      if (isElite || isAdmin) loadGexFlipCell(ticker).catch(() => {});

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

  // ── News helpers ──────────────────────────────────────────────────────────

  function fmtNewsAge(isoStr) {
    if (!isoStr) return '?';
    try {
      const diff = (Date.now() - new Date(isoStr).getTime()) / 1000;
      if (diff <    60) return Math.round(diff)        + 's';
      if (diff <  3600) return Math.round(diff / 60)   + 'm';
      if (diff < 86400) return Math.round(diff / 3600) + 'h';
      return Math.round(diff / 86400) + 'd';
    } catch (_) { return '?'; }
  }

  function _newsRow(it) {
    const age = fmtNewsAge(it.created_at);
    const src = it.source
      ? `<span class="news-row-src">${it.source}</span>`
      : '';
    const hl = (it.headline || '')
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const inner =
      `${src}<span class="news-row-age">${age}</span>` +
      `<span class="news-row-hl">${hl}</span>`;
    // Belt-and-suspenders: only allow http/https even though the backend already
    // requires startswith("http"). Rejects javascript:, data:, etc. from third-party text.
    const safeUrl = it.url && /^https?:\/\//i.test(it.url) ? it.url : null;
    if (safeUrl) {
      return `<a class="news-row" href="${safeUrl}" target="_blank" rel="noopener noreferrer">${inner}</a>`;
    }
    return `<div class="news-row">${inner}</div>`;
  }

  async function loadMarketNews() {
    const body = document.getElementById('newsMarketBody');
    if (!body) return;
    try {
      const data  = await apiFetch('/api/news/market');
      const items = (data && data.items) || [];
      if (!items.length) {
        body.innerHTML = '<span style="font-size:0.62rem;color:var(--text-muted)">no major headlines</span>';
        return;
      }
      const visible = items.slice(0, 8);
      const rest    = items.slice(8);
      let html = visible.map(_newsRow).join('');
      if (rest.length) {
        html +=
          `<div class="news-more-toggle" id="newsMoreToggle">+ ${rest.length} more…</div>` +
          `<div id="newsMoreBody" class="news-more-body">${rest.map(_newsRow).join('')}</div>`;
      }
      body.innerHTML = html;
      const toggle = document.getElementById('newsMoreToggle');
      if (toggle) {
        toggle.onclick = () => {
          document.getElementById('newsMoreBody').style.display = 'block';
          toggle.style.display = 'none';
        };
      }
    } catch (_) { /* degrade to no news */ }
  }

  async function loadTickerNews(ticker) {
    const panel  = document.getElementById('tickerNewsPanel');
    const body   = document.getElementById('tickerNewsBody');
    const title  = document.getElementById('tickerNewsTitle');
    const digBtn = document.getElementById('tickerNewsDigBtn');
    if (!panel || !body) return;

    if (title) title.textContent = `News — ${ticker}`;
    panel.style.display = 'none';
    body.innerHTML = '';

    try {
      const data  = await apiFetch(`/api/news/ticker/${encodeURIComponent(ticker)}`);
      const items = (data && data.items) || [];
      if (items.length) {
        body.innerHTML = items.map(_newsRow).join('');
      } else {
        body.innerHTML = '<span style="font-size:0.62rem;color:var(--text-muted)">no recent major news</span>';
      }
      panel.style.display = 'block';
    } catch (_) {
      // Quiet failure — panel stays hidden so the focus view is uncluttered.
      return;
    }

    if (digBtn) {
      digBtn.onclick = async () => {
        const prev = digBtn.textContent;
        digBtn.textContent = 'searching…';
        digBtn.disabled = true;
        try {
          const d    = await apiFetch(`/api/news/search/${encodeURIComponent(ticker)}`);
          const its  = (d && d.items) || [];
          if (its.length) {
            body.innerHTML = its.map(_newsRow).join('');
            panel.style.display = 'block';
          } else {
            body.insertAdjacentHTML('beforeend',
              '<div style="font-size:0.62rem;color:var(--text-muted);margin-top:4px">no additional results</div>');
          }
        } catch (_) {}
        digBtn.textContent = prev;
        digBtn.disabled = false;
      };
    }
  }

  // ── Right-column drawer ─────────────────────────────────────────────────────

  function openDrawer(which) {
    const drawerPanel = document.getElementById('drawerPanel');
    const histPanel   = document.getElementById('rightHistPanel');
    if (!drawerPanel || !histPanel) return;

    // Re-tap same slot → close
    if (drawerActive === which) { closeDrawer(); return; }

    drawerActive = which;
    drawerPanel.style.display = '';
    // Only set default split on first open; drag override persists until close
    if (!histPanel.style.flexBasis) histPanel.style.flexBasis = '55%';

    _drawerSetActive(which);

    if (which === 'news')                renderNewsDrawer();
    else if (which === 'ladder')         renderLadderDrawer();
    else if (which === 'calendar')       renderCalendarDrawer();
    else if (which === 'ta')             renderTaDrawer();
    else if (which === 'fundamentals')   renderFundamentalsDrawer();
    else if (which === 'info')           renderInfoDrawer();
    updateDrawerTitle();
  }

  function closeDrawer() {
    const wasActive   = drawerActive;
    const drawerPanel = document.getElementById('drawerPanel');
    const histPanel   = document.getElementById('rightHistPanel');
    if (drawerPanel) drawerPanel.style.display = 'none';
    if (histPanel)   histPanel.style.flexBasis = '';
    if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
    drawerActive = null;
    _drawerSetActive(null);
    // Remove TradingView iframes so they stop loading when drawer is hidden
    if (wasActive === 'calendar' || wasActive === 'ta' ||
        wasActive === 'fundamentals' || wasActive === 'info') {
      const body = document.getElementById('drawerBody');
      if (body) body.innerHTML = '';
    }
  }

  function _drawerSetActive(which) {
    ['drawerTabNews', 'drawerTabLadder', 'ribbonNews', 'ribbonLadder', 'ribbonCalendar', 'ribbonTA', 'ribbonFundamentals', 'ribbonInfo'].forEach(id => {
      document.getElementById(id)?.classList.remove('active');
    });
    if (which === 'news') {
      document.getElementById('drawerTabNews')?.classList.add('active');
      document.getElementById('ribbonNews')?.classList.add('active');
    } else if (which === 'ladder') {
      document.getElementById('drawerTabLadder')?.classList.add('active');
      document.getElementById('ribbonLadder')?.classList.add('active');
    } else if (which === 'calendar') {
      document.getElementById('ribbonCalendar')?.classList.add('active');
    } else if (which === 'ta') {
      document.getElementById('ribbonTA')?.classList.add('active');
    } else if (which === 'fundamentals') {
      document.getElementById('ribbonFundamentals')?.classList.add('active');
    } else if (which === 'info') {
      document.getElementById('ribbonInfo')?.classList.add('active');
    }
  }

  function renderNewsDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    drawerBody.innerHTML =
      `<div class="drawer-news-tabbar">` +
        `<button class="drawer-news-tab${newsInnerTab === 'ticker' ? ' active' : ''}" id="drawerNewsTabTicker">Ticker</button>` +
        `<button class="drawer-news-tab${newsInnerTab === 'market' ? ' active' : ''}" id="drawerNewsTabMarket">Headlines</button>` +
        `<button class="ticker-news-dig" id="drawerNewsDigBtn" style="display:none;margin-left:auto">dig deeper ↗</button>` +
      `</div>` +
      `<div id="drawerNewsContent" class="drawer-news-content"></div>` +
      `<div class="drawer-news-freshness" id="drawerNewsFreshness" style="display:none">` +
        `polled on scan clock · ≈10-min freshness · not real-time` +
      `</div>`;

    document.getElementById('drawerNewsTabTicker').addEventListener('click', () => {
      if (newsInnerTab === 'ticker') return;
      newsInnerTab = 'ticker';
      document.getElementById('drawerNewsTabTicker').classList.add('active');
      document.getElementById('drawerNewsTabMarket').classList.remove('active');
      if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
      loadNewsDrawerContent();
      updateDrawerTitle();
    });

    document.getElementById('drawerNewsTabMarket').addEventListener('click', () => {
      if (newsInnerTab === 'market') return;
      newsInnerTab = 'market';
      document.getElementById('drawerNewsTabMarket').classList.add('active');
      document.getElementById('drawerNewsTabTicker').classList.remove('active');
      if (newsTimer) { clearInterval(newsTimer); newsTimer = null; }
      loadNewsDrawerContent();
      updateDrawerTitle();
    });

    loadNewsDrawerContent();
  }

  function renderLadderDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    if (openConsoleId) {
      window.open(`ladder.html?pos=${encodeURIComponent(openConsoleId)}`, '_blank', 'noopener,noreferrer');
      drawerBody.innerHTML = '<div class="dash-placeholder">Ladder opened in new tab</div>';
    } else {
      drawerBody.innerHTML = '<div class="dash-placeholder">Open a position first</div>';
    }
  }

  function renderCalendarDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    drawerBody.innerHTML = '';

    const container = document.createElement('div');
    container.className    = 'tradingview-widget-container';
    container.style.cssText = 'height:100%;width:100%';

    const inner = document.createElement('div');
    inner.className    = 'tradingview-widget-container__widget';
    inner.style.cssText = 'height:100%;width:100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.type      = 'text/javascript';
    script.src       = 'https://s3.tradingview.com/external-embedding/embed-widget-events.js';
    script.async     = true;
    script.textContent = JSON.stringify({
      colorTheme:       'dark',
      isTransparent:    false,
      width:            '100%',
      height:           '100%',
      locale:           'en',
      importanceFilter: '0,1',
      countryFilter:    'us',
    });
    container.appendChild(script);
    drawerBody.appendChild(container);
  }

  function renderTaDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    drawerBody.innerHTML = '';

    if (!focusedTicker) {
      drawerBody.innerHTML = '<div class="dash-placeholder">Select a ticker to load Technical Analysis</div>';
      return;
    }

    const symbol = _tvSymbol(focusedTicker);

    const container = document.createElement('div');
    container.className    = 'tradingview-widget-container';
    container.style.cssText = 'width:100%;flex:none;height:450px';

    const inner = document.createElement('div');
    inner.className    = 'tradingview-widget-container__widget';
    inner.style.cssText = 'width:100%;height:100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.type      = 'text/javascript';
    script.src       = 'https://s3.tradingview.com/external-embedding/embed-widget-technical-analysis.js';
    script.async     = true;
    script.textContent = JSON.stringify({
      interval:         '1h',
      width:            '100%',
      isTransparent:    false,
      height:           450,
      symbol:           symbol,
      showIntervalTabs: true,
      locale:           'en',
      colorTheme:       'dark',
    });
    container.appendChild(script);
    drawerBody.appendChild(container);

    updateDrawerTitle();
  }

  function renderFundamentalsDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    drawerBody.innerHTML = '';

    if (!focusedTicker) {
      drawerBody.innerHTML = '<div class="dash-placeholder">Select a ticker to load Fundamentals</div>';
      return;
    }

    const symbol = _tvSymbol(focusedTicker);

    const container = document.createElement('div');
    container.className    = 'tradingview-widget-container';
    container.style.cssText = 'width:100%;flex:none;height:600px';

    const inner = document.createElement('div');
    inner.className    = 'tradingview-widget-container__widget';
    inner.style.cssText = 'width:100%;height:100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.type      = 'text/javascript';
    script.src       = 'https://s3.tradingview.com/external-embedding/embed-widget-financials.js';
    script.async     = true;
    script.textContent = JSON.stringify({
      symbol:        symbol,
      colorTheme:    'dark',
      isTransparent: false,
      displayMode:   'adaptive',
      width:         '100%',
      height:        600,
      locale:        'en',
    });
    container.appendChild(script);
    drawerBody.appendChild(container);

    updateDrawerTitle();
  }

  function renderInfoDrawer() {
    const drawerBody = document.getElementById('drawerBody');
    if (!drawerBody) return;
    drawerBody.innerHTML = '';

    if (!focusedTicker) {
      drawerBody.innerHTML = '<div class="dash-placeholder">Select a ticker to load Symbol Info</div>';
      return;
    }

    const symbol = _tvSymbol(focusedTicker);

    const container = document.createElement('div');
    container.className    = 'tradingview-widget-container';
    container.style.cssText = 'width:100%;flex:none;height:140px';

    const inner = document.createElement('div');
    inner.className    = 'tradingview-widget-container__widget';
    inner.style.cssText = 'width:100%;height:100%';
    container.appendChild(inner);

    const script = document.createElement('script');
    script.type      = 'text/javascript';
    script.src       = 'https://s3.tradingview.com/external-embedding/embed-widget-symbol-info.js';
    script.async     = true;
    script.textContent = JSON.stringify({
      symbol:        symbol,
      colorTheme:    'dark',
      isTransparent: false,
      width:         '100%',
      height:        140,
      locale:        'en',
    });
    container.appendChild(script);
    drawerBody.appendChild(container);

    updateDrawerTitle();
  }

  function updateDrawerTitle() {
    const el = document.getElementById('drawerTitle');
    if (!el) return;
    if (drawerActive === 'ladder')       { el.textContent = 'Ladder'; return; }
    if (drawerActive === 'calendar')     { el.textContent = 'Economic Calendar'; return; }
    if (drawerActive === 'ta')           { el.textContent = focusedTicker ? `Technical Analysis — ${focusedTicker}` : 'Technical Analysis'; return; }
    if (drawerActive === 'fundamentals') { el.textContent = focusedTicker ? `Fundamentals — ${focusedTicker}` : 'Fundamentals'; return; }
    if (drawerActive === 'info')         { el.textContent = focusedTicker ? `Symbol Info — ${focusedTicker}` : 'Symbol Info'; return; }
    if (drawerActive === 'news') {
      el.textContent = newsInnerTab === 'market'
        ? 'Market Headlines'
        : (focusedTicker ? `News — ${focusedTicker}` : 'News');
    }
  }

  function loadNewsDrawerContent() {
    if (newsInnerTab === 'ticker') {
      const c = document.getElementById('drawerNewsContent');
      const dig = document.getElementById('drawerNewsDigBtn');
      const fresh = document.getElementById('drawerNewsFreshness');
      if (fresh) fresh.style.display = '';
      if (dig)   dig.style.display   = '';
      if (!focusedTicker) {
        if (c) c.innerHTML = '<div class="dash-placeholder">Select a ticker to load news</div>';
        if (dig) dig.style.display = 'none';
        return;
      }
      loadTickerNewsIntoDrawer(focusedTicker);
    } else {
      const dig   = document.getElementById('drawerNewsDigBtn');
      const fresh = document.getElementById('drawerNewsFreshness');
      if (dig)   dig.style.display   = 'none';
      if (fresh) fresh.style.display = 'none';
      loadMarketNewsIntoDrawer();
    }
  }

  async function loadTickerNewsIntoDrawer(ticker) {
    const content = document.getElementById('drawerNewsContent');
    if (!content) return;
    content.innerHTML = '<div class="dash-placeholder">Loading…</div>';
    try {
      const data  = await apiFetch(`/api/news/ticker/${encodeURIComponent(ticker)}`);
      const items = (data && data.items) || [];
      content.innerHTML = items.length
        ? items.map(_newsRow).join('')
        : '<div class="dash-placeholder">No recent major news</div>';
    } catch (_) {
      content.innerHTML = '';
    }
    // Wire dig-deeper button (re-assign after every load)
    const digBtn = document.getElementById('drawerNewsDigBtn');
    if (digBtn) {
      digBtn.disabled = false;
      digBtn.textContent = 'dig deeper ↗';
      digBtn.onclick = async () => {
        const prev = digBtn.textContent;
        digBtn.textContent = 'searching…';
        digBtn.disabled = true;
        try {
          const d   = await apiFetch(`/api/news/search/${encodeURIComponent(ticker)}`);
          const its = (d && d.items) || [];
          if (its.length) {
            content.innerHTML = its.map(_newsRow).join('');
          } else {
            content.insertAdjacentHTML('beforeend',
              '<div style="font-size:0.62rem;color:var(--text-muted);padding:0.3rem 0.5rem">no additional results</div>');
          }
        } catch (_) {}
        digBtn.textContent = prev;
        digBtn.disabled = false;
      };
    }
  }

  async function loadMarketNewsIntoDrawer() {
    const content = document.getElementById('drawerNewsContent');
    if (!content) return;
    content.innerHTML = '<div class="dash-placeholder">Loading…</div>';
    try {
      const data  = await apiFetch('/api/news/market');
      const items = (data && data.items) || [];
      if (!items.length) {
        content.innerHTML = '<div class="dash-placeholder">No major headlines</div>';
      } else {
        const visible = items.slice(0, 8);
        const rest    = items.slice(8);
        let html = visible.map(_newsRow).join('');
        if (rest.length) {
          html +=
            `<div class="news-more-toggle" id="newsMoreToggle">+ ${rest.length} more…</div>` +
            `<div id="newsMoreBody" class="news-more-body">${rest.map(_newsRow).join('')}</div>`;
        }
        content.innerHTML = html;
        const toggle = document.getElementById('newsMoreToggle');
        if (toggle) toggle.onclick = () => {
          document.getElementById('newsMoreBody').style.display = 'block';
          toggle.style.display = 'none';
        };
      }
    } catch (_) { /* degrade */ }
    // Start 10-min poll only while market tab is active
    if (!newsTimer) {
      newsTimer = setInterval(() => {
        if (drawerActive === 'news' && newsInnerTab === 'market') loadMarketNewsIntoDrawer();
      }, 10 * 60_000);
    }
  }

  function setupDrawer() {
    // Ribbon icon buttons on the right app edge
    document.getElementById('ribbonNews')?.addEventListener('click',     () => openDrawer('news'));
    document.getElementById('ribbonLadder')?.addEventListener('click',   () => openDrawer('ladder'));
    document.getElementById('ribbonCalendar')?.addEventListener('click',      () => openDrawer('calendar'));
    document.getElementById('ribbonTA')?.addEventListener('click',           () => openDrawer('ta'));
    document.getElementById('ribbonFundamentals')?.addEventListener('click', () => openDrawer('fundamentals'));
    document.getElementById('ribbonInfo')?.addEventListener('click',         () => openDrawer('info'));

    // Drawer header tab buttons (visible when drawer is open)
    document.getElementById('drawerTabNews')?.addEventListener('click', () => openDrawer('news'));
    document.getElementById('drawerTabLadder')?.addEventListener('click', () => openDrawer('ladder'));
    document.getElementById('drawerCloseBtn')?.addEventListener('click', closeDrawer);

    // Draggable resizer
    const resizer   = document.getElementById('rightResizer');
    const histPanel = document.getElementById('rightHistPanel');
    if (resizer && histPanel) {
      let startY = 0, startH = 0, onMove, onUp;
      resizer.addEventListener('mousedown', e => {
        startY = e.clientY;
        startH = histPanel.getBoundingClientRect().height;
        onMove = ev => {
          histPanel.style.flexBasis = Math.max(120, startH + (ev.clientY - startY)) + 'px';
        };
        onUp = () => {
          document.removeEventListener('mousemove', onMove);
          document.removeEventListener('mouseup', onUp);
        };
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        e.preventDefault();
      });
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
    _setPmBadge(_computePmBreak(t));
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
    const sourceEl = document.getElementById('levelsSource');
    const gridEl   = document.getElementById('levelsGrid');
    if (!gridEl) return;

    const row = watchlistDataCache.find(r => r.ticker === ticker);
    if (!row) {
      if (sourceEl) sourceEl.textContent = 'not on today\'s watchlist';
      // ATR from chain (real-time, preferred) or sr_levels cache (always-on fallback).
      const _atr  = (chainAtr && chainAtr > 0) ? chainAtr
                      : (srLevelsCache?.sr_atr > 0 ? srLevelsCache.sr_atr : null);
      const _open = chainDayOpen ?? srLevelsCache?.day_open ?? null;
      const _high = chainDayHigh ?? srLevelsCache?.day_high ?? null;
      const _low  = chainDayLow  ?? srLevelsCache?.day_low  ?? null;
      const _px   = chainCurrentPrice > 0 ? chainCurrentPrice : (srLevelsCache?.price ?? null);
      let _atrHtml = '';
      if (_atr) {
        if (_open != null) {
          const _h = (_high != null) ? _high : _px;
          const _l = (_low  != null) ? _low  : _px;
          if (_h != null && _l != null) {
            const _dn  = Math.max(0, (_open - _l) / _atr);
            const _upv = Math.max(0, (_h - _open) / _atr);
            const _exh = (_dn + _upv) >= 0.95;
            const _dp  = Math.round(_dn  * 100);
            const _up  = Math.round(_upv * 100);
            const _tot = Math.round((_dn + _upv) * 100);
            const _xc  = _exh ? ' dash-atr-lbl--exh'  : '';
            const _xf  = _exh ? ' dash-atr-fill--exh' : '';
            _atrHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR <span class="dash-atr-total${_xc}">${_tot}%</span></span><div class="dash-atr-row"><span class="dash-atr-lbl dash-atr-lbl--d${_xc}">↓${_dp}%</span><div class="dash-atr-bar${_exh ? ' dash-atr-bar--exh' : ''}"><div class="dash-atr-h dash-atr-h--d"><div class="dash-atr-fill dash-atr-fill--d${_xf}" style="width:${Math.min(100,_dp)}%"></div></div><div class="dash-atr-h dash-atr-h--u"><div class="dash-atr-fill dash-atr-fill--u${_xf}" style="width:${Math.min(100,_up)}%"></div></div></div><span class="dash-atr-lbl dash-atr-lbl--u${_xc}">↑${_up}%</span></div></div>`;
          }
        } else {
          // Session OHLC unavailable (market closed / pre-open): show ATR dollar value only.
          _atrHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR</span><span class="dash-atr-lbl">$${_atr.toFixed(2)}</span></div>`;
        }
      }
      gridEl.innerHTML = '<div class="dash-placeholder" style="font-size:0.68rem;padding:0.5rem">—</div>' + _atrHtml;
    } else {
      if (sourceEl) sourceEl.textContent = 'watchlist board';

      const dirClass = _isShortSetup(row.direction) ? 'bear' : 'bull';

      const fields = [
        { label: 'Direction', value: (row.direction || '—').replace(/_/g, ' ').toUpperCase(), cls: dirClass },
        { label: 'Vs',        value: row.vs       != null ? fmtPrice(row.vs)      : '—' },
        { label: 'Arm',       value: row.arm_state || '—' },
      ];

      // Wilder ATR (chainAtr) — same denominator as ladder's "now X% ATR".
      // Polygon session OHLC (chainDayOpen/High/Low) — same basis as chainDayRange.
      // Guarantee: up + down = chainDayRange/chainAtr = ladder's exact number.
      // Fallback to watchlist-cache values while chain hasn't loaded yet.
      const _atr  = (chainAtr  && chainAtr  > 0) ? chainAtr  : row.daily_atr;
      const _open = chainDayOpen ?? row.day_open;
      const _high = chainDayHigh ?? row.day_high;
      const _low  = chainDayLow  ?? row.day_low;
      const _px   = row.current_price;
      let _atrHtml = '';
      if (_atr && _atr > 0 && _open != null) {
        // Prefer session high/low (range-extremes); fall back to current price if unavailable.
        const _h = (_high != null) ? _high : _px;
        const _l = (_low  != null) ? _low  : _px;
        if (_h != null && _l != null) {
          const _dn  = Math.max(0, (_open - _l) / _atr);   // no per-side clamp — allow >100%
          const _upv = Math.max(0, (_h - _open) / _atr);   // sum = chainDayRange/chainAtr
          const _exh = (_dn + _upv) >= 0.95;               // matches ladder's EXHAUSTED threshold
          const _dp  = Math.round(_dn  * 100);
          const _up  = Math.round(_upv * 100);
          const _tot = Math.round((_dn + _upv) * 100);
          const _xc  = _exh ? ' dash-atr-lbl--exh'  : '';
          const _xf  = _exh ? ' dash-atr-fill--exh' : '';
          _atrHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR <span class="dash-atr-total${_xc}">${_tot}%</span></span><div class="dash-atr-row"><span class="dash-atr-lbl dash-atr-lbl--d${_xc}">↓${_dp}%</span><div class="dash-atr-bar${_exh ? ' dash-atr-bar--exh' : ''}"><div class="dash-atr-h dash-atr-h--d"><div class="dash-atr-fill dash-atr-fill--d${_xf}" style="width:${Math.min(100,_dp)}%"></div></div><div class="dash-atr-h dash-atr-h--u"><div class="dash-atr-fill dash-atr-fill--u${_xf}" style="width:${Math.min(100,_up)}%"></div></div></div><span class="dash-atr-lbl dash-atr-lbl--u${_xc}">↑${_up}%</span></div></div>`;
        }
      }
      if (!_atrHtml) {
        _atrHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR</span><span class="dash-atr-lbl">—</span></div>`;
      }

      gridEl.innerHTML = fields.map(f => `
<div class="dash-level-cell">
  <span class="dash-level-cell-label">${f.label}</span>
  <span class="dash-level-cell-value${f.cls ? ' ' + f.cls : ''}">${f.value}</span>
</div>`).join('') + _atrHtml;
    }

    // Structural levels — async fetch, graceful degradation
    const structEl = document.getElementById('levelsStructural');
    if (structEl) {
      structEl.innerHTML = '';
      const px = row ? (row.current_price || null) : null;
      const url = `/api/sr_levels?ticker=${encodeURIComponent(ticker)}${px ? '&price=' + px : ''}`;
      apiFetch(url).then(d => {
        srLevelsCache = (d && d.available) ? d : null;
        // Immediately render the off-watchlist ATR bar from sr_levels data if the live
        // chain hasn't loaded yet (chainAtr still null). Guards: focusedTicker must still
        // match — avoids writing stale data when a second ticker was focused mid-flight.
        if (focusedTicker === ticker && d && d.sr_atr > 0 && !chainAtr) {
          const _offRow = watchlistDataCache.find(r => r.ticker === ticker);
          if (!_offRow && gridEl) {
            const _sa = d.sr_atr;
            const _so = d.day_open  ?? null;
            const _sh = d.day_high  ?? null;
            const _sl = d.day_low   ?? null;
            const _sp = d.price     ?? null;
            let _slHtml = '';
            if (_so != null) {
              const _hv = (_sh != null) ? _sh : _sp;
              const _lv = (_sl != null) ? _sl : _sp;
              if (_hv != null && _lv != null) {
                const _dn2  = Math.max(0, (_so - _lv) / _sa);
                const _upv2 = Math.max(0, (_hv - _so) / _sa);
                const _exh2 = (_dn2 + _upv2) >= 0.95;
                const _dp2  = Math.round(_dn2  * 100);
                const _up2  = Math.round(_upv2 * 100);
                const _tot2 = Math.round((_dn2 + _upv2) * 100);
                const _xc2  = _exh2 ? ' dash-atr-lbl--exh'  : '';
                const _xf2  = _exh2 ? ' dash-atr-fill--exh' : '';
                _slHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR <span class="dash-atr-total${_xc2}">${_tot2}%</span></span><div class="dash-atr-row"><span class="dash-atr-lbl dash-atr-lbl--d${_xc2}">↓${_dp2}%</span><div class="dash-atr-bar${_exh2 ? ' dash-atr-bar--exh' : ''}"><div class="dash-atr-h dash-atr-h--d"><div class="dash-atr-fill dash-atr-fill--d${_xf2}" style="width:${Math.min(100,_dp2)}%"></div></div><div class="dash-atr-h dash-atr-h--u"><div class="dash-atr-fill dash-atr-fill--u${_xf2}" style="width:${Math.min(100,_up2)}%"></div></div></div><span class="dash-atr-lbl dash-atr-lbl--u${_xc2}">↑${_up2}%</span></div></div>`;
              }
            } else {
              _slHtml = `<div class="dash-atr-room"><span class="dash-level-cell-label">ATR</span><span class="dash-atr-lbl">$${_sa.toFixed(2)}</span></div>`;
            }
            if (_slHtml) {
              gridEl.innerHTML = '<div class="dash-placeholder" style="font-size:0.68rem;padding:0.5rem">—</div>' + _slHtml;
            }
          }
        }
        if (!d || !d.available) return;
        const fmtN = v => v != null ? '$' + Number(v).toFixed(2) : null;
        const rows = [];

        // Row 1: reference levels (ATH/52WH, ATL/52WL, PDH2/PDL2)
        const refItems = [];
        if (d.ath != null)      refItems.push({ label: 'ATH',   val: fmtN(d.ath),   cls: 'overhead' });
        else if (d.high_52w != null) refItems.push({ label: '52WH', val: fmtN(d.high_52w), cls: 'overhead' });
        if (d.atl != null)      refItems.push({ label: 'ATL',   val: fmtN(d.atl),   cls: 'underfoot' });
        else if (d.low_52w != null)  refItems.push({ label: '52WL', val: fmtN(d.low_52w),  cls: 'underfoot' });
        if (d.pdh2 != null)     refItems.push({ label: 'PDH2',  val: fmtN(d.pdh2),  cls: 'overhead' });
        if (d.pdl2 != null)     refItems.push({ label: 'PDL2',  val: fmtN(d.pdl2),  cls: 'underfoot' });
        if (refItems.length) rows.push({ title: 'Reference', items: refItems });

        // Row 2: round numbers
        const roundItems = [];
        if (d.round_above != null) roundItems.push({ label: 'R↑', val: fmtN(d.round_above), cls: 'round' });
        if (d.round_below != null) roundItems.push({ label: 'R↓', val: fmtN(d.round_below), cls: 'round' });
        if (roundItems.length) rows.push({ title: 'Round', items: roundItems });

        // Row 3: overhead/underfoot swings — use bias selector direction for off-watchlist tickers
        const _dir = row ? row.direction : (document.getElementById('chainBias')?.value === 'bearish' ? 'short_setup' : 'long_setup');
        const isBear = _isShortSetup(_dir);
        const swings = isBear
          ? (d.underfoot_swings || []).slice(0, 3)
          : (d.overhead_swings  || []).slice(0, 3);
        const swingLabel = isBear ? 'UF' : 'OH';
        const swingCls   = isBear ? 'underfoot' : 'overhead';
        if (swings.length) {
          rows.push({
            title: isBear ? 'Underfoot' : 'Overhead',
            items: swings.map((s, i) => ({ label: swingLabel + (i + 1), val: fmtN(s), cls: swingCls })),
          });
        }

        if (!rows.length) return;
        structEl.innerHTML = `<div class="sl-section-title">Structure</div>` +
          rows.map(r =>
            `<div class="sl-row">` +
            r.items.map(it =>
              `<span><span class="sl-label">${it.label} </span><span class="sl-val ${it.cls}">${it.val}</span></span>`
            ).join('') +
            `</div>`
          ).join('');
      }).catch(() => { srLevelsCache = null; });
    }
  }

  // ── Chain — Part 2 ─────────────────────────────────────────────────────────

  async function loadChainExpirations(ticker, price) {
    const chainBody = document.getElementById('chainBody');
    const expiryEl  = document.getElementById('chainExpiry');
    if (!chainBody || !expiryEl) return;

    chainBody.innerHTML = '<div class="dash-placeholder">Loading expirations…</div>';
    expiryEl.innerHTML  = '<option value="">— loading —</option>';
    if (_armedRefreshTimer) { clearInterval(_armedRefreshTimer); _armedRefreshTimer = null; }
    armedContract         = null;
    chainArmedCloudLevels = null;
    matrixProjCache       = null;
    payoutCurveCache      = null;
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
      chainArmStock     = price;    // frozen reference for oneAtrX
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
    if (_armedRefreshTimer) { clearInterval(_armedRefreshTimer); _armedRefreshTimer = null; }
    armedContract         = null;
    chainArmedCloudLevels = null;
    matrixProjCache       = null;
    payoutCurveCache      = null;
    const cockpit1 = document.getElementById('chainCockpit');
    if (cockpit1) cockpit1.innerHTML = '';

    try {
      const params = new URLSearchParams({ ticker, expiry, bias, price, n_strikes: 30 });
      const data   = await apiFetch(`/api/chain?${params}`);
      renderChain(data.strikes || [], bias, data);
      _updateDirectionWarning();
    } catch (err) {
      _updateDirectionWarning();
      if (String(err).includes('403')) {
        chainBody.innerHTML = '<div class="dash-placeholder">Chain requires admin access</div>';
      } else {
        chainBody.innerHTML = '<div class="dash-placeholder">Could not load chain</div>';
      }
    }
  }

  function renderChain(strikes, bias, srCtx, opts = {}) {
    const chainBody = document.getElementById('chainBody');
    if (!strikes.length) {
      chainBody.innerHTML = '<div class="dash-placeholder">No liquid strikes (market closed or try different expiry)</div>';
      return;
    }

    // Save for compact-strip expand (always, on any full chain render)
    chainLastStrikesData = { strikes, bias, srCtx };

    // Remove arm-state and restore structural levels on every full chain render
    const chainPanelEl = document.querySelector('.dash-chain-panel');
    if (chainPanelEl) chainPanelEl.classList.remove('chain-collapsed');
    const structElRestore = document.getElementById('levelsStructural');
    if (structElRestore) structElRestore.style.display = '';

    srCtx = srCtx || {};

    const tier            = srCtx.tier             || null;
    const tierBaselinePct = srCtx.tier_baseline_pct != null ? srCtx.tier_baseline_pct : null;
    const tierHitRate     = srCtx.tier_hit_rate     != null ? srCtx.tier_hit_rate     : null;
    const tierCi          = srCtx.tier_ci           || null;
    const nextSr          = srCtx.next_sr           || null;
    const srDistPct       = srCtx.sr_distance_pct   != null ? srCtx.sr_distance_pct  : null;
    // atr_reachable may be true | false | null (null = no ATR data)
    const atrReachable    = srCtx.atr_reachable != null ? srCtx.atr_reachable : null;
    const atrMultiple     = srCtx.atr_multiple      != null ? srCtx.atr_multiple     : null;

    // Module-level ATR state for the projection matrix Rem ATR column.
    // sr_atr is the daily Wilder EWM ATR14 — constant all session; guard > 0 against bad fetches.
    // day_range grows intraday and is refreshed on every ↻ via chain/quote.
    chainAtr      = (srCtx.sr_atr > 0) ? srCtx.sr_atr : null;
    chainDayRange = srCtx.day_range ?? null;
    chainDayOpen  = srCtx.day_open  ?? null;
    chainDayHigh  = srCtx.day_high  ?? null;
    chainDayLow   = srCtx.day_low   ?? null;
    // Re-render the ATR bar with Wilder ATR + Polygon OHLC now that chain state is populated.
    if (focusedTicker) renderLevels(focusedTicker);

    // When atr_reachable is explicitly false, grey the @TP1 column and suppress values.
    // The SR level exists but is outside today's ATR budget; projecting to it would be
    // arithmetically valid but practically misleading.
    const tp1Greyed = atrReachable === false;

    const dirLabel = bias === 'bullish' ? 'CALL' : 'PUT';

    // ── SR / tier header ────────────────────────────────────────────────────
    let headerHtml = '';
    if (tier || nextSr) {
      const parts = [];

      if (tier) {
        const hitPct = tierHitRate != null ? Math.round(tierHitRate * 100) : null;
        // "typical peak" = MFE (intraday session high), not take-profit. It is a ceiling.
        const hitStr  = hitPct != null ? ` (${hitPct}%)` : '';
        const baseline = tierBaselinePct != null
          ? ` · <span class="chain-hdr-baseline">+${tierBaselinePct}% typical peak${hitStr}</span>`
          : '';
        parts.push(
          `<span class="chain-hdr-tier chain-hdr-tier-${tier.toLowerCase()}">${tier}</span>${baseline}`
        );
      }

      if (nextSr) {
        // Sign: calls go up to resistance (+), puts go down to support (-)
        const dSign = bias === 'bullish' ? '+' : '-';
        const dStr = srDistPct != null
          ? `(${dSign}${(srDistPct * 100).toFixed(2)}%)`
          : '';
        const _atrAmber = atrMultiple != null && atrMultiple > 1.0;
        const aStr = atrMultiple != null
          ? (_atrAmber
              ? `· <span style="color:#eda100">${atrMultiple.toFixed(2)} ATR</span>`
              : `· ${atrMultiple.toFixed(2)} ATR`)
          : '';
        parts.push(
          [`next R $${nextSr.price.toFixed(2)}`, dStr, aStr].filter(Boolean).join(' ')
        );
      }

      if (parts.length) {
        headerHtml = `<div class="chain-sr-header">${parts.join('<span class="chain-hdr-sep">  </span>')}</div>`;
      }
    }

    // ── Table rows ──────────────────────────────────────────────────────────
    const rows = strikes.map((s, i) => {
      // @TP1 cell: BS-projected % gain to next SR. Not clickable; never wired to an order.
      let tp1Cell  = '—';
      let tp1Class = '';
      if (!tp1Greyed && s.tp1_pct != null) {
        const sign = s.tp1_pct >= 0 ? '+' : '';
        tp1Cell = `${sign}${Math.round(s.tp1_pct)}%`;
        if (tierBaselinePct != null) {
          // Green = SR is not the binding constraint; amber = would hit resistance before typical move.
          tp1Class = s.tp1_pct >= tierBaselinePct ? ' tp1-green' : ' tp1-amber';
        }
      }

      return `
<tr data-idx="${i}" class="${s.is_target ? 'chain-atm' : ''}">
  <td><span class="chain-badge ${s.badge}">${s.badge}</span> $${s.strike}</td>
  <td>${s.delta.toFixed(2)}</td>
  <td>${s.ask.toFixed(2)}</td>
  <td>${s.bid.toFixed(2)}</td>
  <td>${s.iv > 0 ? (s.iv * 100).toFixed(0) + '%' : '—'}</td>
  <td class="chain-tp1${tp1Class}">${tp1Cell}</td>
</tr>`;
    }).join('');

    chainBody.innerHTML = headerHtml + `
<table class="chain-table${tp1Greyed ? ' chain-tp1-greyed' : ''}">
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
    if (cockpitEl && !opts.preserveCockpit) cockpitEl.innerHTML = '';

    // Click-to-select a row (arms the contract for order entry)
    chainBody.querySelectorAll('table tbody tr').forEach((row, i) => {
      row.addEventListener('click', () => {
        chainBody.querySelectorAll('table tbody tr').forEach(r => r.classList.remove('chain-selected'));
        row.classList.add('chain-selected');
        armContract(strikes[i], bias);
      });
    });

    // If preserveCockpit (expand from compact strip), mark the currently armed row
    if (opts.preserveCockpit && armedContract) {
      chainBody.querySelectorAll('table tbody tr').forEach((row, i) => {
        if (strikes[i] && strikes[i].strike === armedContract.strike) {
          row.classList.add('chain-selected');
        }
      });
    }

    // Scroll ATM row into view so the center strike is always visible
    const atmRow = chainBody.querySelector('tr.chain-atm');
    if (atmRow) atmRow.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  // watchlist direction is the "long" | "short" enum from alerts/watchlist_board.py:38.
  // It is NOT "bull"/"bear"/"bullish"/"bearish" — testing for those silently returns
  // false on every short setup. Five call sites drifted; this is the only test.
  function _isShortSetup(direction) {
    return String(direction || '').toLowerCase().startsWith('short');
  }

  function _updateDirectionWarning() {
    const warnEl   = document.getElementById('chainDirWarning');
    if (!warnEl) return;

    const biasEl   = document.getElementById('chainBias');
    const wlRow    = watchlistDataCache.find(r => r.ticker === chainTicker);
    const setupDir = wlRow?.direction;   // undefined when ticker has no watchlist row

    if (!setupDir) { warnEl.textContent = ''; return; }

    const selectedIsBull = biasEl.value === 'bullish';
    const setupIsBull    = !_isShortSetup(setupDir);

    if (selectedIsBull === setupIsBull) { warnEl.textContent = ''; return; }

    const selected = selectedIsBull ? 'CALLS' : 'PUTS';
    const setup    = setupIsBull    ? 'LONG'  : 'SHORT';
    warnEl.textContent = `⚠ ${selected} selected · setup is ${setup}`;
  }

  function _activateOrderTab() {
    document.getElementById('tabOrder')?.classList.add('active');
    document.getElementById('tabPositions')?.classList.remove('active');
    document.getElementById('tabHistory')?.classList.remove('active');
    const ordView  = document.getElementById('orderView');
    const posBody  = document.getElementById('positionsBody');
    const histView = document.getElementById('historyView');
    if (ordView)   ordView.style.display   = '';
    if (posBody)   posBody.style.display   = 'none';
    if (histView)  histView.style.display  = 'none';
    const orderPh  = document.getElementById('orderPlaceholder');
    if (orderPh)   orderPh.style.display   = 'none';
    const posMeta  = document.getElementById('positionsMeta');
    if (posMeta)   posMeta.textContent     = '';
  }

  function _onPayoutTab() {
    const t = document.querySelector('#cockpitProjTabs .cpt-tab.active');
    return !!(t && t.dataset.tab === 'payout');
  }

  function _activateCockpitProjTab(tab) {
    document.querySelectorAll('#cockpitProjTabs .cpt-tab').forEach(b => {
      b.classList.toggle('active', b.dataset.tab === tab);
    });
    const asOfEl = document.getElementById('cockpitPayoutAsOf');
    const qty    = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
    if (tab === 'payout') {
      renderPayoutCurve(payoutCurveCache, qty);
    } else {
      if (matrixProjCache) {
        const wrapEl = document.getElementById('cockpitProjWrap');
        const verdEl = document.getElementById('cockpitVerdict');
        const tgt    = parseFloat((document.getElementById('cockpitTarget') || {}).value) || chainCurrentPrice;
        renderProjectionMatrix(matrixProjCache.levels, matrixProjCache.projResults, qty, wrapEl, verdEl, tgt);
      }
    }
  }

  async function armContract(strike, bias) {
    if (_armedRefreshTimer) { clearInterval(_armedRefreshTimer); _armedRefreshTimer = null; }
    _ocoButtonRefreshFn = null;
    armedContract = { ...strike, bias };
    const _isCall = bias === 'bullish';
    chainArmedCloudLevels = (srLevelsCache?.cloud_levels || []).map(c => ({
      label: c.label,
      price: _isCall ? Math.min(c.ema_short, c.ema_long) : Math.max(c.ema_short, c.ema_long),
      type:  'cloud',
      role:  _isCall ? 'support' : 'resistance',
    })).filter(c => c.price > 0);
    _armedRefreshTimer = setInterval(() => { if (armedContract) refreshArmedQuote(); }, 30000);

    const chainBody    = document.getElementById('chainBody');
    const chainCockpit = document.getElementById('chainCockpit');
    const chainPanelEl = document.querySelector('.dash-chain-panel');
    chainCockpit.innerHTML = '';

    const dir = bias === 'bullish' ? 'call' : 'put';
    const sym = strike.symbol || `${chainTicker} $${strike.strike}${dir[0].toUpperCase()} ${strike.expiration}`;
    const ask = parseFloat(strike.ask);
    const bid = parseFloat(strike.bid) || 0;
    const iv  = parseFloat(strike.iv)  || 0;
    const dte = parseInt(strike.dte,10) || 0;

    const _remAtr  = chainAtr > 0 && chainDayRange != null ? Math.max(0, chainAtr - chainDayRange) : 0;
    const _srUp    = srLevelsCache?.overhead_swings?.[0] ?? srLevelsCache?.round_above ?? null;
    const _srDn    = srLevelsCache?.underfoot_swings?.[0] ?? srLevelsCache?.round_below ?? null;
    const _seedUp  = _srUp  ?? (_remAtr > 0 ? chainCurrentPrice + _remAtr : chainCurrentPrice * 1.0025);
    const _seedDn  = _srDn  ?? (_remAtr > 0 ? chainCurrentPrice - _remAtr : chainCurrentPrice * 0.9975);
    const defaultTarget = chainCurrentPrice > 0 ? (bias === 'bullish' ? _seedUp : _seedDn).toFixed(2) : '';
    const _srcUp   = _srUp  ? 'seed · overhead SR' : (_remAtr > 0 ? 'seed · ATR reach' : 'seed · above spot');
    const _srcDn   = _srDn  ? 'seed · support SR'  : (_remAtr > 0 ? 'seed · ATR reach' : 'seed · below spot');
    const targetSrc = chainCurrentPrice > 0 ? (bias === 'bullish' ? _srcUp : _srcDn) : 'enter target';

    // ── Compact strip — collapse chain body to armed ± 2 neighbors ───────────
    if (chainPanelEl && chainLastStrikesData) {
      const allStrikes = chainLastStrikesData.strikes;
      const armedIdx   = allStrikes.findIndex(s => s.strike === strike.strike);
      const start      = Math.max(0, armedIdx - 2);
      const end        = Math.min(allStrikes.length - 1, armedIdx + 2);
      const neighbors  = allStrikes.slice(start, end + 1);

      chainBody.innerHTML = `
<div class="chain-compact-strip">
  <div class="chain-compact-strikes">
    ${neighbors.map((s, ni) => {
      const isArmed = s.strike === strike.strike;
      return `
    <div class="chain-compact-item${isArmed ? ' chain-compact-armed' : ' chain-compact-neighbor'}" data-idx="${start + ni}">
      <span class="chain-badge ${s.badge}">${s.badge}</span>
      <span>$${s.strike}</span>
    </div>`;
    }).join('')}
  </div>
  <button class="chain-expand-btn" id="chainExpandBtn" title="Restore full chain table">⤢ Expand chain</button>
</div>`;

      chainPanelEl.classList.add('chain-collapsed');

      // Neighbor chips re-arm directly from cached strike data (cache path —
      // no /api/chain/quote call at click time; armContract handles quote refresh internally)
      chainBody.querySelectorAll('.chain-compact-neighbor').forEach(chip => {
        chip.addEventListener('click', () => {
          const idx = parseInt(chip.dataset.idx, 10);
          const s   = chainLastStrikesData && chainLastStrikesData.strikes[idx];
          if (s) armContract(s, chainLastStrikesData.bias);
        });
      });
    }

    // Hide structural levels block while cockpit matrix is showing
    const structEl = document.getElementById('levelsStructural');
    if (structEl) structEl.style.display = 'none';

    // ── Centre column (Blocks A, C, D, E, F) — stays in #chainCockpit ──────
    const centreHtml = `
<div class="chain-armed" id="chainArmed">
  <div class="cockpit-header">
    <div class="cockpit-header-left">
      <span class="cockpit-symbol">${sym}</span>
      <span class="cockpit-meta" id="cockpitMeta">${dir.toUpperCase()} · ask $${ask.toFixed(2)} · ${dte}DTE${iv > 0 ? ' · IV ' + (iv * 100).toFixed(0) + '%' : ''}<span class="cockpit-quote-age" id="cockpitQuoteAge"></span></span>
    </div>
    <button class="cockpit-refresh-btn" id="cockpitRefreshBtn" title="Re-fetch live quote + projection">↻</button>
  </div>

  <!-- Projection target -->
  <div class="cockpit-qty-target-row">
    <span class="chain-cost-label">Target $</span>
    <input class="cockpit-target-input" id="cockpitTarget" type="number" step="0.01" value="${defaultTarget}" placeholder="0.00">
    <button class="cockpit-apply-btn" id="cockpitApplyTarget">→</button>
    <span class="cockpit-target-src" id="cockpitTargetSrc">${targetSrc}</span>
  </div>

  <!-- ATR banner lives outside the scroll region — rendered separately from the table -->
  <div id="cockpitAtrBanner"></div>

  <!-- R:R premium number line — renders from matrixProjCache, no fetch -->
  <div id="cockpitRrLine" style="display:none"></div>

  <!-- MATRIX / PAYOUT tab strip — flex-shrink:0, no vertical cost -->
  <div class="cockpit-proj-tabs" id="cockpitProjTabs">
    <button class="cpt-tab active" data-tab="matrix">MATRIX</button>
    <button class="cpt-tab" data-tab="payout">PAYOUT</button>
    <select class="cpt-asof" id="cockpitPayoutAsOf" style="display:none"></select>
  </div>

  <!-- Scrollable matrix / payout SVG — flex:1 1 auto -->
  <div class="cockpit-proj-wrap" id="cockpitProjWrap">
    <div class="dash-placeholder" style="padding:0.25rem 0">Loading projection…</div>
  </div>

  <div class="cockpit-verdict" id="cockpitVerdict" style="display:none"></div>
</div>`;

    // ── Right column (identity + Sections 1 + 3) — injected into #orderFormMount
    const rightHtml = `
<div class="cockpit-order-identity">
  <span class="cockpit-order-symbol">${sym}</span>
  <span class="cockpit-order-meta">${dir.toUpperCase()} · ${strike.strike} · ${dte}DTE</span>
</div>

  <!-- ─── 1. ORDER BASICS ─────────────────────────────────────────── -->
  <div class="cockpit-levels-section">
    <div class="cockpit-section-hd">1. Order Basics</div>

    <!-- Limit price mode + resolved price + bid/ask -->
    <div class="cockpit-limit-row">
      <span class="cockpit-section-label">limit price</span>
      <div class="cockpit-level-btns" id="cockpitEntryModeBtns">
        <button class="cockpit-level-btn active" data-entry-mode="auto">Auto</button>
        <button class="cockpit-level-btn" data-entry-mode="take_ask">Ask</button>
        <button class="cockpit-level-btn" data-entry-mode="your_price">Yours</button>
      </div>
      <span class="cockpit-resolved-price" id="cockpitResolvedPrice">—</span>
      <span class="cockpit-bid-ask" id="cockpitBidAskDisplay">${bid > 0 ? `bid ${bid.toFixed(2)} / ask ${ask.toFixed(2)}` : `ask ${ask.toFixed(2)}`}</span>
    </div>

    <!-- Your price field (revealed only when mode=Yours) -->
    <div id="cockpitEntryPriceRow" style="display:none; align-items:center; gap:0.4rem; margin-top:0.3rem;">
      <span class="cockpit-section-label">Premium $</span>
      <input type="number" id="cockpitEntryPriceInput" class="cockpit-target-input"
             min="0.01" step="0.01" placeholder="0.00">
    </div>

    <!-- Quantity + quick-set chips + TIF chip -->
    <div class="cockpit-qty-row">
      <span class="cockpit-section-label">quantity</span>
      <div class="cockpit-qty-chips" id="cockpitQtyChips">
        <button class="cockpit-qty-chip" type="button" data-qty="1">1</button>
        <button class="cockpit-qty-chip" type="button" data-qty="2">2</button>
        <button class="cockpit-qty-chip" type="button" data-qty="5">5</button>
        <button class="cockpit-qty-chip" type="button" data-qty="10">10</button>
      </div>
      <input class="chain-qty-input" id="chainQty" type="number" min="1" max="20" value="2">
      <span class="cockpit-section-label" style="margin-left:0.4rem">tif</span>
      <div id="cockpitTifChips" style="display:flex;gap:0.12rem">
        <button class="cockpit-qty-chip active" type="button" data-tif="day">DAY</button>
        <button class="cockpit-qty-chip" type="button" data-tif="gtc">GTC</button>
      </div>
      <span id="cockpitTifNote" style="font-size:0.53rem;color:var(--text-muted)"></span>
    </div>

    <div class="cockpit-entry-sublabels">
      <span class="cockpit-entry-sublabel" id="cockpitEntrySublabel">limit order · day</span>
      <span class="cockpit-entry-sublabel">market &amp; stop entry not supported</span>
    </div>
  </div>

  <!-- ─── 3. EXIT STRATEGY ────────────────────────────────────────── -->
  <div class="cockpit-levels-section">
    <div class="cockpit-section-hd">3. Exit Strategy</div>
    <div class="cockpit-inline-row" style="margin-bottom:0.14rem">
      <span class="cockpit-section-label">strategy</span>
      <select id="cockpitExitLayerSelect" class="chain-select" style="flex:1">
        <option value="default">Default</option>
        <option value="tight_trail">Tight trail</option>
        <option value="cloud_break">Cloud break</option>
        <option value="oco_bracket">OCO bracket</option>
      </select>
    </div>
    <!-- Per-layer content rendered by _updateBrokerBotCols -->
    <div class="cockpit-broker-bot-cols">
      <div class="cockpit-broker-col" id="cockpitBrokerCol">
        <div class="cockpit-col-hd">Rests at broker</div>
        <div class="cockpit-col-sub">survives the bot dying</div>
        <div class="cockpit-col-items" id="cockpitBrokerContent"></div>
        <div id="cockpitOcoPriceStale" class="cockpit-oco-price-stale" style="display:none"></div>
      </div>
      <div class="cockpit-bot-col">
        <div class="cockpit-col-hd">Bot watches</div>
        <div class="cockpit-col-sub">dies if the droplet dies</div>
        <div class="cockpit-col-items" id="cockpitBotContent"></div>
      </div>
    </div>
    <div id="cockpitOcoBotCaption" class="cockpit-oco-caption" style="display:none">bot exits suppressed while bracket rests</div>
    <!-- Hidden spans kept for _updateOcoHints compatibility -->
    <span id="cockpitOcoTpHint" style="display:none"></span>
    <span id="cockpitOcoStopHint" style="display:none"></span>
  </div>

  <div class="cockpit-summary-block" id="cockpitSummaryBlock">
    <div class="cockpit-summary-single" id="cockpitSumRiskRow">
      <span class="cockpit-sum-item">cost <span class="cockpit-summary-val" id="chainCost">${fmtPrice(ask * 2 * 100)}</span></span>
      <span class="cockpit-sum-sep">·</span>
      <span class="cockpit-sum-item">max loss <span class="cockpit-summary-val" id="chainMaxLoss">—</span><span class="cockpit-sum-gaps" id="cockpitCostIfGaps"></span></span>
      <span class="cockpit-sum-sep">·</span>
      <span class="cockpit-sum-item">B/E <span class="cockpit-summary-val" id="cockpitBE">—</span><span class="cockpit-be-sub" id="cockpitBESub"></span></span>
      <span class="cockpit-sum-risk-wrap"><span class="cockpit-sum-risk-label">⚠ risk left </span><span class="cockpit-summary-val" id="cockpitSumRisk">—</span></span>
    </div>
    <div class="cockpit-provenance">est. from limit · server uses actual fill</div>
  </div>

  <div class="cockpit-actions">
    <button class="chain-open-btn" id="chainOpenBtn">
      Open Position
      <span class="pos-preview-tag">gated by kill-switch</span>
    </button>
  </div>
`;

    chainCockpit.innerHTML = centreHtml;

    const orderFormMount = document.getElementById('orderFormMount');
    if (!orderFormMount) {
      console.error('[armContract] #orderFormMount missing — ORDER tab HTML not injected. Stale dashboard.html?');
      chainCockpit.innerHTML += '<p style="color:var(--danger);padding:0.5rem 0">Order panel failed to mount — reload the page.</p>';
      return;
    }
    orderFormMount.innerHTML = rightHtml;

    _activateOrderTab();

    // Initialise per-layer broker/bot readout and entry display with current armed state
    _updateBrokerBotCols('default');
    _updateEntryDisplay();

    // Wire expand-chain button (lives in the compact strip, not in the cockpit)
    const expandBtn = document.getElementById('chainExpandBtn');
    if (expandBtn) {
      expandBtn.addEventListener('click', () => {
        if (chainLastStrikesData) {
          renderChain(
            chainLastStrikesData.strikes,
            chainLastStrikesData.bias,
            chainLastStrikesData.srCtx,
            { preserveCockpit: true }
          );
        }
      });
    }

    // Qty → update all display fields + re-render active proj view if cached
    document.getElementById('chainQty').addEventListener('input', () => {
      _updateEntryDisplay();
      if (cockpitExitLayer === 'oco_bracket') _updateOcoPnl();
      const qty = Math.max(1, parseInt(document.getElementById('chainQty').value, 10) || 1);
      if (matrixProjCache) {
        if (!_onPayoutTab()) {
          const wrapEl = document.getElementById('cockpitProjWrap');
          const verdEl = document.getElementById('cockpitVerdict');
          const tgt    = parseFloat(document.getElementById('cockpitTarget').value) || chainCurrentPrice;
          renderProjectionMatrix(matrixProjCache.levels, matrixProjCache.projResults, qty, wrapEl, verdEl, tgt);
        }
        renderRrLine(matrixProjCache.levels, matrixProjCache.projResults, qty);
      }
      if (_onPayoutTab() && payoutCurveCache) renderPayoutCurve(payoutCurveCache, qty);
    });

    // Qty chips — cosmetic shortcuts; write to #chainQty and fire its existing input handler.
    // Active chip class tracks whichever chip matches the current value.
    const _qtyChipsEl = document.getElementById('cockpitQtyChips');
    const _qtyInpEl   = document.getElementById('chainQty');
    function _syncQtyChips() {
      const v = _qtyInpEl.value;
      _qtyChipsEl.querySelectorAll('.cockpit-qty-chip').forEach(c => {
        c.classList.toggle('active', c.dataset.qty === v);
      });
    }
    _qtyChipsEl.addEventListener('click', e => {
      const btn = e.target.closest('[data-qty]');
      if (!btn) return;
      _qtyInpEl.value = btn.dataset.qty;
      _qtyInpEl.dispatchEvent(new Event('input', { bubbles: true }));
    });
    _qtyInpEl.addEventListener('input', _syncQtyChips);
    _syncQtyChips();

    // Entry price mode buttons — reset to AUTO on each arm, persist within session
    cockpitEntryMode = 'auto';
    cockpitExitLayer = 'default';
    _tif             = 'day';
    document.getElementById('cockpitEntryModeBtns').addEventListener('click', e => {
      const btn = e.target.closest('[data-entry-mode]');
      if (!btn) return;
      document.querySelectorAll('#cockpitEntryModeBtns .cockpit-level-btn')
        .forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      cockpitEntryMode = btn.dataset.entryMode;
      document.getElementById('cockpitEntryPriceRow').style.display =
        cockpitEntryMode === 'your_price' ? 'flex' : 'none';
      _updateEntryDisplay();
    });

    // your_price input — live-update resolved price, max loss, B/E as user types
    document.getElementById('cockpitEntryPriceInput').addEventListener('input', _updateEntryDisplay);

    // Exit-layer select — update broker/bot readout; _updateBrokerBotCols handles OCO wiring
    document.getElementById('cockpitExitLayerSelect').addEventListener('change', e => {
      cockpitExitLayer = e.target.value;
      _updateBrokerBotCols(cockpitExitLayer);
    });

    // TIF toggle — DAY/GTC chips; DTE-driven guard: 0DTE disables GTC, 1DTE warns on select
    {
      const _tifChips  = document.querySelectorAll('#cockpitTifChips .cockpit-qty-chip');
      const _tifNoteEl = document.getElementById('cockpitTifNote');
      const _gtcChip   = document.querySelector('#cockpitTifChips [data-tif="gtc"]');
      const _subEl     = document.getElementById('cockpitEntrySublabel');

      if (dte === 0) {
        // GTC is functionally identical to DAY on 0DTE — block it entirely
        _gtcChip.disabled      = true;
        _gtcChip.style.opacity = '0.35';
        _gtcChip.style.cursor  = 'not-allowed';
        if (_tifNoteEl) _tifNoteEl.textContent = 'GTC = DAY today';
      }
      // dte === 1: chips enabled; warning fires on select below
      // dte >= 2: no guard needed

      _tifChips.forEach(btn => {
        btn.addEventListener('click', () => {
          if (btn.disabled) return;
          _tif = btn.dataset.tif;
          _tifChips.forEach(c => c.classList.toggle('active', c === btn));
          if (_subEl) _subEl.textContent = `limit order · ${_tif}`;
          if (_tifNoteEl && dte !== 0) {
            if (dte === 1 && _tif === 'gtc') {
              _tifNoteEl.style.color = 'var(--amber, #f59e0b)';
              _tifNoteEl.textContent = 'GTC rests to next session';
            } else {
              _tifNoteEl.style.color = 'var(--text-muted)';
              _tifNoteEl.textContent = '';
            }
          }
        });
      });
    }

    function _updateOcoHints() {
      const tpInp    = document.getElementById('cockpitOcoTpInput');
      const tpHint   = document.getElementById('cockpitOcoTpHint');
      const stopHint = document.getElementById('cockpitOcoStopHint');
      if (!tpInp) return;
      // Use resolved limit as base; fall back to ask when displayPrice is null (AUTO, no bid)
      const { displayPrice } = _resolveEntryPrice();
      const base      = displayPrice != null ? displayPrice : (armedContract ? armedContract.ask : 0);
      if (base <= 0) return;
      const derivedTp = +(base * _tpMult(EXIT_TP_PCT)).toFixed(2);
      const derivedSl = +(base * _slMult()).toFixed(2);
      tpInp.placeholder    = `${derivedTp}`;
      if (tpHint)   tpHint.textContent   = `blank = server default ≈$${derivedTp} (est. from limit; server uses actual fill)`;
      if (stopHint) stopHint.textContent = `Stop: ≈$${derivedSl} (est. from limit; server uses actual fill — override with stop_price)`;
    }

    // Per-layer broker/bot readout — replaces _updateLayerSubtitle.
    // OCO bracket: creates TP/stop inputs inside the broker column and wires their listeners.
    // The three non-OCO layers render with amber treatment (nothing rests at broker).
    // _ocoTpStash: last-selected TP price string — stashed on layer-switch via the hidden input.
    // _ocoLvlStash: last-selected level label (e.g. 'UF1', '×1.50') — primary restore key for
    //   SR button active state across layer-switches and 30s button re-renders.
    // Both reset on next armContract call (declared in armContract's scope).
    let _ocoTpStash   = null;
    let _ocoLvlStash  = null;
    let _ocoStopStash = null;  // custom stop price string; null → server uses sl_pct=30
    // Set to true on any user interaction with the OCO panel; suppresses the 30s timer
    // re-render so an active form is never silently rebuilt under the user's hands.
    // Resets to false after placement, and naturally on next armContract call.
    let _ocoPanelDirty = false;
    let _ocoDirtyAt    = 0;    // epoch ms when panel first went dirty; 0 = not dirty
    function _setOcoDirty() {
      if (!_ocoPanelDirty) { _ocoPanelDirty = true; _ocoDirtyAt = Date.now(); }
      const el = document.getElementById('cockpitOcoPriceStale');
      if (el) {
        const mins = _ocoDirtyAt ? Math.floor((Date.now() - _ocoDirtyAt) / 60000) : 0;
        el.textContent = mins > 0
          ? `prices held · ${mins}m · re-arm to refresh`
          : 'prices held · re-arm to refresh';
        el.style.display = '';
      }
    }
    function _clearOcoDirty() {
      _ocoPanelDirty = false;
      _ocoDirtyAt    = 0;
      const el = document.getElementById('cockpitOcoPriceStale');
      if (el) el.style.display = 'none';
    }
    function _updateBrokerBotCols(layer) {
      const brokerEl     = document.getElementById('cockpitBrokerContent');
      const botEl        = document.getElementById('cockpitBotContent');
      const brokerCol    = document.getElementById('cockpitBrokerCol');
      const brokerBotCols = brokerCol ? brokerCol.parentElement : null;
      const captionEl    = document.getElementById('cockpitOcoBotCaption');
      if (!brokerEl || !botEl) return;

      // Stash typed TP before innerHTML replacement destroys the input.
      // Stop is intentionally NOT stashed here — cockpitOcoStopVal gets a seeded default on
      // every _updateOcoPnl() call, so reading prevStopEl.value would conflate the default
      // with a user-typed override. _ocoStopStash is set only by the user-input listeners.
      const prevTpEl = document.getElementById('cockpitOcoTpInput');
      if (prevTpEl && prevTpEl.value) _ocoTpStash = prevTpEl.value;

      const nothing = `<div class="cockpit-col-nothing">nothing — bot-held only</div>`;
      const botDefault = `
        <div class="cockpit-col-item">tp1 / tp2</div>
        <div class="cockpit-col-item">trail arm +35% · BE +5% · width 0.10</div>
        <div class="cockpit-col-item">hard stop · stall exit</div>
        <div class="cockpit-col-item">opt floor · dollar cap · time exits</div>`;

      if (brokerCol)    brokerCol.classList.remove('cockpit-broker-accent');
      if (brokerBotCols) brokerBotCols.classList.remove('cockpit-broker-bot-cols--oco');
      if (captionEl)    captionEl.style.display = 'none';
      // Re-enable on every layer switch; oco_bracket block applies checkbox gate below.
      const _openBtn = document.getElementById('chainOpenBtn');
      if (_openBtn) _openBtn.disabled = false;

      if (layer === 'default') {
        brokerEl.innerHTML = nothing;
        botEl.innerHTML    = botDefault;
      } else if (layer === 'tight_trail') {
        brokerEl.innerHTML = nothing;
        botEl.innerHTML    = `
          <div class="cockpit-col-item">tp1 / tp2</div>
          <div class="cockpit-col-item">trail arm +30% · BE +5% · width 0.08 flat</div>
          <div class="cockpit-col-item">hard stop · <s>stall exit</s></div>
          <div class="cockpit-col-item">opt floor · dollar cap · time exits</div>`;
      } else if (layer === 'cloud_break') {
        brokerEl.innerHTML = nothing;
        botEl.innerHTML    = `
          <div class="cockpit-col-item">cloud break (10 m close through fast cloud)</div>
          <div class="cockpit-col-item">0.08 trail backstop · <s>stall exit</s></div>
          <div class="cockpit-col-item">opt floor · dollar cap · time exits</div>`;
      } else if (layer === 'oco_bracket') {
        if (brokerCol)    brokerCol.classList.add('cockpit-broker-accent');
        if (brokerBotCols) brokerBotCols.classList.add('cockpit-broker-bot-cols--oco');
        const curAsk = armedContract ? armedContract.ask : 0;
        const sl     = curAsk > 0 ? +(curAsk * _slMult()).toFixed(2) : '';

        // Build SR-level TP buttons from hoisted _rrProfitSide.
        // entry via _resolveEntryPrice() — same call used by _updateOcoHints (line below).
        const { displayPrice: _btEntry } = _resolveEntryPrice();
        const _lvls = (_rrProfitSide || []).slice(0, 7);
        const _srBtns = _lvls.map(d => {
          const canPrice = d.value != null;
          const lbl      = d.lvl.label || '?';
          if (canPrice) {
            const pct    = _btEntry > 0
              ? `${d.value >= _btEntry ? '+' : ''}${((d.value / _btEntry - 1) * 100).toFixed(0)}%`
              : '';
            return `<button class="cockpit-level-btn cockpit-oco-tp-btn" type="button"
                      data-lvl-label="${lbl}" data-lvl-price="${d.value}"
                    ><span class="oco-btn-lbl">${lbl}</span
                    ><span class="oco-btn-val">$${d.value.toFixed(2)}</span
                    ><span class="oco-btn-pct">${pct}</span></button>`;
          } else {
            return `<button class="cockpit-level-btn cockpit-oco-tp-btn" type="button"
                      data-lvl-label="${lbl}" disabled
                    ><span class="oco-btn-lbl">${lbl}</span
                    ><span class="oco-btn-val oco-btn-val--unpriced">prices at open</span></button>`;
          }
        }).join('');
        // ×1.50 fallback — always present; blank tp_price → server computes from actual fill
        const _defTp  = _btEntry > 0 ? `$${(_btEntry * _tpMult(EXIT_TP_PCT)).toFixed(2)}` : '—';
        const _defBtn = `<button class="cockpit-level-btn cockpit-oco-tp-btn cockpit-oco-tp-btn--default" type="button"
                           data-lvl-label="×1.50"
                         ><span class="oco-btn-lbl">×1.50 default</span
                         ><span class="oco-btn-val">${_defTp}</span
                         ><span class="oco-btn-pct oco-btn-pct--est">+${EXIT_TP_PCT}% est</span></button>`;

        brokerEl.innerHTML = `
          <label class="cockpit-oco-check"><input type="checkbox" id="cockpitOcoSlCheck" checked> stop-loss</label>
          <div style="display:flex;align-items:center;gap:0.28rem;margin:0.1rem 0">
            <input type="number" class="cockpit-target-input" id="cockpitOcoStopVal"
                   min="0.01" step="0.01" style="width:68px">
            <input type="number" class="cockpit-target-input" id="cockpitOcoStopPct"
                   min="1" max="99" step="1" style="width:40px" title="stop loss %">
            <span style="font-size:0.66rem;color:var(--text-muted)">%</span>
            <span class="cockpit-oco-sub" id="cockpitOcoStopSub"></span>
          </div>
          <label class="cockpit-oco-check" style="margin-top:0.16rem"><input type="checkbox" id="cockpitOcoTpCheck" checked> take-profit — pick a level</label>
          <div class="cockpit-oco-tp-list">${_srBtns}${_defBtn}</div>
          <div style="display:flex;align-items:center;gap:0.3rem;margin-top:0.1rem">
            <span class="cockpit-section-label">TP price</span>
            <input type="number" id="cockpitOcoTpInput" class="cockpit-target-input"
                   min="0.01" step="0.01" style="width:68px">
            <span id="cockpitOcoTpPct" class="cockpit-oco-tp-pct"></span>
            <span class="cockpit-tif-sub" style="flex:1">SR fills · edit to adjust</span>
          </div>
          <div class="cockpit-tif-row" style="margin-top:0.22rem">
            <span class="cockpit-section-label">tif (legs)</span>
            <span class="cockpit-field-chip">gtc</span>
            <span class="cockpit-tif-sub">level price = resting limit · ×1.50 = fill × 1.50</span>
          </div>`;
        botEl.innerHTML = '';
        if (captionEl) captionEl.style.display = '';

        // Wire click handlers — bind-time gate: return before addEventListener on disabled buttons.
        // A null-value (unpriced) level has disabled=true in HTML; no handler is ever attached.
        const tpInpEl = document.getElementById('cockpitOcoTpInput');
        brokerEl.querySelectorAll('.cockpit-oco-tp-btn').forEach(btn => {
          if (btn.disabled) return;   // bind-time gate — no handler on unpriced levels
          btn.addEventListener('click', () => {
            _setOcoDirty();
            const lbl   = btn.dataset.lvlLabel;
            const price = lbl === '×1.50' ? null : parseFloat(btn.dataset.lvlPrice);
            _ocoLvlStash = lbl;
            _ocoTpStash  = price != null ? price.toFixed(2) : null;
            if (tpInpEl) tpInpEl.value = price != null ? price.toFixed(2) : '';
            brokerEl.querySelectorAll('.cockpit-oco-tp-btn').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            _updateOcoPnl();
          });
        });

        // Direct TP field edit — clears button selection; ≤0 or blank reverts to ×1.50.
        if (tpInpEl) {
          tpInpEl.addEventListener('input', () => {
            _setOcoDirty();
            const val = parseFloat(tpInpEl.value);
            if (val > 0) {
              _ocoLvlStash = 'custom';
              _ocoTpStash  = String(val);
              brokerEl.querySelectorAll('.cockpit-oco-tp-btn').forEach(b => b.classList.remove('active'));
            } else {
              _ocoLvlStash = null;
              _ocoTpStash  = null;
              const _db = brokerEl.querySelector('.cockpit-oco-tp-btn[data-lvl-label="×1.50"]');
              if (_db) {
                brokerEl.querySelectorAll('.cockpit-oco-tp-btn').forEach(b => b.classList.remove('active'));
                _db.classList.add('active');
              }
            }
            _updateOcoPnl();
          });
        }

        // Stop price ↔ pct bidirectional listeners
        const stopValInpEl = document.getElementById('cockpitOcoStopVal');
        const stopPctInpEl = document.getElementById('cockpitOcoStopPct');
        if (stopValInpEl) {
          stopValInpEl.addEventListener('input', () => {
            _setOcoDirty();
            const price = parseFloat(stopValInpEl.value);
            const { displayPrice } = _resolveEntryPrice();
            const base = displayPrice != null ? displayPrice : (armedContract ? armedContract.ask : 0);
            if (price > 0 && base > 0) {
              const pct = Math.max(1, Math.round((1 - price / base) * 100));
              if (stopPctInpEl) stopPctInpEl.value = pct;
              _ocoStopStash = price.toFixed(2);
            } else {
              _ocoStopStash = null;
            }
            _updateOcoPnl();
          });
        }
        if (stopPctInpEl) {
          stopPctInpEl.addEventListener('input', () => {
            _setOcoDirty();
            const pct = parseFloat(stopPctInpEl.value);
            const { displayPrice } = _resolveEntryPrice();
            const base = displayPrice != null ? displayPrice : (armedContract ? armedContract.ask : 0);
            if (pct > 0 && pct < 100 && base > 0) {
              const price = +(base * (1 - pct / 100)).toFixed(2);
              if (stopValInpEl && price > 0) stopValInpEl.value = price.toFixed(2);
              _ocoStopStash = price > 0 ? price.toFixed(2) : null;
            } else {
              _ocoStopStash = null;
            }
            _updateOcoPnl();
          });
        }

        // Restore last selection; fall back to ×1.50 if previous level is now unpriced or gone.
        const _allBtns = Array.from(brokerEl.querySelectorAll('.cockpit-oco-tp-btn'));
        if (_ocoLvlStash === 'custom' && _ocoTpStash) {
          // Restore custom-typed value — no button gets active class
          if (tpInpEl) tpInpEl.value = _ocoTpStash;
        } else {
          const _matchBtn = _ocoLvlStash
            ? _allBtns.find(b => b.dataset.lvlLabel === _ocoLvlStash && !b.disabled)
            : null;
          if (_matchBtn) {
            _matchBtn.classList.add('active');
            const _rp = _matchBtn.dataset.lvlPrice;
            if (_rp && tpInpEl) tpInpEl.value = parseFloat(_rp).toFixed(2);
            _ocoTpStash = _rp ? parseFloat(_rp).toFixed(2) : null;
          } else {
            // No stash or previously selected level is now unpriced — default to ×1.50
            _ocoLvlStash = null;
            _ocoTpStash  = null;
            const _defBtnEl = _allBtns.find(b => b.dataset.lvlLabel === '×1.50');
            if (_defBtnEl) _defBtnEl.classList.add('active');
          }
        }

        _updateOcoPnl();

        // Tier 1 — both unchecked → disable Open Position (nothing to place).
        const _slChk = document.getElementById('cockpitOcoSlCheck');
        const _tpChk = document.getElementById('cockpitOcoTpCheck');
        const _syncOpenBtn = () => {
          if (_openBtn) _openBtn.disabled = !_slChk.checked && !_tpChk.checked;
        };
        if (_slChk) _slChk.addEventListener('change', () => { _setOcoDirty(); _syncOpenBtn(); });
        if (_tpChk) _tpChk.addEventListener('change', () => { _setOcoDirty(); _syncOpenBtn(); });
        _syncOpenBtn();
      }
    }
    // Let renderRrLine trigger an OCO button re-render when _rrProfitSide refreshes (30s cycle).
    // Captures this arm's _updateBrokerBotCols closure; cleared at next armContract call.
    _ocoButtonRefreshFn = () => {
      if (cockpitExitLayer !== 'oco_bracket') return;
      // Panel dirty: user is mid-form. Tick the stale-price age display but do not rebuild
      // the DOM — a background timer must not reset controls the user has touched.
      if (_ocoPanelDirty) { _setOcoDirty(); return; }
      _updateBrokerBotCols('oco_bracket');
    };

    // Target override apply
    document.getElementById('cockpitApplyTarget').addEventListener('click', () => {
      const tgt = parseFloat(document.getElementById('cockpitTarget').value);
      if (tgt > 0) {
        document.getElementById('cockpitTargetSrc').textContent = 'manual override';
        loadProjectionMatrix();
      }
    });
    // Also apply on Enter key in target input
    document.getElementById('cockpitTarget').addEventListener('keydown', e => {
      if (e.key === 'Enter') document.getElementById('cockpitApplyTarget').click();
    });

    // Cockpit refresh: re-fetch live quote then re-run matrix + payout curve
    document.getElementById('cockpitRefreshBtn').addEventListener('click', async () => {
      await refreshArmedQuote();
      loadProjectionMatrix();
      loadPayoutCurve();
    });

    // MATRIX / PAYOUT tab strip
    document.querySelectorAll('#cockpitProjTabs .cpt-tab').forEach(btn => {
      btn.addEventListener('click', () => _activateCockpitProjTab(btn.dataset.tab));
    });

    // Open Position button
    document.getElementById('chainOpenBtn').addEventListener('click', () => {
      const qty     = Math.max(1, parseInt(document.getElementById('chainQty').value, 10) || 1);
      const cpLabel = dir === 'call' ? 'CALL' : 'PUT';
      const bid     = armedContract.bid ?? 0;
      const ask     = armedContract.ask;

      // ── Spread preview (same thresholds as server: warn >40%, reject >60%) ──
      let spreadPct      = null;
      let spreadWarnHtml = '';
      if (bid > 0 && ask > 0) {
        const mid = optionMid(bid, ask);
        spreadPct = (ask - bid) / mid;
        if (spreadPct > 0.60) {
          const pct = (spreadPct * 100).toFixed(0);
          spreadWarnHtml = cockpitEntryMode === 'your_price'
            ? `<span style="color:var(--warn-amber,#fa0)">⚠ Spread ${pct}% — server guard bypassed in Your price mode. Order may rest or fill thinly.</span><br>`
            : `<span style="color:var(--danger,#e05);font-weight:600">⚠ Spread ${pct}% — server will reject this order (&gt;60% limit). Choose a different strike.</span><br>`;
        } else if (spreadPct > 0.40) {
          spreadWarnHtml = `<span style="color:var(--warn-amber,#fa0)">⚠ Wide spread ${(spreadPct * 100).toFixed(0)}% — order may not fill promptly.</span><br>`;
        }
      }

      // ── Entry limit resolution — delegates formula to _resolveEntryPrice() ─────
      const { payload: limitPricePayload, displayPrice: displayCostPrice } = _resolveEntryPrice();

      // your_price: validate that a price was actually typed before opening the modal
      if (cockpitEntryMode === 'your_price' && !(displayCostPrice > 0)) {
        const inp = document.getElementById('cockpitEntryPriceInput');
        if (inp) { inp.focus(); inp.setCustomValidity('Enter a valid premium price'); inp.reportValidity(); inp.setCustomValidity(''); }
        return;
      }

      let entryPriceHtml;
      if (cockpitEntryMode === 'auto') {
        entryPriceHtml = bid <= 0
          ? `<span style="color:var(--danger,#e05);font-weight:600">⚠ No bid — server will send a MARKET order, unbounded fill price</span>`
          : `$${displayCostPrice.toFixed(2)} (server-derived)`;
      } else if (cockpitEntryMode === 'take_ask') {
        entryPriceHtml = `$${displayCostPrice.toFixed(2)} (ask + 2% fill cushion)`;
      } else {
        entryPriceHtml = `$${displayCostPrice.toFixed(2)} (your price — may rest unfilled)`;
      }

      const costHtml = displayCostPrice != null
        ? `Est. cost: <strong>${fmtPrice(displayCostPrice * qty * 100)}</strong><br>`
        : `Est. cost: <strong>unknown — market order, no limit</strong><br>`;

      // ── Exit-layer resolution — derive from checkbox state ───────────────────
      let effectiveExitLayer = cockpitExitLayer;
      if (cockpitExitLayer === 'oco_bracket') {
        const _slChk = document.getElementById('cockpitOcoSlCheck');
        const _tpChk = document.getElementById('cockpitOcoTpCheck');
        // Missing elements default to true (full OCO) — conservative: prefer an unwanted stop
        // over silently dropping one. Log so a DOM regression is not invisible.
        if (!_slChk) console.warn('cockpitOcoSlCheck missing at OCO placement — defaulting slOn=true');
        if (!_tpChk) console.warn('cockpitOcoTpCheck missing at OCO placement — defaulting tpOn=true');
        const slOn = _slChk ? _slChk.checked : true;
        const tpOn = _tpChk ? _tpChk.checked : true;
        if      (slOn && tpOn) effectiveExitLayer = 'oco_bracket';
        else if (tpOn)         effectiveExitLayer = 'tp_only';
        else if (slOn)         effectiveExitLayer = 'stop_only';
        // neither → Tier 1 disabled the button; cannot reach here
      }

      // ── OCO / tp_only confirm-modal summary ──────────────────────────────────
      let ocoTpPayload;     // undefined → omit from body; server uses tp2_price (fill × 1.50)
      let ocoBracketHtml = '';
      if (effectiveExitLayer === 'oco_bracket') {
        const tpInp     = document.getElementById('cockpitOcoTpInput');
        const typed     = tpInp ? parseFloat(tpInp.value) : NaN;
        const derivedTp = +(ask * _tpMult(EXIT_TP_PCT)).toFixed(2);
        const derivedSl = +(ask * _slMult()).toFixed(2);
        if (typed > 0) ocoTpPayload = typed;
        const tpDisplay   = ocoTpPayload !== undefined
          ? `$${ocoTpPayload.toFixed(2)} (${_ocoLvlStash && _ocoLvlStash !== '×1.50' ? _ocoLvlStash : 'selected'})`
          : `≈$${derivedTp.toFixed(2)} (est. from ask; server uses actual fill)`;
        const stopDisplay = _ocoStopStash
          ? `$${parseFloat(_ocoStopStash).toFixed(2)} (manual)`
          : `≈$${derivedSl.toFixed(2)} (est. from ask; server uses actual fill)`;
        ocoBracketHtml =
          `OCO bracket: TP <strong>${tpDisplay}</strong>, ` +
          `Stop <strong>${stopDisplay}</strong><br>`;
      } else if (effectiveExitLayer === 'tp_only') {
        const tpInp     = document.getElementById('cockpitOcoTpInput');
        const typed     = tpInp ? parseFloat(tpInp.value) : NaN;
        const derivedTp = +(ask * _tpMult(EXIT_TP_PCT)).toFixed(2);
        if (typed > 0) ocoTpPayload = typed;
        const tpDisplay = ocoTpPayload !== undefined
          ? `$${ocoTpPayload.toFixed(2)} (${_ocoLvlStash && _ocoLvlStash !== '×1.50' ? _ocoLvlStash : 'selected'})`
          : `≈$${derivedTp.toFixed(2)} (est. from ask; server uses actual fill)`;
        ocoBracketHtml = `TP limit resting at broker: <strong>${tpDisplay}</strong> — no stop<br>`;
      }

      showConfirmModal({
        title:   `Open ${chainTicker} ${cpLabel}`,
        body:    spreadWarnHtml +
                 `<strong>${sym}</strong><br>` +
                 `Qty: <strong>${qty}</strong> contract${qty > 1 ? 's' : ''}<br>` +
                 `Entry limit: <strong>${entryPriceHtml}</strong><br>` +
                 costHtml +
                 ocoBracketHtml +
                 `<br>` +
                 `<span style="color:var(--text-muted);font-size:0.68rem">` +
                 `Gated by kill-switch. Order goes to your active env (verify sandbox before first live use).</span>`,
        okLabel: 'Place Order',
        okClass: '',
        onOk: async (setStatus) => {
          // Block: no bid in AUTO mode → would send unbounded market order
          if (cockpitEntryMode === 'auto' && bid <= 0) {
            setStatus(
              '⚠ No bid — refusing to send a market order on an illiquid contract. ' +
              'Switch to Your price mode to set a limit, or choose a different strike.',
              'error',
            );
            return;
          }
          // Block: spread >60% in AUTO/take_ask — server rejects, spare the round-trip
          if (spreadPct !== null && spreadPct > 0.60 && cockpitEntryMode !== 'your_price') {
            setStatus(
              `Spread ${(spreadPct * 100).toFixed(0)}% exceeds 60% server limit — order would be rejected. ` +
              'Choose a different strike or use Your price mode.',
              'error',
            );
            return;
          }

          setStatus('Placing order…');
          try {
            const body = {
              ticker:        chainTicker,
              option_symbol: armedContract.symbol,
              direction:     dir,
              strike:        armedContract.strike,
              expiry:        armedContract.expiration,
              qty,
              bid_price:     ask,
              tif:           _tif,
            };
            if (limitPricePayload !== undefined) {
              body.limit_price = limitPricePayload;
            }
            if (effectiveExitLayer !== 'default') {
              body.exit_layer = effectiveExitLayer;
            }
            if (ocoTpPayload !== undefined) {
              body.tp_price = ocoTpPayload;
            }
            if ((effectiveExitLayer === 'oco_bracket' || effectiveExitLayer === 'stop_only') && _ocoStopStash) {
              body.stop_price = parseFloat(_ocoStopStash);
            }
            const result = await apiPost('/api/v1/orders/open', body);

            if (result.status === 'filled') {
              const priceStr = result.resolved_limit_price != null
                ? `$${result.resolved_limit_price.toFixed(2)}`
                : result.fill_price != null ? `$${result.fill_price.toFixed(2)}` : '';
              _clearOcoDirty();
              setStatus(
                `Filled${priceStr ? ` @ ${priceStr}` : ''} · position_id ${result.position_id}`,
                'ok',
              );
            } else if (result.status === 'working') {
              const priceStr = result.limit_price != null
                ? ` at $${result.limit_price.toFixed(2)}`
                : '';
              setStatus(
                `Resting${priceStr} — will register when filled. ` +
                'Check Working Orders to monitor or cancel.',
                'ok',
              );
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

    // Auto-refresh quote then load projection matrix + payout curve on arm
    await refreshArmedQuote();
    loadProjectionMatrix();
    loadPayoutCurve();
  }

  // Resolves the entry limit price from current cockpitEntryMode and armedContract.
  // Single source of truth for the formula — called by _updateEntryDisplay and the Open button.
  // Mirrors the server gate at trading.py:554: AUTO omits limit_price → gate = bid_price (=ask);
  // take_ask/your_price send limit_price → gate = that value. Update here if server changes.
  function _resolveEntryPrice() {
    if (!armedContract) return { payload: undefined, displayPrice: null, gatePrice: null };
    const ask = armedContract.ask;
    const bid = armedContract.bid ?? 0;
    if (cockpitEntryMode === 'auto') {
      if (bid <= 0) return { payload: undefined, displayPrice: null, gatePrice: ask };
      const mid     = optionMid(bid, ask);
      const derived = Math.min(ask * 1.02, mid * 1.08);
      return { payload: undefined, displayPrice: derived, gatePrice: ask };
    } else if (cockpitEntryMode === 'take_ask') {
      const p = ask * 1.02;
      return { payload: p, displayPrice: p, gatePrice: p };
    } else {
      const inp   = document.getElementById('cockpitEntryPriceInput');
      const typed = inp ? parseFloat(inp.value) : NaN;
      if (!(typed > 0)) return { payload: undefined, displayPrice: null, gatePrice: null };
      return { payload: typed, displayPrice: typed, gatePrice: typed };
    }
  }

  // Updates resolved price, bid/ask, cost, max loss (entry × 30% × qty × 100), B/E, and
  // the spend gate warning. Called on: mode change, your_price input, qty change, quote refresh.
  // Accessible at outer-closure scope so refreshArmedQuote can call it directly.
  function _updateEntryDisplay() {
    if (!armedContract) return;
    const { displayPrice, gatePrice } = _resolveEntryPrice();
    const qty    = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
    const ask    = armedContract.ask;
    const bid    = armedContract.bid ?? 0;
    const isCall = armedContract.bias === 'bullish';
    const strike = parseFloat(armedContract.strike) || 0;
    const ticker = chainTicker || '';

    const priceEl = document.getElementById('cockpitResolvedPrice');
    if (priceEl) {
      priceEl.textContent = displayPrice != null
        ? `$${displayPrice.toFixed(2)}`
        : (cockpitEntryMode === 'auto' && bid <= 0 ? 'no bid' : '—');
    }

    const baEl = document.getElementById('cockpitBidAskDisplay');
    if (baEl) {
      baEl.textContent = bid > 0
        ? `bid ${bid.toFixed(2)} / ask ${ask.toFixed(2)}`
        : `ask ${ask.toFixed(2)}`;
    }

    const costEl    = document.getElementById('chainCost');
    const maxLossEl = document.getElementById('chainMaxLoss');
    const gapsEl    = document.getElementById('cockpitCostIfGaps');
    const beEl      = document.getElementById('cockpitBE');
    const beSubEl   = document.getElementById('cockpitBESub');

    if (displayPrice != null && displayPrice > 0) {
      const cost    = displayPrice * qty * 100;
      // Max loss = what you lose if stop fills at entry × 0.70 → (entry − stop) × qty × 100
      const maxLoss = displayPrice * 0.30 * qty * 100;
      const be      = isCall ? strike + displayPrice : strike - displayPrice;
      if (costEl)    costEl.textContent    = fmtPrice(cost);
      if (maxLossEl) maxLossEl.textContent = fmtPrice(maxLoss);
      if (gapsEl)    gapsEl.textContent    = ` · ${fmtPrice(cost)} if it gaps`;
      if (beEl)      beEl.textContent      = `$${be.toFixed(2)}`;
      if (beSubEl)   beSubEl.textContent   = ticker ? `${ticker} at expiry` : '';
    } else {
      if (costEl)    costEl.textContent    = fmtPrice(ask * qty * 100);
      if (maxLossEl) maxLossEl.textContent = '—';
      if (gapsEl)    gapsEl.textContent    = '';
      if (beEl)      beEl.textContent      = '—';
      if (beSubEl)   beSubEl.textContent   = '';
    }

    // Spend gate mirrors trading.py:554: AUTO gates on ask; take_ask/your_price gate on limit.
    // Must be updated if trading.py:554 changes.
    const gateCost = gatePrice != null ? gatePrice * qty * 100 : ask * qty * 100;
    _updateSummaryRisk(gateCost);

    // R:R line also depends on displayPrice — refresh it if matrix data is ready.
    if (matrixProjCache) {
      renderRrLine(matrixProjCache.levels, matrixProjCache.projResults, qty);
    }
    if (payoutCurveCache && _onPayoutTab()) {
      renderPayoutCurve(payoutCurveCache, qty);
    }
  }

  // Evaluates whether gate cost exceeds risk_left and styles the summary row accordingly.
  // Promoted to outer-closure scope so _updateEntryDisplay and future callers don't need
  // an inline twin in refreshArmedQuote.
  function _updateSummaryRisk(gateCost) {
    const riskEl = document.getElementById('cockpitSumRisk');
    const rowEl  = document.getElementById('cockpitSumRiskRow');
    if (!riskEl || !rowEl) return;
    if (lastRiskLeft == null) {
      riskEl.textContent = '—';
      rowEl.classList.remove('cockpit-summary-warn');
      return;
    }
    const overBudget = gateCost != null && gateCost > lastRiskLeft;
    rowEl.classList.toggle('cockpit-summary-warn', overBudget);
    riskEl.textContent = overBudget
      ? '$' + lastRiskLeft.toFixed(0) + ' — spend gate will reject'
      : '$' + lastRiskLeft.toFixed(0);
  }

  // Re-fetches the live quote for the armed contract from /api/chain/quote.
  // Updates armedContract.ask / .iv / .dte in place so subsequent projection
  // calls and the Open button use fresh data.
  async function refreshArmedQuote() {
    if (!armedContract || !chainTicker) return;
    if (_armedQuoteRefreshing) return;
    _armedQuoteRefreshing = true;
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

      // Refresh day_range + OHLC split so ATR bar and Rem ATR column stay current.
      if (fresh.day_range   != null) chainDayRange    = fresh.day_range;
      if (fresh.day_open    != null) chainDayOpen     = fresh.day_open;
      if (fresh.day_high    != null) chainDayHigh     = fresh.day_high;
      if (fresh.day_low     != null) chainDayLow      = fresh.day_low;
      // Live underlying — null pre-market or on fetch failure; leave chainCurrentPrice unchanged then.
      if (fresh.underlying  != null) chainCurrentPrice = fresh.underlying;
      if (focusedTicker) renderLevels(focusedTicker);

      // Update in-place so qty handler and Open button use fresh ask/bid
      armedContract.bid = fresh.bid;
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

      // Refresh all display fields (resolved price, bid/ask, cost, max loss, B/E, spend gate)
      _updateEntryDisplay();
      // Refresh OCO P&L sub-labels if OCO bracket is active
      if (cockpitExitLayer === 'oco_bracket') _updateOcoPnl();
    } catch (_) {
      if (ageEl) ageEl.textContent = ' · refresh failed';
    } finally {
      _armedQuoteRefreshing = false;
    }
  }

  // Promoted to outer-closure scope so refreshArmedQuote and _updateBrokerBotCols (inner)
  // both reach it without a shim. Only reads module-level variables and DOM elements.
  function _updateOcoPnl() {
    // Use resolved limit as base so stop/TP estimates match max loss and cost.
    // Falls back to ask only when displayPrice is null (AUTO with no bid).
    const { displayPrice } = _resolveEntryPrice();
    const curBase = displayPrice != null ? displayPrice : (armedContract ? armedContract.ask : 0);

    // Seed stop inputs before the PnL guard. PnL labels need curBase>0 (bid required for the
    // midpoint path), but the price/pct fields only need any non-zero ask — which is present
    // from chain data at arm time, even if bid hasn't loaded yet. refreshArmedQuote() also
    // calls _updateOcoPnl() after the fresh ask arrives, so a late-loading ask still re-seeds.
    const seedBase  = curBase > 0 ? curBase : (armedContract ? armedContract.ask : 0);
    const sl        = _ocoStopStash
      ? parseFloat(_ocoStopStash)
      : seedBase > 0 ? +(seedBase * _slMult()).toFixed(2) : 0;
    const stopValEl = document.getElementById('cockpitOcoStopVal');
    const stopPctEl = document.getElementById('cockpitOcoStopPct');
    if (seedBase > 0) {
      if (stopValEl && document.activeElement !== stopValEl) stopValEl.value = sl.toFixed(2);
      if (stopPctEl && document.activeElement !== stopPctEl)
        stopPctEl.value = Math.max(1, Math.round((1 - sl / seedBase) * 100));
    }

    if (curBase <= 0) return;
    const qty       = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
    const tpInp     = document.getElementById('cockpitOcoTpInput');
    const tpVal     = tpInp ? parseFloat(tpInp.value) : 0;
    const tp        = tpVal > 0 ? tpVal : +(curBase * _tpMult(EXIT_TP_PCT)).toFixed(2);
    const slPnl     = Math.round((sl - curBase) * qty * 100);
    const tpPnl     = Math.round((tp - curBase) * qty * 100);
    const tpPct     = Math.round((tp / curBase - 1) * 100);
    const stopSubEl = document.getElementById('cockpitOcoStopSub');
    const tpSubEl   = document.getElementById('cockpitOcoTpSub');
    if (stopSubEl) stopSubEl.textContent = `est −$${Math.abs(slPnl)}`;
    if (tpSubEl) {
      const pctStr = tpPct >= 0 ? `+${tpPct}%` : `−${Math.abs(tpPct)}%`;
      const dolStr = tpPnl >= 0 ? `+$${tpPnl}` : `−$${Math.abs(tpPnl)}`;
      tpSubEl.textContent = `${pctStr} · est ${dolStr}`;
      tpSubEl.style.color = tpPnl < 0 ? 'var(--danger, #ef4444)' : '';
    }
    const tpPctEl = document.getElementById('cockpitOcoTpPct');
    if (tpPctEl) {
      const rawVal = tpInp ? tpInp.value : '';
      if (rawVal && parseFloat(rawVal) > 0 && curBase > 0) {
        const pct = Math.round((parseFloat(rawVal) / curBase - 1) * 100);
        tpPctEl.textContent = pct >= 0 ? `+${pct}%` : `${pct}%`;
        tpPctEl.style.color = pct >= 0 ? '#22c55e' : 'var(--danger, #ef4444)';
      } else {
        tpPctEl.textContent = '';
      }
    }
  }

  // Mirror of trading.py:698-699. If those change, this must change with them.
  // tp_pct=50 / sl_pct=30 are the server's authoritative values; these are the
  // client-side derivations of the same numbers for display estimates only.
  // The server derives the real legs from the actual FILL, not from these.
  const EXIT_TP_PCT = 50;
  const EXIT_SL_PCT = 30;
  const _slMult  = ()    => 1 - EXIT_SL_PCT / 100;        // 0.70
  const _tpMult  = (pct) => 1 + pct / 100;                // 1.50 at pct=EXIT_TP_PCT

  // Confluence tolerance for display-only level merging (not a scored input).
  const CONFLUENCE_TOLERANCE_PCT = 0.0020; // 0.20% of price

  // Shared by renderProjectionMatrix (REM ATR column) and renderRrLine (S/R filter).
  // Returns null when ATR data absent (neutral — show all), Infinity when exhausted (all dim).
  function _remAtrDemand(lvlPrice) {
    if (!chainAtr || chainAtr <= 0 || chainDayRange == null) return null;
    const rem = Math.max(0, chainAtr - chainDayRange);
    if (chainDayRange / chainAtr >= 0.95 || rem <= 0) return Infinity;
    return Math.abs(lvlPrice - chainCurrentPrice) / rem * 100;
  }

  // Mirror of build_tiers() in tradebot/core/exit_strategy.py:45-75.
  // Display estimate only — the server rebuilds tiers from the actual fill.
  // qty 1 returns [] by design: tp1 collapses into tp2, no scale-out.
  function _buildTiersMirror(qty, entryPrice) {
    function _tier(n, pct) {
      return { n, pct, price: +(entryPrice * _tpMult(pct)).toFixed(2) };
    }
    if (qty === 1)  return [];
    if (qty === 2)  return [_tier(1, EXIT_TP_PCT * 0.5)];
    if (qty === 3)  return [_tier(1, EXIT_TP_PCT * 0.5), _tier(1, EXIT_TP_PCT)];
    if (qty === 4)  return [_tier(1, EXIT_TP_PCT * 0.5), _tier(1, EXIT_TP_PCT * 0.75), _tier(1, EXIT_TP_PCT)];
    if (qty === 5)  return [_tier(1, EXIT_TP_PCT * 0.5), _tier(1, EXIT_TP_PCT * 0.75), _tier(1, EXIT_TP_PCT)];
    if (qty === 6)  return [_tier(2, EXIT_TP_PCT * 0.5), _tier(2, EXIT_TP_PCT)];
    const n = Math.floor(qty / 3);
    return [_tier(n, EXIT_TP_PCT * 0.5), _tier(n, EXIT_TP_PCT)];
  }

  // Shared by renderRrLine (S/R ticks) and renderProjectionMatrix (LEVEL column).
  // Source of truth: loadProjectionMatrix label strings — see ABBREV map below.
  const ABBREV = {
    'All-time high':  'ATH',  '52-week high':   '52wH', 'Prior-day high': 'PDH',
    'Overhead 1':     'OH1',  'Overhead 2':     'OH2',  'Overhead 3':     'OH3',
    'Underfoot 1':    'UF1',  'Underfoot 2':    'UF2',  'Underfoot 3':    'UF3',
    'Round above':    '',     'Round below':    '',
    'Prior-day low':  'PDL',  'All-time low':   'ATL',  '52-week low':    '52wL',
    'Call Wall':      'C/W',  'Magnet':         'MAG',  'Put Wall':       'P/W',
    'Target':         'TGT',  'Current':        'CUR',  'Strike':         'K',
    'Breakeven':      'B/E',
  };
  function srAbbrev(lvl) {
    if (lvl.srLabel !== undefined)
      return [ABBREV[lvl.srLabel], ABBREV[lvl.gexLabel]].filter(Boolean).join('+');
    return Object.prototype.hasOwnProperty.call(ABBREV, lvl.label) ? ABBREV[lvl.label] : '';
  }

  // Colour a structural/marker level by role. Shared by renderRrLine and renderProjectionMatrix.
  // Callers must map their own field names to (role, stockPrice) explicitly.
  // Strip palette (css/dashboard.css): support #26a69a · resistance #ef5350 · fused #94a3b8.
  function srColor(role, stockPrice) {
    if (role === 'resistance')  return '#ef5350';   // strip red
    if (role === 'support')     return '#26a69a';   // strip teal-green
    if (role === 'current')     return '#2a78d6';
    if (role === 'strike')      return '#9085e9';
    if (role === 'breakeven')   return '#eda100';
    if (role === 'round')       return stockPrice > chainCurrentPrice ? '#1baf7a' : '#64748b';
    if (role === 'call_wall' || role === 'magnet' || role === 'put_wall')
                                return '#94a3b8';   // strip fused gray — GEX, not structural S/R
    return 'var(--text-muted)';                     // unhandled role — reads as absent
  }

  // Assigns item.stagger (bool) for items sorted by ascending x-position.
  // Any adjacent pair closer than minGapPx pixels alternates between stagger=false and true.
  // Resets to false after any gap >= minGapPx. Shared by renderRrLine and renderPayoutCurve.
  function _assignStagger(items, getX, minGapPx) {
    if (minGapPx == null) minGapPx = 60;
    let prevX = -Infinity, flip = false;
    items.forEach(item => {
      const x = getX(item);
      if (x - prevX < minGapPx) { flip = !flip; item.stagger = flip; }
      else                      { flip = false;  item.stagger = false; }
      prevX = x;
    });
  }

  // Maximum ATR demand % for a level to extend the axis.  Controls axis width only —
  // visibility is decided by the resulting [minP, maxP] bounds.
  const REACH_PCT = 100;

  // Renders the R:R premium number line between #cockpitAtrBanner and #cockpitProjWrap.
  // Reads matrixProjCache for below-axis S/R levels; derives exits from _resolveEntryPrice().
  // No fetch — updates whenever renderProjectionMatrix updates, same data, same moment.
  // 0DTE caveat: below-axis option prices are intrinsic only (projection endpoint T≤0 guard).
  function renderRrLine(levels, projResults, qty) {
    const el = document.getElementById('cockpitRrLine');
    if (!el) return;
    if (!levels || !projResults) { el.style.display = 'none'; return; }

    // ── Pre-compute projection values — needed for SR-based TP selection ─────
    // Hoisted above displayPrice gate: _lvlStock needs only levels/projResults/
    // chainCurrentPrice — no bid. OCO buttons populate pre-session (bid unavailable).
    const _asOfEl = document.getElementById('cockpitPayoutAsOf');
    const _hIdx   = _asOfEl ? (parseInt(_asOfEl.value, 10) || 0) : 0;
    const _lvlStock = levels.map((lvl, i) => {
      if (!lvl.price) return null;
      const _pr = projResults[i];
      const _nr = _pr && _pr.rows && _pr.rows[_hIdx];
      const value = (_nr && _nr.value != null) ? _nr.value : null;
      return { lvl, value, demand: _remAtrDemand(lvl.price) };
    }).filter(Boolean);
    // Tier 2: subset with a projection value — session-gated.
    const _lvlValued = _lvlStock.filter(d => d.value != null);

    // ── SR-based TP selection ─────────────────────────────────────────────────
    const _optType = armedContract
      ? (armedContract.option_type || (armedContract.bias === 'bullish' ? 'call' : 'put'))
      : 'call';
    const _isCall = _optType === 'call';

    // Profit-side structural levels, nearest first; exclude marker roles (Current, Strike, etc.).
    // Uses _lvlStock so SR levels resolve even pre-session when projection values are null.
    const _profitSide = _lvlStock
      .filter(d => d.lvl.type !== 'marker'
        && (_isCall ? d.lvl.price > chainCurrentPrice : d.lvl.price < chainCurrentPrice))
      .sort((a, b) => _isCall
        ? a.lvl.price - b.lvl.price    // ascending for calls — nearest overhead first
        : b.lvl.price - a.lvl.price);  // descending for puts — nearest underfoot first
    // Expose to OCO panel; call refresh hook so buttons update on every renderRrLine (incl. 30s).
    _rrProfitSide = _profitSide;
    if (_ocoButtonRefreshFn) _ocoButtonRefreshFn();

    const { displayPrice } = _resolveEntryPrice();
    if (!displayPrice || displayPrice <= 0) {
      const reason = cockpitEntryMode === 'auto'
        ? 'No bid — switch to Ask or Your Price to see R:R line'
        : '';
      if (reason) {
        el.innerHTML = `<div class="rrl-no-price">${reason}</div>`;
        el.style.display = '';
      } else {
        el.style.display = 'none';
      }
      return;
    }

    const entry  = displayPrice;
    const sl     = +(entry * _slMult()).toFixed(2);
    const rDenom = entry - sl;

    function fmtR(price) {
      if (rDenom <= 0) return '';
      const r = (price - entry) / rDenom;
      return (r >= 0 ? '+' : '') + r.toFixed(1) + 'R';
    }

    const _tp1Cand = _profitSide[0] || null;
    const _tp1Val  = _tp1Cand ? _tp1Cand.value : null;
    // TP2: when values exist, require ≥1.20× TP1 option value to skip same-shelf levels.
    // When values are null (pre-session), fall back to second-nearest by stock proximity.
    const _tp2Cand = _tp1Cand
      ? (_tp1Val != null
          ? (_profitSide.slice(1).find(d => d.value != null && d.value >= _tp1Val * 1.20) || null)
          : (_profitSide[1] || null))
      : null;

    // Linear interpolation of option value at an arbitrary stock price from existing projections.
    // Used only for ATR-reach fallback — no new fetches required.
    function _interpOptVal(stockTarget) {
      const pts = [..._lvlValued].sort((a, b) => a.lvl.price - b.lvl.price);
      if (!pts.length) return null;
      if (stockTarget <= pts[0].lvl.price) return pts[0].value;
      if (stockTarget >= pts[pts.length - 1].lvl.price) return pts[pts.length - 1].value;
      for (let i = 0; i < pts.length - 1; i++) {
        if (stockTarget <= pts[i + 1].lvl.price) {
          const t = (stockTarget - pts[i].lvl.price) / (pts[i + 1].lvl.price - pts[i].lvl.price);
          return +(pts[i].value + t * (pts[i + 1].value - pts[i].value)).toFixed(2);
        }
      }
      return pts[pts.length - 1].value;
    }

    // Inverse: option value → approximate stock price. Sorts by value ascending (call: price
    // asc gives value asc; put: price asc gives value desc so sort by value directly).
    function _invInterpStk(optTarget) {
      const pts = [..._lvlValued].sort((a, b) => a.value - b.value);
      if (!pts.length) return null;
      if (optTarget <= pts[0].value) return pts[0].lvl.price;
      if (optTarget >= pts[pts.length - 1].value) return pts[pts.length - 1].lvl.price;
      for (let i = 0; i < pts.length - 1; i++) {
        if (optTarget <= pts[i + 1].value) {
          const dv = pts[i + 1].value - pts[i].value;
          if (dv === 0) return pts[i].lvl.price;
          const t = (optTarget - pts[i].value) / dv;
          return +(pts[i].lvl.price + t * (pts[i + 1].lvl.price - pts[i].lvl.price)).toFixed(2);
        }
      }
      return pts[pts.length - 1].lvl.price;
    }

    const _atrReach1Stk = chainAtr && chainCurrentPrice
      ? (_isCall ? chainCurrentPrice + chainAtr : chainCurrentPrice - chainAtr)
      : null;
    const _atrReach2Stk = chainAtr && chainCurrentPrice
      ? (_isCall ? chainCurrentPrice + 2 * chainAtr : chainCurrentPrice - 2 * chainAtr)
      : null;

    // Resolve TP1 / TP2 with fallback ladder:
    //   2 SR levels ≥1.20× apart  → both SR (price may be null pre-session)
    //   1 SR level                 → TP1 SR; TP2 +1 ATR only when TP1 is priced AND +1 ATR ≥1.20× TP1
    //   0 SR levels                → TP1 +1 ATR; TP2 +2 ATR only when +2 ATR ≥1.20× +1 ATR
    // price=null means SR is identified by stock position but option value unavailable.
    let _tp1 = null, _tp2 = null;
    if (_tp1Cand && _tp2Cand) {
      _tp1 = { price: _tp1Cand.value != null ? +_tp1Cand.value.toFixed(2) : null, abbr: srAbbrev(_tp1Cand.lvl) || _tp1Cand.lvl.label, stockPrice: _tp1Cand.lvl.price };
      _tp2 = { price: _tp2Cand.value != null ? +_tp2Cand.value.toFixed(2) : null, abbr: srAbbrev(_tp2Cand.lvl) || _tp2Cand.lvl.label, stockPrice: _tp2Cand.lvl.price };
    } else if (_tp1Cand) {
      _tp1 = { price: _tp1Cand.value != null ? +_tp1Cand.value.toFixed(2) : null, abbr: srAbbrev(_tp1Cand.lvl) || _tp1Cand.lvl.label, stockPrice: _tp1Cand.lvl.price };
      if (_tp1.price != null) {
        const _v = _atrReach1Stk ? _interpOptVal(_atrReach1Stk) : null;
        // Same 1.20× floor as SR path: skip ATR TP2 when it's not a meaningfully higher exit.
        if (_v != null && _v >= _tp1.price * 1.20) _tp2 = { price: +_v.toFixed(2), abbr: '+1 ATR', stockPrice: _atrReach1Stk };
      }
    } else {
      const _v1 = _atrReach1Stk ? _interpOptVal(_atrReach1Stk) : null;
      const _v2 = _atrReach2Stk ? _interpOptVal(_atrReach2Stk) : null;
      if (_v1) _tp1 = { price: +_v1.toFixed(2), abbr: '+1 ATR', stockPrice: _atrReach1Stk };
      // TP2 only when +2 ATR is a meaningfully different exit — same 1.20× floor as SR path.
      if (_v2 != null && _v1 != null && _v2 >= _v1 * 1.20) _tp2 = { price: +_v2.toFixed(2), abbr: '+2 ATR', stockPrice: _atrReach2Stk };
    }

    // Scale-out: mirror build_tiers' first-tier count (exit_strategy.py:61-75).
    // qty 2-5 → 1; qty 6 → 2; qty ≥ 7 → qty // 3. Runner rides to TP2.
    // Both prices must be non-null — can't scale out if either exit can't be positioned.
    const _tp1N = (_tp1 && _tp1.price != null && _tp2 && _tp2.price != null && qty > 1)
      ? (qty <= 5 ? 1 : qty === 6 ? 2 : Math.floor(qty / 3))
      : 0;
    const _runner = qty - _tp1N;

    // ── Above-axis exit dots — displayLabel is the SR level name (no TP1·prefix) ──
    // _unpricedTpEdge: SR target identified by stock level but no option value yet.
    // Rendered as right-edge marker ("prices at open"), NOT placed on the premium axis.
    let _unpricedTpEdge = null;
    const exitDots = [];
    exitDots.push({ price: sl,    label: 'STOP',  role: 'stop',  mult: _slMult(),         stockPrice: _invInterpStk(sl),  displayLabel: 'STOP'  });
    exitDots.push({ price: entry, label: 'ENTRY', role: 'entry',                           stockPrice: chainCurrentPrice,  displayLabel: 'ENTRY' });
    if (_tp1N > 0 && _tp1) {
      exitDots.push({ price: _tp1.price, label: 'TP1', role: 'tp',   n: _tp1N,   srLabel: _tp1.abbr, stockPrice: _tp1.stockPrice, displayLabel: _tp1.abbr });
    }
    if (_tp2 && _tp2.price != null) {
      exitDots.push({ price: _tp2.price, label: _tp1N > 0 ? 'TP2' : 'EXIT', role: _tp1N > 0 ? 'tp' : 'exit', n: _runner, srLabel: _tp2.abbr, stockPrice: _tp2.stockPrice, displayLabel: _tp2.abbr });
    } else if (_tp1 && _tp1.price != null) {
      exitDots.push({ price: _tp1.price, label: 'EXIT', role: 'exit', n: _runner, srLabel: _tp1.abbr, stockPrice: _tp1.stockPrice, displayLabel: _tp1.abbr });
    } else if (_tp1 && _tp1.price == null) {
      // SR level known by stock position, option value pending — edge marker, not axis dot.
      _unpricedTpEdge = { abbr: _tp1.abbr, stockPrice: _tp1.stockPrice };
    } else {
      // Ultimate fallback: genuinely no SR levels on trade direction (no srLevelsCache, brand-new ticker).
      exitDots.push({ price: +(entry * _tpMult(EXIT_TP_PCT)).toFixed(2), label: 'EXIT', role: 'exit', n: qty, mult: _tpMult(EXIT_TP_PCT), srLabel: '\xd71.50', stockPrice: null, displayLabel: 'EXIT' });
    }

    const lastExit = exitDots[exitDots.length - 1];

    // ── TP2 on-scale gate — stock-price space ────────────────────────────────
    // TP2 runner blows domain if its SR level is deep OTM. Gate: on-scale when stock
    // price is within 2 ATR of spot. qty=1 → _tp2IsRunner=false → always on-scale.
    const _tp2IsRunner = _tp2 != null && _tp1N > 0;
    const _tp2OnScale  = _tp2IsRunner
      ? (_tp2.stockPrice != null && (chainAtr
          ? (_isCall ? _tp2.stockPrice <= chainCurrentPrice + 2 * chainAtr
                     : _tp2.stockPrice >= chainCurrentPrice - 2 * chainAtr)
          : true))
      : true;

    // ── §0 Stock-price domain ──────────────────────────────────────────────────
    // x-axis is always low→high left→right; direction emerges from stock positions.
    const _spot = chainCurrentPrice;

    // Day origin: real session open when available; proxy (spot − dayRange) otherwise.
    // Used as the anchor for ATR zone marks and the ATR-consumed glow — keeps both
    // on the same reference point so "now 77%" falls between the 0.75 and 1.0 marks.
    const _dayOrigin = chainDayOpen != null
      ? chainDayOpen
      : (chainDayRange != null && chainDayRange >= 0
         ? (_isCall ? _spot - chainDayRange : _spot + chainDayRange)
         : null);

    // Zone anchor: day origin when session data exists (zones agree with consumed % + glow);
    // falls back to spot post/pre-session (static "N ATR from here" ladder — no consumed
    // reading exists, so no glow either, but the marks still render).
    const _zoneAnchor   = _dayOrigin ?? _spot;
    const _spotAnchored = _dayOrigin == null;   // true → labels get + prefix

    const _atr075Stk = chainAtr && _zoneAnchor
      ? (_isCall ? _zoneAnchor + 0.75 * chainAtr : _zoneAnchor - 0.75 * chainAtr) : null;
    const _atr100Stk = chainAtr && _zoneAnchor
      ? (_isCall ? _zoneAnchor + 1.0  * chainAtr : _zoneAnchor - 1.0  * chainAtr) : null;
    // _atr150Stk remains spot-relative — used only as an SR-level viewport clip, not a zone mark.
    const _atr150Stk = chainAtr && _spot
      ? (_isCall ? _spot + 1.5  * chainAtr : _spot - 1.5  * chainAtr) : null;

    // Profit-side SR/cloud split: within 1.5 ATR → dots; beyond → edge markers
    const _srOnScale  = _profitSide.filter(d =>
      _atr150Stk == null || (_isCall ? d.lvl.price <= _atr150Stk : d.lvl.price >= _atr150Stk));
    const _srOffScale = _profitSide.filter(d => !_srOnScale.includes(d));

    // Domain: seed from all plotted stock positions
    const _stopStk = exitDots.find(d => d.role === 'stop')?.stockPrice ?? null;
    const _domainPts = [_spot];
    if (_stopStk != null) {
      _domainPts.push(_stopStk);
    } else if (_spot && chainAtr) {
      // Provide minimal visual room on loss side when STOP stock price is unavailable
      _domainPts.push(_isCall ? _spot - 0.5 * chainAtr : _spot + 0.5 * chainAtr);
    }
    if (_atr100Stk != null) _domainPts.push(_atr100Stk);
    exitDots.filter(d => d.label !== 'TP2' || _tp2OnScale)
      .forEach(d => { if (d.stockPrice != null) _domainPts.push(d.stockPrice); });
    _srOnScale.forEach(d => _domainPts.push(d.lvl.price));
    if (chainDayOpen != null) _domainPts.push(chainDayOpen);

    const _minStk  = Math.min(..._domainPts);
    const _maxStk  = Math.max(..._domainPts);
    const _stkPad  = (_maxStk - _minStk) * 0.18;
    const minStkP  = Math.max(0, _minStk - _stkPad);
    const maxStkP  = _maxStk + _stkPad;
    const stkSpan  = maxStkP - minStkP || 1;

    // SVG sizing — dots below axis (4-line stacks), above-axis zone labels + now/open.
    // AXIS_Y=40: now/open at AXIS_Y-30 (y=10); ATR 3-stack at AXIS_Y-20/-10/-2 (y=20/30/38).
    // Labels bottom at AXIS_Y+47=87; stagger +18 → 105; bottom margin → SVG_H=116.
    const _ps = window.getComputedStyle(el.parentElement);
    const W = Math.round(
      el.parentElement.clientWidth
      - parseFloat(_ps.paddingLeft)
      - parseFloat(_ps.paddingRight)
    );
    const SVG_H = 116, AXIS_Y = 40;
    function toX(stockPrice) { return (stockPrice - minStkP) / stkSpan * W; }

    // ATR gauge (unchanged — used by now-marker label and footer)
    const _gaugeAtrRatio  = (chainAtr > 0 && chainDayRange != null) ? chainDayRange / chainAtr : null;
    const _gaugeExhausted = _gaugeAtrRatio !== null && _gaugeAtrRatio >= 1;
    const _atrConsumedPct = _gaugeAtrRatio !== null ? _gaugeAtrRatio * 100 : null;

    const DOT_COLOR = { stop: '#ef4444', entry: '#2a78d6', tp: '#22c55e', exit: '#22c55e' };

    // Edge-aware label position: switches text-anchor to start/end within EDGE_PAD px of
    // either side so centered labels don't clip. Applies to all above- and below-axis text.
    const EDGE_PAD = 38;
    function lblPos(x) {
      if (x < EDGE_PAD) return { lx: Math.max(4, x), anchor: 'start' };
      if (x > W - EDGE_PAD) return { lx: Math.min(W - 4, x), anchor: 'end' };
      return { lx: x, anchor: 'middle' };
    }

    const svgParts  = [];

    // ── §1 Background ATR zones (rects behind everything) ─────────────────────
    if (_spot > 0) {
      const _spotX     = toX(_spot);
      const _profEdgeX = toX(_isCall ? maxStkP : minStkP);
      const _x075      = _atr075Stk != null ? toX(_atr075Stk) : null;
      const _x100      = _atr100Stk != null ? toX(_atr100Stk) : null;

      // Neutral (spot → 0.75 ATR, profit direction)
      const _nEnd = _x075 ?? _profEdgeX;
      const [_nL, _nR] = _isCall ? [_spotX, _nEnd] : [_nEnd, _spotX];
      if (_nR > _nL) svgParts.push(`<rect x="${_nL.toFixed(1)}" y="0" width="${(_nR - _nL).toFixed(1)}" height="${SVG_H}" fill="#1e293b" opacity="0.20"/>`);

      // Amber (0.75 → 1.0 ATR)
      if (_x075 != null && _x100 != null) {
        const [_aL, _aR] = _isCall ? [_x075, _x100] : [_x100, _x075];
        if (_aR > _aL) svgParts.push(`<rect x="${_aL.toFixed(1)}" y="0" width="${(_aR - _aL).toFixed(1)}" height="${SVG_H}" fill="#eda100" opacity="0.11"/>`);
      }

      // Red (> 1.0 ATR)
      if (_x100 != null) {
        const [_rL, _rR] = _isCall ? [_x100, _profEdgeX] : [_profEdgeX, _x100];
        if (_rR > _rL) svgParts.push(`<rect x="${_rL.toFixed(1)}" y="0" width="${(_rR - _rL).toFixed(1)}" height="${SVG_H}" fill="#ef4444" opacity="0.10"/>`);
      }
    }

    // ATR zone boundary dashed ticks + labels (stacked, adjacent to axis)
    if (_atr075Stk != null) {
      const _x75  = toX(_atr075Stk);
      const _v75  = _interpOptVal(_atr075Stk);
      const _r75  = _v75 != null ? fmtR(_v75) : '';
      const _pct75str = (_v75 != null && entry > 0)
        ? ((_v75 >= entry ? '+' : '') + Math.round((_v75 - entry) / entry * 100) + '%') : '';
      const _outcome75 = [_r75, _pct75str].filter(Boolean).join(' · ');
      svgParts.push(`<line x1="${_x75.toFixed(1)}" y1="0" x2="${_x75.toFixed(1)}" y2="${SVG_H}" stroke="#eda100" stroke-width="1" stroke-dasharray="3 2" opacity="0.35"/>`);
      const {lx: _lx75, anchor: _a75} = lblPos(_x75);
      svgParts.push(`<text x="${_lx75.toFixed(1)}" y="${AXIS_Y - 20}" text-anchor="${_a75}" fill="#eda100" font-size="9" font-family="monospace" opacity="0.7">${_spotAnchored ? '+' : ''}0.75 ATR $${_atr075Stk.toFixed(0)}</text>`);
      if (_v75 != null) {
        svgParts.push(`<text x="${_lx75.toFixed(1)}" y="${AXIS_Y - 10}" text-anchor="${_a75}" fill="#eda100" font-size="9" font-family="monospace" opacity="0.55">$${_v75.toFixed(2)}</text>`);
        if (_outcome75) svgParts.push(`<text x="${_lx75.toFixed(1)}" y="${AXIS_Y - 2}" text-anchor="${_a75}" fill="#eda100" font-size="9" font-family="monospace" opacity="0.55">${_outcome75}</text>`);
      }
    }
    if (_atr100Stk != null) {
      const _x100 = toX(_atr100Stk);
      const _v100 = _interpOptVal(_atr100Stk);
      const _r100 = _v100 != null ? fmtR(_v100) : '';
      const _pct100str = (_v100 != null && entry > 0)
        ? ((_v100 >= entry ? '+' : '') + Math.round((_v100 - entry) / entry * 100) + '%') : '';
      const _outcome100 = [_r100, _pct100str].filter(Boolean).join(' · ');
      svgParts.push(`<line x1="${_x100.toFixed(1)}" y1="0" x2="${_x100.toFixed(1)}" y2="${SVG_H}" stroke="#ef4444" stroke-width="1" stroke-dasharray="3 2" opacity="0.35"/>`);
      const {lx: _lx100, anchor: _a100} = lblPos(_x100);
      svgParts.push(`<text x="${_lx100.toFixed(1)}" y="${AXIS_Y - 20}" text-anchor="${_a100}" fill="#ef4444" font-size="9" font-family="monospace" opacity="0.7">${_spotAnchored ? '+' : ''}1 ATR $${_atr100Stk.toFixed(0)}</text>`);
      if (_v100 != null) {
        svgParts.push(`<text x="${_lx100.toFixed(1)}" y="${AXIS_Y - 10}" text-anchor="${_a100}" fill="#ef4444" font-size="9" font-family="monospace" opacity="0.55">$${_v100.toFixed(2)}</text>`);
        if (_outcome100) svgParts.push(`<text x="${_lx100.toFixed(1)}" y="${AXIS_Y - 2}" text-anchor="${_a100}" fill="#ef4444" font-size="9" font-family="monospace" opacity="0.55">${_outcome100}</text>`);
      }
    }

    // ── §2 Role line (base track) ──────────────────────────────────────────────
    svgParts.push(`<line x1="0" y1="${AXIS_Y}" x2="${W}" y2="${AXIS_Y}" stroke="var(--border-bright)" stroke-width="1" opacity="0.4"/>`);

    // Risk segment (red): STOP → ENTRY; omit when STOP stock price unknown
    if (_stopStk != null) {
      const _sx = toX(_stopStk), _ex = toX(_spot);
      svgParts.push(`<line x1="${Math.min(_sx, _ex).toFixed(1)}" y1="${AXIS_Y}" x2="${Math.max(_sx, _ex).toFixed(1)}" y2="${AXIS_Y}" stroke="#ef4444" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`);
    }
    // Reward segment (green): ENTRY → furthest on-scale target
    const _furthestTgtStk = (() => {
      const stks = exitDots
        .filter(d => (d.role === 'tp' || d.role === 'exit') && (d.label !== 'TP2' || _tp2OnScale))
        .map(d => d.stockPrice).filter(v => v != null);
      if (!stks.length) return null;
      return _isCall ? Math.max(...stks) : Math.min(...stks);
    })();
    if (_furthestTgtStk != null) {
      const _ex = toX(_spot), _tx = toX(_furthestTgtStk);
      svgParts.push(`<line x1="${Math.min(_ex, _tx).toFixed(1)}" y1="${AXIS_Y}" x2="${Math.max(_ex, _tx).toFixed(1)}" y2="${AXIS_Y}" stroke="#22c55e" stroke-width="3" stroke-linecap="round" opacity="0.5"/>`);
    }

    // ── §4 Glow — ATR consumed, from day-range terminus back to spot ──
    // Anchor: real day_open when backend supplies it; proxy (spot − dayRange = session
    // low on a trending day) otherwise. Domain stays anchored to the trade (stop → targets);
    // when the anchor is off-domain the glow is clamped at x=0 and a ◂ marker signals that
    // the day's range extends beyond the left edge of the view. Slate (#94a3b8) keeps the
    // consumed-distance channel visually separate from the green reward segment in §3.
    if (_atrConsumedPct != null && chainAtr > 0 && _spot > 0 && _dayOrigin != null) {
      const _gx0Raw = toX(_dayOrigin);
      const _gx0    = Math.max(0, _gx0Raw);
      const _gx1    = toX(_spot);
      if (Math.abs(_gx1 - _gx0) > 1) {
        svgParts.push(`<defs><filter id="rrlGlow"><feGaussianBlur stdDeviation="3.5" result="b"/><feComposite in="SourceGraphic" in2="b" operator="over"/></filter></defs>`);
        svgParts.push(`<line x1="${_gx0.toFixed(1)}" y1="${AXIS_Y}" x2="${_gx1.toFixed(1)}" y2="${AXIS_Y}" stroke="#94a3b8" stroke-width="6" stroke-linecap="round" filter="url(#rrlGlow)" opacity="0.7"/>`);
        svgParts.push(`<line x1="${_gx0.toFixed(1)}" y1="${AXIS_Y}" x2="${_gx1.toFixed(1)}" y2="${AXIS_Y}" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" opacity="0.95"/>`);
        if (_gx0Raw < 0) {
          svgParts.push(`<text x="2" y="${AXIS_Y + 4}" fill="#94a3b8" font-size="9" font-family="monospace" opacity="0.7">&#x25C2;</text>`);
        }
      }
    }

    // ── §5 now / open markers ──────────────────────────────────────────────────
    if (chainDayOpen != null) {
      // Real session open — labeled "open" because the source is authoritative.
      const _ox = toX(chainDayOpen);
      svgParts.push(`<line x1="${_ox.toFixed(1)}" y1="${AXIS_Y - 7}" x2="${_ox.toFixed(1)}" y2="${AXIS_Y + 7}" stroke="#475569" stroke-width="1.5" stroke-linecap="round"/>`);
      const {lx: _oxLx, anchor: _oxA} = lblPos(_ox);
      svgParts.push(`<text x="${_oxLx.toFixed(1)}" y="${AXIS_Y - 30}" text-anchor="${_oxA}" fill="#475569" font-size="9" font-family="monospace">open</text>`);
    } else if (_dayOrigin != null && _atrConsumedPct != null && chainDayRange > 0) {
      // Proxy terminus (spot − dayRange): unlabeled tick only when on-canvas.
      // When off-domain the ◂ marker in §4 already signals the overflow; skip the tick.
      const _px = toX(_dayOrigin);
      if (_px >= 0) {
        svgParts.push(`<line x1="${_px.toFixed(1)}" y1="${AXIS_Y - 5}" x2="${_px.toFixed(1)}" y2="${AXIS_Y + 5}" stroke="#94a3b8" stroke-width="1" stroke-linecap="round" opacity="0.5"/>`);
      }
    }
    {
      const _nx     = toX(_spot);
      const _nowLbl = _atrConsumedPct != null ? `now ${Math.round(_atrConsumedPct)}% ATR` : 'now';
      const _nowCol = _gaugeExhausted ? '#eda100' : '#e2e8f0';
      svgParts.push(`<line x1="${_nx.toFixed(1)}" y1="${AXIS_Y - 7}" x2="${_nx.toFixed(1)}" y2="${AXIS_Y + 7}" stroke="${_nowCol}" stroke-width="1.5" stroke-linecap="round"/>`);
      const {lx: _nowLx, anchor: _nowA} = lblPos(_nx);
      svgParts.push(`<text x="${_nowLx.toFixed(1)}" y="${AXIS_Y - 30}" text-anchor="${_nowA}" fill="#94a3b8" font-size="9" font-family="monospace">${_nowLbl}</text>`);
    }

    // ── §3 Unified dots: exit + on-scale SR/cloud ─────────────────────────────
    // PROX_PX = full width of the widest label line (yL4: "+6.1R · +192%" ≈ 13 chars × 6px
    // at font-9 monospace = 78px). Two centered labels don't overlap when dot centers are
    // separated by at least one full label width.
    // Used for: slot-assignment collision check (T1=below, T2=below-staggered).
    const PROX_PX = 78;

    const exitDotsOnScale = exitDots.filter(d => !(d.label === 'TP2' && !_tp2OnScale));

    // Unified slot assignment: exits (entry→stop→tp) then SR (nearest-to-spot) compete for
    // two label slots — T1 (stagger=false) and T2 (stagger=true). First slot with no existing
    // occupant within PROX_PX wins. Exits with no slot render circle-only; SR with no slot is
    // dropped and counted. Replaces old two-stage SR filter + separate _assignStagger call.
    const _exitPri = { entry: 0, stop: 1, tp: 2, exit: 2 };
    const _candidates = [];
    const _exitStkSet = new Set(
      exitDotsOnScale.filter(d => d.stockPrice != null).map(d => (+d.stockPrice).toFixed(2))
    );
    exitDotsOnScale
      .filter(d => d.stockPrice != null)
      .sort((a, b) => (_exitPri[a.role] ?? 3) - (_exitPri[b.role] ?? 3))
      .forEach(d => _candidates.push({ kind: 'exit', data: d }));
    [..._srOnScale]
      .filter(d => !_exitStkSet.has((+d.lvl.price).toFixed(2)))
      .sort((a, b) => Math.abs(a.lvl.price - _spot) - Math.abs(b.lvl.price - _spot))
      .forEach(d => _candidates.push({ kind: 'sr', data: d }));

    // DROP_PX: minimum x-gap at which stagger (18px y-offset) produces a readable result.
    // Below this threshold, SR candidates are dropped instead of staggered — at < 30px
    // x-separation the T1/T2 label rows interleave over a 16px shared y-band at nearly
    // the same x, making the stacked text unreadable. Exits ignore this limit and always
    // compete for a slot (circle-only fallback if all slots are within PROX_PX).
    const DROP_PX = 30;

    const _slots = [[], []]; // [T1-x-positions, T2-x-positions]
    const _candidateSlot = new Map();
    let _srProxDropped = 0;
    _candidates.forEach(cand => {
      const x = toX(cand.kind === 'exit' ? cand.data.stockPrice : cand.data.lvl.price);
      // SR: drop immediately if any already-assigned dot is within DROP_PX (stagger won't help)
      if (cand.kind === 'sr' && _slots.some(slot => slot.some(kx => Math.abs(x - kx) < DROP_PX))) {
        _srProxDropped++;
        return;
      }
      let slotIdx = null;
      for (let si = 0; si < _slots.length; si++) {
        if (!_slots[si].some(kx => Math.abs(x - kx) < PROX_PX)) { slotIdx = si; break; }
      }
      if (slotIdx === null) {
        if (cand.kind === 'sr') _srProxDropped++;
        else _candidateSlot.set(cand, null); // exit — circle only
        return;
      }
      _slots[slotIdx].push(x);
      _candidateSlot.set(cand, slotIdx);
    });

    const _allDots = [];
    exitDotsOnScale.filter(d => d.stockPrice == null).forEach(d => {
      _allDots.push({
        stockPrice: null, label: d.displayLabel, optVal: d.price,
        pctGain: null, showPct: false, approxStk: true,
        ringColor: DOT_COLOR[d.role] || '#94a3b8', nameColor: null,
        isEntry: false, stagger: false, suppressLabel: false,
      });
    });
    _candidates.forEach(cand => {
      if (!_candidateSlot.has(cand)) return; // SR with no slot — dropped
      const slotIdx = _candidateSlot.get(cand);
      if (cand.kind === 'exit') {
        const d = cand.data;
        _allDots.push({
          stockPrice: d.stockPrice, label: d.displayLabel, optVal: d.price,
          pctGain:    d.role !== 'entry' ? (d.price - entry) / entry * 100 : null,
          showPct:    d.role !== 'entry', approxStk: d.role === 'stop',
          ringColor:  DOT_COLOR[d.role] || '#22c55e', nameColor: null,
          isEntry:    d.role === 'entry', stagger: slotIdx === 1,
          suppressLabel: slotIdx === null,
        });
      } else {
        const d = cand.data;
        const _cloud = d.lvl.type === 'cloud';
        const _col   = _cloud ? '#8b5cf6' : srColor(d.lvl.role, d.lvl.price);
        _allDots.push({
          stockPrice: d.lvl.price, label: srAbbrev(d.lvl) || d.lvl.label,
          optVal: d.value,
          pctGain: d.value != null ? (d.value - entry) / entry * 100 : null,
          showPct: true, approxStk: false, ringColor: _col,
          nameColor: _cloud ? '#a78bfa' : _col,
          isEntry: false, stagger: slotIdx === 1, suppressLabel: false,
        });
      }
    });

    // ── §GEX Wall/Magnet markers — hollow amber, drawn before solid dots ───────
    // put_wall and call_wall → hollow circles (r=6); gamma_magnet → hollow diamond.
    // Each is independent: null value → no marker. Off-chart price → omit (no edge stub).
    if (focusGexCache && focusGexCache.available) {
      const _ga = '#BA7517';
      [
        { price: focusGexCache.put_wall,     shape: 'circle'  },
        { price: focusGexCache.call_wall,    shape: 'circle'  },
        { price: focusGexCache.gamma_magnet, shape: 'diamond' },
      ].forEach(m => {
        if (m.price == null) return;
        const gx = toX(m.price);
        if (gx < 0 || gx > W) return;
        svgParts.push(`<line x1="${gx.toFixed(1)}" y1="0" x2="${gx.toFixed(1)}" y2="${SVG_H}" stroke="${_ga}" stroke-width="1" stroke-dasharray="2 4" opacity="0.35"/>`);
        if (m.shape === 'circle') {
          svgParts.push(`<circle cx="${gx.toFixed(1)}" cy="${AXIS_Y}" r="6" fill="none" stroke="${_ga}" stroke-width="1.5"/>`);
        } else {
          const _d = 5;
          svgParts.push(`<path d="M${gx.toFixed(1)},${(AXIS_Y - _d)} L${(+gx + _d).toFixed(1)},${AXIS_Y} L${gx.toFixed(1)},${(AXIS_Y + _d)} L${(+gx - _d).toFixed(1)},${AXIS_Y} Z" fill="none" stroke="${_ga}" stroke-width="1.5"/>`);
        }
      });
    }

    // Render dots
    _allDots.forEach(dot => {
      if (dot.stockPrice == null) {
        // STOP with no stock position (pre-session/sparse projection) -> left edge stub
        const _col = DOT_COLOR['stop'];
        svgParts.push(`<text x="2" y="${AXIS_Y + 14}" text-anchor="start" fill="${_col}" font-size="9" font-family="monospace" opacity="0.7">&#x25C2; STOP</text>`);
        svgParts.push(`<text x="2" y="${AXIS_Y + 26}" text-anchor="start" fill="${_col}" font-size="9" font-family="monospace" opacity="0.7">&#x2014; · −30%</text>`);
        return;
      }
      const x   = toX(dot.stockPrice);
      const col = dot.ringColor;
      const yS  = dot.stagger ? 18 : 0;
      const yL1 = AXIS_Y + yS + 13;
      const yL2 = AXIS_Y + yS + 25;
      const yL3 = AXIS_Y + yS + 37;
      const yL4 = AXIS_Y + yS + 47;

      svgParts.push(`<circle cx="${x.toFixed(1)}" cy="${AXIS_Y}" r="3.5" fill="${col}"/>`);
      if (!dot.suppressLabel) {
        svgParts.push(`<line x1="${x.toFixed(1)}" y1="${AXIS_Y}" x2="${x.toFixed(1)}" y2="${AXIS_Y + 8}" stroke="${col}" stroke-width="1" opacity="0.4"/>`);

        const nCol = dot.nameColor ?? col;
        const {lx, anchor} = lblPos(x);
        svgParts.push(`<text x="${lx.toFixed(1)}" y="${yL1}" text-anchor="${anchor}" fill="${nCol}" font-size="9" font-family="monospace">${dot.label}</text>`);

        const stkTxt = dot.approxStk ? `~$${(+dot.stockPrice).toFixed(0)}` : `$${(+dot.stockPrice).toFixed(0)}`;
        svgParts.push(`<text x="${lx.toFixed(1)}" y="${yL2}" text-anchor="${anchor}" fill="#94a3b8" font-size="9" font-family="monospace">${stkTxt}</text>`);

        if (dot.isEntry) {
          if (dot.optVal != null) svgParts.push(`<text x="${lx.toFixed(1)}" y="${yL3}" text-anchor="${anchor}" fill="#94a3b8" font-size="9" font-family="monospace">$${dot.optVal.toFixed(2)}</text>`);
        } else if (dot.showPct && entry > 0) {
          const optTxt    = dot.optVal != null ? `$${dot.optVal.toFixed(2)}` : '—';
          const rStr      = dot.optVal != null ? fmtR(dot.optVal) : '';
          const pctStr    = dot.pctGain != null ? (dot.pctGain >= 0 ? '+' : '') + Math.round(dot.pctGain) + '%' : '';
          const outcomeStr = [rStr, pctStr].filter(Boolean).join(' · ');
          const outcomeCol = !outcomeStr ? '#64748b'
            : dot.pctGain != null ? (dot.pctGain < 0 ? '#ef4444' : '#22c55e')
            : (dot.optVal >= entry ? '#22c55e' : '#ef4444');
          svgParts.push(`<text x="${lx.toFixed(1)}" y="${yL3}" text-anchor="${anchor}" fill="#94a3b8" font-size="9" font-family="monospace">${optTxt}</text>`);
          if (outcomeStr) svgParts.push(`<text x="${lx.toFixed(1)}" y="${yL4}" text-anchor="${anchor}" fill="${outcomeCol}" font-size="9" font-family="monospace">${outcomeStr}</text>`);
        }
      }
    });

    // ── Edge markers — off-scale TP2, unpriced SR exit, far profit-side SR ────
    if (_tp2IsRunner && !_tp2OnScale && _tp2) {
      const _col = DOT_COLOR['tp'];
      const _lbl = _tp2.abbr ? `▸ TP2 · ${_tp2.abbr}` : '▸ TP2';
      svgParts.push(`<line x1="${W}" y1="${AXIS_Y - 6}" x2="${W}" y2="${AXIS_Y}" stroke="${_col}" stroke-width="1" opacity="0.4"/>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 13}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">${_lbl}</text>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 25}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">$${(+_tp2.stockPrice).toFixed(0)} stk</text>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 37}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">$${_tp2.price.toFixed(2)}</text>`);
      const _fmtRTp2   = fmtR(_tp2.price);
      const _pctTp2str = entry > 0 ? ((_tp2.price >= entry ? '+' : '') + Math.round((_tp2.price - entry) / entry * 100) + '%') : '';
      const _outcomeTp2 = [_fmtRTp2, _pctTp2str].filter(Boolean).join(' · ');
      if (_outcomeTp2) svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 47}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">${_outcomeTp2}</text>`);
    }
    if (_unpricedTpEdge) {
      const _col = DOT_COLOR['exit'];
      svgParts.push(`<line x1="${W}" y1="${AXIS_Y - 6}" x2="${W}" y2="${AXIS_Y}" stroke="${_col}" stroke-width="1" opacity="0.4"/>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 13}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">▸ EXIT · ${_unpricedTpEdge.abbr}</text>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 25}" text-anchor="end" fill="${_col}" font-size="9" font-family="monospace">$${(+_unpricedTpEdge.stockPrice).toFixed(0)} stk</text>`);
      svgParts.push(`<text x="${W - 2}" y="${AXIS_Y + 37}" text-anchor="end" fill="#64748b" font-size="9" font-family="monospace">prices at open</text>`);
    }
    // Nearest off-domain profit-side SR/cloud level (suppressed when edge already taken by TP2 or unpriced)
    const _profEdgeDot = _srOffScale.sort((a, b) =>
      _isCall ? a.lvl.price - b.lvl.price : b.lvl.price - a.lvl.price)[0] ?? null;
    if (_profEdgeDot && !(_tp2IsRunner && !_tp2OnScale) && !_unpricedTpEdge) {
      const _cloud = _profEdgeDot.lvl.type === 'cloud';
      const _col   = _cloud ? '#8b5cf6' : srColor(_profEdgeDot.lvl.role, _profEdgeDot.lvl.price);
      const _abbr  = srAbbrev(_profEdgeDot.lvl) || _profEdgeDot.lvl.label;
      const _ex    = _isCall ? W - 2 : 2;
      const _anch  = _isCall ? 'end' : 'start';
      const _arrow = _isCall ? '▸' : '◂';
      svgParts.push(`<text x="${_ex}" y="${AXIS_Y + 13}" text-anchor="${_anch}" fill="${_col}" font-size="9" font-family="monospace" opacity="0.6">${_arrow} ${_abbr} $${_profEdgeDot.lvl.price.toFixed(0)}</text>`);
    }

    const svg = `<svg viewBox="0 0 ${W} ${SVG_H}" preserveAspectRatio="xMidYMid meet" width="100%" style="overflow:visible;display:block">${svgParts.join('')}</svg>`;

    // ── Footer ────────────────────────────────────────────────────────────────
    const rrRatio = rDenom > 0 ? ((lastExit.price - entry) / rDenom).toFixed(1) : '—';
    const riskDol = rDenom > 0 ? Math.round(rDenom * qty * 100) : 0;
    const rwdDol  = rDenom > 0 ? Math.round((lastExit.price - entry) * qty * 100) : 0;
    const _rrPfx = _unpricedTpEdge
      ? `risk $${riskDol}`
      : `R:R 1:${rrRatio} · risk $${riskDol} · reward $${rwdDol}`;

    let _atrFooterPfx = '';
    let _footerAmberStyle = '';
    if (_gaugeAtrRatio !== null) {
      if (_gaugeAtrRatio >= 0.95) {
        _atrFooterPfx     = 'ATR EXHAUSTED · ';
        _footerAmberStyle = ' style="color:#eda100"';
      } else {
        const _atrPct  = Math.round(_gaugeAtrRatio * 100);
        const _atrLeft = `$${Math.max(0, chainAtr - chainDayRange).toFixed(2)}`;
        _atrFooterPfx  = `day range ${_atrPct}% used · ${_atrLeft} left · `;
      }
    }
    el.innerHTML = `${svg}<div class="rrl-footer"${_footerAmberStyle}>${_atrFooterPfx}${_rrPfx}</div>`;
    el.style.display = '';
  }

  // Renders the payout profile SVG into #cockpitProjWrap (PAYOUT tab).
  // Measures clientWidth × clientHeight of the wrap and fills both axes — no fixed height.
  // Called from: _activateCockpitProjTab('payout'), qty listener, loadPayoutCurve on cache set.
  function renderPayoutCurve(cache, qty) {
    const wrapEl = document.getElementById('cockpitProjWrap');
    const asOfEl = document.getElementById('cockpitPayoutAsOf');
    if (!wrapEl) return;

    if (!cache) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">Loading payout curve…</div>';
      return;
    }
    if (cache.error) {
      wrapEl.innerHTML = `<div class="dash-placeholder" style="padding:0.4rem 0">${cache.error}</div>`;
      return;
    }

    const hIdx = asOfEl ? (parseInt(asOfEl.value, 10) || 0) : 0;

    // ── P&L base — _resolveEntryPrice().displayPrice, not ask ─────────────────
    const { displayPrice } = _resolveEntryPrice();
    if (!displayPrice || displayPrice <= 0) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">No bid</div>';
      return;
    }
    const premium = displayPrice;

    // ── P&L per point: (value − premium) × qty × 100 ─────────────────────────
    const pnlPts = (cache.points || []).map(pt => ({
      stock: pt.stock,
      val:   pt.values[hIdx],
      pnl:   pt.values[hIdx] != null ? (pt.values[hIdx] - premium) * qty * 100 : null,
    }));
    const hasPnl = pnlPts.filter(p => p.pnl != null);
    if (!hasPnl.length) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">IV solve failed — no data for this horizon</div>';
      return;
    }

    // ── SVG dimensions: measure the wrap, fill both axes ─────────────────────
    const W = wrapEl.clientWidth;
    const H = wrapEl.clientHeight;
    if (!W || !H) return;
    const PAD_L = 48, PAD_R = 10, PAD_T = 26, PAD_B = 42;
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const axisY = PAD_T + plotH;

    const stockLo = pnlPts[0].stock;
    const stockHi = pnlPts[pnlPts.length - 1].stock;
    function toX(s) { return PAD_L + (s - stockLo) / (stockHi - stockLo) * plotW; }

    const pnlVals = hasPnl.map(p => p.pnl);
    const yMin  = Math.min(Math.min(...pnlVals), -1);
    const yMax  = Math.max(Math.max(...pnlVals),  1);
    const ySpan = yMax - yMin;
    function toY(pnl) { return PAD_T + (yMax - pnl) / ySpan * plotH; }
    const zeroY = toY(0);

    const svgParts = [];

    // ── ATR remaining band — same inputs as _remAtrDemand ─────────────────────
    if (chainAtr && chainAtr > 0 && chainDayRange != null && chainCurrentPrice > 0) {
      const remAtr = Math.max(0, chainAtr - chainDayRange);
      if (remAtr > 0) {
        const bx1 = toX(Math.max(stockLo, chainCurrentPrice - remAtr));
        const bx2 = toX(Math.min(stockHi, chainCurrentPrice + remAtr));
        if (bx2 > bx1) svgParts.push(
          `<rect x="${bx1.toFixed(1)}" y="${PAD_T}" width="${(bx2 - bx1).toFixed(1)}" height="${plotH}" fill="rgba(100,130,200,0.18)"/>`
        );
      }
    }

    // ── Y-axis: vertical line + ticks (max-loss floor, $0, gain steps) ─────────
    svgParts.push(`<line x1="${PAD_L}" y1="${PAD_T}" x2="${PAD_L}" y2="${axisY}" stroke="var(--border-bright)" stroke-width="1" opacity="0.4"/>`);
    function fmtPnl(v) {
      const sign = v < 0 ? '-' : v > 0 ? '+' : '';
      const abs  = Math.abs(v);
      return sign + (abs >= 1000 ? `$${(abs / 1000).toFixed(1)}k` : `$${Math.round(abs)}`);
    }
    function niceGainStep(max, count) {
      const rough = max / count;
      const pow   = Math.pow(10, Math.floor(Math.log10(Math.max(rough, 1))));
      const frac  = rough / pow;
      return frac < 2 ? pow : frac < 5 ? 2 * pow : 5 * pow;
    }
    const gainStep  = yMax > 0 ? niceGainStep(yMax, 3) : 0;
    const gainTicks = [];
    if (gainStep > 0) {
      for (let v = gainStep; v <= yMax + gainStep * 0.01; v += gainStep) gainTicks.push(Math.round(v));
    }
    const yTickVals = [...new Set([Math.round(yMin), 0, ...gainTicks])].sort((a, b) => a - b);
    yTickVals.forEach(v => {
      if (v < yMin - 1 || v > yMax + 1) return;
      const ty = toY(v);
      svgParts.push(
        `<line x1="${(PAD_L - 3)}" y1="${ty.toFixed(1)}" x2="${PAD_L}" y2="${ty.toFixed(1)}" stroke="var(--border-bright)" stroke-width="1"/>`,
        `<text x="${(PAD_L - 5)}" y="${(ty + 3).toFixed(1)}" text-anchor="end" font-size="7.5" font-family="monospace" fill="var(--text-muted)">${fmtPnl(v)}</text>`
      );
    });

    // ── Zero line ─────────────────────────────────────────────────────────────
    svgParts.push(
      `<line x1="${PAD_L}" y1="${zeroY.toFixed(1)}" x2="${(W - PAD_R).toFixed(1)}" y2="${zeroY.toFixed(1)}" stroke="var(--border-bright)" stroke-width="1" stroke-dasharray="4 3"/>`
    );

    // ── S/R vertical markers — srColor / srAbbrev, same palette as renderRrLine ──
    const levels = (matrixProjCache && matrixProjCache.levels) || [];
    const visMarkers = levels
      .filter(lvl => lvl.price > stockLo && lvl.price < stockHi)
      .map(lvl => ({ ...lvl, abbr: srAbbrev(lvl) }))
      .sort((a, b) => a.price - b.price);
    _assignStagger(visMarkers, m => toX(m.price), 40);
    visMarkers.forEach(m => {
      const x    = toX(m.price);
      const col  = srColor(m.role, m.price);
      const lblY = m.stagger ? PAD_T - 14 : PAD_T - 5;
      svgParts.push(`<line x1="${x.toFixed(1)}" y1="${PAD_T}" x2="${x.toFixed(1)}" y2="${axisY}" stroke="${col}" stroke-width="1" stroke-dasharray="3 3" opacity="0.7"/>`);
      if (m.abbr) svgParts.push(`<text x="${x.toFixed(1)}" y="${lblY}" text-anchor="middle" font-size="7.5" font-family="monospace" fill="${col}">${m.abbr}</text>`);
    });

    // ── Payout curve — red below zero, green above, split at crossing ─────────
    const redPts = [], grnPts = [];
    for (let i = 0; i < hasPnl.length; i++) {
      const pt = hasPnl[i];
      const x  = toX(pt.stock), y = toY(pt.pnl);
      if (i > 0) {
        const pp = hasPnl[i - 1];
        if ((pp.pnl < 0) !== (pt.pnl < 0)) {
          const t  = -pp.pnl / (pt.pnl - pp.pnl);
          const xz = (toX(pp.stock) + t * (toX(pt.stock) - toX(pp.stock))).toFixed(1);
          redPts.push(`${xz},${zeroY.toFixed(1)}`);
          grnPts.push(`${xz},${zeroY.toFixed(1)}`);
        }
      }
      if (pt.pnl < 0) redPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
      else             grnPts.push(`${x.toFixed(1)},${y.toFixed(1)}`);
    }
    if (redPts.length >= 2) svgParts.push(`<polyline points="${redPts.join(' ')}" fill="none" stroke="#ef5350" stroke-width="2" stroke-linejoin="round"/>`);
    if (grnPts.length >= 2) svgParts.push(`<polyline points="${grnPts.join(' ')}" fill="none" stroke="#26a69a" stroke-width="2" stroke-linejoin="round"/>`);

    // ── X-axis ────────────────────────────────────────────────────────────────
    svgParts.push(`<line x1="${PAD_L}" y1="${axisY}" x2="${(W - PAD_R).toFixed(1)}" y2="${axisY}" stroke="var(--border-bright)" stroke-width="1"/>`);

    // ── Two-row x-axis ticks: row 1 = stock price, row 2 = option value ───────
    const tStep = Math.max(1, Math.floor(pnlPts.length / 8));
    pnlPts.forEach((pt, i) => {
      if (i % tStep !== 0 && i !== pnlPts.length - 1) return;
      const x      = toX(pt.stock);
      const valTxt = pt.val != null ? `$${pt.val.toFixed(2)}` : '—';
      svgParts.push(
        `<line x1="${x.toFixed(1)}" y1="${axisY}" x2="${x.toFixed(1)}" y2="${(axisY + 4)}" stroke="var(--border-bright)" stroke-width="1"/>`,
        `<text x="${x.toFixed(1)}" y="${(axisY + 13)}" text-anchor="middle" font-size="8" font-family="monospace" fill="var(--text-muted)">$${pt.stock.toFixed(0)}</text>`,
        `<text x="${x.toFixed(1)}" y="${(axisY + 25)}" text-anchor="middle" font-size="7.5" font-family="monospace" fill="#64748b">${valTxt}</text>`
      );
    });

    // ── Disclaimer: label the model honestly ──────────────────────────────────
    const disc = hIdx === 3
      ? 'At expiry: arithmetic — model-free'
      : 'Black-Scholes at solved σ \xb7 σ will not hold';
    svgParts.push(`<text x="${(W - PAD_R)}" y="${(H - 4)}" text-anchor="end" font-size="7" font-family="monospace" fill="var(--text-muted)" opacity="0.7">${disc}</text>`);

    wrapEl.innerHTML = `<svg width="${W}" height="${H}" style="display:block;overflow:visible">${svgParts.join('')}</svg>`;
  }

  // Fetches /api/projection for every structural + GEX + marker level in parallel
  // and renders the level × payoff matrix in the cockpit.
  async function loadProjectionMatrix() {
    const wrapEl = document.getElementById('cockpitProjWrap');
    const verdEl = document.getElementById('cockpitVerdict');
    if (!wrapEl || !armedContract) return;

    const targetEl   = document.getElementById('cockpitTarget');
    const userTarget = targetEl && parseFloat(targetEl.value) > 0
      ? parseFloat(targetEl.value)
      : chainCurrentPrice;

    const bannerEl = document.getElementById('cockpitAtrBanner');

    if (!userTarget || userTarget <= 0) {
      if (bannerEl) bannerEl.innerHTML = '';
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">Enter a target price above to see projection</div>';
      if (verdEl) verdEl.style.display = 'none';
      return;
    }

    if (!armedContract.iv || armedContract.iv <= 0) {
      if (bannerEl) bannerEl.innerHTML = '';
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">IV unavailable — projection requires market hours data</div>';
      if (verdEl) verdEl.style.display = 'none';
      return;
    }

    if (bannerEl) bannerEl.innerHTML = '';
    wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.4rem 0">Loading level matrix…</div>';

    const price      = chainCurrentPrice > 0 ? chainCurrentPrice : armedContract.strike;
    const optionType = armedContract.option_type || (armedContract.bias === 'bullish' ? 'call' : 'put');

    // ── Build structural level list ──────────────────────────────────────────
    const srLevels = [];
    if (srLevelsCache && srLevelsCache.available) {
      const d = srLevelsCache;
      if (d.ath != null)           srLevels.push({ label: 'All-time high',  price: d.ath,         type: 'sr', role: 'resistance' });
      else if (d.high_52w != null) srLevels.push({ label: '52-week high',   price: d.high_52w,    type: 'sr', role: 'resistance' });
      if (d.pdh2 != null)          srLevels.push({ label: 'Prior-day high', price: d.pdh2,        type: 'sr', role: 'resistance' });
      if (d.round_above != null)   srLevels.push({ label: 'Round above',    price: d.round_above, type: 'sr', role: 'round' });
      (d.overhead_swings  || []).slice(0, 3).forEach((s, i) =>
        srLevels.push({ label: `Overhead ${i+1}`,  price: s, type: 'sr', role: 'resistance' })
      );
      (d.underfoot_swings || []).slice(0, 3).forEach((s, i) =>
        srLevels.push({ label: `Underfoot ${i+1}`, price: s, type: 'sr', role: 'support' })
      );
      if (d.round_below != null)   srLevels.push({ label: 'Round below',   price: d.round_below, type: 'sr', role: 'round' });
      if (d.pdl2 != null)          srLevels.push({ label: 'Prior-day low', price: d.pdl2,        type: 'sr', role: 'support' });
      if (d.atl != null)           srLevels.push({ label: 'All-time low',  price: d.atl,         type: 'sr', role: 'support' });
      else if (d.low_52w != null)  srLevels.push({ label: '52-week low',   price: d.low_52w,     type: 'sr', role: 'support' });
    }

    if (chainArmedCloudLevels) {
      chainArmedCloudLevels.forEach(c => srLevels.push(c));
    }

    const gexLevels = [];
    if (focusGexCache && focusGexCache.available) {
      const g = focusGexCache;
      if (g.call_wall    != null) gexLevels.push({ label: 'Call Wall', price: g.call_wall,    type: 'gex', role: 'call_wall' });
      if (g.gamma_magnet != null) gexLevels.push({ label: 'Magnet',    price: g.gamma_magnet, type: 'gex', role: 'magnet' });
      if (g.put_wall     != null) gexLevels.push({ label: 'Put Wall',  price: g.put_wall,     type: 'gex', role: 'put_wall' });
    }

    // ── Confluence merge — display-only, no scoring impact ───────────────────
    const tol       = price * CONFLUENCE_TOLERANCE_PCT;
    const allLevels = [...srLevels];
    const usedSrIdx = new Set();

    gexLevels.forEach(gLvl => {
      const srIdx = allLevels.findIndex((s, i) => !usedSrIdx.has(i) && Math.abs(s.price - gLvl.price) <= tol);
      if (srIdx >= 0) {
        const sr = allLevels[srIdx];
        allLevels[srIdx] = {
          label:    `${sr.label} + ${gLvl.label}`,
          srLabel:  sr.label,
          gexLabel: gLvl.label,
          price:    sr.price,
          type:     'confluence',
          role:     sr.role,
          gexRole:  gLvl.role,
        };
        usedSrIdx.add(srIdx);
      } else {
        allLevels.push(gLvl);
      }
    });

    // ── Marker levels ─────────────────────────────────────────────────────────
    const breakevenStock = optionType === 'call'
      ? armedContract.strike + armedContract.ask
      : armedContract.strike - armedContract.ask;

    allLevels.push({ label: 'Target',    price: userTarget,           type: 'marker', role: 'target' });
    allLevels.push({ label: 'Current',   price: price,                type: 'marker', role: 'current' });
    allLevels.push({ label: 'Strike',    price: armedContract.strike, type: 'marker', role: 'strike' });
    allLevels.push({ label: 'Breakeven', price: breakevenStock,       type: 'marker', role: 'breakeven' });

    allLevels.sort((a, b) => b.price - a.price);

    // ── Fetch projection per level in parallel ────────────────────────────────
    const commonParams = {
      ticker:      chainTicker,
      strike:      armedContract.strike,
      expiry:      armedContract.expiration,
      option_type: optionType,
      iv:          armedContract.iv,
      bid:         armedContract.bid,   // enables mid back-solve server-side (Phase 0)
      premium:     armedContract.ask,   // NOTE js:3109 — should be resolved limit, not ask.
                                        // Same ask-vs-limit gap that makes matrix B/E $874.00
                                        // vs panel $874.38. Second change; deferred.
      spot:        price,               // current stock price — required by implied_iv
      dte:         armedContract.dte,
      iv_crush:    0,
    };

    try {
      const projResults = await Promise.all(
        allLevels.map(lvl =>
          apiFetch(`/api/projection?${new URLSearchParams({ ...commonParams, target: lvl.price })}`)
          .catch(() => null)
        )
      );

      matrixProjCache = { levels: allLevels, projResults };

      const qtyEl = document.getElementById('chainQty');
      const qty   = qtyEl ? Math.max(1, parseInt(qtyEl.value, 10) || 1) : 1;
      if (!_onPayoutTab()) {
        renderProjectionMatrix(allLevels, projResults, qty, wrapEl, verdEl, userTarget);
      }
      renderRrLine(allLevels, projResults, qty);
    } catch (err) {
      const detail = String(err).includes('403') ? 'Admin access required' : 'Projection unavailable';
      wrapEl.innerHTML = `<div class="dash-placeholder" style="padding:0.4rem 0">${detail}</div>`;
    }
  }

  // Populates the unified time-basis selector and wires its onchange to re-render
  // both the RR ladder and payout curve. Called from loadPayoutCurve on data arrival
  // so the selector is ready regardless of which tab is active.
  function _populateAsOfSelector(cache) {
    const asOfEl = document.getElementById('cockpitPayoutAsOf');
    if (!asOfEl || !cache || cache.error) return;
    const dteEff      = cache.dte_effective;
    const dteEffFloor = Number.isFinite(dteEff) ? dteEff : 1;
    const HLABELS     = ['Now', '+1D', '+2D', 'Expiry'];
    asOfEl.innerHTML  = '';
    [0, 1, 2, 3].forEach(i => {
      if (i < 3 && i >= dteEffFloor) return;
      const opt       = document.createElement('option');
      opt.value       = String(i);
      opt.textContent = HLABELS[i];
      asOfEl.appendChild(opt);
    });
    asOfEl.value        = '0';
    asOfEl.style.display = '';
    asOfEl.onchange = () => {
      const q = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
      if (payoutCurveCache) renderPayoutCurve(payoutCurveCache, q);
      if (matrixProjCache)  renderRrLine(matrixProjCache.levels, matrixProjCache.projResults, q);
    };
  }

  // Single range-mode fetch for the payout curve. Fires alongside loadProjectionMatrix on arm.
  // premium = _resolveEntryPrice().displayPrice (not ask — the matrix bug is §3, not inherited here).
  async function loadPayoutCurve() {
    payoutCurveCache = null;
    if (!armedContract || !armedContract.iv || armedContract.iv <= 0) return;

    const optionType = armedContract.option_type || (armedContract.bias === 'bullish' ? 'call' : 'put');
    const price      = chainCurrentPrice > 0 ? chainCurrentPrice : armedContract.strike;
    const { displayPrice } = _resolveEntryPrice();
    if (!displayPrice || displayPrice <= 0) return;
    const prem = displayPrice;
    const atr  = chainAtr && chainAtr > 0 ? chainAtr : 0;

    const breakevenStock = optionType === 'call'
      ? armedContract.strike + prem
      : armedContract.strike - prem;

    // ±1×ATR around current price, clamped outward to include strike and breakeven
    let lo = Math.min(price - atr, armedContract.strike, breakevenStock);
    let hi = Math.max(price + atr, armedContract.strike, breakevenStock);
    lo = Math.max(lo, 0.01);   // backend requires lo > 0
    if (hi <= lo) return;

    const params = new URLSearchParams({
      ticker:      chainTicker,
      strike:      armedContract.strike,
      expiry:      armedContract.expiration,
      target:      price.toFixed(4),   // required param; not used in range mode
      option_type: optionType,
      iv:          armedContract.iv,
      premium:     prem.toFixed(4),
      dte:         armedContract.dte,
      iv_crush:    0,
      lo:          lo.toFixed(4),
      hi:          hi.toFixed(4),
      n:           60,
    });
    if (armedContract.bid != null) params.set('bid',  armedContract.bid);
    if (price > 0)                 params.set('spot', price.toFixed(4));

    try {
      const data       = await apiFetch(`/api/projection?${params}`);
      payoutCurveCache = data;
      _populateAsOfSelector(data);
      if (_onPayoutTab()) {
        const qty = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
        renderPayoutCurve(payoutCurveCache, qty);
      }
    } catch (err) {
      payoutCurveCache = { error: String(err).includes('403') ? 'Admin access required' : 'Payout curve unavailable' };
      if (_onPayoutTab()) {
        const qty = Math.max(1, parseInt((document.getElementById('chainQty') || {}).value, 10) || 1);
        renderPayoutCurve(payoutCurveCache, qty);
      }
    }
  }

  // Renders the level × payoff matrix table + verdict banner.
  // 8-col layout: Level · Stock · Now{val,%,$} · Expiry{val,%,$}
  function renderProjectionMatrix(levels, projResults, qty, wrapEl, verdEl, userTarget) {
    if (!wrapEl) return;

    function fmtVal(row) {
      return row ? `$${row.value.toFixed(2)}` : '<span class="mat-na">—</span>';
    }
    function fmtPct(row) {
      if (!row) return '<span class="mat-na">—</span>';
      const gc    = row.gain_pct >= 0 ? 'positive' : 'negative';
      const gSign = row.gain_pct >= 0 ? '+' : '';
      return `<span class="mat-pct ${gc}">${gSign}${row.gain_pct.toFixed(1)}%</span>`;
    }
    function fmtDol(row) {
      if (!row || qty <= 1) return '';
      const total = Math.round(row.dollars * qty);
      const gc    = total >= 0 ? 'positive' : 'negative';
      const tSign = total >= 0 ? '+' : '';
      return `<span class="mat-total ${gc}">${tSign}$${Math.abs(total)}</span>`;
    }

    const _ATR_CUTOFF = 200;  // demand % above which cell goes blank and row dims

    function fmtRemAtr(lvlPrice) {
      const demand = _remAtrDemand(lvlPrice);
      if (demand === null || demand > _ATR_CUTOFF) return '';
      const cls = demand > 100 ? 'mat-rem mat-rem-amber' : 'mat-rem mat-rem-ok';
      return `<span class="${cls}">${Math.round(demand)}%</span>`;
    }

    const rowsHtml = levels.map((lvl, i) => {
      const proj   = projResults[i];
      const nowRow = proj && proj.rows && proj.rows[0];
      const expRow = proj && proj.rows && proj.rows[proj.rows.length - 1];

      let rowCls = '';
      if      (lvl.role === 'target')     rowCls = 'mat-row-target';
      else if (lvl.role === 'current')    rowCls = 'mat-row-current';
      else if (lvl.role === 'strike')     rowCls = 'mat-row-strike';
      else if (lvl.role === 'breakeven')  rowCls = 'mat-row-breakeven';
      else if (lvl.type === 'confluence') rowCls = 'mat-row-confluence';

      const _demand = _remAtrDemand(lvl.price);
      if (_demand !== null) {
        rowCls += _demand <= _ATR_CUTOFF ? ' mat-row-reachable' : ' mat-row-unreachable';
      }

      const priceStr = `$${lvl.price.toFixed(2)}${lvl.role === 'current' ? ' ◀' : ''}`;

      return `<tr class="${rowCls}">
  <td class="mat-label" style="color:${srColor(lvl.role, lvl.price)}">${lvl.label}</td>
  <td class="mat-stock">${priceStr}</td>
  <td class="mat-rematr">${fmtRemAtr(lvl.price)}</td>
  <td class="mat-val">${fmtVal(nowRow)}</td>
  <td class="mat-pct-cell">${fmtPct(nowRow)}</td>
  <td class="mat-dol-cell">${fmtDol(nowRow)}</td>
  <td class="mat-val mat-group-sep">${fmtVal(expRow)}</td>
  <td class="mat-pct-cell">${fmtPct(expRow)}</td>
  <td class="mat-dol-cell">${fmtDol(expRow)}</td>
</tr>`;
    }).join('');

    wrapEl.innerHTML = `
<table class="cockpit-level-matrix">
  <thead>
    <tr class="mat-thead-top">
      <th rowspan="2" class="mat-th-level">Level</th>
      <th rowspan="2" class="mat-th-stock">Stock</th>
      <th rowspan="2" class="mat-th-rematr">Rem ATR</th>
      <th colspan="3" class="mat-th-group">Now</th>
      <th colspan="3" class="mat-th-group mat-th-group-right">Expiry</th>
    </tr>
    <tr class="mat-thead-sub">
      <th class="mat-th-sub">Val</th>
      <th class="mat-th-sub">%</th>
      <th class="mat-th-sub">$</th>
      <th class="mat-th-sub mat-th-sub-sep">Val</th>
      <th class="mat-th-sub">%</th>
      <th class="mat-th-sub">$</th>
    </tr>
  </thead>
  <tbody>${rowsHtml}</tbody>
</table>`;

    // Verdict from the user's chosen target level
    if (verdEl) {
      const tIdx  = levels.findIndex(l => l.role === 'target');
      const tProj = tIdx >= 0 ? projResults[tIdx] : null;
      if (tProj && tProj.verdict) {
        const verdictMap = {
          worthless_at_expiry: { cls: 'verdict-red',   icon: '✗', text: 'Worthless at expiry — expires OTM even if stock hits target' },
          theta_dominated:     { cls: 'verdict-amber',  icon: '⚡', text: 'Theta dominated — most value lost by expiry; move must happen soon' },
          survives_slow_move:  { cls: 'verdict-green',  icon: '✓', text: 'Survives slow move — retains value at target even near expiry' },
        };
        const v = verdictMap[tProj.verdict] || { cls: '', icon: '?', text: tProj.verdict };
        verdEl.innerHTML     = `${v.icon} ${v.text}`;
        verdEl.className     = `cockpit-verdict ${v.cls}`;
        verdEl.style.display = '';
      } else {
        verdEl.style.display = 'none';
      }
    }
  }

  // ── Position management console (Part 3 — close wired) ───────────────────

  function setupConsoleHandlers() {
    document.getElementById('positionsBody').addEventListener('click', e => {
      // Clicks inside the console itself should not re-toggle the card.
      if (e.target.closest('.pos-console')) return;
      // GEX button handled by its own delegated listener in setupGexModal.
      if (e.target.closest('.pos-gex-btn')) return;
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
      clearInterval(_restingInterval);
      _restingInterval = null;
      _restingOpenSym  = null;
      _t2State         = null;
    } else {
      card.insertAdjacentHTML('beforeend', buildConsoleHtml(pos));
      card.classList.add('expanded');
      openConsoleId    = posId;
      _restingOpenSym  = pos.option_symbol || null;
      wireConsoleButtons(card, pos);
      // Fetch resting orders immediately, then every 30 s while the console is open.
      // 30 s is safe under Tradier's rate limits (1 admin user, 2 calls/min).
      // The 3 s WS render only calls updateConsoleLiveFields — no broker call there.
      const consoleEl = card.querySelector('.pos-console');
      if (_restingOpenSym) {
        fetchRestingOrders(_restingOpenSym, consoleEl);
        clearInterval(_restingInterval);
        _restingInterval = setInterval(() => {
          const c = document.querySelector(`.pos-card[data-pos-id="${posId}"] .pos-console`);
          if (c) fetchRestingOrders(_restingOpenSym, c);
          else { clearInterval(_restingInterval); _restingInterval = null; }
        }, 30000);
      }
    }
  }

  // ── Tier 2 console — module-level helpers ────────────────────────────────
  // _t2State is initialized in wireConsoleButtons, nulled in toggleConsole/renderPositions.

  function _t2UpdateStagedBar(consoleEl) {
    const bar = consoleEl && consoleEl.querySelector('[data-live="t2-staged-bar"]');
    if (!bar || !_t2State) return;
    const { staged, broker } = _t2State;
    const hasTp = staged.tp != null;
    const hasSl = staged.sl != null;
    if (!hasTp && !hasSl) { bar.style.display = 'none'; return; }
    bar.style.display = '';
    const count = (hasTp ? 1 : 0) + (hasSl ? 1 : 0);
    const parts = [];
    if (broker.tp != null) parts.push('TP $' + broker.tp.toFixed(2));
    if (broker.sl != null) parts.push('SL $' + broker.sl.toFixed(2));
    const brokerStr = parts.length ? 'broker holds ' + parts.join(' · ') : 'broker state unknown';
    const descEl = consoleEl.querySelector('[data-live="t2-staged-desc"]');
    if (descEl) descEl.textContent = count + (count === 1 ? ' change' : ' changes') + ' pending · ' + brokerStr;
  }

  function _t2UpdateArmButton(consoleEl, entry) {
    const armRow = consoleEl && consoleEl.querySelector('[data-live="t2-arm-row"]');
    const armBtn = armRow && armRow.querySelector('.t2-arm-btn');
    if (!armBtn) return;
    const tpInp = consoleEl.querySelector('[data-leg-inp="tp"]');
    const slInp = consoleEl.querySelector('[data-leg-inp="sl"]');
    const tp = tpInp ? parseFloat(tpInp.value) : 0;
    const sl = slInp ? parseFloat(slInp.value) : 0;
    armBtn.disabled = !(tp > 0 && sl > 0 && sl < tp && (!entry || sl < entry));
  }

  function _t2AddChangelog(consoleEl, text) {
    if (!_t2State) return;
    const ts = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });
    _t2State.changelog.unshift({ text, ts });
    const el = consoleEl && consoleEl.querySelector('[data-live="t2-changelog"]');
    if (!el) return;
    el.innerHTML = _t2State.changelog.slice(0, 8).map(entry =>
      '<div class="t2-clog-entry">' +
      '<span class="t2-clog-ts">' + entry.ts + '</span> ' +
      '<span class="t2-clog-text">' + entry.text + '</span>' +
      '</div>'
    ).join('');
  }

  async function _t2FetchLegRows(sym, consoleEl, options) {
    const opts         = options || {};
    const updateInputs = opts.updateInputs !== undefined
      ? opts.updateInputs
      : !(_t2State && _t2State.initialFetchDone);

    let data;
    try {
      data = await apiFetch('/api/orders/resting?option_symbol=' + encodeURIComponent(sym));
    } catch (_) {
      ['tp', 'sl'].forEach(leg => {
        const m = consoleEl && consoleEl.querySelector('[data-leg-meta="' + leg + '"]');
        if (m) m.innerHTML = '<span class="pnl-badge stale">⚠ broker unreachable</span>';
      });
      return null;
    }

    if (!data.ok) {
      ['tp', 'sl'].forEach(leg => {
        const m = consoleEl && consoleEl.querySelector('[data-leg-meta="' + leg + '"]');
        if (m) m.innerHTML = '<span class="pnl-badge stale">⚠ broker unreachable</span>';
      });
      return null;
    }

    const orders  = data.orders || [];
    const tpOrder = orders.find(o => o.price != null && !o.stop_price);
    const slOrder = orders.find(o => o.stop_price != null);
    const tsStr   = new Date().toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

    if (_t2State) {
      _t2State.broker = {
        tp:          tpOrder ? Number(tpOrder.price)      : null,
        sl:          slOrder ? Number(slOrder.stop_price) : null,
        tpId:        tpOrder ? tpOrder.order_id           : null,
        slId:        slOrder ? slOrder.order_id           : null,
        confirmedAt: tsStr,
      };
      _t2State.initialFetchDone = true;
    }

    const mark = _t2State && _t2State.mark;

    for (const [leg, order] of [['tp', tpOrder], ['sl', slOrder]]) {
      const legEl  = consoleEl && consoleEl.querySelector('.t2-leg[data-leg="' + leg + '"]');
      if (!legEl || legEl.classList.contains('t2-leg--propose') || legEl.classList.contains('t2-leg--dimmed')) continue;
      const inp    = legEl.querySelector('[data-leg-inp="' + leg + '"]');
      const metaEl = legEl.querySelector('[data-leg-meta="' + leg + '"]');
      const price  = order ? (leg === 'tp' ? Number(order.price) : Number(order.stop_price)) : null;
      const ordId  = order ? order.order_id : null;

      if (price == null) {
        if (metaEl) metaEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.62rem">— not resting —</span>';
        if (updateInputs && inp) inp.value = '';
        continue;
      }

      if (updateInputs && inp) {
        if (_t2State && _t2State.pctMode && _t2State.entry) {
          const pct = (_t2State.entry > 0) ? ((price / _t2State.entry - 1) * 100) : null;
          inp.value = pct != null ? pct.toFixed(1) : price.toFixed(2);
        } else {
          inp.value = price.toFixed(2);
        }
        inp.dispatchEvent(new Event('input'));
      }

      let pctStr = '';
      if (mark && mark > 0) {
        const pct  = ((price - mark) / mark * 100);
        const sign = pct >= 0 ? '+' : '';
        pctStr = ' · ' + sign + pct.toFixed(1) + '% from mark';
      }
      if (metaEl) {
        metaEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.62rem">id&nbsp;' +
          (ordId || '?') + ' · ' + tsStr + pctStr + '</span>';
      }
    }

    _t2UpdateStagedBar(consoleEl);

    if (opts.verify) {
      const { tp: sentTp, sl: sentSl } = opts.verify;
      const b = (_t2State || {}).broker || {};
      const tpMatch = sentTp == null || (b.tp != null && Math.abs(b.tp - sentTp) < 0.005);
      const slMatch = sentSl == null || (b.sl != null && Math.abs(b.sl - sentSl) < 0.005);
      return { tpMatch, slMatch };
    }

    return null;
  }

  function wireConsoleButtons(card, pos) {
    const pid    = pos.position_id;
    const cts    = pos.contracts_open || 1;
    const entry  = pos.entry_price || 0;
    const sym    = pos.option_symbol || `${pos.ticker} $${pos.strike} ${pos.direction}`;
    const ticker = pos.ticker || '?';

    _t2State = {
      staged:           { tp: null, sl: null },
      broker:           { tp: null, sl: null, tpId: null, slId: null, confirmedAt: null },
      mark:             pos.current_price || null,
      entry:            entry,
      pctMode:          false,
      changelog:        [],
      initialFetchDone: false,
    };

    const consoleEl = card.querySelector('.pos-console');

    function fmtProceeds(price, qty) { return '$' + (price * qty * 100).toFixed(2); }
    function fmtGain(price, qty) {
      if (!entry) return '—';
      const pct  = ((price - entry) / entry * 100).toFixed(1);
      const cash = ((price - entry) * qty * 100).toFixed(2);
      const sign = price >= entry ? '+' : '';
      return sign + pct + '% ($' + sign + cash + ')';
    }
    function setStratStatus(msg, cls) {
      const el = consoleEl && consoleEl.querySelector('[data-live="t2-strategy-status"]');
      if (!el) return;
      el.textContent = msg;
      el.className   = 't2-strategy-status' + (cls ? ' t2-strategy-status--' + cls : '');
    }
    function setApplyStatus(el, msg, cls) {
      if (!el) return;
      el.textContent   = msg;
      el.className     = 't2-apply-status' + (cls ? ' ' + cls : '');
      el.style.display = msg ? '' : 'none';
    }

    // ── Pre-populate resting close price on first open ───────────────────────
    // If the console opens while the position is closing_pending and we have no
    // cached price (e.g. after a page reload), fetch from /api/orders/resting so
    // the tag shows the actual resting price rather than the fallback text.
    if (pos.state === 'closing_pending' && sym && !_closeRestingState.has(pid)) {
      (async () => {
        try {
          const orders = await apiFetch('/api/orders/resting?option_symbol=' + encodeURIComponent(sym));
          if (!Array.isArray(orders)) return;
          const limitClose = orders.find(o => o.price != null && !o.stop_price);
          if (!limitClose) return;
          _closeRestingState.set(pid, { price: Number(limitClose.price) });
          const btn = card.querySelector('.pos-console-close-btn');
          if (btn && !btn.disabled) {
            const tag = btn.querySelector('.pos-preview-tag');
            if (tag) tag.textContent = 'resting $' + Number(limitClose.price).toFixed(2) + ' · press to reprice';
          }
        } catch (_) {
          // Fetch failed — show a distinct state so it is not confused with
          // "not yet fetched". Price stays absent; user should check broker.
          const btn = card.querySelector('.pos-console-close-btn');
          if (btn && !btn.disabled) {
            const tag = btn.querySelector('.pos-preview-tag');
            if (tag && tag.textContent.includes('resting limit')) {
              tag.textContent = 'resting · price unavailable · press to reprice';
            }
          }
        }
      })();
    }

    // ── Exit button — limit close at mid, re-pressable to reprice ────────────
    const closeBtn = card.querySelector('.pos-console-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const livePos = currentPositions.find(p => p.position_id === pid) || pos;

        // ── Reprice path — position already has a resting limit close ──────
        if (livePos.state === 'closing_pending') {
          const resting = _closeRestingState.get(pid);
          const restingStr = resting ? '$' + resting.price.toFixed(2) : 'limit';

          const doReprice = async (setStatus) => {
            setStatus('Fetching live mid and repricing…');
            try {
              const result = await apiPost('/api/v1/orders/close/reprice', {
                position_id: pid,
              });
              if (result.ok) {
                if (result.confirmed_price != null) {
                  _closeRestingState.set(pid, { price: result.confirmed_price });
                  setStatus('Resting $' + result.confirmed_price.toFixed(2) + ' GTC.', 'ok');
                } else {
                  // Modify accepted but re-read failed — do not display any price as confirmed
                  _closeRestingState.delete(pid);
                  setStatus('Repriced — price unverified, check broker.', 'warn');
                }
              } else {
                setStatus('Reprice failed: ' + (result.error || 'unknown').slice(0, 60), 'error');
              }
            } catch(err) {
              const detail = (err.data && err.data.detail) || err.message || 'unknown';
              if (err.status === 503)      setStatus('Kill-switch OFF — ' + detail.slice(0, 50), 'error');
              else if (err.status === 403) setStatus('Admin access required', 'error');
              else                         setStatus('Error: ' + detail.slice(0, 50), 'error');
            }
          };

          const doMarket = async (setStatus) => {
            setStatus('Placing market close…');
            try {
              const result = await apiPost('/api/v1/orders/close', { position_id: pid, order_type: 'market' });
              if (result.status === 'closed') {
                setStatus('Closed @ $' + (result.fill_price || '?'), 'ok');
              } else if (result.status === 'closing_pending') {
                setStatus('Fill unconfirmed — GTC limit remains; reconciling.', 'warn');
              } else if (result.status === 'pdt_protected') {
                setStatus('PDT protected — close manually in broker.', 'error');
              } else {
                setStatus('Unexpected status: ' + (result.status || 'unknown'), 'error');
              }
            } catch(err) {
              const detail = (err.data && err.data.detail) || err.message || 'unknown';
              if (err.status === 503)      setStatus('Kill-switch OFF', 'error');
              else if (err.status === 403) setStatus('Admin access required', 'error');
              else                         setStatus('Error: ' + detail.slice(0, 50), 'error');
            }
          };

          showConfirmModal({
            title:    'Resting close · ' + ticker,
            body:     '<strong>' + sym + '</strong><br>' +
                      'Currently resting: <strong>' + restingStr + '</strong> GTC<br>' +
                      'New price: <strong>live mid fetched at request time</strong><br><br>' +
                      '<span style="color:var(--text-muted);font-size:0.68rem">Reprice moves the limit to current mid — passive, may not fill.<br>' +
                      'Exit at market fills immediately but may slip on wide spreads.</span>',
            okLabel:  'Reprice to live mid',
            okClass:  '',
            onOk:     doReprice,
            altLabel: 'Exit at market instead',
            altClass: 'danger',
            onAlt:    doMarket,
          });
          return;
        }

        // ── First-press path — place limit at current mid ──────────────────
        const mid = (_t2State && _t2State.mark) || livePos.current_price;
        showConfirmModal({
          title:   'Close ' + ticker + ' · limit at mid',
          body:    '<strong>' + sym + '</strong><br>' +
                   'Qty: <strong>' + cts + ' contract' + (cts !== 1 ? 's' : '') + '</strong> · entry $' + entry.toFixed(2) + '<br>' +
                   'Limit: <strong>' + (mid ? '$' + mid.toFixed(2) : '— (no live price)') + '</strong> (current mid, GTC)<br><br>' +
                   '<span style="color:var(--text-muted);font-size:0.68rem">Passive limit — may not fill. Press the button again to reprice or exit at market.</span>',
          okLabel: 'Place limit at ' + (mid ? '$' + mid.toFixed(2) : 'mid'),
          okClass: 'danger',
          onOk: async (setStatus) => {
            if (!mid || mid <= 0) { setStatus('No live price — wait for a quote.', 'error'); return; }
            setStatus('Placing limit close…');
            try {
              const result = await apiPost('/api/v1/orders/close', {
                position_id: pid,
                order_type:  'limit',
                limit_price: Math.round(mid * 100) / 100,
                tif:         'gtc',
              });
              if (result.status === 'closing_pending') {
                const rPrice = result.limit_price || mid;
                _closeRestingState.set(pid, { price: rPrice });
                setStatus('Resting $' + rPrice.toFixed(2) + ' GTC · press button again to reprice or exit at market.', 'ok');
              } else if (result.status === 'pdt_protected') {
                setStatus('PDT protected — exit manually in broker.', 'error');
              } else if (result.status === 'dry_run') {
                setStatus('Dry-run (EXIT_ORDERS_ENABLED=False) — no order placed.', 'warn');
              } else {
                setStatus('Unexpected status: ' + (result.status || 'unknown'), 'error');
              }
            } catch(err) {
              const detail = (err.data && err.data.detail) || err.message;
              if (err.status === 503)      setStatus('Kill-switch OFF — web trading disabled', 'error');
              else if (err.status === 403) setStatus('Admin access required', 'error');
              else                         setStatus('Error: ' + detail, 'error');
            }
          },
        });
      });
    }

    // ── Strategy dropdown ─────────────────────────────────────────────────────
    const stratSel = consoleEl && consoleEl.querySelector('.t2-strategy-sel');
    const curLayer = pos.exit_layer || 'default';
    if (stratSel) {
      stratSel.addEventListener('change', e => {
        e.stopPropagation();
        const newVal = stratSel.value;

        if ((curLayer === 'oco_bracket' || curLayer === 'stop_only' || curLayer === 'tp_only') && newVal === 'default') {
          stratSel.value = curLayer; // revert until cancel modal confirms
          const isOco  = curLayer === 'oco_bracket';
          const isTp   = curLayer === 'tp_only';
          const title  = isOco ? 'Cancel OCO Bracket' : isTp ? 'Cancel TP Order' : 'Cancel Stop';
          const warn   = isOco ? 'Both legs of the OCO bracket will be cancelled.'
                       : isTp  ? 'The resting TP limit order will be cancelled.'
                       :         'The protective stop will be cancelled.';
          const body2  = isOco ? 'The TP limit <em>and</em> the protective stop for <strong>' + ticker + '</strong> will be removed. Bot exits resume within ~30 s.'
                       : isTp  ? 'The TP limit for <strong>' + ticker + '</strong> will be removed. Bot trail stop manages the exit.'
                       :         'The stop for <strong>' + ticker + '</strong> will be removed. Bot exits resume within ~30 s.';
          const okLbl  = isOco ? 'Cancel bracket — both legs' : isTp ? 'Cancel TP order' : 'Cancel stop';
          showConfirmModal({
            title:   title + ' — ' + ticker,
            body:    '<strong style="color:var(--danger)">⚠ ' + warn + '</strong><br><br>' +
                     body2 + '<br><br>' +
                     'Option: <code style="font-size:0.8rem">' + sym + '</code>',
            okLabel: okLbl,
            okClass: 'danger',
            onOk: async (setModalStatus) => {
              setModalStatus('Canceling…');
              try {
                const result = await apiPost('/api/orders/cancel-bracket', { position_id: pid });
                if (result.ok) {
                  setModalStatus('Canceled — bot exits resumed', 'ok');
                  setStratStatus('Canceled — bot exits resumed', 'ok');
                  _pollOrders();
                  if (_restingOpenSym && consoleEl) _t2FetchLegRows(_restingOpenSym, consoleEl, { updateInputs: true });
                } else if (result.reason === 'already_filled') {
                  setModalStatus('A leg already filled — position is closing.', 'error');
                  _pollOrders();
                } else {
                  setModalStatus('Error: ' + (result.error || 'cancel failed'), 'error');
                }
              } catch (err) {
                const detail = err.data && err.data.detail ? err.data.detail : err.message;
                setModalStatus('Error: ' + detail, 'error');
              }
            },
          });
          return;
        }

        if (curLayer === 'default' && newVal === 'oco_bracket') {
          const armRowEl = consoleEl.querySelector('[data-live="t2-arm-row"]');
          if (armRowEl) {
            armRowEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
            armRowEl.classList.add('t2-arm-row--flash');
            setTimeout(() => armRowEl.classList.remove('t2-arm-row--flash'), 800);
          }
        }
      });
    }

    // ── Nudge buttons ─────────────────────────────────────────────────────────
    consoleEl && consoleEl.querySelectorAll('.t2-nudge').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const leg = btn.dataset.nudge;
        const dir = Number(btn.dataset.dir);
        const inp = consoleEl.querySelector('[data-leg-inp="' + leg + '"]');
        if (!inp) return;
        const isPct = _t2State && _t2State.pctMode;
        const step  = isPct ? 0.1 : 0.01;
        const cur   = parseFloat(inp.value) || (isPct
          ? (_t2State.broker[leg] != null ? _toPct(_t2State.broker[leg]) : 0)
          : ((_t2State && _t2State.broker && _t2State.broker[leg]) || 0));
        const next  = Math.max(isPct ? -99.9 : 0.01, cur + dir * step);
        inp.value   = next.toFixed(isPct ? 1 : 2);
        inp.dispatchEvent(new Event('input', { bubbles: true }));
      });
    });

    // ── % / $ mode toggle and annotation helpers ──────────────────────────────
    function _toDollar(pct)  { return entry > 0 ? entry * (1 + pct / 100)       : null; }
    function _toPct(dollar)  { return entry > 0 ? (dollar / entry - 1) * 100    : null; }
    function _fmtAnnot(dollar) {
      if (!dollar || !entry) return '';
      const pct  = _toPct(dollar);
      const sign = pct >= 0 ? '+' : '';
      return _t2State && _t2State.pctMode
        ? (sign + pct.toFixed(1) + '% · $' + dollar.toFixed(2))
        : ('$' + dollar.toFixed(2) + ' · ' + sign + pct.toFixed(1) + '%');
    }
    function _updateAnnot(leg, dollar) {
      const el = consoleEl && consoleEl.querySelector('[data-leg-annot="' + leg + '"]');
      if (el) el.textContent = dollar ? _fmtAnnot(dollar) : '';
    }
    function _inputDollar(leg) {
      const inp = consoleEl && consoleEl.querySelector('[data-leg-inp="' + leg + '"]');
      if (!inp || !inp.value) return null;
      const v = parseFloat(inp.value);
      if (isNaN(v)) return null;
      return (_t2State && _t2State.pctMode) ? _toDollar(v) : v;
    }

    const modeToggle = consoleEl && consoleEl.querySelector('[data-live="t2-mode-toggle"]');
    if (modeToggle) {
      modeToggle.addEventListener('click', e => {
        e.stopPropagation();
        if (!_t2State) return;
        const wasPct = _t2State.pctMode;
        _t2State.pctMode = !wasPct;
        modeToggle.textContent = _t2State.pctMode ? '%' : '$';
        modeToggle.classList.toggle('t2-mode-toggle--active', _t2State.pctMode);
        // Update hints
        const hintEl = consoleEl.querySelector('[data-live="t2-legs-hint"]');
        if (hintEl) hintEl.textContent = _t2State.pctMode ? '% of entry $' + entry.toFixed(2) : 'enter option premiums ($)';
        // Re-render each input in the new mode
        ['tp', 'sl'].forEach(leg => {
          const inp = consoleEl.querySelector('[data-leg-inp="' + leg + '"]');
          if (!inp) return;
          const rawV = parseFloat(inp.value);
          if (isNaN(rawV) || rawV === 0) { inp.step = _t2State.pctMode ? '0.1' : '0.01'; inp.placeholder = _t2State.pctMode ? '0.0' : '0.00'; return; }
          const dollar = wasPct ? _toDollar(rawV) : rawV;
          if (_t2State.pctMode) {
            const pct = _toPct(dollar);
            inp.value = pct != null ? pct.toFixed(1) : '';
          } else {
            inp.value = dollar != null ? dollar.toFixed(2) : '';
          }
          inp.step        = _t2State.pctMode ? '0.1' : '0.01';
          inp.placeholder = _t2State.pctMode ? '0.0' : '0.00';
          _updateAnnot(leg, dollar);
        });
      });
    }

    // ── Leg inputs (edit mode) — staged state ─────────────────────────────────
    ['tp', 'sl'].forEach(leg => {
      const legEl = consoleEl && consoleEl.querySelector('.t2-leg:not(.t2-leg--propose)[data-leg="' + leg + '"]');
      if (!legEl) return;
      const inp    = legEl.querySelector('[data-leg-inp="' + leg + '"]');
      const staged = legEl.querySelector('[data-staged="' + leg + '"]');
      if (!inp) return;
      inp.addEventListener('input', e => {
        e.stopPropagation();
        if (!_t2State) return;
        const raw    = parseFloat(inp.value);
        const dollar = (!isNaN(raw) && raw > 0) ? ((_t2State.pctMode) ? _toDollar(raw) : raw) : null;
        const broker = _t2State.broker[leg];
        if (dollar && (broker == null || Math.abs(dollar - broker) >= 0.005)) {
          _t2State.staged[leg] = dollar;
          if (staged) { staged.textContent = '→ $' + dollar.toFixed(2); staged.style.display = ''; }
        } else {
          _t2State.staged[leg] = null;
          if (staged) staged.style.display = 'none';
        }
        _updateAnnot(leg, dollar);
        _t2UpdateStagedBar(consoleEl);
      });
    });

    // ── Propose-mode inputs — update arm button + annotation on each keystroke ─
    consoleEl && consoleEl.querySelectorAll('.t2-leg--propose [data-leg-inp]').forEach(inp => {
      inp.addEventListener('input', e => {
        e.stopPropagation();
        _t2UpdateArmButton(consoleEl, entry);
        const leg    = inp.dataset.legInp;
        const raw    = parseFloat(inp.value);
        const dollar = (!isNaN(raw) && raw > 0) ? ((_t2State && _t2State.pctMode) ? _toDollar(raw) : raw) : null;
        _updateAnnot(leg, dollar);
      });
    });

    // ── Arm bracket ───────────────────────────────────────────────────────────
    const armBtn    = consoleEl && consoleEl.querySelector('.t2-arm-btn');
    const armStatus = consoleEl && consoleEl.querySelector('[data-live="t2-arm-status"]');
    if (armBtn) {
      armBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const tpInp = consoleEl.querySelector('[data-leg-inp="tp"]');
        const slInp = consoleEl.querySelector('[data-leg-inp="sl"]');
        const tpRaw = parseFloat(tpInp && tpInp.value || '0');
        const slRaw = parseFloat(slInp && slInp.value || '0');
        const tp = (_t2State && _t2State.pctMode) ? (_toDollar(tpRaw) || 0) : tpRaw;
        const sl = (_t2State && _t2State.pctMode) ? (_toDollar(slRaw) || 0) : slRaw;

        if (!(tp > 0) || !(sl > 0)) {
          if (armStatus) { armStatus.textContent = 'Enter both TP and SL prices.'; armStatus.className = 't2-arm-status t2-arm-status--error'; }
          return;
        }
        if (sl >= tp) {
          if (armStatus) { armStatus.textContent = 'Stop must be below TP.'; armStatus.className = 't2-arm-status t2-arm-status--error'; }
          return;
        }
        if (entry && sl >= entry) {
          if (armStatus) { armStatus.textContent = 'Stop ($' + sl.toFixed(2) + ') at or above entry ($' + entry.toFixed(2) + ') — would trigger immediately.'; armStatus.className = 't2-arm-status t2-arm-status--error'; }
          return;
        }

        armBtn.disabled = true;
        if (armStatus) { armStatus.textContent = 'Placing bracket…'; armStatus.className = 't2-arm-status'; }

        try {
          const result = await apiPost('/api/trading/place-bracket', { position_id: pid, tp_price: tp, stop_price: sl });
          if (!result.ok) {
            armBtn.disabled = false;
            if (armStatus) { armStatus.textContent = 'Rejected: ' + (result.error || result.detail || 'placement failed'); armStatus.className = 't2-arm-status t2-arm-status--error'; }
            return;
          }

          if (armStatus) { armStatus.textContent = 'Placed — verifying with broker…'; armStatus.className = 't2-arm-status'; }

          const rsym   = _restingOpenSym || sym;
          const verify = await _t2FetchLegRows(rsym, consoleEl, { updateInputs: true, verify: { tp, sl } });

          if (verify) {
            const { tpMatch, slMatch } = verify;
            if (tpMatch && slMatch) {
              if (armStatus) { armStatus.textContent = 'Bracket armed — TP and SL confirmed at broker.'; armStatus.className = 't2-arm-status t2-arm-status--ok'; }
              _t2AddChangelog(consoleEl, 'Bracket armed: TP $' + tp.toFixed(2) + ' · SL $' + sl.toFixed(2) + ' — confirmed');
            } else {
              const legs = [!tpMatch && 'TP', !slMatch && 'SL'].filter(Boolean).join(' and ');
              if (armStatus) { armStatus.textContent = 'Placement accepted but ' + legs + ' not confirmed by re-read. Legs may be out of sync.'; armStatus.className = 't2-arm-status t2-arm-status--error'; }
              _t2AddChangelog(consoleEl, 'Bracket arm: ' + legs + ' MISMATCH — re-read did not confirm');
            }
          } else {
            if (armStatus) { armStatus.textContent = 'Placed but broker re-read failed — check resting orders manually.'; armStatus.className = 't2-arm-status t2-arm-status--error'; }
          }

          _pollOrders();
        } catch (err) {
          armBtn.disabled = false;
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          if (armStatus) { armStatus.textContent = 'Error: ' + detail; armStatus.className = 't2-arm-status t2-arm-status--error'; }
        }
      });
    }

    // ── Discard staged changes ────────────────────────────────────────────────
    const discardBtn = consoleEl && consoleEl.querySelector('.t2-discard-btn');
    if (discardBtn) {
      discardBtn.addEventListener('click', e => {
        e.stopPropagation();
        if (!_t2State) return;
        _t2State.staged = { tp: null, sl: null };
        ['tp', 'sl'].forEach(leg => {
          const inp    = consoleEl.querySelector('.t2-leg:not(.t2-leg--propose) [data-leg-inp="' + leg + '"]');
          const staged = consoleEl.querySelector('[data-staged="' + leg + '"]');
          const price  = _t2State.broker[leg];
          if (inp && price != null) {
            if (_t2State.pctMode) {
              const pct = _toPct(price);
              inp.value = pct != null ? pct.toFixed(1) : price.toFixed(2);
            } else {
              inp.value = price.toFixed(2);
            }
            inp.dispatchEvent(new Event('input'));
          }
          if (staged) staged.style.display = 'none';
        });
        _t2UpdateStagedBar(consoleEl);
      });
    }

    // ── Apply staged changes ──────────────────────────────────────────────────
    const applyBtn    = consoleEl && consoleEl.querySelector('.t2-apply-btn');
    const applyStatus = consoleEl && consoleEl.querySelector('[data-live="t2-apply-status"]');
    if (applyBtn) {
      applyBtn.addEventListener('click', async e => {
        e.stopPropagation();
        if (!_t2State) return;

        const { staged, broker } = _t2State;
        const sentTp = staged.tp != null ? staged.tp : broker.tp;
        const sentSl = staged.sl != null ? staged.sl : broker.sl;

        if (sentTp == null || sentSl == null) {
          setApplyStatus(applyStatus, 'Cannot apply — broker prices unknown. Wait for re-read.', 'error');
          return;
        }
        if (sentSl >= sentTp) {
          setApplyStatus(applyStatus, 'Stop must be below TP.', 'error');
          return;
        }

        applyBtn.disabled = true;
        setApplyStatus(applyStatus, 'Sending to broker…');

        try {
          const payload = { position_id: pid };
          if (staged.tp != null) payload.tp_price   = staged.tp;
          if (staged.sl != null) payload.stop_price = staged.sl;

          const result = await apiPost('/api/orders/modify-bracket', payload);

          if (!result.ok && result.reason === 'rejected') {
            applyBtn.disabled = false;
            setApplyStatus(applyStatus, 'Broker rejected both changes. Legs unchanged.', 'error');
            _t2AddChangelog(consoleEl, 'Modify rejected — broker unchanged');
            return;
          }

          setApplyStatus(applyStatus, 'Accepted — verifying with broker…');

          const rsym   = _restingOpenSym || sym;
          const verify = await _t2FetchLegRows(rsym, consoleEl, { updateInputs: true, verify: { tp: sentTp, sl: sentSl } });

          applyBtn.disabled = false;

          if (!verify) {
            setApplyStatus(applyStatus, 'Broker re-read failed. Check resting orders.', 'error');
            _t2AddChangelog(consoleEl, 'Modify: re-read failed — verification incomplete');
            return;
          }

          const { tpMatch, slMatch } = verify;
          if (tpMatch && slMatch) {
            _t2State.staged = { tp: null, sl: null };
            ['tp', 'sl'].forEach(leg => {
              const el = consoleEl.querySelector('[data-staged="' + leg + '"]');
              if (el) el.style.display = 'none';
            });
            _t2UpdateStagedBar(consoleEl);
            setApplyStatus(applyStatus, 'MATCH — both legs confirmed at broker.', 'ok');
            _t2AddChangelog(consoleEl, 'Applied: TP $' + sentTp.toFixed(2) + ' · SL $' + sentSl.toFixed(2) + ' — both legs confirmed');
          } else {
            const synced  = [tpMatch && 'TP', slMatch && 'SL'].filter(Boolean);
            const drifted = [!tpMatch && 'TP', !slMatch && 'SL'].filter(Boolean);
            setApplyStatus(applyStatus,
              'MISMATCH: ' + drifted.join(' and ') + ' did not move' +
              (synced.length ? '; ' + synced.join(' and ') + ' confirmed' : '') +
              '. Legs are out of sync.',
              'error'
            );
            _t2AddChangelog(consoleEl, 'Modify MISMATCH: ' + drifted.join(', ') + ' not confirmed by broker');
            if (tpMatch) _t2State.staged.tp = null;
            if (slMatch) _t2State.staged.sl = null;
            _t2UpdateStagedBar(consoleEl);
          }

          _pollOrders();
        } catch (err) {
          applyBtn.disabled = false;
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          setApplyStatus(applyStatus, 'Error: ' + detail, 'error');
        }
      });
    }

    // ── Profit-only ticket (admin-gated) ──────────────────────────────────────
    const profitTpInp   = consoleEl && consoleEl.querySelector('.t2-profit-tp-inp');
    const profitQtyInp  = consoleEl && consoleEl.querySelector('.t2-profit-qty-inp');
    const profitTifSel  = consoleEl && consoleEl.querySelector('.t2-profit-tif-sel');
    const profitStatus  = consoleEl && consoleEl.querySelector('.t2-profit-status');
    const profitReview  = consoleEl && consoleEl.querySelector('.t2-profit-review');
    const profitRevBody = consoleEl && consoleEl.querySelector('.t2-profit-review-body');
    const profitRevBtn  = consoleEl && consoleEl.querySelector('.t2-profit-review-btn');
    const profitConfBtn = consoleEl && consoleEl.querySelector('.t2-profit-confirm-btn');

    function setProfitStatus(msg, cls) {
      if (!profitStatus) return;
      profitStatus.textContent = msg;
      profitStatus.className   = 't2-profit-status' + (cls ? ' ' + cls : '');
    }

    if (profitRevBtn) {
      profitRevBtn.addEventListener('click', e => {
        e.stopPropagation();
        const tp  = parseFloat(profitTpInp  && profitTpInp.value  || '0');
        const qty = parseInt(profitQtyInp   && profitQtyInp.value  || '0', 10);
        const tif = profitTifSel ? profitTifSel.value : 'gtc';
        if (!(tp > 0))   { setProfitStatus('Enter a valid TP limit price.', 'error'); return; }
        if (!(qty >= 1)) { setProfitStatus('Enter a valid quantity.', 'error'); return; }
        if (qty > cts)   { setProfitStatus('Qty exceeds contracts open (' + cts + ').', 'error'); return; }
        if (profitRevBody) profitRevBody.innerHTML =
          '<div class="t2-review-line"><span class="t2-review-lbl">TP limit</span> $' + tp.toFixed(2) + '</div>' +
          '<div class="t2-review-line"><span class="t2-review-lbl">Proceeds</span> ' + fmtProceeds(tp, qty) + '</div>' +
          '<div class="t2-review-line"><span class="t2-review-lbl">vs entry</span> ' + fmtGain(tp, qty) + '</div>' +
          (entry && tp < entry ? '<div class="t2-review-line" style="color:var(--warning)">⚠ TP below entry ($' + entry.toFixed(2) + ') — limit sells at a loss if filled</div>' : '') +
          '<div class="t2-review-line"><span class="t2-review-lbl">Qty / TIF</span> ' + qty + '× ' + tif.toUpperCase() + '</div>';
        if (profitReview) {
          profitReview.style.display = '';
          profitReview.dataset.tp    = tp;
          profitReview.dataset.qty   = qty;
          profitReview.dataset.tif   = tif;
        }
        setProfitStatus('', '');
      });
    }

    if (profitConfBtn) {
      profitConfBtn.addEventListener('click', async e => {
        e.stopPropagation();
        const tp  = parseFloat(profitReview && profitReview.dataset.tp  || '0');
        const qty = parseInt(profitReview   && profitReview.dataset.qty || '0', 10);
        const tif = (profitReview && profitReview.dataset.tif) || 'gtc';
        if (!(tp > 0) || !(qty >= 1)) { setProfitStatus('Review the order first.', 'error'); return; }
        profitConfBtn.disabled = true;
        setProfitStatus('Placing limit order…');
        try {
          const result = await apiPost('/api/v1/orders/close', { position_id: pid, order_type: 'limit', limit_price: tp, quantity: qty, tif });
          if (result.status === 'closing_pending') {
            setProfitStatus('Resting at $' + result.limit_price.toFixed(2) + ' ' + tif.toUpperCase() + ' — fill reconciles automatically.', 'ok');
            if (_restingOpenSym && consoleEl) fetchRestingOrders(_restingOpenSym, consoleEl);
          } else if (result.status === 'pdt_protected') {
            setProfitStatus('PDT protected — close manually.', 'error');
            profitConfBtn.disabled = false;
          } else {
            setProfitStatus('Unexpected: ' + result.status, 'warn');
            profitConfBtn.disabled = false;
          }
        } catch(err) {
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          setProfitStatus('Error: ' + detail, 'error');
          profitConfBtn.disabled = false;
        }
      });
    }

    // ── SELL NOW — wire any data-sell-pid buttons in the console ─────────────
    // _setSellNowState also rewires after each state change, so this only handles
    // the initial button created by buildConsoleHtml via _sellSlotContent.
    consoleEl && consoleEl.querySelectorAll('[data-sell-pid]').forEach(btn => {
      btn.addEventListener('pointerdown', e => { e.preventDefault(); _startSellNowHold(btn, btn.dataset.sellPid); });
      btn.addEventListener('pointerup',    _cancelSellNowHold);
      btn.addEventListener('pointercancel', _cancelSellNowHold);
      btn.addEventListener('pointerleave',  _cancelSellNowHold);
    });
  }

  // Updates live fields in the tier 2 console node without rebuilding it.
  // Called on each WS tick while the console is open (hot-path reattach).
  function updateConsoleLiveFields(consoleEl, pos) {
    const ps = priceState(pos.current_price, pos.price_age_secs);

    // Keep _t2State.mark current so leg metadata % from mark stays fresh.
    if (_t2State && pos.current_price != null) _t2State.mark = pos.current_price;

    function set(attr, text) {
      const el = consoleEl.querySelector('[data-live="' + attr + '"]');
      if (el) el.textContent = text;
    }

    // Trail state
    const tw = pos.trail_width != null ? (pos.trail_width * 100).toFixed(0) + '%' : '—';
    const trailArmEl = consoleEl.querySelector('[data-live="t2-trail-arm"]');
    if (trailArmEl) {
      trailArmEl.textContent = pos.trail_armed ? '⬆ armed' : '⭕ waiting';
      trailArmEl.classList.toggle('t2-val--armed', !!pos.trail_armed);
    }
    set('t2-trail-width', tw);
    set('t2-trail-stop',  pos.trail_stop_price ? fmtPrice(pos.trail_stop_price) : '—');
    const botSummaryEl = consoleEl.querySelector('.t2-bot-summary');
    if (botSummaryEl) botSummaryEl.classList.toggle('t2-bot-summary--armed', !!pos.trail_armed);

    // Truth-sync strategy select. Skip while a pending-intent selection is active
    // (user chose OCO but hasn't armed yet; truth still 'default'). Sync fires as
    // soon as truth moves (arm confirmed, bracket cancelled, position state changes)
    // or when the console is closed and rebuilt from scratch.
    const stratSelEl = consoleEl.querySelector('.t2-strategy-sel');
    if (stratSelEl) {
      const truth = pos.exit_layer || 'default';
      if (!(stratSelEl.value !== truth && truth === 'default')) stratSelEl.value = truth;
    }

    // Refresh leg metadata % from mark on every WS tick
    if (_t2State && _t2State.broker && pos.current_price != null) {
      const mark = pos.current_price;
      for (const leg of ['tp', 'sl']) {
        const price  = _t2State.broker[leg];
        const ordId  = _t2State.broker[leg === 'tp' ? 'tpId' : 'slId'];
        const ts     = _t2State.broker.confirmedAt;
        if (!price) continue;
        const metaEl = consoleEl.querySelector('[data-leg-meta="' + leg + '"]');
        if (!metaEl) continue;
        const pct  = ((price - mark) / mark * 100);
        const sign = pct >= 0 ? '+' : '';
        metaEl.innerHTML = '<span style="color:var(--text-muted);font-size:0.62rem">id&nbsp;' +
          (ordId || '?') + (ts ? ' · ' + ts : '') +
          ' · ' + sign + pct.toFixed(1) + '% from mark</span>';
      }
    }

    // Exit button — sync with closing_pending transitions.
    // In closing_pending the button stays enabled; click fires reprice path.
    const closeBtn = consoleEl.querySelector('.pos-console-close-btn');
    if (closeBtn && !closeBtn.disabled) {  // skip if temporarily disabled by reprice in-flight
      const isPending = pos.state === 'closing_pending';
      const tag = closeBtn.querySelector('.pos-preview-tag');
      if (isPending) {
        const resting = _closeRestingState.get(pos.position_id);
        if (tag) tag.textContent = resting
          ? 'resting $' + resting.price.toFixed(2) + ' · press to reprice'
          : 'resting limit · press to reprice · gated';
      } else {
        if (tag) tag.textContent = 'limit · may not fill · gated';
      }
    }
  }

  // Fetches resting orders.  For tier 2 consoles, drives the TP/SL leg rows
  // via _t2FetchLegRows.  Called on console open, after any mutation, and on
  // the 30 s poll cadence.
  async function fetchRestingOrders(sym, consoleEl) {
    if (!consoleEl || !sym) return;
    if (consoleEl.classList.contains('t2-console')) {
      return _t2FetchLegRows(sym, consoleEl);
    }
    // Legacy path for any non-tier-2 console still in the DOM.
    const el = consoleEl.querySelector('[data-live="resting-orders"]');
    if (!el) return;
    try {
      const data = await apiFetch('/api/orders/resting?option_symbol=' + encodeURIComponent(sym));
      if (!data.ok) { el.innerHTML = '<span class="pnl-badge stale">⚠ could not reach broker</span>'; return; }
      if (!data.orders || !data.orders.length) { el.innerHTML = '<span style="color:var(--text-muted);font-size:0.75rem">— none resting —</span>'; return; }
      el.innerHTML = data.orders.map(o => {
        const priceStr = o.stop_price ? 'stop $' + o.stop_price.toFixed(2) : (o.price ? 'limit $' + o.price.toFixed(2) : '—');
        const dur = o.duration ? o.duration.toUpperCase() : '';
        return '<div class="pos-target-row">' +
          '<span class="pos-target-type">' + (o.type || '?').toUpperCase() + '</span>' +
          '<span class="pos-target-price">' + priceStr + '</span>' +
          '<span class="pos-target-badge">' + (o.quantity || '?') + '× · ' + (o.status || '') + ' · ' + dur + '</span>' +
          '<span style="color:var(--text-muted);font-size:0.65rem;margin-left:0.4rem">id&nbsp;' + (o.order_id || '?') + '</span>' +
          '</div>';
      }).join('');
    } catch (_) {
      el.innerHTML = '<span class="pnl-badge stale">⚠ could not reach broker</span>';
    }
  }

  // Fetches /api/orders/working, updates _lastOrdersData, then re-renders positions.
  // Called on the 30 s interval and by cancel/modify handlers after an action completes.
  async function _pollOrders() {
    try {
      const data = await apiFetch('/api/orders/working');
      if (!data.ok) {
        _lastOrdersData = { ok: false, orders: null, fetchedAt: Date.now() };
      } else {
        _lastOrdersData = { ok: true, orders: data.orders || [], fetchedAt: Date.now() };
      }
    } catch (err) {
      if (err.status === 403) {
        // Not authorized — stop polling.  Mirrors loadIndexLevels 403 handler.
        clearInterval(_workingInterval);
        _workingInterval = null;
      }
      _lastOrdersData = { ok: false, orders: null, fetchedAt: Date.now() };
    }
    renderPositions(currentPositions);
  }

  // Returns seconds-ago string for the last successful orders fetch, or '' if not yet fetched.
  // Only displayed when ok === true so stale data is never claimed as fresh.
  function _fmtOrdersAge() {
    if (_lastOrdersData.ok !== true || !_lastOrdersData.fetchedAt) return '';
    const secs = Math.round((Date.now() - _lastOrdersData.fetchedAt) / 1000);
    if (secs < 5)  return 'just refreshed';
    if (secs < 60) return 'refreshed ' + secs + 's ago';
    return 'refreshed ' + Math.floor(secs / 60) + 'm ago';
  }

  // Renders a single order row for the orphan section (unmatched working orders only).
  function _renderOrderRow(o) {
    const isStop  = o.classification === 'protective_stop';
    const isEntry = o.classification === 'entry';
    const dirCls  = isEntry ? 'call' : isStop ? 'put' : '';
    const clsLabel = isEntry ? 'ENTRY'
                   : isStop  ? 'STOP ⚠'
                   : o.classification === 'take_profit' ? 'TP'
                   : 'ORDER';
    const priceStr = o.stop_price
      ? 'stop $' + Number(o.stop_price).toFixed(2)
      : (o.price ? 'limit $' + Number(o.price).toFixed(2) : '—');
    const sym      = o.option_symbol || o.ticker || '?';
    const dur      = o.duration ? o.duration.toUpperCase() : '';
    const safeSym  = (sym + '').replace(/"/g, '&quot;');
    const untracked = !o.tracked
      ? ' <span class="pnl-badge stale" title="Broker has this order but system does not track it">untracked</span>'
      : '';
    const cancelBtn = '<button class="pos-console-btn' + (isStop ? ' danger' : '') + '"' +
      ' style="margin-left:auto;font-size:0.65rem;padding:0.1rem 0.4rem"' +
      ' data-cancel-id="' + o.order_id + '"' +
      ' data-classification="' + o.classification + '"' +
      ' data-ticker="' + (o.ticker || '') + '"' +
      ' data-sym="' + safeSym + '">Cancel</button>';
    return '<div class="pos-target-row" style="flex-wrap:wrap;gap:0.2rem 0.4rem;align-items:center"' +
      ' data-pos-id="" data-order-id="' + (o.order_id || '') + '">' +
      '<span class="pos-direction ' + dirCls + '" style="font-size:0.68rem;padding:0.1rem 0.3rem">' + clsLabel + '</span>' +
      '<span class="pos-target-type">' + (o.ticker || '?') + '</span>' +
      '<span class="pos-target-price" style="font-size:0.72rem;max-width:11rem;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="' + safeSym + '">' + sym + '</span>' +
      '<span class="pos-target-badge">' + priceStr + ' · ' + (o.quantity || '?') + '× · ' + (o.status || '') + (dur ? ' · ' + dur : '') + '</span>' +
      untracked +
      cancelBtn +
      '</div>';
  }

  // Returns a badge-only bracket status for a single position card.
  // Three states: checking… / ⚠ unreadable / OCO resting / — no bracket —
  function _renderOrdersForPosition(positionId) {
    if (_lastOrdersData.ok === null) {
      return '<div class="pos-orders-badge-row"><span style="color:var(--text-muted);font-size:0.72rem">checking…</span></div>';
    }
    if (_lastOrdersData.ok === false) {
      return '<div class="pos-orders-badge-row"><span class="pnl-badge stale">⚠ unreadable</span></div>';
    }
    const orders = (_lastOrdersData.orders || []).filter(
      o => o.bracket_position_id != null && String(o.bracket_position_id) === String(positionId)
    );
    if (!orders.length) {
      return '<div class="pos-orders-badge-row"><span style="color:var(--text-muted);font-size:0.72rem">— no bracket —</span></div>';
    }
    return '<div class="pos-orders-badge-row"><span class="pnl-badge" style="background:var(--accent-muted,#444);color:var(--text-on-accent,#fff);font-size:0.65rem">OCO resting</span></div>';
  }

  // Returns the always-present orphan section HTML.
  // Orphans: sell-side orders with bracket_position_id=null and tracked=false —
  // placed by the now-disabled exit-bracket endpoint which never wrote exit_layer='oco_bracket'.
  function _renderOrphanSection() {
    const hd = '<div class="pos-orphan-hd">Unmatched Orders</div>';
    if (_lastOrdersData.ok === null) {
      return '<section class="pos-orphan-section">' + hd +
        '<div class="pos-orphan-body"><span style="color:var(--text-muted);font-size:0.72rem">checking…</span></div>' +
        '</section>';
    }
    if (_lastOrdersData.ok === false) {
      return '<section class="pos-orphan-section">' + hd +
        '<div class="pos-orphan-body"><span class="pnl-badge stale">⚠ orders unreadable</span></div>' +
        '</section>';
    }
    const orphans = (_lastOrdersData.orders || []).filter(o => o.bracket_position_id == null && !o.tracked);
    if (!orphans.length) {
      return '<section class="pos-orphan-section pos-orphan-section--empty">' + hd +
        '<div class="pos-orphan-body"><span style="color:var(--text-muted);font-size:0.72rem">— none —</span></div>' +
        '</section>';
    }
    const age = _fmtOrdersAge();
    return '<section class="pos-orphan-section">' + hd +
      '<div class="pos-orphan-body">' +
      orphans.map(_renderOrderRow).join('') +
      (age ? '<div class="pos-orders-age">' + age + '</div>' : '') +
      '</div>' +
      '</section>';
  }

  // Wires cancel/modify/sell-now button handlers across a freshly rendered container.
  // Buttons are rebuilt each render, so listeners are always fresh.
  function _wireOrderHandlers(container) {
    container.querySelectorAll('[data-cancel-id]').forEach(btn => {
      btn.addEventListener('click', () => _onCancelWorkingOrder(btn));
    });
    container.querySelectorAll('[data-bracket-pid]').forEach(btn => {
      btn.addEventListener('click', () => _onCancelBracket(btn));
    });
    container.querySelectorAll('[data-modify-pid]').forEach(btn => {
      btn.addEventListener('click', () => _onModifyBracketLeg(btn));
    });
    // SELL NOW — hold mechanic: pointerdown starts 600ms hold, pointerup/cancel aborts early.
    container.querySelectorAll('[data-sell-pid]').forEach(btn => {
      btn.addEventListener('pointerdown', e => { e.preventDefault(); _startSellNowHold(btn, btn.dataset.sellPid); });
      btn.addEventListener('pointerup',    _cancelSellNowHold);
      btn.addEventListener('pointercancel', _cancelSellNowHold);
      btn.addEventListener('pointerleave',  _cancelSellNowHold);
    });
  }

  function _onCancelWorkingOrder(btn) {
    const orderId = btn.dataset.cancelId;
    const cls     = btn.dataset.classification;
    const ticker  = btn.dataset.ticker;
    const sym     = btn.dataset.sym;
    const isStop  = cls === 'protective_stop';

    const modalBody = isStop
      ? '<strong style="color:var(--danger)">⚠ This is a PROTECTIVE STOP for ' + ticker + '.</strong><br>' +
        'Canceling it leaves the <strong>' + ticker + '</strong> position <strong>completely unprotected</strong>.<br><br>' +
        'Order: <code style="font-size:0.8rem">' + sym + '</code> &nbsp; ID: <code style="font-size:0.8rem">' + orderId + '</code><br><br>' +
        '<span style="color:var(--danger);font-size:0.8rem">Only proceed if you intend to manage the exit manually.</span>'
      : 'Cancel this entry order?<br><br>' +
        'Order: <code style="font-size:0.8rem">' + sym + '</code> &nbsp; ID: <code style="font-size:0.8rem">' + orderId + '</code>';

    showConfirmModal({
      title:   isStop ? 'Cancel Stop — ' + ticker + ' will be EXPOSED' : 'Cancel Entry Order',
      body:    modalBody,
      okLabel: isStop ? 'Cancel Stop — leave exposed' : 'Cancel Order',
      okClass: isStop ? 'danger' : '',
      onOk: async (setStatus) => {
        setStatus('Canceling…');
        try {
          const result = await apiPost('/api/orders/cancel', { order_id: orderId });
          if (result.ok) {
            setStatus('Canceled', 'ok');
            _pollOrders();
          } else if (result.reason === 'already_filled') {
            setStatus('Already filled — position may now exist. Refreshing…', 'error');
            _pollOrders();
          } else {
            setStatus('Error: ' + (result.error || 'cancel failed'), 'error');
          }
        } catch (err) {
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          setStatus('Error: ' + detail, 'error');
        }
      },
    });
  }

  function _onCancelBracket(btn) {
    const positionId = btn.dataset.bracketPid;
    const ticker     = btn.dataset.ticker;
    const sym        = btn.dataset.sym;

    showConfirmModal({
      title:   'Cancel OCO Bracket — ' + ticker,
      body:    '<strong style="color:var(--danger)">Both legs of the OCO bracket will be cancelled.</strong><br><br>' +
               'The TP limit <em>and</em> the protective stop for <strong>' + ticker + '</strong> will be removed. ' +
               'Bot price-driven exits (trail stop, hard stop, ATR stop) will resume within ~30 seconds.<br><br>' +
               'Option: <code style="font-size:0.8rem">' + sym + '</code>',
      okLabel: 'Cancel bracket — both legs',
      okClass: 'danger',
      onOk: async (setStatus) => {
        setStatus('Canceling bracket…');
        try {
          const result = await apiPost('/api/orders/cancel-bracket', { position_id: positionId });
          if (result.ok) {
            setStatus('Bracket canceled — bot exits resumed', 'ok');
            _pollOrders();
          } else if (result.reason === 'already_filled') {
            setStatus('A leg already filled — position is closing. Refreshing…', 'error');
            _pollOrders();
          } else {
            setStatus('Error: ' + (result.error || 'cancel failed'), 'error');
          }
        } catch (err) {
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          setStatus('Error: ' + detail, 'error');
        }
      },
    });
  }

  function _onModifyBracketLeg(btn) {
    const positionId     = btn.dataset.modifyPid;
    const classification = btn.dataset.classification;
    const ticker         = btn.dataset.ticker;
    const currentPrice   = btn.dataset.currentPrice;
    const isStop         = classification === 'protective_stop';
    const input          = btn.parentElement.querySelector('input.pos-modify-input');
    if (!input) return;

    const rawVal = parseFloat(input.value);
    if (!rawVal || rawVal <= 0 || isNaN(rawVal)) {
      input.style.outline = '1.5px solid var(--danger)';
      input.focus();
      return;
    }
    input.style.outline = '';
    const newPrice   = rawVal.toFixed(2);
    const legLabel   = isStop ? 'stop-loss'   : 'take-profit';
    const otherLabel = isStop ? 'take-profit' : 'stop-loss';
    const fieldLabel = isStop ? 'stop trigger' : 'limit price';

    showConfirmModal({
      title:   'Modify ' + (isStop ? 'Stop' : 'Take-Profit') + ' — ' + ticker,
      body:    '<strong style="color:var(--danger)">⚠ This modifies a LIVE resting order.</strong><br><br>' +
               'Change the <strong>' + legLabel + '</strong> leg for <strong>' + ticker + '</strong>:<br>' +
               '<code style="font-size:0.82rem">' + fieldLabel + ': $' + currentPrice + ' → $' + newPrice + '</code><br><br>' +
               'The <strong>' + otherLabel + '</strong> leg is unchanged.<br>' +
               '<span style="color:var(--text-muted);font-size:0.76rem">Sent as a PUT to the broker — no cancel occurs. Both legs remain live during the update.</span>',
      okLabel: 'Update at broker',
      okClass: '',
      onOk: async (setStatus) => {
        setStatus('Sending to broker…');
        try {
          const payload = isStop
            ? { position_id: positionId, stop_price: rawVal }
            : { position_id: positionId, tp_price:   rawVal };
          const result = await apiPost('/api/orders/modify-bracket', payload);
          if (result.ok) {
            setStatus(result.message || 'Bracket updated', 'ok');
            _pollOrders();
          } else if (result.reason === 'partial') {
            setStatus(result.error || 'Partial update — check working orders', 'error');
            _pollOrders();
          } else {
            setStatus('Error: ' + (result.error || 'update failed'), 'error');
          }
        } catch (err) {
          const detail = err.data && err.data.detail ? err.data.detail : err.message;
          setStatus('Error: ' + detail, 'error');
        }
      },
    });
  }

  // ── SELL NOW mechanics ───────────────────────────────────────────────────────
  // Shared by both entry points: strip chip (rs-sell-slot) and card TP row.
  // Hold = 600ms press-and-hold. Release before 600ms cancels with no action.
  // During hold: mid is fetched and fresh orders are read. After hold completes
  // the modify fires immediately without a second confirm step.

  function _startSellNowHold(btn, positionId) {
    if (_sellNowInFlight.has(positionId)) return;
    _cancelSellNowHold();
    _sellNowHoldBtn = btn;

    let remaining = 600;
    const TICK    = 50;
    btn.textContent = '600ms…';
    _sellNowHoldInterval = setInterval(() => {
      remaining -= TICK;
      if (remaining > 0) btn.textContent = remaining + 'ms…';
    }, TICK);

    _sellNowHoldTimer = setTimeout(() => {
      clearInterval(_sellNowHoldInterval);
      _sellNowHoldInterval = null;
      _sellNowHoldTimer    = null;
      const pid = positionId;
      const b   = _sellNowHoldBtn;
      _sellNowHoldBtn = null;
      if (b) b.textContent = 'Fetching…';
      _executeSellNow(pid);
    }, 600);
  }

  function _cancelSellNowHold() {
    if (_sellNowHoldTimer) { clearTimeout(_sellNowHoldTimer); _sellNowHoldTimer = null; }
    if (_sellNowHoldInterval) { clearInterval(_sellNowHoldInterval); _sellNowHoldInterval = null; }
    if (_sellNowHoldBtn) {
      _sellNowHoldBtn.textContent = 'SELL NOW';
      _sellNowHoldBtn = null;
    }
  }

  function _setSellNowState(positionId, state) {
    _sellNowState.set(positionId, state);
    // Update all live DOM elements for this position without a full re-render.
    const pos = currentPositions.find(p => p.position_id === positionId) || null;
    document.querySelectorAll(
      '.rs-sell-slot[data-spid="' + positionId + '"], .rs-sell-slot'
    ).forEach(slot => {
      // rs-sell-slot elements don't carry the position id — find via parent chip.
      const chip = slot.closest('[data-pos-id]');
      if (chip && chip.dataset.posId === positionId) {
        slot.innerHTML = _sellSlotContent(positionId, pos);
        // Re-wire the new button if it has data-sell-pid.
        const btn = slot.querySelector('[data-sell-pid]');
        if (btn) {
          btn.addEventListener('pointerdown', e => { e.preventDefault(); _startSellNowHold(btn, positionId); });
          btn.addEventListener('pointerup',    _cancelSellNowHold);
          btn.addEventListener('pointercancel', _cancelSellNowHold);
          btn.addEventListener('pointerleave',  _cancelSellNowHold);
        }
      }
    });
    // Also update any matching sell slots inside the position console (TP row).
    // Re-render is handled by the next _pollOrders() call; transient states are
    // visible via the button text set imperatively in _startSellNowHold.
  }

  async function _executeSellNow(positionId) {
    if (_sellNowInFlight.has(positionId)) return;
    _sellNowInFlight.add(positionId);
    _setSellNowState(positionId, { status: 'fetching' });

    const abort = (msg) => {
      _sellNowInFlight.delete(positionId);
      _setSellNowState(positionId, { status: 'error', msg });
    };

    try {
      // 1. Resolve position for chain/quote params.
      const pos = currentPositions.find(p => p.position_id === positionId);
      if (!pos) return abort('Position not found in local state');

      // 2. Fetch mid — abort immediately on bad quote.
      let sentPrice;
      try {
        const optionType = (pos.direction || '').includes('put') ? 'put' : 'call';
        const px = (pos.current_price > 0) ? pos.current_price : pos.strike;
        const params = new URLSearchParams({
          ticker:      pos.ticker,
          strike:      pos.strike,
          expiry:      pos.expiry,
          option_type: optionType,
          price:       px,
        });
        const q = await apiFetch('/api/chain/quote?' + params);
        const bid = q.bid ?? 0;
        const ask = q.ask ?? 0;
        if (bid <= 0 || ask <= 0) return abort('Invalid quote — bid=' + bid + ' ask=' + ask);
        // sentPrice is the 2-decimal value actually sent to the broker via change_order().
        // Confirmation compares against sentPrice, not the raw mid, to avoid spurious
        // unverified when rounding shifts the last decimal (e.g. raw 1.835 → sent 1.84).
        sentPrice = parseFloat(optionMid(bid, ask).toFixed(2));
      } catch (err) {
        return abort('Quote fetch failed — ' + (err.message || 'network error'));
      }

      // 3. Fresh order read — verify TP leg is still resting and modifiable.
      let freshOrders;
      try {
        freshOrders = await apiFetch('/api/orders/working');
      } catch (err) {
        return abort('Orders read failed — ' + (err.message || 'network error'));
      }
      if (!freshOrders.ok) return abort('Orders unreadable — ' + (freshOrders.error || 'broker error'));

      const tpLeg = (freshOrders.orders || []).find(o =>
        o.classification === 'take_profit' &&
        String(o.bracket_position_id) === String(positionId)
      );
      if (!tpLeg) return abort('No TP leg in fresh read — bracket may have filled or been canceled');

      const TERMINAL = ['filled', 'canceled', 'rejected', 'expired', 'partially_filled'];
      if (tpLeg.status === 'pending') {
        return abort('Market closed — order suspended, cannot reprice');
      }
      if (TERMINAL.includes(tpLeg.status)) {
        return abort('TP leg is ' + tpLeg.status + ' — cannot reprice');
      }

      // 4. Fire the modify.
      _setSellNowState(positionId, { status: 'sent' });
      let modResult;
      try {
        modResult = await apiPost('/api/orders/modify-bracket', {
          position_id: positionId,
          tp_price:    sentPrice,
        });
      } catch (err) {
        _sellNowInFlight.delete(positionId);
        return _setSellNowState(positionId, { status: 'error', msg: 'Modify failed — ' + (err.message || 'network error') });
      }
      if (!modResult.ok) {
        _sellNowInFlight.delete(positionId);
        return _setSellNowState(positionId, { status: 'error', msg: modResult.error || 'Broker rejected modify' });
      }

      // 5. Confirmation read — 1200ms wait, one retry at 800ms if inconclusive.
      // Compare leg.price against sentPrice (the rounded value the broker received),
      // not the raw mid, so floating-point rounding never causes a spurious unverified.
      const checkLeg = async () => {
        try {
          const r = await apiFetch('/api/orders/working');
          if (!r.ok) return null;
          return (r.orders || []).find(o =>
            o.classification === 'take_profit' &&
            String(o.bracket_position_id) === String(positionId)
          ) || null;
        } catch (_) { return null; }
      };

      await new Promise(r => setTimeout(r, 1200));
      let leg = await checkLeg();
      let confirmed = leg && Math.abs((leg.price || 0) - sentPrice) < 0.005;

      if (!confirmed && leg) {
        // Inconclusive (leg exists, old price) — one retry.
        await new Promise(r => setTimeout(r, 800));
        leg = await checkLeg();
        confirmed = leg && Math.abs((leg.price || 0) - sentPrice) < 0.005;
      }

      _sellNowInFlight.delete(positionId);
      _setSellNowState(positionId, confirmed
        ? { status: 'confirmed', mid: sentPrice }
        : { status: 'unverified' }
      );
      _pollOrders();

    } catch (err) {
      // Outer catch: releases the in-flight lock on any unexpected async exception
      // so the button never gets stuck disabled. Named exception per constraint.
      _sellNowInFlight.delete(positionId);
      _setSellNowState(positionId, { status: 'error', msg: 'Unexpected error — check console' });
      throw err;
    }
  }

  // ── Stage 3b: SELL ALL sheet ──────────────────────────────────────────────

  // Classify one position for the sheet. Does NOT fire anything.
  // ordersData must be the parsed JSON body from GET /api/orders/working.
  function _deriveSellAllMethod(pos, ordersData) {
    if (!ordersData.ok) return { method: 'skip', reason: 'Orders unreadable' };
    const TERMINAL = ['filled', 'canceled', 'rejected', 'expired', 'partially_filled'];
    const tpLeg = (ordersData.orders || []).find(o =>
      o.classification === 'take_profit' &&
      String(o.bracket_position_id) === String(pos.position_id)
    );
    if (!tpLeg) return { method: 'skip', reason: 'No bracket resting' };
    if (tpLeg.status === 'pending') return { method: 'skip', reason: 'Market closed — order suspended' };
    if (TERMINAL.includes(tpLeg.status)) return { method: 'skip', reason: 'TP leg ' + tpLeg.status };
    if (priceState(pos.current_price, pos.price_age_secs).state !== 'live') {
      return { method: 'skip', reason: 'No price data' };
    }
    return { method: 'reprice', reason: null };
  }

  // Builds one position row for the sheet. outcomeEl is hidden until execution runs.
  function _buildSaRowHtml(pos, det) {
    const dir       = (pos.direction || '').toLowerCase().includes('put') ? 'put' : 'call';
    const strikeStr = pos.strike ? '$' + parseFloat(pos.strike).toFixed(0) : '—';
    const expShort  = pos.expiry ? pos.expiry.slice(5).replace('-', '/') : '—';
    const qty       = (pos.contracts_open != null ? pos.contracts_open : '—') + 'c';

    let pnlHtml;
    if (pos.unrealized_pnl != null) {
      const cls  = pos.unrealized_pnl >= 0 ? 'positive' : 'negative';
      const sign = pos.unrealized_pnl >= 0 ? '+' : '';
      const age  = pos.price_age_secs != null ? Math.round(pos.price_age_secs) + 's old' : '?s old';
      pnlHtml = `<span class="sa-pnl ${cls}">${sign}${fmt$(Math.round(pos.unrealized_pnl))} · ${fmtPct(pos.unrealized_pnl_pct)} at last price <span class="sa-meta">(${age})</span></span>`;
    } else {
      pnlHtml = `<span class="sa-pnl neutral">P&amp;L unavailable — no price data</span>`;
    }

    const badgeCls   = det.method === 'reprice' ? 'reprice' : 'skip';
    const badgeLabel = det.method === 'reprice' ? 'REPRICE TP' : 'SKIP';
    const methodDesc = det.method === 'reprice' ? 'Reprice TP leg to current mid' : det.reason;

    return `<div class="sa-row">
  <div class="sa-row-hd">
    <span class="sa-ticker">${pos.ticker}</span>
    <span class="sa-dir ${dir}">${dir === 'put' ? 'PUT' : 'CALL'}</span>
    <span class="sa-meta">${strikeStr} ${expShort} · ${qty}</span>
  </div>
  <div class="sa-method"><span class="sa-badge ${badgeCls}">${badgeLabel}</span>${methodDesc}</div>
  ${pnlHtml}
  <div class="sa-outcome" data-sa-outcome="${pos.position_id}" style="display:none"></div>
</div>`;
  }

  // Opens the SELL ALL sheet. Fetches fresh positions + working orders on open,
  // derives method per position, then waits for user to confirm before executing.
  async function _openSellAllSheet() {
    const modal      = document.getElementById('sellAllModal');
    const sheetBody  = document.getElementById('saSheetBody');
    const advisory   = document.getElementById('saAdvisory');
    const statusEl   = document.getElementById('saStatus');
    const cancelBtn  = document.getElementById('saCancel');
    let   confirmBtn = document.getElementById('saConfirm');

    // Reset to loading state before showing.
    sheetBody.innerHTML    = '<span class="sa-loading">Loading positions&hellip;</span>';
    advisory.style.display = 'none';
    confirmBtn.disabled    = true;
    confirmBtn.textContent = 'Reprice 0 TP legs';
    statusEl.textContent   = '';
    statusEl.className     = 'dash-modal-status';
    cancelBtn.disabled     = false;
    cancelBtn.textContent  = 'Cancel';
    modal.style.display    = 'flex';

    // Fresh reads — re-fetching rather than using cached poll data so the
    // sheet reflects now, not up to 30 s ago.
    let posResp, ordersData;
    try {
      [posResp, ordersData] = await Promise.all([
        apiFetch('/api/positions'),
        apiFetch('/api/orders/working'),
      ]);
    } catch (err) {
      sheetBody.innerHTML = `<span class="sa-error">Failed to load: ${err.message || 'network error'}</span>`;
      return;
    }

    const open = (posResp.positions || []).filter(
      p => p.state === 'open' || p.state === 'closing_pending'
    );

    if (open.length === 0) {
      sheetBody.innerHTML    = '<span class="sa-loading">No open positions — nothing to act on.</span>';
      advisory.style.display = 'none';
      return;
    }

    const rows       = open.map(pos => ({ pos, det: _deriveSellAllMethod(pos, ordersData) }));
    const actionable = rows.filter(r => r.det.method === 'reprice');

    sheetBody.innerHTML    = rows.map(r => _buildSaRowHtml(r.pos, r.det)).join('');
    advisory.style.display = '';

    // Clone confirm button to shed any listener from a previous sheet open.
    const newConfirm = confirmBtn.cloneNode(true);
    confirmBtn.parentNode.replaceChild(newConfirm, confirmBtn);
    confirmBtn = newConfirm;

    if (actionable.length === 0) {
      confirmBtn.disabled    = true;
      confirmBtn.textContent = 'No positions actionable';
    } else {
      confirmBtn.disabled    = false;
      confirmBtn.textContent = `Reprice ${actionable.length} TP leg${actionable.length !== 1 ? 's' : ''}`;

      confirmBtn.addEventListener('click', async () => {
        _sellAllInFlight      = true;
        confirmBtn.disabled   = true;
        cancelBtn.disabled    = true;
        statusEl.textContent  = `Executing — 0 of ${actionable.length} complete`;
        statusEl.className    = 'dash-modal-status';

        try {
          let done = 0;
          for (const { pos } of actionable) {
            const outcomeEl = sheetBody.querySelector(`[data-sa-outcome="${pos.position_id}"]`);
            if (outcomeEl) {
              outcomeEl.style.display = '';
              outcomeEl.className     = 'sa-outcome running';
              outcomeEl.textContent   = '⋯ Repricing…';
            }

            try {
              await _executeSellNow(pos.position_id);
            } catch (_) {
              // _executeSellNow wrote error state before re-throwing — swallow re-throw.
            }

            const st = _sellNowState.get(pos.position_id);
            if (outcomeEl) {
              if (st && st.status === 'confirmed') {
                outcomeEl.className   = 'sa-outcome confirmed';
                outcomeEl.textContent = `✓ Repriced to $${parseFloat(st.mid).toFixed(2)}`;
              } else if (st && st.status === 'unverified') {
                outcomeEl.className   = 'sa-outcome unverified';
                outcomeEl.textContent = '⚠ Sent — price unverified, check broker';
              } else {
                outcomeEl.className   = 'sa-outcome error';
                outcomeEl.textContent = '✗ ' + (st ? st.msg || 'Failed' : 'No state — check console');
              }
            }

            done++;
            statusEl.textContent = `Executing — ${done} of ${actionable.length} complete`;
          }

          statusEl.textContent = `Done — ${actionable.length} position${actionable.length !== 1 ? 's' : ''} processed`;
          statusEl.className   = 'dash-modal-status ok';
        } finally {
          _sellAllInFlight      = false;
          cancelBtn.disabled    = false;
          cancelBtn.textContent = 'Close';
        }
      });
    }
  }

  // Wired once at init. Backdrop click and Cancel close the sheet; confirm is
  // re-wired each time the sheet opens to avoid stale closure state.
  function _wireSellAllBtn() {
    const modal = document.getElementById('sellAllModal');
    if (!modal) return;

    // Delegate on the stable panel — #sellAllBtn lives inside #positionsBody which
    // gets body.innerHTML wiped on every WS tick, so a direct querySelector at init
    // would point to a destroyed element after the first render.
    const panel = document.getElementById('rightHistPanel');
    if (panel) {
      panel.addEventListener('click', e => {
        if (e.target.closest('#sellAllBtn')) _openSellAllSheet();
      });
    }

    document.getElementById('saCancel').addEventListener('click', () => {
      if (_sellAllInFlight) return;
      modal.style.display = 'none';
    });
    modal.addEventListener('click', e => {
      if (e.target === modal && !_sellAllInFlight) modal.style.display = 'none';
    });
  }

  // Builds the HTML for the inline management console.
  // Scale and Rebase are stubs. Exit at market uses the legacy modal path.
  // Order Ticket (Rungs 1-2) and Moving Stop A are wired via wireConsoleButtons.
  function buildConsoleHtml(pos) {
    const cts    = pos.contracts_open || 1;
    const entry  = pos.entry_price || 0;
    const sym    = pos.option_symbol || (pos.ticker + ' $' + pos.strike + ' ' + pos.direction);
    const layer  = pos.exit_layer || 'default';
    const isClose = pos.state === 'closing_pending';

    // Which legs are in edit vs propose mode
    const tpEdit    = (layer === 'oco_bracket' || layer === 'tp_only');
    const slEdit    = (layer === 'oco_bracket' || layer === 'stop_only');
    const tpDimmed  = (!tpEdit && layer !== 'default');
    const slDimmed  = (!slEdit && layer !== 'default');
    const proposeMode = (layer === 'default');

    // Trail state
    const tw = pos.trail_width != null ? (pos.trail_width * 100).toFixed(0) + '%' : '—';

    function legHtml(leg, isEdit, isDimmed) {
      const isProposeMode = !isEdit && !isDimmed;
      const label   = isProposeMode ? (leg === 'tp' ? 'TP' : 'SL') : (leg === 'tp' ? 'Take profit' : 'Stop loss');
      const dimNote = isDimmed ? ' <span class="t2-leg-dim-note">not resting</span>' : '';
      const cls     = 't2-leg' + (isDimmed ? ' t2-leg--dimmed' : '') + (isProposeMode ? ' t2-leg--propose' : '');
      const stagedEl = isEdit
        ? '<span class="t2-leg-staged" data-staged="' + leg + '" style="display:none"></span>'
        : '';
      const dis      = isDimmed ? ' disabled' : '';
      // SELL NOW slot — only on the TP leg when a bracket is resting (edit mode).
      // Uses the same _sellSlotContent / 600ms hold mechanic as the strip chip.
      const sellSlot = (leg === 'tp' && isEdit)
        ? '<div class="rs-sell-slot t2-sell-slot">' + _sellSlotContent(pos.position_id, pos) + '</div>'
        : '';
      // In propose mode: meta row omitted — a shared hint sits outside both legs.
      const metaRow = isProposeMode ? '' :
        '<div class="t2-leg-meta" data-leg-meta="' + leg + '">' +
          '<span style="color:var(--text-muted);font-size:0.62rem">fetching…</span>' +
        '</div>';
      const priceRowInner =
        '<button class="t2-nudge" data-nudge="' + leg + '" data-dir="-1"' + dis + '>&#8722;</button>' +
        '<input type="number" class="t2-leg-inp" data-leg-inp="' + leg + '" step="0.01" min="0.01" placeholder="0.00"' + dis + '>' +
        '<button class="t2-nudge" data-nudge="' + leg + '" data-dir="1"' + dis + '>+</button>' +
        stagedEl;
      const annotEl = '<div class="t2-leg-annot" data-leg-annot="' + leg + '"></div>';
      if (isProposeMode) {
        return '<div class="' + cls + '" data-leg="' + leg + '">' +
          '<div class="t2-leg-inline-row">' +
            '<div class="t2-leg-label">' + label + '</div>' +
            '<div class="t2-leg-price-row">' + priceRowInner + '</div>' +
          '</div>' +
          annotEl +
        '</div>';
      }
      return '<div class="' + cls + '" data-leg="' + leg + '">' +
        '<div class="t2-leg-label">' + label + dimNote + '</div>' +
        '<div class="t2-leg-price-row">' + priceRowInner + '</div>' +
        metaRow +
        annotEl +
        sellSlot +
      '</div>';
    }

    const armRow = proposeMode
      ? '<div class="t2-arm-row" data-live="t2-arm-row">' +
          '<button class="t2-arm-btn" disabled>Arm bracket</button>' +
          '<div class="t2-arm-status" data-live="t2-arm-status"></div>' +
        '</div>'
      : '';

    const armedCls  = pos.trail_armed ? ' t2-val--armed' : '';
    const armedText = pos.trail_armed ? '&#11014; armed' : '&#11093; waiting';
    const trailStop = pos.trail_stop_price ? fmtPrice(pos.trail_stop_price) : '&mdash;';

    const mainSection = proposeMode
      ? '<div class="t2-bot-watch">' +
          '<div class="t2-watch-row"><span class="t2-watch-lbl">Trail arm</span>' +
            '<span class="t2-watch-val' + armedCls + '" data-live="t2-trail-arm">' + armedText + '</span></div>' +
          '<div class="t2-watch-row"><span class="t2-watch-lbl">Width</span>' +
            '<span class="t2-watch-val" data-live="t2-trail-width">' + tw + '</span></div>' +
          '<div class="t2-watch-row"><span class="t2-watch-lbl">Stop opt</span>' +
            '<span class="t2-watch-val" data-live="t2-trail-stop">' + trailStop + '</span></div>' +
        '</div>' +
        '<div class="t2-legs t2-legs--inline">' +
          '<div class="t2-legs-toggle-bar">' +
            '<button class="t2-mode-toggle" data-live="t2-mode-toggle">$</button>' +
            '<span class="t2-mode-hint">% relative to entry</span>' +
          '</div>' +
          legHtml('tp', false, false) +
          legHtml('sl', false, false) +
          '<div class="t2-legs-hint" data-live="t2-legs-hint">enter option premiums ($)</div>' +
        '</div>' +
        armRow
      : '<div class="t2-legs">' +
          '<div class="t2-legs-toggle-bar">' +
            '<button class="t2-mode-toggle" data-live="t2-mode-toggle">$</button>' +
            '<span class="t2-mode-hint">% relative to entry</span>' +
          '</div>' +
          legHtml('tp', tpEdit, tpDimmed) +
          legHtml('sl', slEdit, slDimmed) +
        '</div>' +
        '<div class="t2-bot-summary' + (pos.trail_armed ? ' t2-bot-summary--armed' : '') + '">' +
          '<span' + (pos.trail_armed ? ' class="t2-val--armed"' : '') + ' data-live="t2-trail-arm">' + armedText + '</span>' +
          '<span class="t2-bot-sep">&nbsp;&middot;&nbsp;</span>' +
          '<span data-live="t2-trail-width">' + tw + '</span>' +
          '<span class="t2-bot-sep">&nbsp;&middot;&nbsp;stop&nbsp;</span>' +
          '<span data-live="t2-trail-stop">' + trailStop + '</span>' +
        '</div>';

    // Strategy dropdown — 3 standard options; disabled transitions include the reason.
    // stop_only is an inherited state (TP filled), not a user-selectable strategy —
    // shown as a 4th read-only option only when that is the current layer.
    let stratOpts = '<option value="default"' + (layer === 'default' ? ' selected' : '') + '>Bot managed</option>';
    {
      let ocoDis = '', ocoSuffix = '';
      if (layer === 'tp_only')   { ocoDis = ' disabled'; ocoSuffix = ' — cancel TP first'; }
      if (layer === 'stop_only') { ocoDis = ' disabled'; ocoSuffix = ' — cancel stop first'; }
      stratOpts += '<option value="oco_bracket"' +
        (layer === 'oco_bracket' ? ' selected' : '') + ocoDis +
        '>OCO bracket' + ocoSuffix + '</option>';
    }
    {
      let tpDis = '', tpSuffix = '';
      if (layer === 'oco_bracket') { tpDis = ' disabled'; tpSuffix = ' — cancel bracket first'; }
      if (layer === 'stop_only')   { tpDis = ' disabled'; tpSuffix = ' — cancel stop first'; }
      if (layer === 'default')     { tpDis = ' disabled'; tpSuffix = ' — use profit ticket'; }
      stratOpts += '<option value="tp_only"' +
        (layer === 'tp_only' ? ' selected' : '') + tpDis +
        '>TP only' + tpSuffix + '</option>';
    }
    if (layer === 'stop_only') {
      stratOpts += '<option value="stop_only" selected disabled>Stop only (TP filled)</option>';
    }
    const stratSel = '<select class="t2-strategy-sel">' + stratOpts + '</select>';

    const profitSection = isAdmin
      ? '<div class="t2-profit-section">' +
          '<div class="t2-section-hd">Profit-only order</div>' +
          '<div class="pos-preview-tag" style="margin-bottom:0.4rem">Limit SELL &middot; does not cancel the stop</div>' +
          '<div class="t2-profit-row">' +
            '<span class="t2-profit-lbl">TP limit</span>' +
            '<span class="t2-profit-dollar">$</span>' +
            '<input class="t2-profit-tp-inp" type="number" step="0.01" min="0.01" placeholder="0.00">' +
            '<span class="t2-profit-lbl" style="margin-left:0.3rem">Qty</span>' +
            '<input class="t2-profit-qty-inp" type="number" min="1" max="' + cts + '" value="' + cts + '" style="width:2.8rem">' +
            '<select class="t2-profit-tif-sel"><option value="gtc">GTC</option><option value="day">DAY</option></select>' +
          '</div>' +
          '<button class="t2-profit-review-btn">Review</button>' +
          '<div class="t2-profit-status"></div>' +
          '<div class="t2-profit-review" style="display:none">' +
            '<div class="t2-profit-review-body"></div>' +
            '<button class="t2-profit-confirm-btn">Confirm order</button>' +
          '</div>' +
        '</div>'
      : '';

    return '<div class="pos-console t2-console">' +

      '<div class="t2-strategy-row">' +
        '<span class="t2-strategy-lbl">Exit strategy</span>' +
        '<code class="t2-sym-chip">' + sym + '</code>' +
        stratSel +
        '<span class="t2-strategy-status" data-live="t2-strategy-status"></span>' +
      '</div>' +

      mainSection +

      '<div class="t2-staged-bar" data-live="t2-staged-bar" style="display:none">' +
        '<span class="t2-staged-desc" data-live="t2-staged-desc"></span>' +
        '<div class="t2-staged-actions">' +
          '<button class="t2-apply-btn">Apply</button>' +
          '<button class="t2-discard-btn">Discard</button>' +
        '</div>' +
        '<div class="t2-apply-status" data-live="t2-apply-status"></div>' +
      '</div>' +

      profitSection +

      '<div class="t2-changelog-section">' +
        '<div class="t2-section-hd">Recent actions</div>' +
        '<div class="t2-changelog" data-live="t2-changelog">' +
          '<span style="color:var(--text-muted);font-size:0.62rem">&mdash; none yet &mdash;</span>' +
        '</div>' +
      '</div>' +

      '<div class="pos-console-actions">' +
        '<button class="pos-console-btn danger pos-console-close-btn"' +
          ' data-pos-id="' + pos.position_id + '"' +
          ' data-contracts="' + cts + '"' +
          ' data-symbol="' + (sym + '').replace(/"/g, '&quot;') + '"' +
          ' data-entry="' + entry + '">' +
          'Close ' + cts + '&times; at mid' +
          '<span class="pos-preview-tag">' + (isClose ? 'resting limit &middot; press to reprice &middot; gated' : 'limit &middot; may not fill &middot; gated') + '</span>' +
        '</button>' +
      '</div>' +

    '</div>';
  }

  // ── History tab ───────────────────────────────────────────────────────────

  function setupHistoryTab() {
    const tabPos   = document.getElementById('tabPositions');
    const tabHist  = document.getElementById('tabHistory');
    const tabOrd   = document.getElementById('tabOrder');
    const posBody  = document.getElementById('positionsBody');
    const histView = document.getElementById('historyView');
    const ordView  = document.getElementById('orderView');
    if (!tabPos || !tabHist) return;

    tabPos.addEventListener('click', () => {
      tabPos.classList.add('active');
      tabHist.classList.remove('active');
      tabOrd?.classList.remove('active');
      posBody.style.display  = '';
      histView.style.display = 'none';
      if (ordView) ordView.style.display = 'none';
      document.getElementById('positionsMeta').textContent = 'live';
    });

    tabHist.addEventListener('click', () => {
      tabHist.classList.add('active');
      tabPos.classList.remove('active');
      tabOrd?.classList.remove('active');
      posBody.style.display  = 'none';
      histView.style.display = '';
      if (ordView) ordView.style.display = 'none';
      document.getElementById('positionsMeta').textContent = 'closed';
      loadHistory(histCurrentPeriod);
    });

    if (tabOrd) {
      tabOrd.addEventListener('click', _activateOrderTab);
    }

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
    } else {
      // Remove the All users button from the DOM entirely for non-admins.
      // histScopeBar stays display:none (never revealed), but omitting the
      // element prevents it from being discovered via DOM inspection.
      const allBtn = document.querySelector('#histScopeBar .hist-scope-btn[data-scope="all"]');
      if (allBtn) allBtn.remove();
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
  <span class="hist-cell hist-col-date hist-hdr">Date</span>
  <span class="hist-cell hist-col-tkr  hist-hdr">Ticker</span>
  <span class="hist-cell hist-col-dir  hist-hdr">Dir</span>
  <span class="hist-cell hist-col-pnl  hist-hdr">P&amp;L</span>
  <span class="hist-cell hist-col-pct  hist-hdr">%</span>
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
      const posId    = t.position_id || '';
      const extraCls = posId ? ' hist-row-clickable' : '';
      const extraDat = posId ? ` data-position-id="${posId}" data-ticker="${t.ticker || ''}"` : '';
      return `
<div class="hist-row${extraCls}"${extraDat}>
  ${userCell}
  <span class="hist-cell hist-col-date">${dt}</span>
  <span class="hist-cell hist-col-tkr hist-ticker">${t.ticker || '?'}</span>
  <span class="hist-cell hist-col-dir"><span class="hist-dir ${dir}">${dir === 'put' ? 'P' : 'C'}</span></span>
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

    histBody.querySelectorAll('.hist-row-clickable').forEach(row => {
      row.addEventListener('click', e => {
        if (e.target.classList.contains('hist-uid-link')) return;
        openCardModal(row.dataset.positionId, row.dataset.ticker);
      });
    });
  }

  function setHistScope(scope, userId) {
    if (!isAdmin && scope === 'all') return;
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

  function showConfirmModal({ title, body, okLabel, okClass, onOk, altLabel, altClass, onAlt }) {
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

    // Optional secondary action (e.g. "Exit at market instead")
    const altBtn = document.getElementById('confirmAlt');
    if (altBtn) {
      const newAlt = altBtn.cloneNode(true);
      altBtn.parentNode.replaceChild(newAlt, altBtn);
      if (altLabel && onAlt) {
        newAlt.textContent   = altLabel;
        newAlt.className     = 'dash-modal-btn' + (altClass ? ' ' + altClass : '');
        newAlt.style.display = '';
        newAlt.addEventListener('click', async () => {
          newAlt.disabled = true;
          const setStatus = (msg, cls) => {
            const el = document.getElementById('confirmStatus');
            el.textContent = msg;
            el.className   = 'dash-modal-status' + (cls ? ' ' + cls : '');
            if (cls === 'ok') setTimeout(closeModal, 2500);
          };
          try {
            await onAlt(setStatus);
          } catch (err) {
            const el = document.getElementById('confirmStatus');
            el.textContent = 'Unexpected error: ' + err.message;
            el.className   = 'dash-modal-status error';
          } finally {
            newAlt.disabled = false;
          }
        });
      } else {
        newAlt.style.display = 'none';
      }
    }

    document.getElementById('confirmModal').style.display = 'flex';
  }

  function closeModal() {
    document.getElementById('confirmModal').style.display = 'none';
  }

  // Close modal when clicking the overlay backdrop
  document.getElementById('confirmModal').addEventListener('click', e => {
    if (e.target === document.getElementById('confirmModal')) closeModal();
  });

  // ── Trade card modal ──────────────────────────────────────────────────────

  async function openCardModal(positionId, ticker) {
    const modal = document.getElementById('cardModal');
    const img   = document.getElementById('cardModalImg');
    const err   = document.getElementById('cardModalErr');
    const dl    = document.getElementById('cardModalDownload');
    const spin  = document.getElementById('cardModalSpinner');

    img.style.display   = 'none';
    err.style.display   = 'none';
    dl.style.display    = 'none';
    spin.style.display  = 'block';
    err.textContent     = '';
    modal.style.display = 'flex';

    try {
      const resp = await fetch(
        API + '/api/trade-card?position_id=' + encodeURIComponent(positionId),
        { headers: authHeaders() },
      );
      if (!resp.ok) {
        spin.style.display = 'none';
        err.textContent    = resp.status === 403 ? 'Not available' : "Couldn't generate card";
        err.style.display  = 'block';
        return;
      }
      const blob = await resp.blob();
      const url  = URL.createObjectURL(blob);
      if (img._cardUrl) URL.revokeObjectURL(img._cardUrl);
      img._cardUrl       = url;
      img.src            = url;
      spin.style.display = 'none';
      img.style.display  = 'block';
      dl.style.display   = 'inline-block';
      dl.onclick = () => {
        const a    = document.createElement('a');
        a.href     = url;
        a.download = (ticker || 'trade') + '_card.png';
        a.click();
      };
    } catch {
      spin.style.display = 'none';
      err.textContent    = "Couldn't generate card";
      err.style.display  = 'block';
    }
  }

  function closeCardModal() {
    const modal = document.getElementById('cardModal');
    const img   = document.getElementById('cardModalImg');
    modal.style.display = 'none';
    if (img._cardUrl) {
      URL.revokeObjectURL(img._cardUrl);
      img._cardUrl = null;
      img.src = '';
    }
  }

  document.getElementById('cardModalClose').addEventListener('click', closeCardModal);
  document.getElementById('cardModal').addEventListener('click', e => {
    if (e.target === document.getElementById('cardModal')) closeCardModal();
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
    if (!isAdmin) return;
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

  function setupBasketTooltip() {
    const tip  = document.getElementById('basketTip');
    const body = document.getElementById('flowSectorBody');
    if (!tip || !body) return;

    let activeEl = null;

    function show(nameEl) {
      const idx = parseInt(nameEl.dataset.bidx, 10);
      if (!_lastBaskets || isNaN(idx)) return;
      const b = _lastBaskets[idx];
      if (!b) return;

      const tf  = _lastBasketsTimeframe;
      const rs  = b.rs_vs_spy != null ? (b.rs_vs_spy >= 0 ? '+' : '') + b.rs_vs_spy.toFixed(1) + '%' : '—';
      const hd  = b.etf
        ? `${b.etf} ${rs} vs SPY · your ${b.total} names`
        : `no liquid ETF — mean of ${b.pct_n} monitored names`;
      const coverNote   = (b.etf && b.pct_n < b.total)
        ? `<div class="basket-tip-note">mean covers ${b.pct_n} of ${b.total}</div>` : '';
      const missingNote = (b.missing > 0)
        ? `<div class="basket-tip-note">${b.missing} members had no scan data</div>` : '';

      const memberRows = (b.members || []).map(m => {
        let biasHtml;
        if (m.bias === null || m.bias === undefined) {
          biasHtml = `<span class="basket-tip-bias muted">—</span><span class="basket-tip-nd">n/d</span>`;
        } else {
          const g = m.bias === 'bull' ? '▲' : m.bias === 'bear' ? '▼' : '—';
          biasHtml = `<span class="basket-tip-bias ${m.bias}">${g}</span>`;
        }
        const pctStr = m.pct != null ? (m.pct >= 0 ? '+' : '') + m.pct.toFixed(1) + '%' : '—';
        return `<div class="basket-tip-member">${biasHtml}<span class="basket-tip-ticker">${m.ticker}</span><span class="basket-tip-pct">${pctStr}</span></div>`;
      }).join('');

      tip.innerHTML = `<div class="basket-tip-hd">${hd}</div>${coverNote}${missingNote}<div class="basket-tip-tf">clouds ${tf}</div><div class="basket-tip-members">${memberRows}</div>`;

      // Measure height while invisible — position:fixed with no insets defaults to
      // viewport origin on first show, so don't rely on the user-visible path.
      tip.style.visibility = 'hidden';
      tip.style.display    = 'block';
      const tipH = tip.offsetHeight;
      tip.style.visibility = '';
      tip.style.display    = '';

      const r = nameEl.getBoundingClientRect();
      tip.style.left = Math.min(r.left, window.innerWidth - 290) + 'px';
      if (tipH <= r.top - 10) {
        tip.style.bottom = (window.innerHeight - r.top + 6) + 'px';
        tip.style.top    = '';
      } else {
        tip.style.top    = (r.bottom + 6) + 'px';
        tip.style.bottom = '';
      }
      tip.classList.add('visible');
      tip.setAttribute('aria-hidden', 'false');
      activeEl = nameEl;
    }

    function hide() {
      tip.classList.remove('visible');
      tip.setAttribute('aria-hidden', 'true');
      activeEl = null;
    }

    body.addEventListener('mouseover', e => {
      const nameEl = e.target.closest('.basket-name');
      if (nameEl && nameEl !== activeEl) show(nameEl);
    });
    body.addEventListener('mouseleave', e => {
      if (!tip.contains(e.relatedTarget)) hide();
    });
    tip.addEventListener('mouseleave', e => {
      if (!body.contains(e.relatedTarget)) hide();
    });
    document.addEventListener('click', e => {
      if (!body.contains(e.target) && !tip.contains(e.target)) hide();
    });
  }

  // ── GEX analysis modal ────────────────────────────────────────────────────
  // Surface 1: per-position pop-out with GEX terrain + projection calculator.
  // Surface 2: bottom-strip GEX FLIP cell populated by loadGexFlipCell().

  function setupGexModal() {
    document.getElementById('gexModalClose').addEventListener('click', closeGexModal);
    document.getElementById('gexModal').addEventListener('click', e => {
      if (e.target === document.getElementById('gexModal')) closeGexModal();
    });

    // Level quick-fill buttons
    ['gexBtnPutWall', 'gexBtnMagnet', 'gexBtnCallWall'].forEach(id => {
      document.getElementById(id).addEventListener('click', () => {
        if (!gexData || !gexData.available) return;
        const level = id === 'gexBtnPutWall'  ? gexData.put_wall
                    : id === 'gexBtnMagnet'    ? gexData.gamma_magnet
                    :                             gexData.call_wall;
        if (level == null) return;
        const inp = document.getElementById('gexTargetInput');
        if (inp) { inp.value = level.toFixed(2); scheduleGexProjection(); }
      });
    });

    // Target input: debounced projection refresh
    document.getElementById('gexTargetInput').addEventListener('input', scheduleGexProjection);

    // Exit bracket section
    ['gexExitBracket', 'gexExitLimit'].forEach(id => {
      document.getElementById(id).addEventListener('change', () => {
        const isBracket = document.getElementById('gexExitBracket').checked;
        const stopRow   = document.getElementById('gexExitStopRow');
        if (stopRow) stopRow.style.display = isBracket ? '' : 'none';
        _renderExitSummary();
      });
    });
    ['gexExitTp', 'gexExitStop'].forEach(id => {
      document.getElementById(id).addEventListener('input', _renderExitSummary);
    });
    document.getElementById('gexExitStageBtn')?.addEventListener('click', _stageExitBracket);

    // Delegated click handler for GEX button on each pos-card
    document.getElementById('positionsBody').addEventListener('click', e => {
      const btn = e.target.closest('.pos-gex-btn');
      if (!btn) return;
      e.stopPropagation();
      const card  = btn.closest('.pos-card');
      if (!card) return;
      const posId = card.dataset.posId;
      const pos   = currentPositions.find(p => p.position_id === posId);
      if (pos) openGexModal(pos);
    });
  }

  function openGexModal(pos) {
    gexModalPos = pos;
    gexData     = null;
    gexModalIv  = null;

    // Header
    const dir = pos.direction.toLowerCase().includes('put') ? 'put' : 'call';
    const sym = pos.option_symbol || `${pos.ticker} $${pos.strike}${dir === 'call' ? 'C' : 'P'}`;
    document.getElementById('gexModalTitle').textContent =
      `${pos.ticker} ${sym.includes('$') ? '' : '— '}${pos.expiry || ''} · GEX Analysis`;

    // Stat row — entry / current opt / DTE / P&L%
    const dte      = _computeDteNum(pos.expiry);
    const curOpt   = pos.current_price != null ? fmtPrice(pos.current_price) : '—';
    const pnlPct   = pos.unrealized_pnl_pct != null ? fmtPct(pos.unrealized_pnl_pct) : '—';
    const pnlCls   = pos.unrealized_pnl_pct == null ? '' : pos.unrealized_pnl_pct >= 0 ? 'positive' : 'negative';
    document.getElementById('gexModalStats').innerHTML = `
<div class="gex-stat-item">
  <span class="gex-stat-label">Entry</span>
  <span class="gex-stat-val">${fmtPrice(pos.entry_price)}</span>
</div>
<div class="gex-stat-item">
  <span class="gex-stat-label">Current opt</span>
  <span class="gex-stat-val">${curOpt}</span>
</div>
<div class="gex-stat-item">
  <span class="gex-stat-label">DTE</span>
  <span class="gex-stat-val">${dte >= 0 ? dte + 'd' : 'exp'}</span>
</div>
<div class="gex-stat-item">
  <span class="gex-stat-label">P&amp;L</span>
  <span class="gex-stat-val ${pnlCls}">${pnlPct}</span>
</div>`;

    // Pre-fill target with TP1 stock price if available
    const inp = document.getElementById('gexTargetInput');
    if (inp) inp.value = pos.tp1_stock_price ? parseFloat(pos.tp1_stock_price).toFixed(2) : '';

    // Reset terrain + projection areas
    document.getElementById('gexTerrain').innerHTML =
      '<div class="gex-unavailable" style="padding:0.5rem 0">Loading GEX data…</div>';
    document.getElementById('gexTerrainCaption').textContent = '';
    document.getElementById('gexProjResult').innerHTML = '';
    document.getElementById('gexProjVerdict').style.display = 'none';
    document.getElementById('gexProjFootnote').textContent = '';
    _updateGexLevelBtns(null);  // disable level buttons until data arrives

    // Reset estimator outputs + exit section
    gexLastProj = null;
    document.getElementById('gexEstOptPrice').innerHTML   = '';
    document.getElementById('gexTargetRef').textContent   = '';
    document.getElementById('gexExitSection').style.display = 'none';
    document.getElementById('gexExitResult').textContent  = '';
    document.getElementById('gexExitTp').value            = '';
    document.getElementById('gexExitStop').value          = '';

    document.getElementById('gexModal').style.display = 'flex';
    _loadGexModalData(pos.ticker);
  }

  function closeGexModal() {
    document.getElementById('gexModal').style.display = 'none';
    if (gexProjTimer) { clearTimeout(gexProjTimer); gexProjTimer = null; }
    gexModalPos = null;
    gexData     = null;
    gexModalIv  = null;
    gexLastProj = null;
  }

  async function _loadGexModalData(ticker) {
    try {
      const gex = await apiFetch(`/api/gex?ticker=${encodeURIComponent(ticker)}`);
      gexData = gex;
      _renderGexTerrain(gex);
      _updateGexLevelBtns(gex);
      // Seed spot reference in target input once GEX data arrives
      const spotRefEl = document.getElementById('gexTargetRef');
      if (spotRefEl && gex && gex.available && gex.spot) {
        spotRefEl.textContent = `spot $${gex.spot.toFixed(2)}`;
      }
      // Fetch IV from chain/quote in parallel so the projection is ready when user sets a target
      await _fetchGexModalIv(ticker, gex);
      // If target already set (from TP1 prefill), kick off projection now
      const inp = document.getElementById('gexTargetInput');
      if (inp && parseFloat(inp.value) > 0) scheduleGexProjection();
    } catch (_) {
      document.getElementById('gexTerrain').innerHTML =
        '<div class="gex-unavailable">GEX data unavailable</div>';
    }
  }

  async function _fetchGexModalIv(ticker, gex) {
    const pos = gexModalPos;
    if (!pos) return;
    const spot = gex && gex.available && gex.spot ? gex.spot : null;
    if (!spot) return;
    const optionType = pos.direction.toLowerCase().includes('put') ? 'put' : 'call';
    try {
      const q = await apiFetch(
        `/api/chain/quote?ticker=${encodeURIComponent(ticker)}&strike=${pos.strike}` +
        `&expiry=${encodeURIComponent(pos.expiry)}&option_type=${optionType}&price=${spot}`
      );
      gexModalIv = (q && q.iv && q.iv > 0) ? q.iv : null;
    } catch (_) {
      gexModalIv = null;
    }
  }

  function _renderGexTerrain(gex) {
    const terrainEl = document.getElementById('gexTerrain');
    const captionEl = document.getElementById('gexTerrainCaption');

    if (!gex || !gex.available) {
      terrainEl.innerHTML = '<div class="gex-unavailable">GEX unavailable</div>';
      captionEl.textContent = '';
      return;
    }

    const spot     = gex.spot;
    const callWall = gex.call_wall;
    const putWall  = gex.put_wall;
    const magnet   = gex.gamma_magnet;

    const validLevels = [spot, callWall, putWall, magnet].filter(v => v != null);
    if (!validLevels.length) {
      terrainEl.innerHTML = '<div class="gex-unavailable">GEX unavailable — no structural levels</div>';
      captionEl.textContent = '';
      return;
    }

    const minL = Math.min(...validLevels);
    const maxL = Math.max(...validLevels);
    const rawSpan = maxL - minL;
    const pad  = rawSpan > 0 ? rawSpan * 0.12 : minL * 0.05;
    const lo   = minL - pad;
    const hi   = maxL + pad;
    const span = hi - lo;

    const W = 460, TY = 36;
    function xOf(price) { return ((price - lo) / span) * W; }

    const parts = [];
    const BARRIER_PX = Math.max(10, W * 0.024);

    // Track line
    parts.push(`<line x1="4" y1="${TY}" x2="${W - 4}" y2="${TY}" stroke="var(--border-bright)" stroke-width="1.5" stroke-linecap="round"/>`);

    // Barrier zones
    if (putWall != null) {
      const px = xOf(putWall);
      parts.push(`<rect x="${(px - BARRIER_PX).toFixed(1)}" y="${TY - 18}" width="${(BARRIER_PX * 2).toFixed(1)}" height="36" fill="rgba(239,68,68,0.12)" rx="2"/>`);
      parts.push(`<line x1="${px.toFixed(1)}" y1="${TY - 20}" x2="${px.toFixed(1)}" y2="${TY + 20}" stroke="var(--danger)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.75"/>`);
    }
    if (callWall != null) {
      const cx = xOf(callWall);
      parts.push(`<rect x="${(cx - BARRIER_PX).toFixed(1)}" y="${TY - 18}" width="${(BARRIER_PX * 2).toFixed(1)}" height="36" fill="rgba(74,222,128,0.10)" rx="2"/>`);
      parts.push(`<line x1="${cx.toFixed(1)}" y1="${TY - 20}" x2="${cx.toFixed(1)}" y2="${TY + 20}" stroke="var(--accent)" stroke-width="1.5" stroke-dasharray="3,2" opacity="0.75"/>`);
    }

    // Magnet: dashed amber line (no barrier zone; NOT gamma_flip)
    if (magnet != null) {
      const mx = xOf(magnet);
      parts.push(`<line x1="${mx.toFixed(1)}" y1="${TY - 14}" x2="${mx.toFixed(1)}" y2="${TY + 14}" stroke="var(--warning)" stroke-width="1.5" stroke-dasharray="4,3"/>`);
    }

    // Spot: filled circle + downward arrow above track
    if (spot != null) {
      const sx = xOf(spot);
      parts.push(`<polygon points="${sx - 5},${TY - 26} ${sx + 5},${TY - 26} ${sx},${TY - 12}" fill="var(--text-primary)"/>`);
      parts.push(`<circle cx="${sx.toFixed(1)}" cy="${TY}" r="4" fill="var(--text-primary)" stroke="var(--bg-card)" stroke-width="1.5"/>`);
    }

    // Labels below track — collision detection by staggering y
    const LY1 = TY + 30, LY2 = TY + 44;
    const lbls = [];
    if (putWall  != null) lbls.push({ x: xOf(putWall),  text: `PW $${putWall.toFixed(0)}`,   fill: 'var(--danger)',  y: LY1 });
    if (magnet   != null) lbls.push({ x: xOf(magnet),   text: `MAG $${magnet.toFixed(0)}`,   fill: 'var(--warning)', y: LY1 });
    if (callWall != null) lbls.push({ x: xOf(callWall), text: `CW $${callWall.toFixed(0)}`,  fill: 'var(--accent)',  y: LY1 });
    lbls.sort((a, b) => a.x - b.x);
    // Stagger: if two adjacent labels would overlap (approx 7px per char), shift second down
    for (let i = 1; i < lbls.length; i++) {
      const prev = lbls[i - 1];
      const curr = lbls[i];
      const prevRight = prev.x + prev.text.length * 3.8;
      if (curr.y === prev.y && curr.x < prevRight + 5) curr.y = LY2;
    }
    lbls.forEach(l => {
      parts.push(`<text x="${l.x.toFixed(1)}" y="${l.y}" text-anchor="middle" font-size="9" fill="${l.fill}" font-family="monospace">${l.text}</text>`);
    });

    // Spot label above (clamped to SVG bounds)
    if (spot != null) {
      const sx  = xOf(spot);
      const ax  = Math.max(28, Math.min(W - 28, sx));
      const hasBelowLbl = lbls.some(l => l.y === LY2);
      parts.push(`<text x="${ax.toFixed(1)}" y="${TY - 32}" text-anchor="middle" font-size="9" fill="var(--text-primary)" font-weight="bold" font-family="monospace">$${spot.toFixed(2)}</text>`);
    }

    const svgH = (lbls.some(l => l.y === LY2) ? LY2 : LY1) + 10;
    terrainEl.innerHTML =
      `<svg viewBox="0 0 ${W} ${svgH}" preserveAspectRatio="xMidYMid meet" width="100%" style="overflow:visible;display:block">` +
      parts.join('') + `</svg>`;

    // Caption: regime + flip note + net gamma
    const capParts = [];
    const regime = gex.regime;
    if (regime === 'POS-gamma')      capParts.push('POS-γ (pin)');
    else if (regime === 'NEG-gamma') capParts.push('NEG-γ (amplify)');
    capParts.push(gex.gamma_flip != null ? `flip $${gex.gamma_flip.toFixed(2)}` : 'flip n/a (guarded)');
    if (gex.net_gex_dir != null) {
      const ng = gex.net_gex_dir;
      capParts.push(`net γ ${ng >= 0 ? '+' : ''}${ng.toFixed(1)}/1%`);
    }
    captionEl.textContent = capParts.join(' · ');
  }

  function _updateGexLevelBtns(gex) {
    const avail = gex && gex.available;
    const pwBtn  = document.getElementById('gexBtnPutWall');
    const mgBtn  = document.getElementById('gexBtnMagnet');
    const cwBtn  = document.getElementById('gexBtnCallWall');
    if (!pwBtn) return;

    pwBtn.disabled  = !avail || gex.put_wall     == null;
    mgBtn.disabled  = !avail || gex.gamma_magnet == null;
    cwBtn.disabled  = !avail || gex.call_wall    == null;

    if (avail) {
      if (gex.put_wall     != null) pwBtn.textContent = `PW $${gex.put_wall.toFixed(0)}`;
      if (gex.gamma_magnet != null) mgBtn.textContent = `MAG $${gex.gamma_magnet.toFixed(0)}`;
      if (gex.call_wall    != null) cwBtn.textContent = `CW $${gex.call_wall.toFixed(0)}`;
    }
  }

  function scheduleGexProjection() {
    if (gexProjTimer) clearTimeout(gexProjTimer);
    gexProjTimer = setTimeout(() => {
      const inp = document.getElementById('gexTargetInput');
      const val = inp && parseFloat(inp.value);
      if (val && val > 0) _loadGexProjection(val);
    }, 600);
  }

  async function _loadGexProjection(target) {
    const pos    = gexModalPos;
    const wrapEl = document.getElementById('gexProjResult');
    const verdEl = document.getElementById('gexProjVerdict');
    const noteEl = document.getElementById('gexProjFootnote');
    if (!pos || !wrapEl) return;

    if (!gexModalIv || gexModalIv <= 0) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.35rem 0;font-size:0.68rem">IV unavailable — chain data needed (market hours)</div>';
      if (verdEl) verdEl.style.display = 'none';
      if (noteEl) noteEl.textContent = '';
      return;
    }

    wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.35rem 0;font-size:0.68rem">Loading projection…</div>';
    if (verdEl) verdEl.style.display = 'none';

    const dte        = _computeDteNum(pos.expiry);
    const optionType = pos.direction.toLowerCase().includes('put') ? 'put' : 'call';

    try {
      const params = new URLSearchParams({
        ticker:      pos.ticker,
        strike:      pos.strike,
        expiry:      pos.expiry,
        target,
        option_type: optionType,
        iv:          gexModalIv,
        premium:     pos.entry_price,
        dte,
        iv_crush:    0,
      });
      const proj = await apiFetch(`/api/projection?${params}`);
      _renderGexProjection(proj, wrapEl, verdEl, noteEl);
    } catch (err) {
      const msg = String(err).includes('403') ? 'Admin access required' : 'Projection unavailable';
      wrapEl.innerHTML = `<div class="dash-placeholder" style="padding:0.35rem 0;font-size:0.68rem">${msg}</div>`;
    }
  }

  function _renderGexProjection(proj, wrapEl, verdEl, noteEl) {
    gexLastProj = proj;
    const rows = proj.rows || [];
    if (!rows.length) {
      wrapEl.innerHTML = '<div class="dash-placeholder" style="padding:0.35rem 0;font-size:0.68rem">No projection data</div>';
      return;
    }

    // ── Estimated option price beside the target input ────────────────────
    const todayRow = rows[0];  // "today (0d)": move happens now, full DTE
    const pos      = gexModalPos;
    const estEl    = document.getElementById('gexEstOptPrice');
    if (estEl && todayRow) {
      const estPrice = todayRow.value;
      const curOpt   = pos && pos.current_price != null ? pos.current_price : (pos ? pos.entry_price : 0);
      const delta    = curOpt > 0 ? estPrice - curOpt : null;
      const deltaPct = (delta != null && curOpt > 0) ? (delta / curOpt * 100) : null;
      const deltaCls = delta == null ? '' : delta >= 0 ? 'positive' : 'negative';
      const deltaStr = delta != null
        ? `<span class="gex-est-opt-delta ${deltaCls}">${delta >= 0 ? '+' : ''}$${Math.abs(delta).toFixed(2)} (${delta >= 0 ? '+' : ''}${deltaPct.toFixed(1)}% vs current)</span>`
        : '';
      estEl.innerHTML =
        `<div class="gex-est-opt-label">Est. option</div>` +
        `<div class="gex-est-opt-val">$${estPrice.toFixed(2)}</div>` +
        deltaStr;
    }

    // ── Target reference: stock delta vs current spot ─────────────────────
    const refEl = document.getElementById('gexTargetRef');
    const spot  = gexData && gexData.spot;
    if (refEl && spot && proj.target) {
      const d   = proj.target - spot;
      const dp  = spot > 0 ? (d / spot * 100) : 0;
      const sgn = d >= 0 ? '+' : '';
      refEl.textContent =
        `${sgn}$${Math.abs(d).toFixed(2)} (${sgn}${dp.toFixed(1)}%) vs spot $${spot.toFixed(2)}`;
    }

    // ── Time-horizon strip ────────────────────────────────────────────────
    // Shows how the estimate degrades over time if target is reached later.
    // Gain/loss columns are vs entry price (premium param sent to API).
    const labelMap = { 'today (0d)': 'now', '1d': '1d', '2d': '2d', 'at expiry': 'expiry' };
    const rowsHtml = rows.map(r => {
      const gainCls = r.gain_pct >= 0 ? 'positive' : 'negative';
      const dolSign = r.dollars  >= 0 ? '+' : '';
      const lbl     = labelMap[r.horizon_label] || r.horizon_label;
      return `<div class="proj-strip-cell">
  <div class="proj-strip-when">${lbl}</div>
  <div class="proj-strip-val">$${r.value.toFixed(2)}</div>
  <div class="proj-strip-gain ${gainCls}">${r.gain_pct >= 0 ? '+' : ''}${r.gain_pct.toFixed(1)}%</div>
  <div class="proj-strip-dol ${gainCls}">${dolSign}$${Math.abs(Math.round(r.dollars))}</div>
</div>`;
    }).join('');
    wrapEl.innerHTML =
      `<div class="gex-strip-hdr">Estimate if target reached at each horizon — theta erodes value whether or not the stock moves</div>` +
      `<div class="cockpit-proj-strip">${rowsHtml}</div>`;

    if (verdEl) {
      const verdictMap = {
        worthless_at_expiry: { cls: 'verdict-red',   icon: '✗', text: 'Worthless at expiry — expires OTM even if stock hits target' },
        theta_dominated:     { cls: 'verdict-amber',  icon: '⚡', text: 'Theta dominated — most value lost by expiry; move must happen soon' },
        survives_slow_move:  { cls: 'verdict-green',  icon: '✓', text: 'Survives slow move — retains value at target even near expiry' },
      };
      const v = verdictMap[proj.verdict] || { cls: '', icon: '?', text: proj.verdict };
      verdEl.innerHTML  = `${v.icon} ${v.text}`;
      verdEl.className  = `cockpit-verdict ${v.cls}`;
      verdEl.style.display = '';
    }
    if (noteEl) {
      const tgtStr = proj.target != null ? `$${proj.target.toFixed(2)}` : '—';
      noteEl.textContent =
        `Black-Scholes reprice at ${tgtStr} · IV ${(gexModalIv * 100).toFixed(1)}% · ` +
        `gain/loss vs entry · analysis only, not an order`;
    }

    // _updateExitSection removed 2026-08-03 — exit-bracket endpoint retired;
    // #gexExitSection stays hidden, see trading.py /api/trading/exit-bracket
  }

  function _updateExitSection(proj) {
    const pos    = gexModalPos;
    const sectEl = document.getElementById('gexExitSection');
    if (!pos || !sectEl) return;

    sectEl.style.display = '';

    // Auto-fill TP from the "now (0d)" estimated option price
    const tpInput = document.getElementById('gexExitTp');
    if (tpInput && proj.rows && proj.rows.length > 0) {
      tpInput.value = proj.rows[0].value.toFixed(2);
    }
    const hintEl = document.getElementById('gexExitTpHint');
    if (hintEl) {
      const tgtInput = document.getElementById('gexTargetInput');
      const tgtVal   = tgtInput ? parseFloat(tgtInput.value) : 0;
      hintEl.textContent = tgtVal > 0 ? `from $${tgtVal.toFixed(2)} stock target` : '';
    }

    _renderExitSummary();
  }

  function _renderExitSummary() {
    const pos       = gexModalPos;
    const summaryEl = document.getElementById('gexExitSummary');
    const stageBtn  = document.getElementById('gexExitStageBtn');
    if (!pos || !summaryEl) return;

    const bracketEl = document.getElementById('gexExitBracket');
    const isBracket = bracketEl ? bracketEl.checked : true;
    const tp        = parseFloat((document.getElementById('gexExitTp')   || {}).value) || 0;
    const stop      = parseFloat((document.getElementById('gexExitStop') || {}).value) || 0;
    const qty       = pos.contracts_open || 1;
    const sym       = pos.option_symbol || `${pos.ticker} $${pos.strike}`;

    const valid = tp > 0 && (!isBracket || (stop > 0 && stop < tp));

    if (!valid) {
      summaryEl.textContent = isBracket
        ? 'Enter take-profit and stop prices — stop must be below take-profit'
        : 'Enter a take-profit price';
      if (stageBtn) stageBtn.disabled = true;
      return;
    }

    summaryEl.textContent = isBracket
      ? `${qty}× ${sym} · GTC · exit at $${tp.toFixed(2)} or stop $${stop.toFixed(2)} — first fill cancels the other`
      : `${qty}× ${sym} · GTC limit · exit at $${tp.toFixed(2)}`;

    if (stageBtn) stageBtn.disabled = false;
  }

  async function _stageExitBracket() {
    const pos      = gexModalPos;
    const resultEl = document.getElementById('gexExitResult');
    const stageBtn = document.getElementById('gexExitStageBtn');
    if (!pos || !resultEl) return;

    if (stageBtn) stageBtn.disabled = true;
    resultEl.className   = 'gex-exit-result';
    resultEl.textContent = 'Staging…';

    const bracketEl = document.getElementById('gexExitBracket');
    const isBracket = bracketEl ? bracketEl.checked : true;
    const tp   = parseFloat((document.getElementById('gexExitTp')   || {}).value) || 0;
    const stop = parseFloat((document.getElementById('gexExitStop') || {}).value) || 0;
    const qty  = pos.contracts_open || 1;

    try {
      const resp = await apiFetch('/api/trading/exit-bracket', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          position_id:   pos.position_id,
          option_symbol: pos.option_symbol,
          contracts:     qty,
          tp_price:      tp,
          stop_price:    stop,
          bracket:       isBracket,
        }),
      });
      if (resp.order_id) {
        resultEl.className   = 'gex-exit-result success';
        resultEl.textContent = `✓ Staged — order ${resp.order_id}: ${resp.summary}`;
      } else {
        resultEl.className   = 'gex-exit-result error';
        resultEl.textContent = `Error: ${resp.detail || 'Unknown error'}`;
      }
    } catch (err) {
      const e   = String(err);
      const msg = e.includes('503') ? 'Kill-switch is OFF — web trading disabled'
                : e.includes('403') ? 'Admin access required'
                : e.includes('422') ? 'Invalid order parameters — check prices'
                : e;
      resultEl.className   = 'gex-exit-result error';
      resultEl.textContent = msg;
    } finally {
      if (stageBtn) stageBtn.disabled = false;
    }
  }

  function _computeDteNum(expiry) {
    if (!expiry) return 0;
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const exp  = new Date(expiry + 'T00:00:00');
    return Math.max(0, Math.round((exp - today) / 86_400_000));
  }

  // ── Analytics strip GEX stat row ──────────────────────────────────────────
  // Replaces the single gamma_flip value with a compact 2-line terrain summary.

  async function loadGexFlipCell(ticker) {
    const valueEl = document.getElementById('acGexFlip');
    const cellEl  = document.getElementById('acCellGexFlip');
    if (!valueEl) return;

    if (!ticker) {
      valueEl.textContent = '—';
      valueEl.style.color = 'var(--text-muted)';
      if (cellEl) cellEl.classList.remove('stale');
      return;
    }

    try {
      const gex = await apiFetch(`/api/gex?ticker=${encodeURIComponent(ticker)}`);
      focusGexCache = (gex && gex.available) ? gex : null;

      if (!gex || !gex.available) {
        valueEl.textContent = '—';
        valueEl.style.color = 'var(--text-muted)';
        if (cellEl) cellEl.classList.remove('stale');
        return;
      }

      const regime = gex.regime;
      const regimeCls  = regime === 'POS-gamma' ? 'pos' : regime === 'NEG-gamma' ? 'neg' : '';
      const regimeText = regime === 'POS-gamma' ? 'POS-γ pin'
                       : regime === 'NEG-gamma' ? 'NEG-γ amplify'
                       : '—';

      const fmtLvl = (price, distPct) => {
        if (price == null) return '—';
        const d = distPct != null
          ? `(${distPct >= 0 ? '+' : ''}${distPct.toFixed(1)}%)`
          : '';
        return `$${price.toFixed(0)}${d}`;
      };

      const pw  = fmtLvl(gex.put_wall,     gex.dist_to_put_wall_pct);
      const mag = fmtLvl(gex.gamma_magnet, gex.dist_to_magnet_pct);
      const cw  = fmtLvl(gex.call_wall,    gex.dist_to_call_wall_pct);
      const ng  = gex.net_gex_dir != null
        ? (gex.net_gex_dir >= 0 ? '+' : '') + gex.net_gex_dir.toFixed(1)
        : '—';

      valueEl.style.color = '';
      valueEl.innerHTML =
        `<span class="gex-ac-regime gex-ac-regime-${regimeCls}">${regimeText}</span>` +
        `<span class="gex-ac-levels">PW ${pw} · MG ${mag} · CW ${cw} · γ${ng}</span>`;
      if (cellEl) cellEl.classList.toggle('stale', !!gex.stale_exposure);

    } catch (_) {
      valueEl.textContent = '—';
      valueEl.style.color = 'var(--text-muted)';
    }
  }

  // ── Universe screener (authenticated members) ────────────────────────────

  function _injectUniverseToggle() {
    const headerLeft = document.querySelector('.dash-header-left');
    if (!headerLeft) return;
    const bar = document.createElement('div');
    bar.className = 'univ-view-toggle';
    bar.innerHTML =
      '<button class="univ-view-btn active" id="cockpitViewBtn">Cockpit</button>' +
      '<button class="univ-view-btn" id="univViewBtn">Universe</button>';
    headerLeft.appendChild(bar);
    document.getElementById('cockpitViewBtn').addEventListener('click', _enterCockpitMode);
    document.getElementById('univViewBtn').addEventListener('click', _enterUniverseMode);
  }

  function _injectUniverseView() {
    const mainEl = document.querySelector('.cmd-main');
    if (!mainEl) return;
    const wrap = document.createElement('div');
    wrap.id        = 'universeWrap';
    wrap.className = 'univ-wrap';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="univ-toolbar">' +
        '<span class="univ-freshness" id="univFreshness">—</span>' +
        '<div class="univ-filters" id="univFilters">' +
          '<div class="univ-fgroup">' +
            '<span class="univ-flabel">10m</span>' +
            '<button class="univ-fchip" data-col="cloud_10m" data-val="bull">bull</button>' +
            '<button class="univ-fchip" data-col="cloud_10m" data-val="bear">bear</button>' +
            '<button class="univ-fchip" data-col="cloud_10m" data-val="inside">neutral</button>' +
          '</div>' +
          '<div class="univ-fgroup">' +
            '<span class="univ-flabel">1h</span>' +
            '<button class="univ-fchip" data-col="cloud_1h" data-val="bull">bull</button>' +
            '<button class="univ-fchip" data-col="cloud_1h" data-val="bear">bear</button>' +
            '<button class="univ-fchip" data-col="cloud_1h" data-val="inside">neutral</button>' +
          '</div>' +
          '<div class="univ-fgroup">' +
            '<span class="univ-flabel">1d</span>' +
            '<button class="univ-fchip" data-col="cloud_1d" data-val="bull">bull</button>' +
            '<button class="univ-fchip" data-col="cloud_1d" data-val="bear">bear</button>' +
            '<button class="univ-fchip" data-col="cloud_1d" data-val="inside">neutral</button>' +
          '</div>' +
          '<div class="univ-fgroup">' +
            '<span class="univ-flabel">PM</span>' +
            '<button class="univ-fchip" data-col="pm_break_state" data-val="bull_break">▲ break</button>' +
            '<button class="univ-fchip" data-col="pm_break_state" data-val="bear_break">▼ break</button>' +
            '<button class="univ-fchip" data-col="pm_break_state" data-val="chop">chop</button>' +
            '<button class="univ-fchip" data-col="pm_break_state" data-val="pending">pending</button>' +
          '</div>' +
        '</div>' +
        '<span class="univ-disclaimer">Informational screen — not trade advice</span>' +
      '</div>' +
      '<div class="univ-table-wrap" id="univTableWrap">' +
        '<div class="dash-placeholder">Loading universe…</div>' +
      '</div>';
    // Insert between cmd-main and app-ribbon so it inherits the flex slot
    mainEl.parentNode.insertBefore(wrap, mainEl.nextElementSibling);

    // Wire filter chips once — toolbar is not re-rendered each 65s cycle
    wrap.querySelectorAll('.univ-fchip').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const col = btn.dataset.col;
        const val = btn.dataset.val;
        univFilters[col] = univFilters[col] === val ? null : val;
        wrap.querySelectorAll(`.univ-fchip[data-col="${col}"]`).forEach(b =>
          b.classList.toggle('active', b.dataset.val === univFilters[col])
        );
        if (universeDataCache && universeDataCache.rows) renderUniverseTable(universeDataCache.rows);
      });
    });
  }

  function _enterUniverseMode() {
    universeMode = true;
    journalMode  = false;
    const main  = document.querySelector('.cmd-main');
    const uWrap = document.getElementById('universeWrap');
    const jWrap = document.getElementById('journalWrap');
    if (main)  main.style.display  = 'none';
    if (uWrap) uWrap.style.display = 'flex';
    if (jWrap) jWrap.style.display = 'none';
    document.getElementById('univViewBtn')?.classList.add('active');
    document.getElementById('cockpitViewBtn')?.classList.remove('active');
    document.getElementById('journalViewBtn')?.classList.remove('active');
    if (universeDataCache) {
      _renderUniverseFreshness(universeDataCache);
      renderUniverseTable(universeDataCache.rows || []);
    } else {
      loadUniverse();
    }
  }

  function _enterCockpitMode() {
    universeMode = false;
    journalMode  = false;
    const main  = document.querySelector('.cmd-main');
    const uWrap = document.getElementById('universeWrap');
    const jWrap = document.getElementById('journalWrap');
    if (main)  main.style.display  = '';
    if (uWrap) uWrap.style.display = 'none';
    if (jWrap) jWrap.style.display = 'none';
    document.getElementById('cockpitViewBtn')?.classList.add('active');
    document.getElementById('univViewBtn')?.classList.remove('active');
    document.getElementById('journalViewBtn')?.classList.remove('active');
  }

  async function loadUniverse() {
    if (!authToken) return;
    try {
      const data = await apiFetch('/api/scan-universe');
      universeDataCache = data;
      // Only push to DOM when the tab is visible
      if (!universeMode) return;
      _renderUniverseFreshness(data);
      if (!data.available) {
        const wrap = document.getElementById('univTableWrap');
        if (wrap) wrap.innerHTML =
          '<div class="dash-placeholder">No scan data yet — populates at next scan cycle</div>';
        return;
      }
      renderUniverseTable(data.rows || []);
    } catch (err) {
      if (err.status === 403) return;
      if (universeMode) {
        const wrap = document.getElementById('univTableWrap');
        if (wrap) wrap.innerHTML =
          '<div class="dash-placeholder">Could not load scan universe</div>';
      }
    }
  }

  function _renderUniverseFreshness(data) {
    const el = document.getElementById('univFreshness');
    if (!el) return;
    if (!data.available) { el.textContent = 'no data'; el.classList.remove('stale'); return; }
    const age = data.age_secs;
    const ageStr = age == null ? '?' : age < 60 ? `${Math.round(age)}s ago` : `${Math.round(age / 60)}m ago`;
    el.textContent = `live · ${ageStr}`;
    el.classList.toggle('stale', !!data.stale);
  }

  function renderUniverseTable(rows) {
    const wrap = document.getElementById('univTableWrap');
    if (!wrap) return;
    if (!rows.length) {
      wrap.innerHTML =
        '<div class="dash-placeholder">No scan data yet — populates at next scan cycle</div>';
      return;
    }

    // Watchlist index for overlay (trigger / rank_score / arm_state for locked names)
    const wlMap = {};
    watchlistDataCache.forEach(r => { wlMap[r.ticker] = r; });

    // Enrich: live pm_break_state recompute + watchlist overlay
    const TIER_ORD = { PRIME: 0, WATCH: 1, CAUTION: 2, SKIP: 3 };
    const enriched = rows.map(row => {
      const wl = wlMap[row.ticker] || null;
      // Prefer watchlist current_price (live, enriched server-side) for locked names;
      // fall back to prev_close from scan cache for the other ~68 tickers.
      const livePrice = (wl && wl.current_price) ? parseFloat(wl.current_price) : (row.price || 0);

      // Recompute pm_break_state from best available price vs emitted pm levels
      let pmBreak = row.pm_break_state;
      if (livePrice > 0 && row.pm_high != null && row.pm_low != null) {
        if (livePrice > row.pm_high)      pmBreak = 'bull_break';
        else if (livePrice < row.pm_low)  pmBreak = 'bear_break';
        else                              pmBreak = 'chop';
      }

      return {
        ...row,
        live_price:     livePrice,
        pm_break_state: pmBreak,
        _tier_ord:      TIER_ORD[row.tier] ?? 9,
        // Watchlist overlay
        trigger:    wl && wl.trigger    != null ? parseFloat(wl.trigger)    : null,
        rank_score: wl && wl.rank_score != null ? parseFloat(wl.rank_score) : null,
        arm_state:  wl ? (wl.arm_state || null) : null,
      };
    });

    // Filter — AND-combine all active filters (null = inactive)
    const filtered = enriched.filter(r =>
      Object.entries(univFilters).every(([k, v]) => v === null || r[k] === v)
    );

    // Sort — applied to the filtered subset
    const col = univSortCol;
    const dir = univSortDir;
    filtered.sort((a, b) => {
      let va = a[col], vb = b[col];
      if (va == null && vb == null) return 0;
      if (va == null) return 1;
      if (vb == null) return -1;
      if (typeof va === 'string') return dir * va.localeCompare(vb);
      return dir * (va - vb);
    });

    const COLS = [
      { key: 'ticker',         label: 'Ticker',   right: false,                width: '13%' },
      { key: 'live_price',     label: 'Price',    right: true,                 width: '9%'  },
      { key: 'cloud_10m',      label: '10m',      right: false, center: true,  width: '6%'  },
      { key: 'cloud_1h',       label: '1h',       right: false, center: true,  width: '6%'  },
      { key: 'cloud_1d',       label: '1d',       right: false, center: true,  width: '6%'  },
      { key: 'pm_break_state', label: 'PM Break', right: false,                width: '13%' },
      { key: 'daily_atr',      label: 'ATR',      right: true,                 width: '9%'  },
      { key: 'atr_consumed',   label: 'Consumed', right: true,                 width: '9%'  },
      { key: 'gex_state',      label: 'GAMMA',    right: false,                width: '12%' },
      { key: 'gex_put_wall',   label: 'WALLS',    right: false,                width: '17%' },
    ];

    const colgroup = '<colgroup>' +
      COLS.map(c => `<col style="width:${c.width}">`).join('') +
      '</colgroup>';

    const headers = COLS.map(c => {
      const isSorted = c.key === univSortCol;
      const arrow    = isSorted ? (univSortDir === 1 ? ' ▲' : ' ▼') : '';
      const cls      = 'univ-th' +
        (isSorted  ? ' sorted'      : '') +
        (c.right   ? ' univ-r'      : '') +
        (c.center  ? ' univ-center' : '');
      return `<th class="${cls}" data-col="${c.key}">${c.label}${arrow}</th>`;
    }).join('');

    const rowsHtml = filtered.map(r => {
      const cells = COLS.map(c => {
        const v = r[c.key];
        switch (c.key) {
          case 'ticker':
            return `<td class="univ-td univ-ticker">${r.ticker}</td>`;

          case 'live_price':
            return `<td class="univ-td univ-r">${v > 0 ? '$' + v.toFixed(2) : '—'}</td>`;

          case 'cloud_10m':
          case 'cloud_1h':
          case 'cloud_1d': {
            const cls = ({ bull: 'bull', bear: 'bear', inside: 'inside' })[v] || 'unknown';
            const sym = v === 'bull' ? '●' : v === 'bear' ? '●' : v === 'inside' ? '◐' : '○';
            return `<td class="univ-td univ-center"><span class="univ-cloud univ-cloud-${cls}" title="${v || '?'}">${sym}</span></td>`;
          }

          case 'pm_break_state': {
            const lbl = ({ bull_break: '▲ break', bear_break: '▼ break', chop: 'chop', pending: '—' })[v] || (v || '—');
            const cls = ({ bull_break: 'bull', bear_break: 'bear', chop: 'chop', pending: 'pending' })[v] || '';
            return `<td class="univ-td"><span class="univ-pm univ-pm-${cls}">${lbl}</span></td>`;
          }

          case 'daily_atr':
            return `<td class="univ-td univ-r">${v > 0 ? v.toFixed(2) : '—'}</td>`;

          case 'atr_consumed': {
            // consumed_pct stored as 0-1 decimal; display as integer percent
            const pct = v != null ? Math.round(v * 100) : null;
            const cls = pct == null ? '' : pct >= 75 ? ' univ-consumed-hi' : pct >= 40 ? ' univ-consumed-mid' : '';
            return `<td class="univ-td univ-r${cls}">${pct != null ? pct + '%' : '—'}</td>`;
          }

          case 'gex_state': {
            const dot = v === 'Expansion' ? '🟢' : v === 'Compression' ? '🔵' : '⚪';
            return `<td class="univ-td"><span class="univ-gex-chip">${dot} ${v || '—'}</span></td>`;
          }

          case 'gex_put_wall': {
            const fmtW = n => n == null ? '—' : (n % 1 === 0 ? Math.round(n).toString() : n.toFixed(2));
            return `<td class="univ-td">${fmtW(r.gex_put_wall)} · ${fmtW(r.gex_magnet)} · ${fmtW(r.gex_call_wall)}</td>`;
          }

          default:
            return `<td class="univ-td">${v != null ? v : '—'}</td>`;
        }
      }).join('');
      return `<tr class="univ-row" data-ticker="${r.ticker}">${cells}</tr>`;
    }).join('');

    wrap.innerHTML =
      '<table class="univ-table">' +
        colgroup +
        '<thead><tr>' + headers + '</tr></thead>' +
        '<tbody>' + rowsHtml + '</tbody>' +
      '</table>';

    // Column header click → sort
    wrap.querySelectorAll('.univ-th').forEach(th => {
      th.addEventListener('click', () => {
        const key = th.dataset.col;
        if (univSortCol === key) {
          univSortDir *= -1;
        } else {
          univSortCol = key;
          // Default direction: ascending for text columns, descending for numeric
          univSortDir = key === 'ticker' ? 1 : -1;
        }
        if (universeDataCache && universeDataCache.rows) renderUniverseTable(universeDataCache.rows);
      });
    });

    // Row click → focus ticker in cockpit
    wrap.querySelectorAll('.univ-row').forEach(row => {
      row.addEventListener('click', () => {
        const t = row.dataset.ticker;
        if (t) { _enterCockpitMode(); focusOn(t); }
      });
    });
  }

  // ── Journal tab ───────────────────────────────────────────────────────────

  function _jEsc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function _jFmtHold(secs) {
    if (secs == null) return '—';
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    return h > 0 ? h + 'h ' + m + 'm' : m + 'm';
  }

  function _jFmtTidePrem(val) {
    if (val == null) return '—';
    const abs  = Math.abs(val);
    const sign = val >= 0 ? '+' : '−';
    if (abs >= 1e6) return sign + '$' + (abs / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return sign + '$' + (abs / 1e3).toFixed(0) + 'K';
    return sign + '$' + abs.toFixed(0);
  }

  function _jShortReason(reason) {
    if (!reason) return '—';
    const map = {
      TAKE_PROFIT_1:           'TP1',
      TAKE_PROFIT_2:           'TP2',
      STOP_HIT:                'SL',
      TRAIL_STOP:              'Trail',
      MANUAL_CLOSE:            'Manual',
      RECONCILED_PHANTOM:      'Phantom',
      RECONCILED_UNKNOWN_EXIT: 'Rcncl',
      RECONCILED_UNKNOWN:      'Rcncl',
      TIME_STOP:               'TimeStop',
      BIAS_FLIP:               'BiasFlip',
    };
    return map[reason] || reason.replace(/_/g, ' ').toLowerCase();
  }

  function _jFillBadge(trade) {
    if (trade.exit_tracking_absent)
      return '<span class="jt-badge jt-badge-absent" title="Predates pnl_log — exit never recorded">absent</span>';
    switch (trade.fill_source) {
      case 'tradier_confirmed':
        return '<span class="jt-badge jt-badge-conf" title="Broker-confirmed">conf</span>';
      case 'estimated':
        return '<span class="jt-badge jt-badge-est" title="Estimated fill">est</span>';
      case 'unavailable':
        return '<span class="jt-badge jt-badge-unav" title="Fill unavailable">unav</span>';
      default:
        return _jEsc(trade.fill_source || '—');
    }
  }

  function _injectJournalToggle() {
    const toggle = document.querySelector('.univ-view-toggle');
    if (!toggle || document.getElementById('journalViewBtn')) return;
    const btn = document.createElement('button');
    btn.className   = 'univ-view-btn';
    btn.id          = 'journalViewBtn';
    btn.textContent = 'Journal';
    toggle.appendChild(btn);
    btn.addEventListener('click', _enterJournalMode);
  }

  function _injectJournalView() {
    if (document.getElementById('journalWrap')) return;
    const uWrap = document.getElementById('universeWrap');
    const wrap  = document.createElement('div');
    wrap.id        = 'journalWrap';
    wrap.className = 'journal-wrap';
    wrap.style.display = 'none';
    wrap.innerHTML =
      '<div class="journal-cal-wrap">' +
        '<div class="journal-nav">' +
          '<button class="journal-nav-btn" id="journalPrev">&#9664;</button>' +
          '<span class="journal-nav-month" id="journalMonthLabel">—</span>' +
          '<button class="journal-nav-btn" id="journalNext">&#9654;</button>' +
          '<span class="journal-nav-loading" id="journalLoading" style="display:none">Loading…</span>' +
        '</div>' +
        '<div class="journal-cal-dow-row">' +
          ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'].map(d =>
            '<div class="journal-cal-dow">' + d + '</div>'
          ).join('') +
        '</div>' +
        '<div id="journalCalGrid" class="journal-cal-grid"></div>' +
      '</div>' +
      '<div id="journalDetail" class="journal-detail">' +
        '<div class="dash-placeholder" style="padding:1.5rem">Click a day to see details</div>' +
      '</div>';
    if (uWrap && uWrap.parentNode) {
      uWrap.parentNode.insertBefore(wrap, uWrap.nextSibling);
    } else {
      const main = document.querySelector('.cmd-main');
      if (main && main.parentNode) main.parentNode.insertBefore(wrap, main.nextSibling);
    }
    document.getElementById('journalPrev').addEventListener('click', () => {
      if (!journalMonth) return;
      const [y, m] = journalMonth.split('-').map(Number);
      const prev   = m === 1 ? (y - 1) + '-12' : y + '-' + String(m - 1).padStart(2, '0');
      loadJournalCalendar(prev);
    });
    document.getElementById('journalNext').addEventListener('click', () => {
      if (!journalMonth) return;
      const [y, m] = journalMonth.split('-').map(Number);
      const next   = m === 12 ? (y + 1) + '-01' : y + '-' + String(m + 1).padStart(2, '0');
      loadJournalCalendar(next);
    });
  }

  function _enterJournalMode() {
    journalMode  = true;
    universeMode = false;
    const main  = document.querySelector('.cmd-main');
    const uWrap = document.getElementById('universeWrap');
    const jWrap = document.getElementById('journalWrap');
    if (main)  main.style.display  = 'none';
    if (uWrap) uWrap.style.display = 'none';
    if (jWrap) jWrap.style.display = 'flex';
    document.getElementById('journalViewBtn')?.classList.add('active');
    document.getElementById('cockpitViewBtn')?.classList.remove('active');
    document.getElementById('univViewBtn')?.classList.remove('active');
    if (!journalMonth) {
      const now = new Date();
      journalMonth = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0');
    }
    if (journalCalCache && journalCalCache.month === journalMonth) {
      _renderJournalCalendar(journalCalCache);
    } else {
      loadJournalCalendar(journalMonth);
    }
  }

  async function loadJournalCalendar(month) {
    journalMonth = month;
    const label   = document.getElementById('journalMonthLabel');
    const loading = document.getElementById('journalLoading');
    if (label) {
      const [y, m] = month.split('-').map(Number);
      label.textContent = new Date(y, m - 1, 1).toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
    }
    if (loading) loading.style.display = '';
    const grid = document.getElementById('journalCalGrid');
    if (grid) grid.innerHTML = '<div class="dash-placeholder" style="padding:1rem">Loading…</div>';
    try {
      const data = await apiFetch('/api/journal/calendar?month=' + encodeURIComponent(month));
      journalCalCache = data;
      _renderJournalCalendar(data);
    } catch (err) {
      if (grid) grid.innerHTML = '<div class="dash-placeholder" style="padding:1rem">Could not load calendar</div>';
    } finally {
      if (loading) loading.style.display = 'none';
    }
  }

  function _renderJournalCalendar(data) {
    const grid = document.getElementById('journalCalGrid');
    if (!grid) return;

    const byDate = {};
    (data.days || []).forEach(d => { byDate[d.date] = d; });

    const [y, m]   = (data.month || journalMonth).split('-').map(Number);
    const firstDow = new Date(y, m - 1, 1).getDay();  // 0=Sun
    const lastDay  = new Date(y, m, 0).getDate();

    // Today's ET date approximated as UTC date (close enough for cell highlight)
    const todayStr = new Date().toISOString().slice(0, 10);

    let html = '';

    // Empty cells before day 1
    for (let i = 0; i < firstDow; i++) {
      html += '<div class="journal-cal-cell journal-cal-empty"></div>';
    }

    for (let day = 1; day <= lastDay; day++) {
      const dateStr  = y + '-' + String(m).padStart(2, '0') + '-' + String(day).padStart(2, '0');
      const dow      = (firstDow + day - 1) % 7;
      const isWeekend = dow === 0 || dow === 6;
      const cell     = byDate[dateStr];
      const isToday  = dateStr === todayStr;
      const isSel    = dateStr === journalSelDate;

      let cls = 'journal-cal-cell';
      if (isWeekend)          cls += ' journal-cal-weekend';
      if (!cell)              cls += ' journal-cal-nodata';
      if (cell && cell.trade_count > 0) cls += ' journal-cal-has-trades';
      if (isToday)            cls += ' journal-cal-today';
      if (isSel)              cls += ' journal-cal-selected';

      let inner = '<div class="journal-cal-date">' + day + '</div>';

      if (cell) {
        // Confirmed P&L
        if (cell.confirmed_count > 0) {
          const v   = cell.confirmed_pnl;
          const cls2 = v >= 0 ? 'pos' : 'neg';
          inner += '<div class="journal-cal-pnl ' + cls2 + '">' +
            (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', {maximumFractionDigits: 0}) +
            '<span class="journal-pnl-tag"> ✓</span></div>';
        }
        // Estimated / unverified P&L (estimated + unavailable rows with estimated_pnl)
        const hasEst = (cell.estimated_count || 0) + (cell.unavailable_count || 0) > 0;
        if (hasEst && cell.estimated_pnl != null) {
          const v    = cell.estimated_pnl;
          const cls2 = v >= 0 ? 'pos' : 'neg';
          inner += '<div class="journal-cal-pnl journal-cal-pnl-est ' + cls2 + '">' +
            (v >= 0 ? '+' : '') + '$' + Math.abs(v).toLocaleString('en-US', {maximumFractionDigits: 0}) +
            '<span class="journal-pnl-tag"> ~</span></div>';
        }
        // Trade count
        if (cell.trade_count > 0) {
          inner += '<div class="journal-cal-count">' + cell.trade_count + 't</div>';
        }
        // Context-only day (daily_market exists, no trades)
        if (cell.trade_count === 0 && cell.has_market_context && cell.directive) {
          inner += '<div class="journal-cal-regime">' + _jEsc(cell.directive) + '</div>';
        }
        // Markers
        let markers = '';
        if (cell.has_macro_event)     markers += '<span class="jcal-marker jcal-macro" title="Macro event scheduled">M</span>';
        if (cell.has_unresolved_fill) markers += '<span class="jcal-marker jcal-unresolved" title="Unresolved fill — tracking present but unconfirmed">⚠</span>';
        if (cell.has_tracking_absent) markers += '<span class="jcal-marker jcal-absent" title="Exit tracking absent — predates pnl_log">◦</span>';
        if (markers) inner += '<div class="journal-cal-markers">' + markers + '</div>';
      }

      html += '<div class="' + cls + '" data-date="' + dateStr + '">' + inner + '</div>';
    }

    // Pad final row
    const totalCells = firstDow + lastDay;
    const remainder  = totalCells % 7;
    if (remainder > 0) {
      for (let i = remainder; i < 7; i++) {
        html += '<div class="journal-cal-cell journal-cal-empty"></div>';
      }
    }

    grid.innerHTML = html;

    grid.querySelectorAll('.journal-cal-cell[data-date]').forEach(cellEl => {
      cellEl.addEventListener('click', () => {
        grid.querySelectorAll('.journal-cal-cell').forEach(c => c.classList.remove('journal-cal-selected'));
        cellEl.classList.add('journal-cal-selected');
        journalSelDate = cellEl.dataset.date;
        loadJournalDay(cellEl.dataset.date);
      });
    });
  }

  async function loadJournalDay(dateStr) {
    const detail = document.getElementById('journalDetail');
    if (!detail) return;
    detail.innerHTML = '<div class="dash-placeholder" style="padding:1.5rem">Loading…</div>';
    try {
      const data = await apiFetch('/api/journal/day?date=' + encodeURIComponent(dateStr));
      _renderJournalDay(data);
    } catch (err) {
      detail.innerHTML = '<div class="dash-placeholder" style="padding:1.5rem">Could not load day detail</div>';
    }
  }

  function _renderJournalDay(data) {
    const detail = document.getElementById('journalDetail');
    if (!detail) return;

    const mk = data.market;
    const s  = data.pnl_summary || {};
    const trades = data.trades || [];

    // ── Left column: market state, index vs walls, tide, macro, catalysts ────

    let leftHtml = '';

    if (!mk) {
      leftHtml += '<div class="journal-section"><div class="journal-section-hd">Market Context</div><div class="journal-no-data">No market context recorded for this date</div></div>';
    } else {
      // Market state
      const vix  = mk.vix_close      != null ? mk.vix_close.toFixed(1)                      : (mk.market_state_ok ? '—' : 'not fetched');
      const adv  = mk.breadth_pct_adv != null ? mk.breadth_pct_adv.toFixed(1) + '%'          : (mk.market_state_ok ? '—' : 'not fetched');
      const dir  = mk.directive       || (mk.system_state_ok ? '—' : 'not fetched');
      const reg  = mk.regime_label    || (mk.system_state_ok ? '—' : 'not fetched');
      leftHtml +=
        '<div class="journal-section">' +
          '<div class="journal-section-hd">Market State</div>' +
          '<div class="journal-kv"><span class="journal-kv-lbl">Directive</span><span class="journal-kv-val">' + _jEsc(dir) + '</span></div>' +
          '<div class="journal-kv"><span class="journal-kv-lbl">Regime</span><span class="journal-kv-val">' + _jEsc(reg) + '</span></div>' +
          '<div class="journal-kv"><span class="journal-kv-lbl">VIX</span><span class="journal-kv-val">' + vix + '</span></div>' +
          '<div class="journal-kv"><span class="journal-kv-lbl">Advancing</span><span class="journal-kv-val">' + adv + '</span></div>' +
        '</div>';

      // Index vs walls — flag-aware nulls
      const idxs = [
        { sym: 'SPY', close: mk.spy_close, chg: mk.spy_chg_pct, pw: mk.spy_put_wall, cw: mk.spy_call_wall, band: mk.spy_closed_in_band },
        { sym: 'QQQ', close: mk.qqq_close, chg: mk.qqq_chg_pct, pw: mk.qqq_put_wall, cw: mk.qqq_call_wall, band: mk.qqq_closed_in_band },
        { sym: 'IWM', close: mk.iwm_close, chg: mk.iwm_chg_pct, pw: mk.iwm_put_wall, cw: mk.iwm_call_wall, band: mk.iwm_closed_in_band },
      ];
      let idxRows = '';
      idxs.forEach(ix => {
        const close = mk.index_prices_ok
          ? (ix.close != null ? ix.close.toFixed(2) : '—')
          : 'not fetched';
        const chgStr = mk.index_prices_ok && ix.chg != null
          ? (ix.chg >= 0 ? '+' : '') + ix.chg.toFixed(2) + '%' : '';
        const chgCls = ix.chg != null ? (ix.chg >= 0 ? 'positive' : 'negative') : '';
        const pw = mk.index_gex_ok ? (ix.pw != null ? ix.pw.toFixed(0) : '—') : 'not fetched';
        const cw = mk.index_gex_ok ? (ix.cw != null ? ix.cw.toFixed(0) : '—') : 'not fetched';
        const bandMark = ix.band === 1 ? ' <span class="journal-band-in" title="Closed inside band">✓</span>'
                       : ix.band === 0 ? ' <span class="journal-band-out" title="Closed outside band">✗</span>' : '';
        idxRows +=
          '<div class="journal-idx-row">' +
            '<span class="journal-idx-sym">' + ix.sym + '</span>' +
            '<span class="journal-idx-close">' + close + '</span>' +
            '<span class="journal-idx-chg ' + chgCls + '">' + chgStr + '</span>' +
            '<span class="journal-idx-walls">PW ' + pw + ' · CW ' + cw + bandMark + '</span>' +
          '</div>';
      });
      leftHtml +=
        '<div class="journal-section">' +
          '<div class="journal-section-hd">Index vs Walls</div>' +
          idxRows +
        '</div>';

      // Market tide
      if (mk.tide_ok) {
        const bias = mk.tide_bias || '—';
        leftHtml +=
          '<div class="journal-section">' +
            '<div class="journal-section-hd">Market Tide</div>' +
            '<div class="journal-kv"><span class="journal-kv-lbl">Bias</span><span class="journal-kv-val">' + _jEsc(bias) + '</span></div>' +
            '<div class="journal-kv"><span class="journal-kv-lbl">Net calls</span><span class="journal-kv-val">' + _jFmtTidePrem(mk.tide_call_premium) + '</span></div>' +
            '<div class="journal-kv"><span class="journal-kv-lbl">Net puts</span><span class="journal-kv-val">' + _jFmtTidePrem(mk.tide_put_premium) + '</span></div>' +
          '</div>';
      }
    }

    // Macro events
    if (data.macro_events && data.macro_events.length > 0) {
      let mrows = '';
      data.macro_events.forEach(e => {
        const time = e.scheduled_time ? '<span class="journal-macro-time">' + _jEsc(e.scheduled_time) + '</span> ' : '';
        const est  = e.estimate ? ' · est ' + _jEsc(e.estimate) : '';
        const pri  = e.prior    ? ' · prior ' + _jEsc(e.prior)  : '';
        mrows += '<div class="journal-macro-row">' + time + '<span class="journal-macro-name">' + _jEsc(e.event_name) + '</span><span class="journal-macro-vals">' + est + pri + '</span></div>';
      });
      leftHtml += '<div class="journal-section"><div class="journal-section-hd">Macro Events</div>' + mrows + '</div>';
    }

    // Catalysts — published headlines only, no linking to trades
    if (data.catalysts && data.catalysts.length > 0) {
      let crows = '';
      data.catalysts.forEach(c => {
        let pub = '';
        if (c.published_at) {
          try {
            const dt = new Date(c.published_at);
            pub = dt.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: 'America/New_York' }) + ' ET';
          } catch (_) {}
        }
        const src  = c.source ? '<span class="journal-cat-src">' + _jEsc(c.source) + '</span>' : '';
        const meta = (pub || src) ? '<div class="journal-cat-meta">' + (pub ? '<span class="journal-cat-time">' + pub + '</span>' : '') + src + '</div>' : '';
        crows += '<div class="journal-cat-row">' + meta + '<div class="journal-cat-title">' + _jEsc(c.title) + '</div></div>';
      });
      leftHtml += '<div class="journal-section journal-section-cats"><div class="journal-section-hd">Market Catalysts <span class="journal-section-note">' + data.catalysts.length + ' published</span></div>' + crows + '</div>';
    }

    // ── Right column: P&L summary cards + trade rows ──────────────────────

    // P&L cards — confirmed and estimated are strictly separate
    let pnlCards = '<div class="journal-pnl-cards">';

    if (s.confirmed_count > 0) {
      const v   = s.confirmed_pnl;
      const cls = v >= 0 ? 'positive' : 'negative';
      pnlCards +=
        '<div class="journal-pnl-card journal-pnl-conf">' +
          '<div class="journal-pnl-label">Confirmed</div>' +
          '<div class="journal-pnl-value ' + cls + '">' + (v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2) + '</div>' +
          '<div class="journal-pnl-sub">' + s.confirmed_count + ' trade' + (s.confirmed_count !== 1 ? 's' : '') + ' · broker-verified</div>' +
        '</div>';
    }

    const estTotal = (s.estimated_count || 0) + (s.unavailable_count || 0);
    if (estTotal > 0) {
      const v    = s.estimated_pnl;
      const cls  = v != null ? (v >= 0 ? 'positive' : 'negative') : '';
      const vStr = v != null ? ((v >= 0 ? '+' : '') + '$' + Math.abs(v).toFixed(2)) : 'no figure';
      const parts = [];
      if (s.estimated_count)   parts.push(s.estimated_count + ' estimated');
      if (s.unavailable_count) parts.push(s.unavailable_count + ' unavailable');
      pnlCards +=
        '<div class="journal-pnl-card journal-pnl-est">' +
          '<div class="journal-pnl-label">Estimated / unverified</div>' +
          '<div class="journal-pnl-value ' + cls + '">' + vStr + '</div>' +
          '<div class="journal-pnl-sub">' + parts.join(' · ') + ' · not broker-confirmed</div>' +
        '</div>';
    }

    if (s.tracking_absent_count > 0) {
      const n = s.tracking_absent_count;
      pnlCards +=
        '<div class="journal-pnl-card journal-pnl-absent">' +
          '<div class="journal-pnl-label">Tracking absent</div>' +
          '<div class="journal-pnl-value">—</div>' +
          '<div class="journal-pnl-sub">' + n + ' trade' + (n !== 1 ? 's' : '') + ' · predates pnl_log</div>' +
        '</div>';
    }
    pnlCards += '</div>';

    // Trade rows
    let tradeRows = '';
    if (!trades.length) {
      tradeRows = '<div class="dash-placeholder" style="padding:0.75rem 0">No trades this session</div>';
    } else {
      tradeRows =
        '<div class="journal-trade-hdr">' +
          '<span class="jt-col jt-ticker">Ticker</span>' +
          '<span class="jt-col jt-dir">Dir</span>' +
          '<span class="jt-col jt-strike">Strike</span>' +
          '<span class="jt-col jt-dte">DTE</span>' +
          '<span class="jt-col jt-tier">Tier</span>' +
          '<span class="jt-col jt-pnl">P&amp;L</span>' +
          '<span class="jt-col jt-fill">Fill</span>' +
          '<span class="jt-col jt-reason">Exit</span>' +
          '<span class="jt-col jt-hold">Hold</span>' +
          '<span class="jt-col jt-mfe">MFE%</span>' +
        '</div>';
      trades.forEach(t => {
        const pnlVal = t.realized_pnl != null ? t.realized_pnl : t.estimated_pnl;
        const pnlStr = pnlVal != null ? ((pnlVal >= 0 ? '+' : '') + '$' + Math.abs(pnlVal).toFixed(2)) : '—';
        const pnlCls = pnlVal != null ? (pnlVal >= 0 ? 'positive' : 'negative') : '';
        const dir    = (t.direction || '').toLowerCase().includes('put') ? 'put' : 'call';
        const mfe    = t.mfe_pct != null
          ? t.mfe_pct.toFixed(1) + '%'
          : (t.peak_untracked ? 'untracked' : '—');
        const bfTag  = t.backfilled ? ' <span class="jt-bf" title="Backfilled">bf</span>' : '';
        tradeRows +=
          '<div class="journal-trade-row">' +
            '<span class="jt-col jt-ticker">' + _jEsc(t.ticker || '?') + bfTag + '</span>' +
            '<span class="jt-col jt-dir"><span class="hist-dir ' + dir + '">' + (dir === 'put' ? 'P' : 'C') + '</span></span>' +
            '<span class="jt-col jt-strike">' + (t.strike || '—') + '</span>' +
            '<span class="jt-col jt-dte">' + (t.dte != null ? t.dte : '—') + '</span>' +
            '<span class="jt-col jt-tier">' + _jEsc(t.tier || '—') + '</span>' +
            '<span class="jt-col jt-pnl ' + pnlCls + '">' + pnlStr + '</span>' +
            '<span class="jt-col jt-fill">' + _jFillBadge(t) + '</span>' +
            '<span class="jt-col jt-reason">' + _jEsc(_jShortReason(t.exit_reason)) + '</span>' +
            '<span class="jt-col jt-hold">' + _jFmtHold(t.hold_seconds) + '</span>' +
            '<span class="jt-col jt-mfe">' + mfe + '</span>' +
          '</div>';
      });
    }

    detail.innerHTML =
      '<div class="journal-detail-inner">' +
        '<div class="journal-detail-left">' + leftHtml + '</div>' +
        '<div class="journal-detail-right">' +
          '<div class="journal-section">' + pnlCards + '</div>' +
          '<div class="journal-section journal-section-trades">' + tradeRows + '</div>' +
        '</div>' +
      '</div>';
  }

  // ── Boot ──────────────────────────────────────────────────────────────────

  init();
})();
