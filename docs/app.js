/* School Accounts — single-page app (no build step).
 * Data lives in Supabase; security is enforced by the database (schema.sql),
 * this file only decides what to show.
 */
(() => {
  'use strict';

  const cfg = Object.assign({
    SCHOOL_NAME: 'School Accounts', CURRENCY: 'INR', LOCALE: 'en-IN', REQUIRE_BILL_FOR_PAYMENTS: true
  }, window.APP_CONFIG || {});

  // Read auth info from the URL before the Supabase client consumes it
  const initialHash = new URLSearchParams(location.hash.replace(/^#\/?/, ''));
  const authType = initialHash.get('type');                 // invite | recovery | signup | magiclink
  const authError = initialHash.get('error_description');

  // ---------------------------------------------------------------- helpers
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => Array.from(el.querySelectorAll(s));
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const moneyFmt = new Intl.NumberFormat(cfg.LOCALE, { style: 'currency', currency: cfg.CURRENCY, maximumFractionDigits: 2 });
  const compactFmt = new Intl.NumberFormat(cfg.LOCALE, { notation: 'compact', maximumFractionDigits: 1 });
  const fmt = (n) => moneyFmt.format(Number(n) || 0);
  const fmtCompact = (n) => compactFmt.format(Number(n) || 0);
  const sum = (rows) => rows.reduce((s, r) => s + Number(r.amount || 0), 0);
  const fmtDate = (d) => d ? new Date(d.length === 10 ? d + 'T00:00:00' : d)
    .toLocaleDateString(cfg.LOCALE, { day: '2-digit', month: 'short', year: 'numeric' }) : '';
  const fmtDateTime = (d) => d ? new Date(d).toLocaleString(cfg.LOCALE,
    { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '';
  const todayStr = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  // Financial year April–March (matches fy_of() in the database)
  const fyOf = (dateStr) => {
    const [y, m] = dateStr.split('-').map(Number);
    const s = m >= 4 ? y : y - 1;
    return `${s}-${String((s + 1) % 100).padStart(2, '0')}`;
  };
  const fyRange = (fy) => { const s = parseInt(fy.slice(0, 4), 10); return [`${s}-04-01`, `${s + 1}-03-31`]; };
  const fyList = () => {
    const cur = parseInt(fyOf(todayStr()).slice(0, 4), 10);
    return Array.from({ length: 6 }, (_, i) => { const s = cur - i; return `${s}-${String((s + 1) % 100).padStart(2, '0')}`; });
  };
  const MONTHS = ['Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec', 'Jan', 'Feb', 'Mar'];
  const fyMonth = (dateStr) => (Number(dateStr.slice(5, 7)) + 8) % 12;

  const KIND = { income: 'Receipt (in)', expense: 'Payment (out)', transfer: 'Transfer' };
  const MODES = { cash: 'Cash', upi: 'UPI', bank_transfer: 'Bank transfer', cheque: 'Cheque', card: 'Card', other: 'Other' };
  const STATUS = { pending: '◷ Pending', approved: '✓ Approved', rejected: '✕ Rejected', void: '⊘ Void' };
  const ROLES = { admin: 'Admin', accountant: 'Accountant', viewer: 'Viewer' };
  const pill = (s) => `<span class="pill ${s}">${STATUS[s] || esc(s)}</span>`;

  function toast(msg, kind = 'info') {
    const el = document.createElement('div');
    el.className = 'toast' + (kind === 'error' ? ' error' : '');
    el.textContent = msg;
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), kind === 'error' ? 7000 : 3500);
  }

  async function q(promise) {
    const { data, error } = await promise;
    if (error) throw new Error(error.message || String(error));
    return data;
  }

  // PostgREST returns at most 1000 rows per request — page through
  async function fetchAll(build) {
    const out = [];
    const size = 1000;
    for (let from = 0; ; from += size) {
      const data = await q(build().range(from, from + size - 1));
      out.push(...data);
      if (data.length < size) break;
    }
    return out;
  }

  function csvDownload(filename, rows, cols) {
    const cell = (v) => {
      const s = v == null ? '' : String(v);
      return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
    };
    const lines = [cols.map((c) => cell(c.label)).join(',')]
      .concat(rows.map((r) => cols.map((c) => cell(c.get(r))).join(',')));
    const blob = new Blob(['﻿' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  function inWordsINR(num) {
    const a = ['', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
      'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen', 'Nineteen'];
    const b = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];
    const two = (n) => n < 20 ? a[n] : b[Math.floor(n / 10)] + (n % 10 ? ' ' + a[n % 10] : '');
    const three = (n) => n >= 100 ? a[Math.floor(n / 100)] + ' Hundred' + (n % 100 ? ' ' + two(n % 100) : '') : two(n);
    const conv = (n) => {
      if (n === 0) return 'Zero';
      const out = [];
      const cr = Math.floor(n / 1e7); n %= 1e7;
      const l = Math.floor(n / 1e5); n %= 1e5;
      const th = Math.floor(n / 1000); n %= 1000;
      if (cr) out.push(conv(cr) + ' Crore');
      if (l) out.push(two(l) + ' Lakh');
      if (th) out.push(two(th) + ' Thousand');
      if (n) out.push(three(n));
      return out.join(' ');
    };
    const rupees = Math.floor(num);
    const paise = Math.round((num - rupees) * 100);
    return 'Rupees ' + conv(rupees) + (paise ? ' and ' + two(paise) + ' Paise' : '') + ' Only';
  }

  // ---------------------------------------------------------------- setup check
  if (!window.supabase || !cfg.SUPABASE_URL || cfg.SUPABASE_URL.includes('PASTE') || !cfg.SUPABASE_ANON_KEY || cfg.SUPABASE_ANON_KEY.includes('PASTE')) {
    $('#app').innerHTML = `
      <div class="center-screen"><div class="card setup">
        <h1>Almost there</h1>
        <p>This app is not connected to its database yet.</p>
        <p>Open <code>docs/config.js</code> and paste your Supabase <b>Project URL</b> and <b>anon / publishable key</b>
        (Supabase → Project Settings → API). Then reload this page.</p>
        <p class="muted small">See README.md, step 3.</p>
      </div></div>`;
    return;
  }

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'implicit' }
  });

  // ---------------------------------------------------------------- state
  const S = {
    session: null, me: null,
    cats: [], funds: [], accounts: [], people: {}, peopleList: [],
    catMap: {}, fundMap: {}, acctMap: {},
    fy: fyOf(todayStr()),
    f: { kind: '', status: '', cat: '', fund: '', account: '', text: '', month: '' },
    routed: false
  };
  const can = {
    enter: () => ['admin', 'accountant'].includes(S.me?.role),
    admin: () => S.me?.role === 'admin',
    audit: () => ['admin', 'viewer'].includes(S.me?.role)
  };
  const catName = (id) => S.catMap[id]?.name || '—';
  const fundName = (id) => S.fundMap[id]?.name || '—';
  const acctName = (id) => S.acctMap[id]?.name || '—';
  const personName = (id) => { const p = S.people[id]; return p ? (p.full_name || p.email) : '—'; };

  async function loadLookups() {
    const [cats, funds, accounts, people] = await Promise.all([
      q(sb.from('categories').select('*').order('kind').order('name')),
      q(sb.from('funds').select('*').order('name')),
      q(sb.from('accounts').select('*').order('name')),
      q(sb.from('profiles').select('id,email,full_name,role,active,created_at').order('email'))
    ]);
    Object.assign(S, { cats, funds, accounts, peopleList: people });
    S.catMap = Object.fromEntries(cats.map((c) => [c.id, c]));
    S.fundMap = Object.fromEntries(funds.map((c) => [c.id, c]));
    S.acctMap = Object.fromEntries(accounts.map((c) => [c.id, c]));
    S.people = Object.fromEntries(people.map((p) => [p.id, p]));
  }

  async function loadTxns(fy, statuses) {
    const [a, b] = fyRange(fy);
    return fetchAll(() => {
      let x = sb.from('transactions').select('*').gte('txn_date', a).lte('txn_date', b)
        .order('txn_date', { ascending: false }).order('id', { ascending: false });
      if (statuses) x = x.in('status', statuses);
      return x;
    });
  }

  const opt = (list, sel, label = (x) => x.name) => list.map((x) =>
    `<option value="${esc(x.id)}" ${String(x.id) === String(sel) ? 'selected' : ''}>${esc(label(x))}</option>`).join('');
  const fySelect = () => `<select id="fy-select" aria-label="Financial year">${fyList().map((f) =>
    `<option value="${f}" ${f === S.fy ? 'selected' : ''}>FY ${f}</option>`).join('')}</select>`;
  const bindFy = (v, rerender) => { const s = $('#fy-select', v); if (s) s.onchange = () => { S.fy = s.value; rerender(v); }; };

  // ---------------------------------------------------------------- auth screens
  function renderLogin(message) {
    $('#app').innerHTML = `
      <div class="center-screen"><div class="card auth-card">
        <h1>${esc(cfg.SCHOOL_NAME)}</h1>
        <p class="muted">Accounts — staff sign in</p>
        ${message ? `<div class="note-box">${esc(message)}</div>` : ''}
        <form id="login">
          <div class="field"><label for="em">Email</label><input id="em" type="email" autocomplete="username" required></div>
          <div class="field"><label for="pw">Password</label><input id="pw" type="password" autocomplete="current-password" required></div>
          <button class="btn primary block" type="submit">Sign in</button>
        </form>
        <p class="small" style="margin-top:12px"><button class="linklike" id="forgot" type="button">Forgot password?</button></p>
        <p class="small muted">New staff: ask the admin to send you an invite.</p>
      </div></div>`;
    $('#login').onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter; btn.disabled = true;
      const { data, error } = await sb.auth.signInWithPassword({ email: $('#em').value.trim(), password: $('#pw').value });
      btn.disabled = false;
      if (error) return toast(error.message, 'error');
      S.session = data.session;
      history.replaceState(null, '', location.pathname + '#/dashboard');
      enterApp();
    };
    $('#forgot').onclick = async () => {
      const email = $('#em').value.trim();
      if (!email) return toast('Type your email first, then click "Forgot password?"', 'error');
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname });
      if (error) return toast(error.message, 'error');
      toast('If that email has an account, a reset link has been sent.');
    };
  }

  let settingPassword = false;
  function renderSetPassword(title) {
    if (settingPassword) return;
    settingPassword = true;
    $('#app').innerHTML = `
      <div class="center-screen"><div class="card auth-card">
        <h1>${esc(title)}</h1>
        <p class="muted">Use at least 8 characters. Don't reuse a password from another site.</p>
        <form id="setpw">
          <div class="field"><label for="p1">New password</label><input id="p1" type="password" minlength="8" autocomplete="new-password" required></div>
          <div class="field"><label for="p2">Type it again</label><input id="p2" type="password" minlength="8" autocomplete="new-password" required></div>
          <button class="btn primary block" type="submit">Save password</button>
        </form>
      </div></div>`;
    $('#setpw').onsubmit = async (e) => {
      e.preventDefault();
      if ($('#p1').value !== $('#p2').value) return toast('The two passwords do not match', 'error');
      const btn = e.submitter; btn.disabled = true;
      const { error } = await sb.auth.updateUser({ password: $('#p1').value });
      btn.disabled = false;
      if (error) return toast(error.message, 'error');
      settingPassword = false;
      toast('Password saved');
      history.replaceState(null, '', location.pathname + '#/dashboard');
      enterApp();
    };
  }

  function renderInactive() {
    $('#app').innerHTML = `
      <div class="center-screen"><div class="card auth-card">
        <h1>Waiting for approval</h1>
        <p>You're signed in as <b>${esc(S.session.user.email)}</b>, but an admin hasn't activated your account yet.</p>
        <p class="muted">Ask the admin to open <b>Settings → Staff</b>, set your role and tick <b>Active</b>.</p>
        <div class="actions"><button class="btn" id="reload">Check again</button><button class="btn" id="so">Sign out</button></div>
      </div></div>`;
    $('#reload').onclick = () => enterApp();
    $('#so').onclick = signOut;
  }

  async function signOut() {
    await sb.auth.signOut();
    S.session = null; S.me = null;
    history.replaceState(null, '', location.pathname);
    renderLogin();
  }

  // ---------------------------------------------------------------- shell & routing
  const NAV = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'entries', label: 'Entries' },
    { id: 'approvals', label: 'Approvals' },
    { id: 'reports', label: 'Reports' },
    { id: 'reconcile', label: 'Bank check' },
    { id: 'audit', label: 'Audit log', show: () => can.audit() },
    { id: 'settings', label: 'Settings', show: () => can.admin() }
  ];
  const allowed = (id) => { const n = NAV.find((x) => x.id === id); return n && (!n.show || n.show()); };

  function renderShell() {
    const me = S.me;
    $('#app').innerHTML = `
      <header class="topbar">
        <div class="topbar-inner">
          <div class="brand">${esc(cfg.SCHOOL_NAME)}<span>Accounts</span></div>
          <div class="me"><span>${esc(me.full_name || me.email)} <span class="role">· ${esc(ROLES[me.role])}</span></span>
            <button class="btn small" id="signout">Sign out</button></div>
        </div>
        <nav class="tabs" aria-label="Main">${NAV.filter((n) => !n.show || n.show()).map((n) =>
          `<a href="#/${n.id}" data-nav="${n.id}">${n.label}${n.id === 'approvals' ? '<span class="badge" id="pending-badge" hidden></span>' : ''}</a>`).join('')}</nav>
      </header>
      <main id="view"></main>`;
    $('#signout').onclick = signOut;
  }

  const VIEWS = {};
  async function route() {
    if (!S.me) return;
    let name = location.hash.replace(/^#\/?/, '').split(/[?&=]/)[0] || 'dashboard';
    if (!VIEWS[name] || !allowed(name)) name = 'dashboard';
    $$('nav.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.nav === name));
    const v = $('#view');
    v.innerHTML = '<div class="loading">Loading…</div>';
    try { await VIEWS[name](v); } catch (e) { v.innerHTML = `<div class="error-box">Something went wrong: ${esc(e.message)}</div>`; }
    refreshBadge();
  }

  async function refreshBadge() {
    const { count } = await sb.from('transactions').select('id', { count: 'exact', head: true }).eq('status', 'pending');
    const b = $('#pending-badge');
    if (b) { b.hidden = !count; b.textContent = count || ''; }
  }

  async function enterApp() {
    try {
      const { data: { session } } = await sb.auth.getSession();
      if (!session) return renderLogin();
      S.session = session;
      S.me = await q(sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle());
      if (!S.me || !S.me.active) return renderInactive();
      await loadLookups();
      renderShell();
      if (!S.routed) { window.addEventListener('hashchange', route); S.routed = true; }
      if (/access_token|=/.test(location.hash)) history.replaceState(null, '', location.pathname + '#/dashboard');
      route();
    } catch (e) {
      $('#app').innerHTML = `<div class="center-screen"><div class="card auth-card"><h1>Can't load</h1>
        <p class="error-box">${esc(e.message)}</p><button class="btn" onclick="location.reload()">Try again</button></div></div>`;
    }
  }

  // ---------------------------------------------------------------- modal & tooltip
  function modal(html) {
    const d = $('#modal');
    d.innerHTML = `<div class="modal-body">${html}</div>`;
    if (!d.open) d.showModal();
    return d;
  }
  const closeModal = () => { const d = $('#modal'); if (d.open) d.close(); };
  $('#modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-close]') || e.target === e.currentTarget) closeModal();
  });
  const modalHead = (title) => `<div class="modal-head"><h2>${esc(title)}</h2>
    <button type="button" class="icon-btn" data-close aria-label="Close">×</button></div>`;

  const tip = $('#tip');
  function showTip(e, html) {
    tip.innerHTML = html; tip.hidden = false;
    const r = tip.getBoundingClientRect();
    let x = e.clientX + 14, y = e.clientY + 14;
    if (x + r.width > innerWidth - 8) x = e.clientX - r.width - 14;
    if (y + r.height > innerHeight - 8) y = e.clientY - r.height - 14;
    tip.style.left = Math.max(8, x) + 'px'; tip.style.top = Math.max(8, y) + 'px';
  }
  const hideTip = () => { tip.hidden = true; };

  // ---------------------------------------------------------------- charts
  function niceMax(v) {
    if (v <= 0) return 1;
    const p = Math.pow(10, Math.floor(Math.log10(v)));
    const n = v / p;
    return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? 2.5 : n <= 5 ? 5 : 10) * p;
  }
  function barPath(x, base, w, h) {
    if (h <= 0.5) return '';
    const r = Math.min(4, w / 2, h);
    const t = base - h;
    return `M${x},${base}V${t + r}Q${x},${t} ${x + r},${t}H${x + w - r}Q${x + w},${t} ${x + w},${t + r}V${base}Z`;
  }

  function drawMonthly(el, inc, exp) {
    const W = 680, H = 260, m = { t: 10, r: 8, b: 26, l: 52 };
    const iw = W - m.l - m.r, ih = H - m.t - m.b;
    const max = niceMax(Math.max(...inc, ...exp));
    const y = (v) => m.t + ih - (v / max) * ih;
    const step = iw / 12;
    const bw = Math.max(4, Math.min(18, (step - 12) / 2));
    let g = '';
    for (let i = 0; i <= 4; i++) {
      const v = (max / 4) * i, yy = y(v);
      if (i > 0) g += `<line class="gridline" x1="${m.l}" x2="${W - m.r}" y1="${yy}" y2="${yy}"/>`;
      g += `<text x="${m.l - 8}" y="${yy + 4}" text-anchor="end">${esc(fmtCompact(v))}</text>`;
    }
    const base = m.t + ih;
    for (let i = 0; i < 12; i++) {
      const cx = m.l + step * i + step / 2;
      g += `<path fill="var(--s1)" d="${barPath(cx - bw - 1, base, bw, base - y(inc[i]))}"/>`;
      g += `<path fill="var(--s2)" d="${barPath(cx + 1, base, bw, base - y(exp[i]))}"/>`;
      g += `<text x="${cx}" y="${H - 8}" text-anchor="middle">${MONTHS[i]}</text>`;
    }
    g += `<line class="baseline" x1="${m.l}" x2="${W - m.r}" y1="${base}" y2="${base}"/>`;
    for (let i = 0; i < 12; i++) {
      g += `<rect class="hit" data-i="${i}" x="${m.l + step * i}" y="${m.t}" width="${step}" height="${ih}"/>`;
    }
    el.innerHTML = `
      <div class="legend"><span><i style="background:var(--s1)"></i>Income</span><span><i style="background:var(--s2)"></i>Expenses</span></div>
      <svg viewBox="0 0 ${W} ${H}" role="img" aria-label="Monthly income and expenses">${g}</svg>
      <details class="table-view"><summary>View as table</summary><div class="table-wrap"><table>
        <thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead>
        <tbody>${MONTHS.map((mo, i) => `<tr><td>${mo}</td><td class="num">${fmt(inc[i])}</td><td class="num">${fmt(exp[i])}</td><td class="num">${fmt(inc[i] - exp[i])}</td></tr>`).join('')}</tbody>
      </table></div></details>`;
    $$('.hit', el).forEach((r) => {
      const i = Number(r.dataset.i);
      const html = `<div><b>${MONTHS[i]}</b></div>
        <div class="row"><span><i class="sw" style="display:inline-block;width:8px;height:8px;background:var(--s1);margin-right:6px"></i>Income</span><b>${fmt(inc[i])}</b></div>
        <div class="row"><span><i class="sw" style="display:inline-block;width:8px;height:8px;background:var(--s2);margin-right:6px"></i>Expenses</span><b>${fmt(exp[i])}</b></div>
        <div class="row"><span>Net</span><b>${fmt(inc[i] - exp[i])}</b></div>`;
      r.addEventListener('pointermove', (e) => showTip(e, html));
      r.addEventListener('pointerleave', hideTip);
    });
  }

  function drawCatBars(el, rows, total) {
    if (!rows.length) { el.innerHTML = '<div class="empty">No approved expenses yet in this year.</div>'; return; }
    const max = rows[0].amount;
    el.innerHTML = `<div class="hbars">${rows.map((r, i) => `
      <div class="hbar" data-i="${i}">
        <div class="name" title="${esc(r.name)}">${esc(r.name)}</div>
        <div class="track"><div class="fill" style="width:${(r.amount / max) * 100}%"></div></div>
        <div class="val">${fmt(r.amount)}</div>
      </div>`).join('')}</div>`;
    $$('.hbar', el).forEach((row) => {
      const r = rows[Number(row.dataset.i)];
      const html = `<div><b>${esc(r.name)}</b></div><div class="row"><span>Spent</span><b>${fmt(r.amount)}</b></div>
        <div class="row"><span>Share of expenses</span><b>${total ? ((r.amount / total) * 100).toFixed(1) : 0}%</b></div>`;
      row.addEventListener('pointermove', (e) => showTip(e, html));
      row.addEventListener('pointerleave', hideTip);
    });
  }

  // ---------------------------------------------------------------- Dashboard
  VIEWS.dashboard = async function viewDashboard(v) {
    const [txns, balances, pend] = await Promise.all([
      loadTxns(S.fy),
      q(sb.from('account_balances').select('*').order('name')),
      q(sb.from('transactions').select('id,amount').eq('status', 'pending'))
    ]);
    const ok = txns.filter((t) => t.status === 'approved');
    const incRows = ok.filter((t) => t.kind === 'income');
    const expRows = ok.filter((t) => t.kind === 'expense');
    const inc = sum(incRows), exp = sum(expRows), net = inc - exp;
    const mInc = Array(12).fill(0), mExp = Array(12).fill(0);
    incRows.forEach((t) => { mInc[fyMonth(t.txn_date)] += Number(t.amount); });
    expRows.forEach((t) => { mExp[fyMonth(t.txn_date)] += Number(t.amount); });
    const byCat = {};
    expRows.forEach((t) => { byCat[t.category_id] = (byCat[t.category_id] || 0) + Number(t.amount); });
    const catRows = Object.entries(byCat).map(([id, amount]) => ({ name: catName(id), amount })).sort((a, b) => b.amount - a.amount);
    const recent = txns.slice(0, 8);

    v.innerHTML = `
      <div class="page-head"><h1>Dashboard</h1>${fySelect()}</div>
      <div class="grid tiles">
        <div class="card tile"><div class="label">Income (approved)</div><div class="value">${fmt(inc)}</div><div class="sub">${incRows.length} receipts</div></div>
        <div class="card tile"><div class="label">Expenses (approved)</div><div class="value">${fmt(exp)}</div><div class="sub">${expRows.length} payments</div></div>
        <div class="card tile"><div class="label">${net >= 0 ? 'Surplus' : 'Deficit'}</div><div class="value">${fmt(Math.abs(net))}</div>
          <div class="sub">${inc ? `${((net / inc) * 100).toFixed(1)}% of income saved` : 'No income yet'}</div></div>
        <div class="card tile"><div class="label">Waiting for approval</div><div class="value">${pend.length}</div><div class="sub">${fmt(sum(pend))} in total · all years</div></div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card"><div class="card-head"><h2>Income vs expenses by month</h2><span class="muted small">FY ${S.fy}</span></div><div class="chart" id="ch-month"></div></div>
        <div class="card"><div class="card-head"><h2>Where the money went</h2><span class="muted small">Expenses by category</span></div><div id="ch-cat"></div></div>
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card"><div class="card-head"><h2>Account balances today</h2><a class="small" href="#/reconcile">Check against bank →</a></div>
          <div class="table-wrap"><table><tbody>${balances.filter((b) => b.active).map((b) =>
            `<tr><td>${esc(b.name)} <span class="muted small">${esc(b.type)}</span></td><td class="num">${fmt(b.balance)}</td></tr>`).join('') || '<tr><td class="empty">No accounts</td></tr>'}</tbody>
          <tfoot><tr><td>Total</td><td class="num">${fmt(balances.filter((b) => b.active).reduce((s, b) => s + Number(b.balance), 0))}</td></tr></tfoot></table></div></div>
        <div class="card"><div class="card-head"><h2>Latest entries</h2><a class="small" href="#/entries">See all →</a></div>
          ${txnTable(recent, { compact: true })}</div>
      </div>`;
    bindFy(v, VIEWS.dashboard);
    drawMonthly($('#ch-month', v), mInc, mExp);
    drawCatBars($('#ch-cat', v), catRows, exp);
    bindTxnRows(v);
  };

  function txnTable(rows, { compact = false, totals = false } = {}) {
    if (!rows.length) return '<div class="empty">No entries.</div>';
    const body = rows.map((t) => `
      <tr class="clickable" data-txn="${t.id}">
        <td class="nowrap">${esc(t.number)}</td>
        <td class="nowrap">${fmtDate(t.txn_date)}</td>
        ${compact ? '' : `<td><span class="kind">${KIND[t.kind]}</span></td>`}
        <td>${t.kind === 'transfer' ? `${esc(acctName(t.account_id))} → ${esc(acctName(t.to_account_id))}` : esc(catName(t.category_id))}
          ${compact ? '' : `<div class="muted small">${esc(t.party || t.description || '')}</div>`}</td>
        ${compact ? '' : `<td>${esc(acctName(t.account_id))}</td>`}
        <td class="num">${t.kind === 'income' ? '+' : t.kind === 'expense' ? '−' : ''}${fmt(t.amount)}</td>
        <td>${pill(t.status)}</td>
      </tr>`).join('');
    let foot = '';
    if (totals) {
      const ok = rows.filter((t) => t.status === 'approved');
      foot = `<tfoot><tr><td colspan="${compact ? 3 : 5}">Approved in this list: money in ${fmt(sum(ok.filter((t) => t.kind === 'income')))} · money out ${fmt(sum(ok.filter((t) => t.kind === 'expense')))}</td><td></td><td></td></tr></tfoot>`;
    }
    return `<div class="table-wrap"><table>
      <thead><tr><th>No.</th><th>Date</th>${compact ? '' : '<th>Type</th>'}<th>Category</th>${compact ? '' : '<th>Account</th>'}<th class="num">Amount</th><th>Status</th></tr></thead>
      <tbody>${body}</tbody>${foot}</table></div>`;
  }
  const bindTxnRows = (v) => $$('[data-txn]', v).forEach((tr) => { tr.onclick = () => openDetail(Number(tr.dataset.txn)); });

  // ---------------------------------------------------------------- Entries
  VIEWS.entries = async function viewEntries(v) {
    const txns = await loadTxns(S.fy);
    const f = S.f;
    const draw = () => {
      const text = f.text.toLowerCase();
      const rows = txns.filter((t) =>
        (!f.kind || t.kind === f.kind) && (!f.status || t.status === f.status) &&
        (!f.cat || String(t.category_id) === f.cat) && (!f.fund || String(t.fund_id) === f.fund) &&
        (!f.account || String(t.account_id) === f.account || String(t.to_account_id) === f.account) &&
        (f.month === '' || fyMonth(t.txn_date) === Number(f.month)) &&
        (!text || [t.number, t.party, t.description, t.reference, catName(t.category_id)].join(' ').toLowerCase().includes(text)));
      $('#list', v).innerHTML = `<p class="muted small">${rows.length} of ${txns.length} entries in FY ${S.fy}</p>` + txnTable(rows, { totals: true });
      bindTxnRows(v);
      v._rows = rows;
    };
    v.innerHTML = `
      <div class="page-head"><h1>Entries</h1>
        ${can.enter() ? `<div class="actions">
          <button class="btn primary" data-new="income">+ Money in</button>
          <button class="btn primary" data-new="expense">− Money out</button>
          <button class="btn" data-new="transfer">⇄ Transfer</button></div>` : ''}
      </div>
      <div class="filters">
        ${fySelect()}
        <select id="f-month" aria-label="Month"><option value="">All months</option>${MONTHS.map((mo, i) => `<option value="${i}" ${f.month === String(i) ? 'selected' : ''}>${mo}</option>`).join('')}</select>
        <select id="f-kind" aria-label="Type"><option value="">All types</option>${Object.entries(KIND).map(([k, l]) => `<option value="${k}" ${f.kind === k ? 'selected' : ''}>${l}</option>`).join('')}</select>
        <select id="f-status" aria-label="Status"><option value="">All statuses</option>${Object.keys(STATUS).map((k) => `<option value="${k}" ${f.status === k ? 'selected' : ''}>${k[0].toUpperCase() + k.slice(1)}</option>`).join('')}</select>
        <select id="f-cat" aria-label="Category"><option value="">All categories</option>${opt(S.cats, f.cat, (c) => `${c.name} (${c.kind === 'income' ? 'in' : 'out'})`)}</select>
        <select id="f-fund" aria-label="Fund"><option value="">All funds</option>${opt(S.funds, f.fund)}</select>
        <select id="f-account" aria-label="Account"><option value="">All accounts</option>${opt(S.accounts, f.account)}</select>
        <input id="f-text" type="search" placeholder="Search no., name, note…" value="${esc(f.text)}">
        <button class="btn" id="export">Download CSV</button>
      </div>
      <div class="card" id="list"></div>`;
    bindFy(v, VIEWS.entries);
    [['f-month', 'month'], ['f-kind', 'kind'], ['f-status', 'status'], ['f-cat', 'cat'], ['f-fund', 'fund'], ['f-account', 'account']]
      .forEach(([id, key]) => { $('#' + id, v).onchange = (e) => { f[key] = e.target.value; draw(); }; });
    $('#f-text', v).oninput = (e) => { f.text = e.target.value; draw(); };
    $$('[data-new]', v).forEach((b) => { b.onclick = () => openEntryForm(b.dataset.new); });
    $('#export', v).onclick = () => exportTxns(v._rows || [], `entries-FY${S.fy}.csv`);
    draw();
  };

  function exportTxns(rows, filename) {
    csvDownload(filename, rows, [
      { label: 'Number', get: (t) => t.number }, { label: 'Date', get: (t) => t.txn_date },
      { label: 'Type', get: (t) => KIND[t.kind] }, { label: 'Category', get: (t) => t.kind === 'transfer' ? '' : catName(t.category_id) },
      { label: 'Fund', get: (t) => t.fund_id ? fundName(t.fund_id) : '' },
      { label: 'Account', get: (t) => acctName(t.account_id) }, { label: 'To account', get: (t) => t.to_account_id ? acctName(t.to_account_id) : '' },
      { label: 'Amount', get: (t) => t.amount }, { label: 'Received from / Paid to', get: (t) => t.party },
      { label: 'Mode', get: (t) => MODES[t.mode] }, { label: 'Reference', get: (t) => t.reference },
      { label: 'Description', get: (t) => t.description }, { label: 'Status', get: (t) => t.status },
      { label: 'Status note', get: (t) => t.status_note }, { label: 'Bill attached', get: (t) => t.bill_path ? 'Yes' : 'No' },
      { label: 'Entered by', get: (t) => personName(t.created_by) }, { label: 'Entered at', get: (t) => t.created_at },
      { label: 'Reviewed by', get: (t) => t.reviewed_by ? personName(t.reviewed_by) : '' }, { label: 'Reviewed at', get: (t) => t.reviewed_at }
    ]);
  }

  // ---------------------------------------------------------------- New entry form
  function openEntryForm(kind) {
    const title = { income: 'Money in — new receipt', expense: 'Money out — new payment voucher', transfer: 'Transfer between accounts' }[kind];
    const cats = S.cats.filter((c) => c.kind === kind && c.active);
    const accts = S.accounts.filter((a) => a.active);
    const funds = S.funds.filter((x) => x.active);
    const billRequired = kind === 'expense' && cfg.REQUIRE_BILL_FOR_PAYMENTS;
    const d = modal(`${modalHead(title)}
      <form id="ef">
        <div class="field-row">
          <div class="field"><label for="e-date">Date</label><input id="e-date" type="date" value="${todayStr()}" max="${todayStr()}" required></div>
          <div class="field"><label for="e-amount">Amount (${esc(cfg.CURRENCY)})</label><input id="e-amount" type="number" inputmode="decimal" min="0.01" step="0.01" required></div>
        </div>
        <div class="field-row">
          <div class="field"><label for="e-acct">${kind === 'income' ? 'Received into' : kind === 'expense' ? 'Paid from' : 'From account'}</label>
            <select id="e-acct" required>${opt(accts)}</select></div>
          ${kind === 'transfer'
            ? `<div class="field"><label for="e-to">To account</label><select id="e-to" required>${opt(accts, accts[1]?.id)}</select></div>`
            : `<div class="field"><label for="e-cat">Category</label><select id="e-cat" required><option value="">Choose…</option>${opt(cats)}</select></div>`}
        </div>
        ${kind === 'transfer' ? '' : `
        <div class="field-row">
          <div class="field"><label for="e-fund">Fund</label><select id="e-fund">${opt(funds, funds[0]?.id)}</select></div>
          <div class="field"><label for="e-party">${kind === 'income' ? 'Received from (student / parent / donor)' : 'Paid to (vendor / staff name)'}</label>
            <input id="e-party" required maxlength="200"></div>
        </div>`}
        <div class="field-row">
          <div class="field"><label for="e-mode">Mode</label><select id="e-mode">${Object.entries(MODES).map(([k, l]) => `<option value="${k}">${l}</option>`).join('')}</select></div>
          <div class="field"><label for="e-ref">Cheque no. / UPI ref / Txn ID</label><input id="e-ref" maxlength="100"></div>
        </div>
        <div class="field"><label for="e-desc">Description</label><textarea id="e-desc" maxlength="1000" placeholder="${kind === 'income' ? 'e.g. Term 2 tuition fee, Class 5, Roll 12' : kind === 'expense' ? 'e.g. October electricity bill' : 'e.g. Cash withdrawn for petty cash'}"></textarea></div>
        <div class="field"><label for="e-bill">${kind === 'expense' ? 'Bill / invoice (photo or PDF)' + (billRequired ? ' — required' : '') : 'Attachment (optional)'}</label>
          <input id="e-bill" type="file" accept="image/*,application/pdf" ${billRequired ? 'required' : ''}></div>
        <p class="muted small">After saving, the entry gets a number and waits for an admin to approve it. Entries can't be deleted — if something is wrong, the admin rejects or voids it.</p>
        <div class="actions"><button class="btn primary" type="submit">Save entry</button><button class="btn" type="button" data-close>Cancel</button></div>
      </form>`);
    $('#ef', d).onsubmit = async (e) => {
      e.preventDefault();
      const btn = e.submitter;
      const amount = Number($('#e-amount', d).value);
      const date = $('#e-date', d).value;
      if (!(amount > 0)) return toast('Enter an amount greater than zero', 'error');
      if (date > todayStr()) return toast('Date cannot be in the future', 'error');
      const row = {
        kind, txn_date: date, amount,
        account_id: Number($('#e-acct', d).value),
        mode: $('#e-mode', d).value,
        reference: $('#e-ref', d).value.trim() || null,
        description: $('#e-desc', d).value.trim() || null
      };
      if (kind === 'transfer') {
        row.to_account_id = Number($('#e-to', d).value);
        if (row.to_account_id === row.account_id) return toast('From and To accounts must be different', 'error');
      } else {
        row.category_id = Number($('#e-cat', d).value);
        row.fund_id = Number($('#e-fund', d).value) || null;
        row.party = $('#e-party', d).value.trim();
      }
      const file = $('#e-bill', d).files[0];
      if (file && file.size > 10 * 1024 * 1024) return toast('File is larger than 10 MB', 'error');
      btn.disabled = true; btn.textContent = 'Saving…';
      try {
        if (file) {
          const ext = (file.name.split('.').pop() || 'bin').toLowerCase().replace(/[^a-z0-9]/g, '') || 'bin';
          const path = `${fyOf(date)}/${crypto.randomUUID()}.${ext}`;
          await q(sb.storage.from('bills').upload(path, file, { contentType: file.type || undefined, upsert: false }));
          row.bill_path = path;
        }
        const saved = await q(sb.from('transactions').insert(row).select().single());
        closeModal();
        toast(`Saved as ${saved.number} — waiting for approval`);
        if (fyOf(date) !== S.fy) S.fy = fyOf(date);
        route();
      } catch (err) {
        toast(err.message, 'error');
        btn.disabled = false; btn.textContent = 'Save entry';
      }
    };
  }

  // ---------------------------------------------------------------- Entry detail
  async function openDetail(id) {
    const t = await q(sb.from('transactions').select('*').eq('id', id).single());
    const isAdmin = can.admin();
    const mine = t.created_by === S.me.id;
    const rows = [
      ['Number', esc(t.number)], ['Status', pill(t.status)], ['Type', KIND[t.kind]], ['Date', fmtDate(t.txn_date)],
      ['Amount', `<b>${fmt(t.amount)}</b>`],
      t.kind === 'transfer' ? ['From → To', `${esc(acctName(t.account_id))} → ${esc(acctName(t.to_account_id))}`]
        : [t.kind === 'income' ? 'Received into' : 'Paid from', esc(acctName(t.account_id))],
      t.kind !== 'transfer' && ['Category', esc(catName(t.category_id))],
      t.kind !== 'transfer' && ['Fund', esc(t.fund_id ? fundName(t.fund_id) : '—')],
      t.kind !== 'transfer' && [t.kind === 'income' ? 'Received from' : 'Paid to', esc(t.party || '—')],
      ['Mode', MODES[t.mode]], ['Reference', esc(t.reference || '—')], ['Description', esc(t.description || '—')],
      ['Entered by', `${esc(personName(t.created_by))} <span class="muted small">${fmtDateTime(t.created_at)}</span>`],
      t.reviewed_by && [t.status === 'rejected' ? 'Rejected by' : 'Approved by', `${esc(personName(t.reviewed_by))} <span class="muted small">${fmtDateTime(t.reviewed_at)}</span>`],
      t.voided_by && ['Voided by', `${esc(personName(t.voided_by))} <span class="muted small">${fmtDateTime(t.voided_at)}</span>`]
    ].filter(Boolean);
    const d = modal(`${modalHead(t.number)}
      ${t.status_note ? `<div class="note-box"><b>${t.status === 'void' ? 'Reason for voiding' : 'Reason'}:</b> ${esc(t.status_note)}</div>` : ''}
      <dl class="details">${rows.map(([k, val]) => `<dt>${k}</dt><dd>${val}</dd>`).join('')}</dl>
      <div class="actions">
        ${t.bill_path ? '<button class="btn" id="d-bill">View attachment</button>' : (t.kind === 'expense' ? '<span class="flag-near">⚠ No bill attached</span>' : '')}
        <button class="btn" id="d-print">Print ${t.kind === 'income' ? 'receipt' : 'voucher'}</button>
        ${isAdmin && t.status === 'pending' && !mine ? '<button class="btn primary" id="d-approve">✓ Approve</button><button class="btn danger" id="d-reject">✕ Reject</button>' : ''}
        ${isAdmin && t.status === 'approved' ? '<button class="btn danger" id="d-void">⊘ Void</button>' : ''}
      </div>
      ${isAdmin && t.status === 'pending' && mine ? '<p class="muted small" style="margin-top:10px">You entered this yourself, so another admin has to approve it (two-person rule).</p>' : ''}
      <div id="d-reason"></div>`);

    if (t.bill_path) $('#d-bill', d).onclick = async () => {
      try {
        const { signedUrl } = await q(sb.storage.from('bills').createSignedUrl(t.bill_path, 120));
        window.open(signedUrl, '_blank', 'noopener');
      } catch (e) { toast(e.message, 'error'); }
    };
    $('#d-print', d).onclick = () => printDoc(t);
    const act = async (status, note) => {
      try {
        await q(sb.rpc('set_txn_status', { p_id: t.id, p_status: status, p_note: note || null }));
        closeModal(); toast(`${t.number}: ${status}`); route();
      } catch (e) { toast(e.message, 'error'); }
    };
    const askReason = (status, label) => {
      $('#d-reason', d).innerHTML = `<div class="field" style="margin-top:12px"><label for="d-note">${label}</label><textarea id="d-note" required></textarea></div>
        <button class="btn danger" id="d-confirm">Confirm ${status === 'void' ? 'void' : 'reject'}</button>`;
      $('#d-note', d).focus();
      $('#d-confirm', d).onclick = () => {
        const note = $('#d-note', d).value.trim();
        if (!note) return toast('Please write a reason', 'error');
        act(status, note);
      };
    };
    if ($('#d-approve', d)) $('#d-approve', d).onclick = () => act('approved');
    if ($('#d-reject', d)) $('#d-reject', d).onclick = () => askReason('rejected', 'Why are you rejecting this entry?');
    if ($('#d-void', d)) $('#d-void', d).onclick = () => askReason('void', 'Why should this approved entry be voided? (It stays in the records, marked void.)');
  }

  function printDoc(t) {
    const label = { income: 'RECEIPT', expense: 'PAYMENT VOUCHER', transfer: 'TRANSFER VOUCHER' }[t.kind];
    const w = window.open('', '_blank');
    if (!w) return toast('Please allow pop-ups to print', 'error');
    const line = (k, val) => `<tr><th>${k}</th><td>${val}</td></tr>`;
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(t.number)}</title>
      <style>body{font-family:system-ui,Segoe UI,sans-serif;margin:32px;color:#111}h1{margin:0;font-size:22px}
      .top{display:flex;justify-content:space-between;align-items:flex-end;border-bottom:2px solid #111;padding-bottom:8px;margin-bottom:16px}
      table{width:100%;border-collapse:collapse}th{text-align:left;width:34%;color:#444;font-weight:600}th,td{padding:7px 4px;border-bottom:1px solid #ddd}
      .sig{display:flex;justify-content:space-between;margin-top:64px;gap:24px}.sig div{flex:1;border-top:1px solid #111;padding-top:6px;text-align:center;font-size:13px}
      .st{font-size:12px;color:#555;margin-top:16px}</style></head><body>
      <div class="top"><div><h1>${esc(cfg.SCHOOL_NAME)}</h1><div>${label}</div></div><div><b>${esc(t.number)}</b><br>${fmtDate(t.txn_date)}</div></div>
      <table>
        ${t.kind === 'income' ? line('Received from', esc(t.party)) : t.kind === 'expense' ? line('Paid to', esc(t.party)) : ''}
        ${line('Amount', `<b>${fmt(t.amount)}</b>`)}
        ${cfg.CURRENCY === 'INR' ? line('In words', inWordsINR(Number(t.amount))) : ''}
        ${t.kind === 'transfer' ? line('From → To', `${esc(acctName(t.account_id))} → ${esc(acctName(t.to_account_id))}`) : line('Category', esc(catName(t.category_id)))}
        ${t.kind !== 'transfer' ? line('Fund', esc(t.fund_id ? fundName(t.fund_id) : '—')) : ''}
        ${line('Mode', MODES[t.mode] + (t.reference ? ' — ' + esc(t.reference) : ''))}
        ${line('Description', esc(t.description || '—'))}
      </table>
      <p class="st">Status: ${esc(t.status)}${t.reviewed_by && t.status === 'approved' ? ' by ' + esc(personName(t.reviewed_by)) + ' on ' + fmtDateTime(t.reviewed_at) : ''} · Entered by ${esc(personName(t.created_by))}</p>
      <div class="sig"><div>Prepared by</div><div>Approved by</div><div>${t.kind === 'income' ? 'Cashier' : 'Receiver’s signature'}</div></div>
      <script>window.onload=function(){window.print()}<\/script></body></html>`);
    w.document.close();
  }

  // ---------------------------------------------------------------- Approvals
  VIEWS.approvals = async function viewApprovals(v) {
    const [pending, rejected] = await Promise.all([
      fetchAll(() => sb.from('transactions').select('*').eq('status', 'pending').order('txn_date').order('id')),
      q(sb.from('transactions').select('*').eq('status', 'rejected').order('reviewed_at', { ascending: false }).limit(20))
    ]);
    const intro = can.admin()
      ? 'Open each entry, check the bill and details, then approve or reject. You can\'t approve entries you entered yourself.'
      : 'These entries are waiting for an admin to check them.';
    v.innerHTML = `
      <div class="page-head"><h1>Approvals</h1></div>
      <div class="card"><div class="card-head"><h2>Waiting for approval</h2><span class="muted small">${pending.length} entries · ${fmt(sum(pending))}</span></div>
        <p class="muted small">${intro}</p>${txnTable(pending)}</div>
      <div class="card"><div class="card-head"><h2>Recently rejected</h2></div>
        <p class="muted small">Rejected entries stay in the records. Re-enter them correctly as a new entry.</p>${txnTable(rejected)}</div>`;
    bindTxnRows(v);
  };

  // ---------------------------------------------------------------- Reports
  VIEWS.reports = async function viewReports(v) {
    const [txns, budgets] = await Promise.all([loadTxns(S.fy, ['approved']), q(sb.from('budgets').select('*').eq('fy', S.fy))]);
    const inc = txns.filter((t) => t.kind === 'income'), exp = txns.filter((t) => t.kind === 'expense');
    const totInc = sum(inc), totExp = sum(exp);
    const group = (rows, key) => { const m = {}; rows.forEach((t) => { const k = t[key] ?? 'none'; m[k] = (m[k] || 0) + Number(t.amount); }); return m; };
    const incByCat = group(inc, 'category_id'), expByCat = group(exp, 'category_id');
    const catTable = (map, total) => {
      const rows = Object.entries(map).map(([id, a]) => [catName(id), a]).sort((a, b) => b[1] - a[1]);
      if (!rows.length) return '<div class="empty">Nothing approved yet.</div>';
      return `<div class="table-wrap"><table><thead><tr><th>Category</th><th class="num">Amount</th><th class="num">Share</th></tr></thead><tbody>
        ${rows.map(([n, a]) => `<tr><td>${esc(n)}</td><td class="num">${fmt(a)}</td><td class="num">${total ? ((a / total) * 100).toFixed(1) : 0}%</td></tr>`).join('')}
        </tbody><tfoot><tr><td>Total</td><td class="num">${fmt(total)}</td><td></td></tr></tfoot></table></div>`;
    };

    const budgetMap = Object.fromEntries(budgets.map((b) => [b.category_id, Number(b.amount)]));
    const bRows = S.cats.filter((c) => (budgetMap[c.id] > 0) || (c.kind === 'expense' ? expByCat[c.id] : incByCat[c.id]))
      .map((c) => {
        const actual = (c.kind === 'expense' ? expByCat : incByCat)[c.id] || 0;
        const budget = budgetMap[c.id] || 0;
        return { c, actual, budget, pct: budget ? (actual / budget) * 100 : null };
      })
      .sort((a, b) => (a.c.kind === b.c.kind ? (b.pct ?? -1) - (a.pct ?? -1) : a.c.kind === 'expense' ? -1 : 1));
    const flag = (r) => {
      if (r.budget === 0) return '<span class="muted small">No budget set</span>';
      if (r.c.kind === 'income') return r.pct >= 100 ? '<span class="diff-ok">✓ Target reached</span>' : `<span class="muted small">${r.pct.toFixed(0)}% of target</span>`;
      if (r.pct > 100) return '<span class="flag-over">▲ Over budget</span>';
      if (r.pct >= 90) return '<span class="flag-near">⚠ Nearly used up</span>';
      return '<span class="diff-ok">✓ Within budget</span>';
    };

    const fInc = group(inc, 'fund_id'), fExp = group(exp, 'fund_id');
    const fundIds = Array.from(new Set([...Object.keys(fInc), ...Object.keys(fExp)]));
    const mInc = Array(12).fill(0), mExp = Array(12).fill(0);
    inc.forEach((t) => { mInc[fyMonth(t.txn_date)] += Number(t.amount); });
    exp.forEach((t) => { mExp[fyMonth(t.txn_date)] += Number(t.amount); });

    v.innerHTML = `
      <div class="page-head"><h1>Reports</h1>${fySelect()}
        <div class="actions no-print"><button class="btn" id="print">Print / save as PDF</button><button class="btn" id="csv">Download all entries (CSV)</button></div></div>
      <p class="muted small">Only approved entries are counted. FY ${S.fy} (1 April – 31 March).</p>
      <div class="card"><div class="card-head"><h2>Income &amp; Expenditure statement</h2></div>
        <div class="grid two">
          <div><h3>Income</h3>${catTable(incByCat, totInc)}</div>
          <div><h3>Expenditure</h3>${catTable(expByCat, totExp)}</div>
        </div>
        <p style="margin-top:12px"><b>${totInc - totExp >= 0 ? 'Surplus (income over expenditure)' : 'Deficit (expenditure over income)'}: ${fmt(Math.abs(totInc - totExp))}</b></p>
      </div>
      <div class="card"><div class="card-head"><h2>Budget vs actual</h2>${can.admin() ? '<a class="small no-print" href="#/settings">Set budgets →</a>' : ''}</div>
        ${bRows.length ? `<div class="table-wrap"><table><thead><tr><th>Category</th><th>Type</th><th class="num">Budget</th><th class="num">Actual</th><th class="num">Remaining</th><th>Used</th><th></th></tr></thead><tbody>
          ${bRows.map((r) => `<tr><td>${esc(r.c.name)}</td><td class="kind">${r.c.kind === 'income' ? 'Income' : 'Expense'}</td>
            <td class="num">${r.budget ? fmt(r.budget) : '—'}</td><td class="num">${fmt(r.actual)}</td>
            <td class="num">${r.budget ? fmt(r.budget - r.actual) : '—'}</td>
            <td>${r.budget ? `<div class="meter ${r.c.kind === 'expense' && r.pct > 100 ? 'over' : ''}"><div style="width:${Math.min(100, r.pct)}%"></div></div>` : ''}</td>
            <td>${flag(r)}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">No budgets or approved entries yet.</div>'}
      </div>
      <div class="grid two" style="margin-top:16px">
        <div class="card"><div class="card-head"><h2>Fund-wise summary</h2></div>
          ${fundIds.length ? `<div class="table-wrap"><table><thead><tr><th>Fund</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead><tbody>
          ${fundIds.map((id) => `<tr><td>${id === 'none' ? 'No fund' : esc(fundName(id))}</td><td class="num">${fmt(fInc[id] || 0)}</td><td class="num">${fmt(fExp[id] || 0)}</td><td class="num">${fmt((fInc[id] || 0) - (fExp[id] || 0))}</td></tr>`).join('')}
          </tbody></table></div>` : '<div class="empty">Nothing yet.</div>'}</div>
        <div class="card"><div class="card-head"><h2>Month-wise summary</h2></div>
          <div class="table-wrap"><table><thead><tr><th>Month</th><th class="num">Income</th><th class="num">Expenses</th><th class="num">Net</th></tr></thead><tbody>
          ${MONTHS.map((mo, i) => `<tr><td>${mo}</td><td class="num">${fmt(mInc[i])}</td><td class="num">${fmt(mExp[i])}</td><td class="num">${fmt(mInc[i] - mExp[i])}</td></tr>`).join('')}
          </tbody><tfoot><tr><td>Total</td><td class="num">${fmt(totInc)}</td><td class="num">${fmt(totExp)}</td><td class="num">${fmt(totInc - totExp)}</td></tr></tfoot></table></div></div>
      </div>`;
    bindFy(v, VIEWS.reports);
    $('#print', v).onclick = () => window.print();
    $('#csv', v).onclick = async () => exportTxns(await loadTxns(S.fy), `all-entries-FY${S.fy}.csv`);
  };

  // ---------------------------------------------------------------- Bank reconciliation
  VIEWS.reconcile = async function viewReconcile(v) {
    const recs = await q(sb.from('reconciliations').select('*').order('as_of', { ascending: false }).order('id', { ascending: false }).limit(100));
    const accts = S.accounts.filter((a) => a.active);
    v.innerHTML = `
      <div class="page-head"><h1>Bank &amp; cash check</h1></div>
      <div class="card">
        <p>Once a month, compare what the app says with your <b>bank statement</b> (or count the <b>petty cash</b>). If they don't match, an entry is missing, wrong, or still waiting for approval.</p>
        <div class="field-row">
          <div class="field"><label for="r-acct">Account</label><select id="r-acct">${opt(accts)}</select></div>
          <div class="field"><label for="r-date">Balance as on</label><input id="r-date" type="date" value="${todayStr()}" max="${todayStr()}"></div>
        </div>
        <div class="field-row">
          <div class="field"><label>Balance in this app (approved entries)</label><div id="r-app" style="font-size:1.3rem;font-weight:700">…</div></div>
          <div class="field"><label for="r-stmt">Balance on bank statement / cash counted</label><input id="r-stmt" type="number" step="0.01" inputmode="decimal"></div>
        </div>
        <div id="r-diff" class="field"></div>
        ${can.enter() ? `<div class="field"><label for="r-note">Note (e.g. explain any difference)</label><input id="r-note" maxlength="500"></div>
        <button class="btn primary" id="r-save">Save this check</button>` : ''}
      </div>
      <div class="card"><div class="card-head"><h2>Past checks</h2></div>
        ${recs.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Account</th><th class="num">App</th><th class="num">Statement</th><th class="num">Difference</th><th>Note</th><th>By</th></tr></thead><tbody>
        ${recs.map((r) => { const diff = Number(r.statement_balance) - Number(r.app_balance); return `<tr><td class="nowrap">${fmtDate(r.as_of)}</td><td>${esc(acctName(r.account_id))}</td>
          <td class="num">${fmt(r.app_balance)}</td><td class="num">${fmt(r.statement_balance)}</td>
          <td class="num ${Math.abs(diff) < 0.005 ? 'diff-ok' : 'diff-bad'}">${Math.abs(diff) < 0.005 ? '✓ Matches' : '✕ ' + fmt(diff)}</td>
          <td>${esc(r.note || '')}</td><td>${esc(personName(r.created_by))}</td></tr>`; }).join('')}
        </tbody></table></div>` : '<div class="empty">No checks saved yet.</div>'}</div>`;
    let appBal = null;
    const showDiff = () => {
      const s = $('#r-stmt', v).value;
      if (s === '' || appBal === null) { $('#r-diff', v).innerHTML = ''; return; }
      const diff = Number(s) - appBal;
      $('#r-diff', v).innerHTML = Math.abs(diff) < 0.005
        ? '<span class="diff-ok">✓ Matches — the books agree with the statement.</span>'
        : `<span class="diff-bad">✕ Difference of ${fmt(diff)}.</span> <span class="muted small">Look for missing entries, entries still pending, or bank charges/interest not entered.</span>`;
    };
    const loadBal = async () => {
      const id = $('#r-acct', v).value;
      if (!id) return;
      $('#r-app', v).textContent = '…';
      try {
        appBal = Number(await q(sb.rpc('account_balance', { p_account: Number(id), p_as_of: $('#r-date', v).value })));
        $('#r-app', v).textContent = fmt(appBal);
      } catch (e) { $('#r-app', v).textContent = 'Error'; toast(e.message, 'error'); }
      showDiff();
    };
    $('#r-acct', v).onchange = loadBal; $('#r-date', v).onchange = loadBal; $('#r-stmt', v).oninput = showDiff;
    if ($('#r-save', v)) $('#r-save', v).onclick = async (e) => {
      const s = $('#r-stmt', v).value;
      if (s === '') return toast('Enter the statement balance first', 'error');
      e.target.disabled = true;
      try {
        await q(sb.from('reconciliations').insert({
          account_id: Number($('#r-acct', v).value), as_of: $('#r-date', v).value,
          statement_balance: Number(s), note: $('#r-note', v).value.trim() || null
        }));
        toast('Check saved'); route();
      } catch (err) { toast(err.message, 'error'); e.target.disabled = false; }
    };
    loadBal();
  };

  // ---------------------------------------------------------------- Audit log
  VIEWS.audit = async function viewAudit(v) {
    const logs = await q(sb.from('audit_log').select('*').order('id', { ascending: false }).limit(300));
    const TABLES = { transactions: 'Entry', profiles: 'Staff', categories: 'Category', funds: 'Fund', accounts: 'Account', budgets: 'Budget', reconciliations: 'Bank check' };
    const summary = (l) => {
      const n = l.new_data || {}, o = l.old_data || {};
      const name = n.number || n.name || n.email || o.number || o.name || o.email || (l.table_name === 'budgets' ? `${catName(n.category_id)} FY ${n.fy}` : '');
      if (l.action === 'INSERT') {
        if (l.table_name === 'transactions') return `${esc(name)} — ${KIND[n.kind]} ${fmt(n.amount)}`;
        return `Added ${esc(name)}`;
      }
      if (l.action === 'UPDATE') {
        const changed = Object.keys(n).filter((k) => JSON.stringify(n[k]) !== JSON.stringify(o[k]) && !/_at$/.test(k));
        return `${esc(name)}: ${changed.map((k) => `<b>${esc(k)}</b> ${esc(o[k] ?? '—')} → ${esc(n[k] ?? '—')}`).join(', ') || 'no visible change'}`;
      }
      return `Deleted ${esc(name)}`;
    };
    v.innerHTML = `
      <div class="page-head"><h1>Audit log</h1><span class="muted small">Latest 300 changes. This log can't be edited or deleted by anyone using the app.</span></div>
      <div class="card">${logs.length ? `<div class="table-wrap"><table><thead><tr><th>When</th><th>Who</th><th>What</th><th>Action</th><th>Details</th></tr></thead><tbody>
        ${logs.map((l) => `<tr><td class="nowrap">${fmtDateTime(l.at)}</td><td>${esc(l.user_email || 'System / setup')}</td>
          <td>${TABLES[l.table_name] || esc(l.table_name)}</td><td>${{ INSERT: 'Added', UPDATE: 'Changed', DELETE: 'Deleted' }[l.action] || esc(l.action)}</td>
          <td>${summary(l)}</td></tr>`).join('')}
      </tbody></table></div>` : '<div class="empty">No activity yet.</div>'}</div>`;
  };

  // ---------------------------------------------------------------- Settings (admin)
  VIEWS.settings = async function viewSettings(v) {
    await loadLookups();
    const budgets = await q(sb.from('budgets').select('*').eq('fy', S.fy));
    const bMap = Object.fromEntries(budgets.map((b) => [b.category_id, b.amount]));
    const activeBox = (x, disabled) => `<input type="checkbox" data-field="active" ${x.active ? 'checked' : ''} ${disabled ? 'disabled' : ''} aria-label="Active">`;
    const saveBtn = (table) => `<button class="btn small" data-save="${table}">Save</button>`;

    v.innerHTML = `
      <div class="page-head"><h1>Settings</h1></div>

      <div class="card"><div class="card-head"><h2>Staff</h2></div>
        <p class="muted small">To add someone: Supabase dashboard → Authentication → Users → <b>Invite user</b>. They'll appear here; choose their role and tick Active.
          <b>Admin</b> sees everything and approves. <b>Accountant</b> enters receipts &amp; payments. <b>Viewer</b> (e.g. trustee) can only look.</p>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Active</th><th></th></tr></thead><tbody>
        ${S.peopleList.map((p) => { const self = p.id === S.me.id; return `<tr data-id="${p.id}">
          <td><input data-field="full_name" value="${esc(p.full_name || '')}" aria-label="Name"></td><td>${esc(p.email)}</td>
          <td><select data-field="role" ${self ? 'disabled' : ''} aria-label="Role">${Object.entries(ROLES).map(([k, l]) => `<option value="${k}" ${p.role === k ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
          <td>${activeBox(p, self)}</td><td>${saveBtn('profiles')}${self ? ' <span class="muted small">(you)</span>' : ''}</td></tr>`; }).join('')}
        </tbody></table></div></div>

      <div class="card"><div class="card-head"><h2>Bank &amp; cash accounts</h2></div>
        <p class="muted small">Opening balance = the balance on the day you started using this app. Untick Active to hide an account you no longer use.</p>
        <div class="table-wrap"><table><thead><tr><th>Name</th><th>Type</th><th class="num">Opening balance</th><th>Active</th><th></th></tr></thead><tbody>
        ${S.accounts.map((a) => `<tr data-id="${a.id}"><td><input data-field="name" value="${esc(a.name)}" aria-label="Name"></td>
          <td><select data-field="type" aria-label="Type">${['bank', 'cash', 'upi', 'other'].map((k) => `<option ${a.type === k ? 'selected' : ''}>${k}</option>`).join('')}</select></td>
          <td><input data-field="opening_balance" data-num="1" type="number" step="0.01" value="${esc(a.opening_balance)}" aria-label="Opening balance"></td>
          <td>${activeBox(a)}</td><td>${saveBtn('accounts')}</td></tr>`).join('')}
        </tbody></table></div>
        <form class="inline-form" data-add="accounts"><input name="name" placeholder="New account name" required>
          <select name="type"><option>bank</option><option>cash</option><option>upi</option><option>other</option></select>
          <input name="opening_balance" type="number" step="0.01" placeholder="Opening balance" value="0"><button class="btn" type="submit">Add account</button></form></div>

      <div class="card"><div class="card-head"><h2>Categories</h2></div>
        <p class="muted small">Don't delete or rename categories that are already used for something different — untick Active instead, so old reports stay correct.</p>
        <div class="grid two">${['income', 'expense'].map((k) => `<div><h3>${k === 'income' ? 'Income' : 'Expense'}</h3>
          <div class="table-wrap"><table><tbody>${S.cats.filter((c) => c.kind === k).map((c) => `<tr data-id="${c.id}">
            <td><input data-field="name" value="${esc(c.name)}" aria-label="Name"></td><td>${activeBox(c)}</td><td>${saveBtn('categories')}</td></tr>`).join('')}</tbody></table></div>
          <form class="inline-form" data-add="categories"><input type="hidden" name="kind" value="${k}"><input name="name" placeholder="New ${k} category" required><button class="btn" type="submit">Add</button></form></div>`).join('')}
        </div></div>

      <div class="card"><div class="card-head"><h2>Funds</h2></div>
        <p class="muted small">Keep money for different purposes apart — e.g. a government grant that may only be spent on books.</p>
        <div class="table-wrap"><table><tbody>${S.funds.map((x) => `<tr data-id="${x.id}">
          <td><input data-field="name" value="${esc(x.name)}" aria-label="Name"></td><td>${activeBox(x)}</td><td>${saveBtn('funds')}</td></tr>`).join('')}</tbody></table></div>
        <form class="inline-form" data-add="funds"><input name="name" placeholder="New fund" required><button class="btn" type="submit">Add fund</button></form></div>

      <div class="card"><div class="card-head"><h2>Budgets</h2>${fySelect()}</div>
        <p class="muted small">Planned amount per category for the year. Leave blank for no budget. Reports → Budget vs actual compares against these.</p>
        <form id="budgets"><div class="grid two">${['expense', 'income'].map((k) => `<div><h3>${k === 'income' ? 'Income targets' : 'Expense budgets'}</h3>
          <div class="table-wrap"><table><tbody>${S.cats.filter((c) => c.kind === k && c.active).map((c) => `<tr><td>${esc(c.name)}</td>
            <td><input type="number" min="0" step="1" data-cat="${c.id}" value="${bMap[c.id] != null ? esc(bMap[c.id]) : ''}" aria-label="Budget for ${esc(c.name)}"></td></tr>`).join('')}</tbody></table></div></div>`).join('')}
        </div><button class="btn primary" type="submit" style="margin-top:12px">Save budgets for FY ${S.fy}</button></form></div>`;

    bindFy(v, VIEWS.settings);
    $$('[data-save]', v).forEach((btn) => {
      btn.onclick = async () => {
        const tr = btn.closest('tr');
        const patch = {};
        $$('[data-field]', tr).forEach((inp) => {
          if (inp.disabled) return;
          patch[inp.dataset.field] = inp.type === 'checkbox' ? inp.checked : inp.dataset.num ? Number(inp.value || 0) : inp.value.trim();
        });
        btn.disabled = true;
        try { await q(sb.from(btn.dataset.save).update(patch).eq('id', tr.dataset.id)); toast('Saved'); await loadLookups(); }
        catch (e) { toast(e.message, 'error'); }
        btn.disabled = false;
      };
    });
    $$('form[data-add]', v).forEach((form) => {
      form.onsubmit = async (e) => {
        e.preventDefault();
        const row = Object.fromEntries(new FormData(form).entries());
        if (row.opening_balance !== undefined) row.opening_balance = Number(row.opening_balance || 0);
        row.name = (row.name || '').trim();
        try { await q(sb.from(form.dataset.add).insert(row)); toast('Added'); route(); }
        catch (err) { toast(err.message, 'error'); }
      };
    });
    $('#budgets', v).onsubmit = async (e) => {
      e.preventDefault();
      const rows = $$('[data-cat]', v)
        .filter((i) => i.value !== '' || bMap[i.dataset.cat] != null)
        .map((i) => ({ fy: S.fy, category_id: Number(i.dataset.cat), amount: Number(i.value || 0) }));
      if (!rows.length) return toast('Nothing to save');
      try { await q(sb.from('budgets').upsert(rows, { onConflict: 'fy,category_id' })); toast(`Budgets saved for FY ${S.fy}`); }
      catch (err) { toast(err.message, 'error'); }
    };
  };

  // ---------------------------------------------------------------- start
  sb.auth.onAuthStateChange((event) => {
    if (event === 'PASSWORD_RECOVERY') renderSetPassword('Choose a new password');
  });
  (async () => {
    if (authError) return renderLogin(`Sign-in link problem: ${authError}. Ask the admin to send a new invite, or use "Forgot password?".`);
    const { data: { session } } = await sb.auth.getSession();
    if (session && authType === 'invite') return renderSetPassword('Welcome! Set your password');
    if (session && authType === 'recovery') return renderSetPassword('Choose a new password');
    if (!session) return renderLogin();
    enterApp();
  })();
})();
