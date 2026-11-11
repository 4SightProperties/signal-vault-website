// js/grid.js — Projection grid panel (signal mode) + position drawer (position mode).
//
// READ-ONLY DISPLAY. This module:
//   • calls exactly one endpoint, POST /api/projection/grid (a read-only projection);
//   • makes NO order calls and never reads from or writes to any order-form input;
//   • does not touch the R:R line, matrix cache, OCO TP buttons, TP input or confirm modal.
// dashboard.js only mounts it (Grid toggle in the cockpit, Project button on position cards).
//
// Dev mock: append ?gridMock=1 to the URL. Fixtures (js/fixtures/grid_samples.js) are
// injected ONLY under that flag, and a small launcher appears so the views can be opened
// without signing in.

(() => {
  'use strict';

  // Mock only on a local dev host — on the public site ?gridMock=1 does nothing.
  // (location.hostname for IPv6 loopback is "[::1]"; accept both spellings.)
  const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);
  const MOCK       = LOCAL_HOSTS.has(location.hostname)
                  && new URLSearchParams(location.search).get('gridMock') === '1';
  const ASSET_VER  = '20261110a';
  const REFRESH_MS = 30000;
  const GATE       = 1.5;
  const PREF_KEY   = 'svGridPrefs';

  // ── UI prefs (localStorage: cell mode + vs-mark/vs-cost only) ──────────────

  function loadPrefs() {
    try {
      const p = JSON.parse(localStorage.getItem(PREF_KEY) || '{}');
      return { cell: p.cell === 'pct' ? 'pct' : 'usd', vs: p.vs === 'cost' ? 'cost' : 'mark' };
    } catch (e) {
      // Prefs are cosmetic: log and fall back to defaults (no data error to render).
      console.warn('[grid] could not read UI prefs from localStorage; using defaults', e);
      return { cell: 'usd', vs: 'mark' };
    }
  }

  function savePrefs(p) {
    try {
      localStorage.setItem(PREF_KEY, JSON.stringify({ cell: p.cell, vs: p.vs }));
    } catch (e) {
      console.warn('[grid] could not save UI prefs to localStorage', e);
    }
  }

  // ── Data layer ─────────────────────────────────────────────────────────────

  let _fixtures = null;
  function loadFixtures() {
    if (!MOCK) return Promise.reject(new Error('grid mock disabled'));
    if (!_fixtures) {
      _fixtures = new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.src = 'js/fixtures/grid_samples.js?v=' + ASSET_VER;
        s.onload  = () => resolve(window.SV_GRID_FIXTURES);
        s.onerror = () => reject(new Error('could not load js/fixtures/grid_samples.js'));
        document.head.appendChild(s);
      });
    }
    return _fixtures;
  }

  function mockResponse(fx, ctx) {
    if (ctx.position_id === 'mock-error') throw new Error('Mock error — exercising the Retry path');
    let key;
    if (ctx.mode === 'position') key = /nolegs/.test(ctx.position_id) ? 'position_nolegs' : 'position_legs';
    else key = ctx.contract && ctx.contract.right === 'put' ? 'signal_3dte_put' : 'signal_0dte_call';
    return JSON.parse(JSON.stringify(fx[key]));
  }

  // Same base URL + Bearer pattern as dashboard.js apiPost (CONFIG.backendUrl, DiscordAuth token).
  async function fetchGrid(context) {
    if (MOCK) return mockResponse(await loadFixtures(), context);
    const token = (window.DiscordAuth && window.DiscordAuth.getToken()) || '';
    const res = await fetch(CONFIG.backendUrl + '/api/projection/grid', {
      method:  'POST',
      headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body:    JSON.stringify({ context }),
    });
    let data;
    try {
      data = await res.json();
    } catch (e) {
      console.warn('[grid] /api/projection/grid returned non-JSON', res.status, e);
      data = {};
    }
    if (!res.ok) {
      const detail = typeof data.detail === 'string' ? data.detail : (res.status + ' /api/projection/grid');
      throw Object.assign(new Error(detail), { status: res.status });
    }
    if (!data || !Array.isArray(data.columns) || !Array.isArray(data.rows)) {
      throw new Error('Malformed grid response');
    }
    return data;
  }

  const _inflight = new Map();   // context key → Promise (one request in flight per context)
  const ctxKey = ctx => JSON.stringify(ctx);

  // ── Formatting ─────────────────────────────────────────────────────────────

  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g,
    c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = v => (typeof v === 'number' && isFinite(v));
  const fmtPx  = v => num(v) ? '$' + v.toFixed(2) : '—';
  const fmtOpt = v => num(v) ? v.toFixed(2) : '—';
  const fmtPct = (v, dp = 1) => num(v) ? (v > 0 ? '+' : '') + v.toFixed(dp) + '%' : '—';
  const fmtUsd = v => num(v) ? (v < 0 ? '−' : v > 0 ? '+' : '') + '$' + Math.abs(Math.round(v)).toLocaleString('en-US') : '—';
  const fmtRR  = v => num(v) ? v.toFixed(2) : '—';
  const fmtProb = v => num(v) ? Math.round(v * 100) + '%' : '—';
  const fmtTime = iso => {
    try {
      return new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short',
        hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
    } catch (e) {
      console.warn('[grid] bad timestamp in response', iso, e);
      return String(iso);
    }
  };

  const ROLE_CHIP = {
    sr:       { cls: 'sr',    text: 'S/R' },
    cloud:    { cls: 'cloud', text: '5/12 cloud' },
    atr:      { cls: 'atr',   text: 'ATR' },
    spot:     { cls: 'spot',  text: 'Spot' },
    tp_leg:   { cls: 'tpleg', text: 'TP leg' },
    stop_leg: { cls: 'stopleg', text: 'Stop leg' },
    override: { cls: 'ovr',   text: 'Override' },
  };

  const WARN_TEXT = [
    ['atr_anchor',         w => 'ATR ladder anchor: ' + w.replace(/^atr_anchor:\s*/, '')],
    ['stop_fallback',      () => 'No structural stop on the other side — the stop shown is a 30% loss on the premium, converted to an underlying price per column.'],
    ['vendor_iv_fallback', () => "Couldn't solve volatility from the live mid, so Tradier's IV is used (converted to trading time)."],
    ['low_confidence',     () => 'Columns marked ◔ fall in the last trading hour of a 0DTE — treat those values as rough.'],
    ['stale_levels',       w => 'Levels may be stale: ' + w.replace(/^stale_levels:\s*/, '')],
    ['no_cloud',           () => 'Not enough 10-minute bars yet for the 5/12 cloud.'],
    ['no_atr',             () => 'Daily ATR unavailable — the ATR ladder is omitted.'],
    ['no_target',          () => 'No structural level beyond spot in the trade direction, so there is no target (R:R unavailable).'],
    ['mark_from_chain',    () => 'Live position mark was stale; the chain mid was used instead.'],
  ];
  const warnText = w => {
    const hit = WARN_TEXT.find(([k]) => String(w).startsWith(k));
    return hit ? hit[1](String(w)) : String(w);
  };

  function whyText(s) {
    if (!s || (num(s.rr) && s.rr >= GATE)) return '';
    if (!num(s.reward) || s.reward <= 0) return 'Theta: target no longer covers the premium by this time.';
    if (!num(s.risk) || s.risk <= 0) return 'Stop is above current value.';
    return 'Reward/risk below 1.5 gate.';
  }

  function heatBg(pct) {
    if (!num(pct)) return 'transparent';
    const a = (0.06 + Math.min(Math.abs(pct) / 100, 1) * 0.30).toFixed(3);
    return pct >= 0 ? `rgba(74,222,128,${a})` : `rgba(239,68,68,${a})`;
  }

  // ── Grid view (shared by panel and drawer) ─────────────────────────────────

  class GridView {
    constructor(host, context, opts = {}) {
      this.host     = host;
      this.context  = context;
      this.opts     = opts;           // { onClose }
      this.data     = null;
      this.error    = null;
      this.selected = 0;
      this.prefs    = loadPrefs();
      this.timer    = null;
      this.running  = false;
      this._onVis   = () => this._visibility();
      this._onClick = e => this._click(e);
      host.addEventListener('click', this._onClick);
    }

    start() {
      this.running = true;
      document.addEventListener('visibilitychange', this._onVis);
      this.load();
      this._arm();
    }

    stop() {
      this.running = false;
      if (this.timer) { clearInterval(this.timer); this.timer = null; }
      document.removeEventListener('visibilitychange', this._onVis);
      this.host.removeEventListener('click', this._onClick);
    }

    _arm() {
      if (this.timer) clearInterval(this.timer);
      this.timer = document.hidden ? null : setInterval(() => this._tick(), REFRESH_MS);
    }

    _visibility() {
      if (!this.running) return;
      if (document.hidden) {
        if (this.timer) { clearInterval(this.timer); this.timer = null; }
      } else {
        this.load();
        this._arm();
      }
    }

    _tick() {
      if (!this.host.isConnected) { this.stop(); return; }   // panel DOM replaced (re-arm, chain reload)
      if (!document.hidden) this.load();
    }

    async load() {
      const key = ctxKey(this.context);
      if (_inflight.has(key)) return _inflight.get(key);
      if (!this.data) this.render();      // first load → loading state
      const p = (async () => {
        try {
          const data = await fetchGrid(this.context);
          this.data  = data;
          this.error = null;
          if (this.selected >= data.columns.length) this.selected = 0;
        } catch (e) {
          console.warn('[grid] projection grid fetch failed', this.context, e);
          this.error = e;
        } finally {
          _inflight.delete(key);
        }
        if (this.running) this.render();
      })();
      _inflight.set(key, p);
      return p;
    }

    setContext(ctx) {
      this.context = ctx;
      this.data = null;
      this.error = null;
      this.load();
    }

    _click(e) {
      const btn = e.target.closest('[data-grid-action]');
      if (!btn || !this.host.contains(btn)) return;
      const act = btn.dataset.gridAction;
      if (act === 'retry') { this.error = null; this.load(); return; }
      if (act === 'col') { this.selected = parseInt(btn.dataset.col, 10) || 0; this.render(); return; }
      if (act === 'cell') { this.prefs.cell = btn.dataset.value; savePrefs(this.prefs); this.render(); return; }
      if (act === 'vs')   { this.prefs.vs = btn.dataset.value; savePrefs(this.prefs); this.render(); return; }
      if (act === 'basis') { this.setContext({ ...this.context, basis: btn.dataset.value }); return; }
      if (act === 'close' && this.opts.onClose) this.opts.onClose();
    }

    // ── render ──
    render() {
      const restoreScroll = this.host.querySelector('.svg-grid-scroll');
      const sx = restoreScroll ? restoreScroll.scrollLeft : 0;
      if (this.error && !this.data) {
        this.host.innerHTML = this._errorHtml();
      } else if (!this.data) {
        this.host.innerHTML = '<div class="svg-grid-state" role="status">Loading projection grid…</div>';
      } else {
        this.host.innerHTML = (this.error ? this._errorHtml(true) : '') + this._html(this.data);
      }
      const sc = this.host.querySelector('.svg-grid-scroll');
      if (sc) sc.scrollLeft = sx;
    }

    _errorHtml(stale) {
      const msg = this.error ? esc(this.error.message || String(this.error)) : 'Unknown error';
      return `<div class="svg-grid-error" role="alert">
        <span>${stale ? 'Refresh failed — showing the last good grid. ' : 'Projection grid unavailable. '}${msg}</span>
        <button type="button" class="svg-btn" data-grid-action="retry">Retry</button>
      </div>`;
    }

    _cellPct(cell, pos) {
      if (!pos) return cell.pct;
      return (this.prefs.vs === 'cost' ? cell.vs_cost : cell.vs_mark)?.pct;
    }
    _cellPnl(cell, pos) {
      if (!pos) return cell.pnl;
      return (this.prefs.vs === 'cost' ? cell.vs_cost : cell.vs_mark)?.pnl;
    }

    _html(d) {
      const pos = d.mode === 'position';
      const right = (d.contract.right || '').toUpperCase().slice(0, 1);
      const sel = Math.min(this.selected, d.columns.length - 1);
      const s = d.summary[sel] || {};
      const why = whyText(s);

      // ── header ──
      const ivTxt = num(d.iv_display) ? (d.iv_display * 100).toFixed(1) + '%' : '—';
      const srcTxt = d.sigma_source === 'back_solved_mid' ? 'σ from live mid'
                   : d.sigma_source === 'vendor_iv' ? 'σ from Tradier IV' : esc(d.sigma_source || '—');
      const ivChange = (pos && num(d.entry_iv) && num(d.iv_display))
        ? `<span class="svg-chip" title="Implied volatility change since entry">IV Δ ${fmtPct((d.iv_display - d.entry_iv) * 100, 1).replace('%', ' pts')}</span>` : '';
      const header = `
        <div class="svg-grid-head">
          <div class="svg-grid-title">${esc(d.contract.ticker)} ${esc(d.contract.strike)}${right}
            <span class="svg-muted">exp ${esc(d.contract.expiry)} · qty ${esc(d.qty)}</span></div>
          <div class="svg-grid-meta">
            <span class="svg-chip svg-chip-basis" title="P/L basis">${esc(d.basis.type)} ${fmtPx(d.basis.price)}</span>
            ${pos ? `<span class="svg-chip svg-chip-entry" title="Your fill price">◆ entry ${fmtPx(d.cost)}</span>` : ''}
            <span class="svg-chip" title="Implied volatility, calendar-annualized (matches broker IV)">IV ${ivTxt}</span>
            <span class="svg-chip svg-chip-soft">${srcTxt}</span>
            ${ivChange}
            <span class="svg-chip svg-chip-soft">spot ${fmtPx(d.spot)}</span>
            <span class="svg-chip svg-chip-soft" title="ATR ladder anchored on this session's close">ATR anchor ${esc(d.atr_anchor_date || '—')}</span>
          </div>
          <div class="svg-grid-ctrls">
            ${pos ? '' : `<div class="svg-seg" role="group" aria-label="Basis">
              ${['ask', 'mid'].map(b => `<button type="button" class="svg-seg-btn${this.context.basis === b || (!this.context.basis && b === 'ask') ? ' on' : ''}" data-grid-action="basis" data-value="${b}" aria-pressed="${this.context.basis === b || (!this.context.basis && b === 'ask')}">${b}</button>`).join('')}
            </div>`}
            ${pos ? `<div class="svg-seg" role="group" aria-label="P/L reference">
              ${[['mark', 'vs mark'], ['cost', 'vs cost']].map(([v, l]) => `<button type="button" class="svg-seg-btn${this.prefs.vs === v ? ' on' : ''}" data-grid-action="vs" data-value="${v}" aria-pressed="${this.prefs.vs === v}">${l}</button>`).join('')}
            </div>` : ''}
            <div class="svg-seg" role="group" aria-label="Cell display">
              ${[['usd', '$ P/L'], ['pct', '% P/L']].map(([v, l]) => `<button type="button" class="svg-seg-btn${this.prefs.cell === v ? ' on' : ''}" data-grid-action="cell" data-value="${v}" aria-pressed="${this.prefs.cell === v}">${l}</button>`).join('')}
            </div>
            <span class="svg-muted svg-asof">as of ${esc(fmtTime(d.now))}</span>
          </div>
        </div>`;

      // ── warnings + legs reason ──
      const warns = (d.warnings || []).map(w => `<li>${esc(warnText(w))}</li>`);
      if (pos && d.legs && !d.legs.tp_leg && !d.legs.stop_leg && d.legs.reason) {
        warns.push(`<li>Live OCO legs not shown: ${esc(d.legs.reason)}</li>`);
      }
      const warnHtml = warns.length ? `<ul class="svg-grid-warn" aria-label="Notices">${warns.join('')}</ul>` : '';

      // ── table ──
      const cols = d.columns;
      const thead = `<thead><tr><th class="svg-sticky" scope="col">Level</th>${cols.map((c, j) => `
        <th scope="col" class="${j === sel ? 'sel' : ''}${c.low_confidence ? ' lowc' : ''}">
          <button type="button" class="svg-col-btn" data-grid-action="col" data-col="${j}" aria-pressed="${j === sel}"
            ${c.low_confidence ? 'title="Last trading hour of a 0DTE — low confidence"' : `title="${esc(fmtTime(c.ts))}"`}>
            ${esc(c.label)}${c.low_confidence ? ' <span aria-label="low confidence">◔</span>' : ''}</button></th>`).join('')}</tr></thead>`;

      const rowHtml = d.rows.map(r => {
        const chip = ROLE_CHIP[r.role] || { cls: 'sr', text: r.role };
        const marks = (r.is_target ? '<span class="svg-role svg-role-target">◎ Target</span>' : '')
                    + (r.is_stop ? '<span class="svg-role svg-role-stop">✕ Stop</span>' : '');
        const isLeg = r.role === 'tp_leg' || r.role === 'stop_leg';
        const first = `<th scope="row" class="svg-sticky">
          <div class="svg-lvl">
            <span class="svg-tag svg-tag-${chip.cls}" title="${esc(r.name)}">${esc(r.tag)}</span>
            <span class="svg-role svg-role-${chip.cls}">${chip.text}</span>${marks}
          </div>
          <div class="svg-lvl-px">${isLeg ? 'option ' + fmtPx(r.leg_price) : fmtPx(r.price) + ' <span class="svg-muted">' + fmtPct(r.pct_from_spot, 2) + '</span>'}</div>
        </th>`;
        const cells = r.cells.map((c, j) => {
          if (isLeg) {
            return `<td class="svg-cell svg-cell-leg${j === sel ? ' sel' : ''}" title="Underlying price where the leg fills at this time">
              <div class="svg-cell-main">${fmtPx(c.underlying)}</div><div class="svg-cell-sub">${c.underlying != null ? fmtPct(c.pct_from_spot, 2) : esc(c.status || '')}</div></td>`;
          }
          const pct = this._cellPct(c, pos);
          const pnl = this._cellPnl(c, pos);
          const main = this.prefs.cell === 'pct' ? fmtPct(pct, 0) : fmtUsd(pnl);
          const beyond = c.beyond_1sigma;
          const style = beyond ? '' : ` style="background:${heatBg(pct)}"`;
          return `<td class="svg-cell${beyond ? ' beyond' : ''}${j === sel ? ' sel' : ''}"${style}
              ${beyond ? 'title="Beyond a 1σ move by this time"' : ''}>
            <div class="svg-cell-main">${main}</div><div class="svg-cell-sub">opt ${fmtOpt(c.value)}</div></td>`;
        }).join('');
        const rowCls = r.is_target ? 'is-target' : r.is_stop ? 'is-stop' : r.role === 'spot' ? 'is-spot' : '';
        return `<tr class="${rowCls}">${first}${cells}</tr>`;
      }).join('');

      const beOf = sm => (pos && this.prefs.vs === 'cost' && sm.vs_cost) ? sm.vs_cost : sm;
      const tfoot = `<tfoot>
        <tr class="svg-sum"><th scope="row" class="svg-sticky">Breakeven${pos ? (this.prefs.vs === 'cost' ? ' (cost)' : ' (mark)') : ''}</th>
          ${d.summary.map((sm, j) => { const b = beOf(sm); return `<td class="${j === sel ? 'sel' : ''}"><div class="svg-cell-main">${fmtPx(b.breakeven)}</div><div class="svg-cell-sub">${fmtPct(b.breakeven_pct, 2)}</div></td>`; }).join('')}</tr>
        <tr class="svg-sum"><th scope="row" class="svg-sticky">R:R${pos ? ' (vs mark)' : ''}</th>
          ${d.summary.map((sm, j) => { const low = !num(sm.rr) || sm.rr < GATE; return `<td class="svg-rr${low ? ' low' : ''}${j === sel ? ' sel' : ''}" ${low ? `title="${esc(whyText(sm))}"` : ''}><div class="svg-cell-main">${fmtRR(sm.rr)}${low ? ' <span class="svg-amber-mark" aria-label="below gate">!</span>' : ''}</div></td>`; }).join('')}</tr>
      </tfoot>`;

      const table = `<div class="svg-grid-scroll" tabindex="0" aria-label="Projection grid; scrolls horizontally">
        <table class="svg-grid-table">${thead}<tbody>${rowHtml}</tbody>${tfoot}</table></div>`;

      // ── inspector ──
      const col = cols[sel];
      const b = beOf(s);
      const insp = `<div class="svg-insp" aria-live="polite">
        <div class="svg-insp-title">${esc(col.label)} <span class="svg-muted">${esc(fmtTime(col.ts))}${col.low_confidence ? ' · ◔ low confidence' : ''}</span></div>
        <dl class="svg-insp-grid">
          <div><dt>R:R${pos ? ' (mark)' : ''}</dt><dd class="${!num(s.rr) || s.rr < GATE ? 'svg-amber' : ''}">${fmtRR(s.rr)}${s.clears_gate ? ' ✓' : ''}</dd></div>
          <div><dt>Reward</dt><dd>${fmtUsd(s.reward_dollars)}</dd></div>
          <div><dt>Risk</dt><dd>${fmtUsd(num(s.risk_dollars) ? -s.risk_dollars : null)}</dd></div>
          <div><dt>Breakeven${pos ? (this.prefs.vs === 'cost' ? ' (cost)' : ' (mark)') : ''}</dt><dd>${fmtPx(b.breakeven)} <span class="svg-muted">${fmtPct(b.breakeven_pct, 2)}</span></dd></div>
          <div><dt>1σ move</dt><dd>±${fmtPx(s.expected_move_1sigma)}</dd></div>
          <div><dt>Touch target</dt><dd>${fmtProb(s.touch_prob_target)}</dd></div>
          <div><dt>Touch stop</dt><dd>${fmtProb(s.touch_prob_stop)}</dd></div>
          ${pos && s.vs_cost ? `<div><dt>P/L at stop (cost)</dt><dd>${fmtUsd(s.vs_cost.pnl_at_stop)}</dd></div>` : ''}
        </dl>
        ${why ? `<p class="svg-why">${esc(why)}</p>` : ''}
      </div>`;

      // ── R:R decay chart ──
      const rrs = d.summary.map(sm => sm.rr);
      const cap = Math.max(3, ...rrs.filter(num));
      const bars = d.summary.map((sm, j) => {
        const ok = num(sm.rr);
        const h = ok ? Math.max(4, Math.min(sm.rr, cap) / cap * 100) : 4;
        const low = !ok || sm.rr < GATE;
        return `<button type="button" class="svg-bar${low ? ' low' : ''}${j === sel ? ' sel' : ''}" data-grid-action="col" data-col="${j}"
            aria-label="${esc(cols[j].label)} R:R ${ok ? sm.rr.toFixed(2) : 'not available'}" aria-pressed="${j === sel}">
          <span class="svg-bar-fill" style="height:${h.toFixed(1)}%"></span>
          <span class="svg-bar-lbl">${esc(cols[j].label)}</span></button>`;
      }).join('');
      const st = d.stale_at;
      const sentence = !st ? 'Holds above the 1.5 gate through expiry.'
        : st.index === 0 ? 'Already below the 1.5 gate now.'
        : `Falls below the 1.5 gate at ${esc(st.label)}.`;
      const chart = `<div class="svg-decay">
        <div class="svg-decay-title">R:R by time <span class="svg-muted">(gate 1.5)</span></div>
        <div class="svg-decay-plot">
          <div class="svg-gate" style="bottom:${(GATE / cap * 100).toFixed(1)}%"><span>1.5</span></div>
          ${bars}
        </div>
        <p class="svg-decay-note">${sentence}</p>
      </div>`;

      const tgt = d.target ? `${esc(d.target.tag)} ${fmtPx(d.target.price)}` : 'none';
      const stp = d.stop.price != null ? `${esc(d.stop.tag)} ${fmtPx(d.stop.price)}` : esc(d.stop.name);
      const legend = `<div class="svg-legend">
        <span class="svg-role svg-role-target">◎ Target</span> ${tgt}
        <span class="svg-role svg-role-stop">✕ Stop</span> ${stp} <span class="svg-muted">(${esc(d.stop.source || '')})</span>
        <span class="svg-legend-beyond">muted cell = beyond 1σ by that time</span>
      </div>`;

      return header + warnHtml + legend + table + `<div class="svg-grid-lower">${insp}${chart}</div>`;
    }
  }

  // ── Panel (signal mode, cockpit) ──────────────────────────────────────────

  let _panel = null;   // { view, toggle, host }

  function closePanel() {
    if (!_panel) return;
    _panel.view.stop();
    if (_panel.host.isConnected) { _panel.host.hidden = true; _panel.host.innerHTML = ''; }
    if (_panel.toggle.isConnected) _panel.toggle.setAttribute('aria-expanded', 'false');
    _panel = null;
  }

  function mountPanel(toggle, host, getContext) {
    if (!toggle || !host) return;
    toggle.addEventListener('click', () => {
      if (_panel && _panel.host === host) { closePanel(); return; }
      closePanel();
      let ctx;
      try {
        ctx = { basis: 'ask', ...getContext() };
      } catch (e) {
        console.warn('[grid] could not build signal context from the armed contract', e);
        host.hidden = false;
        host.innerHTML = `<div class="svg-grid-error" role="alert"><span>No armed contract to project.</span>
          <button type="button" class="svg-btn" data-grid-action="retry">Retry</button></div>`;
        host.querySelector('[data-grid-action="retry"]').addEventListener('click', () => { host.hidden = true; toggle.click(); });
        return;
      }
      host.hidden = false;
      toggle.setAttribute('aria-expanded', 'true');
      const view = new GridView(host, ctx);
      _panel = { view, toggle, host };
      view.start();
    });
  }

  // ── Drawer (position mode) ────────────────────────────────────────────────

  let _drawer = null;  // { el, view, lastFocus }

  function _placeDrawer(el) {
    const vw = window.innerWidth;
    const main = document.querySelector('.cmd-main');
    const rail = document.getElementById('rightCol');
    const top = main ? Math.max(0, main.getBoundingClientRect().top) : 0;
    el.style.top = top + 'px';
    if (vw < 700) {
      // Full width without 100vw (which includes the scrollbar and would overflow).
      el.style.left  = '0px';
      el.style.right = '0px';
      el.style.width = 'auto';
      return;
    }
    el.style.left = 'auto';
    let right = 0;
    if (rail) {
      const rb = rail.getBoundingClientRect();
      // Rail sits in its own column on the right (desktop) → keep it visible.
      if (rb.width > 0 && rb.left > vw * 0.4 && rb.right >= vw - 2) right = Math.round(vw - rb.left);
    }
    el.style.right = right + 'px';
    el.style.width = Math.min(720, vw - right - 16) + 'px';
  }

  function _onDrawerResize() { if (_drawer) _placeDrawer(_drawer.el); }
  function _onDrawerKey(e) { if (e.key === 'Escape' && _drawer) closeDrawer(); }

  function openDrawer(ctx, label) {
    closeDrawer();
    const el = document.createElement('aside');
    el.className = 'svg-drawer';
    el.setAttribute('role', 'dialog');
    el.setAttribute('aria-modal', 'false');
    el.setAttribute('aria-label', 'Position projection grid');
    el.innerHTML = `<div class="svg-drawer-head">
        <span class="svg-drawer-title">Projection · ${esc(label || ctx.position_id)}</span>
        <button type="button" class="svg-icon-btn" aria-label="Close projection drawer">✕</button>
      </div>
      <div class="svg-drawer-body"></div>`;
    document.body.appendChild(el);
    _placeDrawer(el);
    const body = el.querySelector('.svg-drawer-body');
    const view = new GridView(body, ctx, { onClose: closeDrawer });
    const lastFocus = document.activeElement;
    _drawer = { el, view, lastFocus };
    el.querySelector('.svg-icon-btn').addEventListener('click', closeDrawer);
    window.addEventListener('resize', _onDrawerResize);
    document.addEventListener('keydown', _onDrawerKey);
    el.querySelector('.svg-icon-btn').focus();
    view.start();
  }

  function closeDrawer() {
    if (!_drawer) return;
    const { el, view, lastFocus } = _drawer;
    view.stop();                       // closing stops the drawer's refresh
    window.removeEventListener('resize', _onDrawerResize);
    document.removeEventListener('keydown', _onDrawerKey);
    el.remove();
    _drawer = null;
    if (lastFocus && lastFocus.isConnected && lastFocus.focus) lastFocus.focus();
  }

  // ── Dev mock launcher (only with ?gridMock=1) ─────────────────────────────

  function mountMockLauncher() {
    const box = document.createElement('section');
    box.className = 'svg-mock';
    box.setAttribute('aria-label', 'Grid mock launcher');
    box.innerHTML = `<div class="svg-mock-head"><strong>Grid mock</strong>
        <span class="svg-muted">fixtures · no network</span>
        <button type="button" class="svg-icon-btn" data-mock="hide" aria-label="Hide grid mock launcher">✕</button></div>
      <div class="svg-mock-btns">
        <button type="button" class="svg-btn" data-mock="call">Panel · 0DTE call</button>
        <button type="button" class="svg-btn" data-mock="put">Panel · 3DTE put</button>
        <button type="button" class="svg-btn" data-mock="pos">Drawer · position + legs</button>
        <button type="button" class="svg-btn" data-mock="nolegs">Drawer · no legs / fallbacks</button>
        <button type="button" class="svg-btn" data-mock="err">Drawer · error → Retry</button>
      </div>
      <div class="svg-mock-toggle-row"><button type="button" class="svg-grid-toggle" id="svgMockToggle" aria-expanded="false" aria-controls="svgMockPanel">Grid</button>
        <span class="svg-muted">← cockpit toggle (uses the contract picked above)</span></div>
      <div id="svgMockPanel" class="svg-grid-panel" hidden></div>`;
    document.body.appendChild(box);
    let pick = { ticker: 'SPY', strike: 501, expiry: '2026-11-20', right: 'call' };
    const toggle = box.querySelector('#svgMockToggle');
    const host = box.querySelector('#svgMockPanel');
    mountPanel(toggle, host, () => ({ mode: 'signal', contract: { ...pick }, qty: 2 }));
    box.addEventListener('click', e => {
      const b = e.target.closest('[data-mock]');
      if (!b) return;
      const m = b.dataset.mock;
      if (m === 'hide') { closePanel(); box.remove(); return; }
      if (m === 'call' || m === 'put') {
        pick = m === 'call' ? { ticker: 'SPY', strike: 501, expiry: '2026-11-20', right: 'call' }
                            : { ticker: 'SPY', strike: 498, expiry: '2026-11-20', right: 'put' };
        closePanel();
        toggle.click();
      }
      if (m === 'pos')    openDrawer({ mode: 'position', position_id: 'mock-pos-legs' }, 'SPY 502C (mock)');
      if (m === 'nolegs') openDrawer({ mode: 'position', position_id: 'mock-pos-nolegs' }, 'SPY 503P (mock)');
      if (m === 'err')    openDrawer({ mode: 'position', position_id: 'mock-error' }, 'error case (mock)');
    });
  }

  window.SVGrid = { mountPanel, closePanel, openDrawer, closeDrawer, fetchGrid, MOCK };

  if (MOCK) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountMockLauncher);
    else mountMockLauncher();
  }
})();
