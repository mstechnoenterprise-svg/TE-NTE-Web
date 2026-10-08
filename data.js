/**
 * data.js — ডেটা লেয়ার
 * MS Techno Enterprise
 *
 * ── দুই মোড ────────────────────────────────────────────────────────────
 *  LOCAL  : js/config.js এ APPS_SCRIPT_URL খালি থাকলে আগের মতোই সব ডেটা
 *           শুধু এই ব্রাউজারে (localStorage) থাকে।
 *  CLOUD  : APPS_SCRIPT_URL সেট থাকলে Google Sheet (Apps Script Web App)
 *           ই ডেটাবেজ। পেজ লোড হওয়ার সময় একবার পুরো ডেটা Sheet থেকে
 *           সিঙ্ক্রোনাসভাবে নেমে আসে (তাই বাকি সব কোড আগের মতোই sync কাজ
 *           করে), আর প্রতিটি পরিবর্তন ব্যাকগ্রাউন্ডে Sheet-এ পাঠানো হয়।
 *           নেট না থাকলে লোকাল কপিতে কাজ চলে, ফিরে এলে নিজে থেকেই
 *           Sheet-এ পাঠিয়ে দেওয়া হয়।
 *
 * ── ক্লাউড মোডের নিয়ম ──────────────────────────────────────────────────
 *  • প্রতিটি রেকর্ডের `id` ই আসল চাবি — id থাকলে আপডেট, না থাকলে নতুন।
 *  • লেখার সময় শুধু বদলানো/মুছে ফেলা রেকর্ডগুলোই পাঠানো হয় (পুরো টেবিল নয়),
 *    তাই দুটো ডিভাইস একসাথে কাজ করলেও একজনের লেখা মুছে যায় না।
 *  • Sheet-এ হাত দিয়ে ডেটা এডিট করা যায়; শুধু `id` কলামটা বদলানো যাবে না।
 */

const DB = {
  // ── Keys ──────────────────────────────────────────────
  KEYS: {
    USERS:        'mste_users',
    AGENTS:       'mste_agents',
    AGENT_BALANCE:'mste_agent_balance',
    DC_PAYMENTS:  'mste_dc_payments',
    CASHBOOK:     'mste_cashbook',
    CAPITAL:      'mste_capital',
    COMMISSION:   'mste_commission',
    LOANS:        'mste_loans',
    EXPENSES:     'mste_expenses',
    APP_SETTINGS: 'mste_settings',
    ACTIVITY_LOG: 'mste_activity',
    // HR Employee data
    HR_EMPLOYEES:   'mste_hr_employees',
    HR_ATTENDANCE:  'mste_hr_attendance',
    HR_LEAVE:       'mste_hr_leave',
    HR_PERFORMANCE: 'mste_hr_performance',
    HR_TARGET:      'mste_hr_target',
    HR_CSERVICE:    'mste_hr_cservice',
    HR_SALARY_HIST: 'mste_hr_salary_hist',
  },

  /** localStorage কী → Apps Script টেবিলের নাম (payload-এ ব্যবহৃত) */
  _KEY_TO_TABLE: null,

  // ── Cloud state ───────────────────────────────────────
  CLOUD: {
    enabled: false,
    url: '',
    token: '',
    online: true,
    lastSync: null,
    serverTime: null,
    lastError: '',
    pendingPush: null,     // শেষ সফল push এর সময়
    migrationNeeded: [],   // যেসব টেবিলে লোকাল ডেটা আছে কিন্তু Sheet খালি
  },

  _store: {},        // key → live data (cloud মোডে মেমোরি ক্যাশ)
  _base: {},         // key → id → শেষ জানা সার্ভার-ভ্যালু (diff করার জন্য)
  _versions: {},     // key → id → Sheet-এ থাকা সংস্করণ (push-এ baseVersion হিসেবে যায়)
  _conflicts: [],    // যেসব রেকর্ডে দ্বন্দ্ব হয়েছে, মিটমাট হওয়ার আগ পর্যন্ত থাকে
  CONFLICT_KEY: 'mste_cloud_conflicts',
  _localSnapshot: {},// cloud চালু করার আগে ব্রাউজারে যা ছিল
  _dirty: {},        // key → { ups:{id:1}, dels:{id:1} }
  _pushTimer: null,
  _pushing: false,
  _bootDone: false,

  /** একটাই রেকর্ড থাকে এমন টেবিলের id */
  SETTINGS_ID: 'app_settings',

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // Generic helpers
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  get(key) {
    if (this.CLOUD.enabled) {
      const v = this._store[key];
      return Array.isArray(v) ? v : [];
    }
    try {
      const d = localStorage.getItem(key);
      return d ? JSON.parse(d) : [];
    } catch { return []; }
  },

  set(key, data) {
    if (this.CLOUD.enabled) {
      this._store[key] = data;
      this._mirrorWrite(key, data);
      this._markDirty(key, data);
      return;
    }
    localStorage.setItem(key, JSON.stringify(data));
  },

  getObj(key, def = {}) {
    if (this.CLOUD.enabled) {
      const v = this._store[key];
      const ok = v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length > 0;
      return ok ? v : def;
    }
    try {
      const d = localStorage.getItem(key);
      return d ? JSON.parse(d) : def;
    } catch { return def; }
  },

  setObj(key, obj) {
    if (this.CLOUD.enabled) {
      const data = obj && obj.id ? obj : { id: this.SETTINGS_ID, ...(obj || {}) };
      this._store[key] = data;
      this._mirrorWrite(key, data);
      this._markDirty(key, data);
      return;
    }
    localStorage.setItem(key, JSON.stringify(obj));
  },

  // ── ID generator ──────────────────────────────────────
  uid() {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 6);
  },

  now() { return new Date().toISOString(); },

  // ── Obfuscation / Encryption for Sensitive User Data ───
  _obf(data) {
    try {
      const json = JSON.stringify(data);
      const utf8Bytes = (typeof TextEncoder !== 'undefined')
        ? new TextEncoder().encode(json)
        : unescape(encodeURIComponent(json)).split('').map(c => c.charCodeAt(0));
      const key = [0x7a, 0x3b, 0x91, 0x4f, 0x2e, 0x88, 0x1d, 0x6c];
      const xored = new Uint8Array(utf8Bytes.length);
      for (let i = 0; i < utf8Bytes.length; i++) {
        xored[i] = utf8Bytes[i] ^ key[i % key.length] ^ ((i * 7) & 0xff);
      }
      let binStr = '';
      for (let i = 0; i < xored.length; i++) {
        binStr += String.fromCharCode(xored[i]);
      }
      return '_enc9:' + btoa(binStr);
    } catch (e) {
      return JSON.stringify(data);
    }
  },

  _deobf(str) {
    if (!str) return null;
    try {
      if (typeof str === 'string' && str.startsWith('_enc9:')) {
        const binStr = atob(str.slice(6));
        const key = [0x7a, 0x3b, 0x91, 0x4f, 0x2e, 0x88, 0x1d, 0x6c];
        const bytes = new Uint8Array(binStr.length);
        for (let i = 0; i < binStr.length; i++) {
          bytes[i] = binStr.charCodeAt(i) ^ key[i % key.length] ^ ((i * 7) & 0xff);
        }
        const json = (typeof TextDecoder !== 'undefined')
          ? new TextDecoder().decode(bytes)
          : decodeURIComponent(escape(String.fromCharCode.apply(null, bytes)));
        return JSON.parse(json);
      }
      return JSON.parse(str);
    } catch (e) {
      return null;
    }
  },

  // ══════════════════════════════════════════════════════
  // CLOUD LAYER
  // ══════════════════════════════════════════════════════

  isCloud() { return this.CLOUD.enabled; },

  _cfg() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG)
      ? APP_CONFIG
      : (typeof window !== 'undefined' && window.APP_CONFIG) || {};
  },

  _tableMap() {
    if (!this._KEY_TO_TABLE) {
      this._KEY_TO_TABLE = {};
      Object.keys(this.KEYS).forEach(name => { this._KEY_TO_TABLE[this.KEYS[name]] = name; });
    }
    return this._KEY_TO_TABLE;
  },

  _endpoint(action) {
    const sep = this.CLOUD.url.indexOf('?') === -1 ? '?' : '&';
    return this.CLOUD.url + sep + 'action=' + encodeURIComponent(action)
      + '&token=' + encodeURIComponent(this.CLOUD.token || '');
  },

  /** ডেটার একেকটি সারি (রেকর্ড) হিসেবে রূপান্তর */
  _valueToRecords(key, value) {
    const arr = [];
    if (Array.isArray(value)) {
      value.forEach(v => { if (v && typeof v === 'object') arr.push(v); });
    } else if (value && typeof value === 'object') {
      arr.push(value.id ? value : { id: this.SETTINGS_ID, ...value });
    }
    return arr;
  },

  _idMap(records) {
    const map = {};
    (records || []).forEach(r => {
      if (r && r.id !== undefined && r.id !== null && String(r.id) !== '') map[String(r.id)] = r;
    });
    return map;
  },

  _sameValue(a, b) {
    if (a === b) return true;
    try { return this._stable(a) === this._stable(b); } catch (_) { return false; }
  },

  /** কী-এর ক্রম নির্বিশেষে একই ডেটা হলে একই স্ট্রিং (নাহলে বারবার অপ্রয়োজনীয় সিঙ্ক হতো) */
  _stable(value) {
    const walk = (v) => {
      if (Array.isArray(v)) return '[' + v.map(walk).join(',') + ']';
      if (v && typeof v === 'object') {
        return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + walk(v[k])).join(',') + '}';
      }
      return JSON.stringify(v === undefined ? null : v);
    };
    return walk(value);
  },

  // ── লোকাল ক্যাশ (offline mirror) ──────────────────────
  _mirrorWrite(key, value) {
    try {
      if (key === this.KEYS.USERS) localStorage.setItem(key, this._obf(value));
      else localStorage.setItem(key, JSON.stringify(value));
    } catch (_) {}
  },

  _mirrorRead(key, isObj) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return null;
      if (key === this.KEYS.USERS) {
        const v = this._deobf(raw);
        return Array.isArray(v) ? v : null;
      }
      const v = JSON.parse(raw);
      if (isObj) return (v && typeof v === 'object' && !Array.isArray(v)) ? v : null;
      return Array.isArray(v) ? v : null;
    } catch (_) { return null; }
  },

  _loadLocalCache() {
    this._localSnapshot = {};
    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      const isObj = name === 'APP_SETTINGS';
      const cached = this._mirrorRead(key, isObj);
      if (cached !== null) this._localSnapshot[key] = cached;
    });
  },

  // ── Pull (পেজ লোডে একবার, sync XHR) ───────────────────
  _pullSync() {
    const xhr = new XMLHttpRequest();
    xhr.open('GET', this._endpoint('pull'), false); // sync — বাকি অ্যাপ sync পড়ে
    xhr.send(null);
    if (xhr.status < 200 || xhr.status >= 300) throw new Error('HTTP ' + xhr.status);
    return JSON.parse(xhr.responseText);
  },

  _applyPull(data, serverTime) {
    this.CLOUD.serverTime = serverTime || null;
    this.CLOUD.migrationNeeded = [];
    const skipMirror = {};

    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      const isObj = name === 'APP_SETTINGS';
      if (!(name in data)) return;

      const localVal = this._localSnapshot[key];
      let serverVal = data[name];
      if (isObj) {
        serverVal = Array.isArray(serverVal) ? (serverVal[0] || null) : serverVal;
      } else if (!Array.isArray(serverVal)) {
        serverVal = serverVal ? [serverVal] : [];
      }

      const serverEmpty = isObj ? (!serverVal || Object.keys(serverVal).length === 0)
                                : serverVal.length === 0;
      const localHasData = isObj ? (!!localVal && Object.keys(localVal).length > 0)
                                 : (Array.isArray(localVal) && localVal.length > 0);

      // Sheet খালি অথচ ব্রাউজারে আগের ডেটা আছে → সেটা রেখে দিই, যাতে ইউজার
      // "Sheet-এ আপলোড" বাটন দিয়ে একবারে সব পাঠাতে পারে।
      let useLocal = false;
      if (serverEmpty && localHasData) useLocal = true;

      // Users টেবিলে সার্ভার নিজেই ডিফল্ট অ্যাডমিন বসায় — সেটাকে "খালি" ধরা হয়
      if (name === 'USERS' && localHasData) {
        const onlySeededAdmin = serverVal.length === 1 && String(serverVal[0].id) === 'admin-001';
        if (onlySeededAdmin) useLocal = true;
      }

      if (useLocal) {
        this._store[key] = isObj ? localVal : localVal;
        this.CLOUD.migrationNeeded.push(name);
        skipMirror[key] = true;
      } else {
        this._store[key] = isObj ? (serverVal || {}) : serverVal;
      }
      this._base[key] = this._idMap(this._valueToRecords(key, this._store[key]));

      // সার্ভারে যে সংস্করণগুলো আছে সেগুলো মনে রাখি
      this._versions[key] = {};
      Object.keys(this._base[key]).forEach(id => {
        const v = this._base[key][id].version;
        this._versions[key][id] = (v === undefined || v === null || v === '') ? 0 : (parseFloat(v) || 0);
      });
    });

    // Sheet-এ যেসব টেবিল আছে কিন্তু ব্রাউজারে নেই — সেগুলো মিরর থেকে মুছে ফেলি,
    // আর যেগুলো মাইগ্রেশনে বাদ পড়েছে সেগুলোর লোকাল কপি অটুট রাখি।
    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      if (skipMirror[key] || !(key in this._store)) return;
      this._mirrorWrite(key, this._store[key]);
    });
  },

  /** পেজে দরকার নেই (index.html শুধু রিডাইরেক্ট করে) — তখন সিঙ্ক বাদ */
  _skipBootPull() {
    if (typeof window === 'undefined' || !window.location) return false;
    const p = window.location.pathname || '';
    return /\/$/.test(p) || /index\.html$/i.test(p);
  },

  _bindNet() {
    if (typeof window === 'undefined' || this._netBound) return;
    this._netBound = true;
    window.addEventListener('online', () => {
      this.CLOUD.online = true;
      this._ui();
      this._flush();
    });
    window.addEventListener('offline', () => {
      this.CLOUD.online = false;
      this._ui();
    });
    // পেজ বন্ধ হওয়ার আগে বাকি লেখাগুলো পাঠানোর শেষ চেষ্টা
    window.addEventListener('beforeunload', () => {
      if (!this._hasDirty()) return;
      try {
        const ops = this._buildOps();
        if (!ops.length) return;
        const blob = new Blob([JSON.stringify({ token: this.CLOUD.token, action: 'push', ops })],
          { type: 'text/plain;charset=utf-8' });
        if (navigator.sendBeacon) navigator.sendBeacon(this.CLOUD.url, blob);
      } catch (_) {}
    });
  },

  // ── Dirty tracking ────────────────────────────────────
  _markDirty(key, value) {
    const next = this._idMap(this._valueToRecords(key, value));
    const base = this._base[key] || {};
    const d = this._dirty[key] || (this._dirty[key] = { ups: {}, dels: {} });

    Object.keys(next).forEach(id => {
      if (!this._sameValue(next[id], base[id])) d.ups[id] = 1;
    });
    Object.keys(base).forEach(id => {
      if (!next[id]) d.dels[id] = 1;
    });
    // আবার যোগ করা রেকর্ড ডিলিট-লিস্ট থেকে বাদ
    Object.keys(d.dels).forEach(id => { if (next[id]) delete d.dels[id]; });

    this._persistDirty();
    this._schedulePush();
    this._ui();
  },

  _hasDirty() {
    return Object.keys(this._dirty).some(k => {
      const d = this._dirty[k];
      return d && (Object.keys(d.ups).length || Object.keys(d.dels).length);
    });
  },

  _dirtyCount() {
    let n = 0;
    Object.keys(this._dirty).forEach(k => {
      const d = this._dirty[k];
      if (!d) return;
      n += Object.keys(d.ups).length + Object.keys(d.dels).length;
    });
    return n;
  },

  _persistDirty() {
    try {
      const clean = {};
      Object.keys(this._dirty).forEach(k => {
        const d = this._dirty[k];
        if (d && (Object.keys(d.ups).length || Object.keys(d.dels).length)) clean[k] = d;
      });
      if (Object.keys(clean).length) localStorage.setItem('mste_cloud_dirty', JSON.stringify(clean));
      else localStorage.removeItem('mste_cloud_dirty');
    } catch (_) {}
  },

  _restoreDirty() {
    try {
      const raw = localStorage.getItem('mste_cloud_dirty');
      if (!raw) return;
      const parsed = JSON.parse(raw);
      this._dirty = {};
      Object.keys(parsed || {}).forEach(k => {
        const d = parsed[k] || {};
        this._dirty[k] = { ups: d.ups || {}, dels: d.dels || {} };
      });
    } catch (_) { this._dirty = {}; }
  },

  /** বর্তমান dirty লিস্ট থেকে Sheet-এ পাঠানোর ops তৈরি */
  _buildOps() {
    const ops = [];
    Object.keys(this._dirty).forEach(key => {
      const d = this._dirty[key];
      if (!d) return;
      const ids = Object.keys(d.ups).concat(Object.keys(d.dels));
      if (!ids.length) return;
      const recs = this._idMap(this._valueToRecords(key, this._store[key]));
      const seen = {};
      // একই রেকর্ডে দ্বন্দ্ব মিটমাট না হওয়া পর্যন্ত আর পাঠাই না
      const blocked = {};
      this._conflicts.forEach(c => { if (c.table === key) blocked[String(c.id)] = 1; });
      ids.forEach(id => {
        if (seen[id] || blocked[id]) return;
        seen[id] = 1;
        const baseVersion = this._baseVersion(key, id);
        const updatedBy = this._actor();
        if (recs[id]) ops.push({ sheet: this._tableFor(key), op: 'upsert', record: recs[id], baseVersion: baseVersion, updatedBy: updatedBy });
        else ops.push({ sheet: this._tableFor(key), op: 'delete', id: id, baseVersion: baseVersion, updatedBy: updatedBy });
      });
    });
    return ops;
  },

  _tableFor(key) { return this._tableMap()[key] || key; },

  _keyForTable(table) {
    const map = this._tableMap();
    const found = Object.keys(map).find(k => map[k] === table);
    return found || table;
  },

  // ── Version / দ্বন্দ্ব সহায়ক ───────────────────────

  /** এই রেকর্ডটি যে সংস্করণে ছিল (শেষ জানা) */
  _baseVersion(key, id) {
    const known = (this._versions[key] || {})[String(id)];
    if (known !== undefined) return known;
    const b = (this._base[key] || {})[String(id)];
    return b && b.version !== undefined && b.version !== null && b.version !== ''
      ? (parseFloat(b.version) || 0) : 0;
  },

  /** কে পরিবর্তন করছে (Sheet-এর updatedBy কলামে যায়) */
  _actor() {
    try {
      const raw = localStorage.getItem('mste_session');
      if (!raw) return '';
      const s = this._deobf(raw);
      return (s && (s.email || s.name)) || '';
    } catch (_) { return ''; }
  },

  conflicts() { return this._conflicts.slice(); },

  /** রেকর্ড চেনার মতো একটা নাম */
  _labelFor(rec) {
    if (!rec) return '—';
    return rec.name || rec.description || rec.personName || rec.employeeId || rec.code
      || rec.email || rec.month || rec.id || '—';
  },

  /** দুটো সংস্করণের মধ্যে কোন কোন ঘর আলাদা */
  _conflictDiff(c) {
    if (c.op === 'delete') return 'তুমি রেকর্ডটা মুছেছিলে, কিন্তু শিটে এখনো আছে।';
    if (!c.server) return 'শিটে এই রেকর্ডটা খুঁজে পাওয়া গেল না।';
    if (!c.local) return 'তোমার সংস্করণটা আর হাতে নেই।';

    const skip = { id: 1, version: 1, updatedAt: 1, updatedBy: 1, createdAt: 1 };
    const fields = [];
    const keys = Object.keys(c.server).concat(Object.keys(c.local));
    const seen = {};
    for (const f of keys) {
      if (skip[f] || seen[f]) continue;
      seen[f] = 1;
      if (!this._sameValue(c.server[f], c.local[f])) fields.push(f);
    }
    if (!fields.length) return 'তোমার লেখা আর শিটের রেকর্ড হুবহু একই।';
    return fields.slice(0, 4).map(f => {
      const s = c.server[f] === undefined ? '' : c.server[f];
      const m = c.local[f] === undefined ? '' : c.local[f];
      const fmtV = v => (v && typeof v === 'object') ? JSON.stringify(v) : String(v);
      return `<div class="mste-sync-diff-row"><i>${f}</i><span class="mste-sync-diff-sheet">${fmtV(s)}</span><span class="mste-sync-diff-arrow">→</span><span class="mste-sync-diff-mine">${fmtV(m)}</span></div>`;
    }).join('') + (fields.length > 4 ? `<div class="mste-sync-diff-row">আরও ${fields.length - 4}টি ঘর আলাদা</div>` : '');
  },

  _persistConflicts() {
    try {
      if (this._conflicts.length) localStorage.setItem(this.CONFLICT_KEY, JSON.stringify(this._conflicts));
      else localStorage.removeItem(this.CONFLICT_KEY);
    } catch (_) {}
  },

  _restoreConflicts() {
    try {
      const raw = localStorage.getItem(this.CONFLICT_KEY);
      const parsed = raw ? JSON.parse(raw) : [];
      this._conflicts = Array.isArray(parsed) ? parsed : [];
    } catch (_) { this._conflicts = []; }
  },

  /** সার্ভার জানালো যে শিটে এর চেয়ে নতুন সংস্করণ আছে */
  _registerConflict(c) {
    const key = this._keyForTable(c.sheet);
    if (!key) return;
    const id = String(c.id);

    // দ্বন্দ্বে থাকা লেখাটা আর জমানো দরকার নেই — নাহলে আবার কী আবার দ্বন্দ্ব হতো
    const d = this._dirty[key];
    if (d) { delete d.ups[id]; delete d.dels[id]; }
    this._persistDirty();

    const localNow = this._idMap(this._valueToRecords(key, this._store[key]))[id] || null;
    const existing = this._conflicts.find(x => x.table === key && x.id === id);
    const entry = {
      table: key,
      sheet: c.sheet,
      id: id,
      op: c.op === 'delete' ? 'delete' : 'upsert',
      local: localNow || (existing ? existing.local : null),
      server: c.server || null,
      yourVersion: c.yourVersion,
      at: Date.now(),
    };
    if (existing) Object.assign(existing, entry);
    else this._conflicts.push(entry);
    this._persistConflicts();
  },

  /** একটি রেকর্ডকে _store-এ বসানো (settings এর মতো obj-ও সামলায়) */
  _upsertRecord(key, id, rec) {
    const v = this._store[key];
    if (Array.isArray(v)) {
      const i = v.findIndex(r => String(r.id) === String(id));
      if (i >= 0) v[i] = rec; else v.push(rec);
      this._mirrorWrite(key, v);
      return v;
    }
    const obj = { ...(v && typeof v === 'object' ? v : {}), ...rec, id: rec.id || this.SETTINGS_ID };
    this._store[key] = obj;
    this._mirrorWrite(key, obj);
    return obj;
  },

  /** রেকর্ডটি _store থেকে মুছে ফেলা */
  _removeRecord(key, id) {
    const v = this._store[key];
    if (Array.isArray(v)) {
      const next = v.filter(r => String(r.id) !== String(id));
      this._store[key] = next;
      this._mirrorWrite(key, next);
      return next;
    }
    this._store[key] = {};
    this._mirrorWrite(key, {});
    return {};
  },

  /**
   * দ্বন্দ্ব মিটমাট করা।
   * choice = 'mine'  → আমার সংস্করণ শিটে লিখে দিই (শিটের সাম্প্রতিক সংস্করণ বেস ধরে)
   * choice = 'sheet' → শিটের সংস্করণ গ্রহণ করি, আমার লেখা বাদ
   * দুটোতেই শেষে পেজ রিলোড হয়, যাতে স্ক্রিনে সঠিক ডেটা দেখায়।
   */
  resolveConflict(entryOrIndex, choice, reload = true) {
    const entry = (typeof entryOrIndex === 'number') ? this._conflicts[entryOrIndex] : entryOrIndex;
    if (!entry) return Promise.reject(new Error('conflict_not_found'));
    const reloadPage = () => { if (reload) window.location.reload(); };
    const key = entry.table, id = String(entry.id);
    const serverV = entry.server ? (parseFloat(entry.server.version) || 0) : 0;

    const done = () => {
      this._conflicts = this._conflicts.filter(x => !(x.table === key && x.id === id));
      this._persistConflicts();
      this._ui();
    };

    if (choice === 'sheet') {
      // শিটে রেকর্ডটা থাকলে সেটাই নিই (এমনকি আমি মুছে ফেললেও ফিরে আসবে),
      // আর শিটে না থাকলে লেকাল থেকে সওয়া যায়
      if (!entry.server) this._removeRecord(key, id);
      else this._upsertRecord(key, id, entry.server);
      if (this._base[key]) {
        if (entry.server) this._base[key][id] = entry.server;
        else delete this._base[key][id];
      }
      this._versions[key] = this._versions[key] || {};
      if (entry.server) this._versions[key][id] = serverV;
      else delete this._versions[key][id];
      done();
      reloadPage();
      return Promise.resolve(true);
    }

    // choice === 'mine' — শিটের চলতি সংস্করণকেই base ধরে জোর করে লিখি
    const currentLocal = entry.op === 'delete'
      ? null
      : (this._idMap(this._valueToRecords(key, this._store[key]))[id] || entry.local);

    if (entry.op !== 'delete' && !currentLocal) {
      done();
      return Promise.resolve(true);
    }

    const op = {
      sheet: entry.sheet,
      op: entry.op === 'delete' ? 'delete' : 'upsert',
      baseVersion: serverV,
      updatedBy: this._actor(),
    };
    if (op.op === 'delete') op.id = id; else op.record = currentLocal;

    this._ui('syncing');
    return this._post({ action: 'push', ops: [op] }).then(res => {
      if (!res || !res.ok) throw new Error((res && (res.error || res.message)) || 'push_failed');
      if (res.conflicts && res.conflicts.length) {
        // এর মধ্যে আবার কেউ বদলেছে — নতুন তথ্য দিয়ে দ্বন্দ্বটা আপডেট করি
        this._registerConflict(res.conflicts[0]);
        this._ui();
        throw new Error('এর মধ্যে শিটে আবার পরিবর্তন হয়েছে — আবার দেখুন');
      }
      (res.updates || []).forEach(u => {
        this._versions[key] = this._versions[key] || {};
        if (u.deleted) delete this._versions[key][String(u.id)];
        else this._versions[key][String(u.id)] = u.version;
      });
      if (op.op === 'delete') {
        this._removeRecord(key, id);
        if (this._base[key]) delete this._base[key][id];
      } else {
        this._base[key] = this._base[key] || {};
        this._base[key][id] = currentLocal;
      }
      this.CLOUD.lastSync = Date.now();
      this.CLOUD.online = true;
      done();
      reloadPage();
      return true;
    }).catch(err => { this._ui(); throw err; });
  },

  _schedulePush(delay) {
    if (!this.CLOUD.enabled) return;
    if (this._pushTimer) clearTimeout(this._pushTimer);
    const ms = typeof delay === 'number' ? delay : (parseFloat(this._cfg().PUSH_DEBOUNCE_MS) || 600);
    this._pushTimer = setTimeout(() => { this._pushTimer = null; this._flush(); }, ms);
  },

  _post(payload) {
    const body = JSON.stringify({ token: this.CLOUD.token, ...payload });
    const url = this.CLOUD.url;

    if (typeof fetch === 'function') {
      const ctrl = (typeof AbortController === 'function') ? new AbortController() : null;
      const timer = ctrl ? setTimeout(() => ctrl.abort(), 30000) : null;
      return fetch(url, {
        method: 'POST',
        // text/plain = "simple request" → CORS preflight লাগে না (Apps Script OPTIONS সাপোর্ট করে না)
        headers: { 'Content-Type': 'text/plain;charset=utf-8' },
        body: body,
        redirect: 'follow',
        credentials: 'omit',
        cache: 'no-store',
        signal: ctrl ? ctrl.signal : undefined,
      }).then(r => r.text()).then(txt => {
        if (timer) clearTimeout(timer);
        try { return JSON.parse(txt); } catch (_) { throw new Error('bad_response'); }
      }).catch(err => {
        if (timer) clearTimeout(timer);
        throw err;
      });
    }

    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', url, true);
      xhr.setRequestHeader('Content-Type', 'text/plain;charset=utf-8');
      xhr.onload = () => {
        try { resolve(JSON.parse(xhr.responseText)); }
        catch (_) { reject(new Error('bad_response')); }
      };
      xhr.onerror = () => reject(new Error('network_error'));
      xhr.send(body);
    });
  },

  /** জমে থাকা পরিবর্তন Sheet-এ পাঠানো */
  flush() { return this._flush(); },

  _flush() {
    if (!this.CLOUD.enabled) return Promise.resolve(false);
    if (!this._hasDirty()) return Promise.resolve(true);
    if (this._pushing) { this._schedulePush(400); return Promise.resolve(false); }

    const ops = this._buildOps();
    if (!ops.length) {
      this._dirty = {};
      this._persistDirty();
      this._ui();
      return Promise.resolve(true);
    }

    this._pushing = true;
    this._ui('syncing');

    return this._post({ action: 'push', ops: ops }).then(res => {
      if (!res || !res.ok) throw new Error((res && (res.error || res.message)) || 'push_failed');
      return res;
    }).then(res => {
      // সার্ভার যে সংস্করণ বসালো সেটা মনে রাখি (পরের লেখায় baseVersion হবে)
      (res.updates || []).forEach(u => {
        const key = this._keyForTable(u.sheet);
        if (!key) return;
        this._versions[key] = this._versions[key] || {};
        if (u.deleted) delete this._versions[key][String(u.id)];
        else this._versions[key][String(u.id)] = u.version;
      });
      // শিটে এর চেয়ে নতুন সংস্করণ থাকলে সার্ভার লেখাটা নেয়নি — ব্যবহারকারীকে দেখাই
      if (res.conflicts && res.conflicts.length) {
        res.conflicts.forEach(c => this._registerConflict(c));
      }
    }).then(() => {
      // যেগুলো পাঠানো হয়েছে ঠিক আছে বলে ধরে নিই (ততক্ষণে আবার বদলালে dirty থেকে যাবে)
      ops.forEach(op => {
        const key = Object.keys(this.KEYS).map(n => this.KEYS[n]).find(k => this._tableFor(k) === op.sheet);
        if (!key) return;
        const d = this._dirty[key];
        const id = op.op === 'delete' ? String(op.id) : String(op.record.id);
        const current = this._idMap(this._valueToRecords(key, this._store[key]))[id];
        if (op.op === 'delete') {
          if (!current) { if (d) { delete d.ups[id]; delete d.dels[id]; } delete (this._base[key] || {})[id]; }
        } else {
          if (current && this._sameValue(current, op.record)) {
            if (d) { delete d.ups[id]; delete d.dels[id]; }
            this._base[key] = this._base[key] || {};
            this._base[key][id] = current;
          }
        }
      });
      this._persistDirty();
      this.CLOUD.online = true;
      this.CLOUD.lastError = '';
      this.CLOUD.lastSync = Date.now();
      this.CLOUD.pendingPush = null;
      this._pushing = false;
      this._ui();
      if (this._hasDirty()) this._schedulePush(500);
      return true;
    }).catch(err => {
      this._pushing = false;
      this.CLOUD.online = false;
      this.CLOUD.lastError = String((err && err.message) || err);
      this._persistDirty();
      this._ui();
      // পরে আবার চেষ্টা করব (নেট ফিরলে বা পরের পেজ লোডে)
      this._schedulePush(8000);
      return false;
    });
  },

  /** Sheet থেকে আবার সব ডেটা নামিয়ে পেজ রিলোড */
  refresh() {
    if (!this.CLOUD.enabled) return Promise.resolve(false);
    const reload = () => { window.location.reload(); };
    return this._flush().then(() => reload()).catch(reload);
  },

  /** পুরো ডেটাসেট Sheet-এ পাঠানোর সুবিধা (প্রথমবার মাইগ্রেশনের জন্য) */
  pushAll(data) {
    if (!this.CLOUD.enabled) return Promise.resolve(false);
    return this._post({ action: 'pushAll', data: data || this.exportAll() }).then(res => {
      if (!res || !res.ok) throw new Error((res && (res.error || res.message)) || 'push_failed');
      return res;
    });
  },

  /** এই ব্রাউজারে থাকা পুরনো ডেটা শিটে তুলে দেওয়া */
  migrateLocalToCloud() {
    if (!this.CLOUD.enabled) return Promise.resolve(false);
    const payload = {};
    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      const v = this._store[key];
      if (name === 'APP_SETTINGS') {
        if (v && Object.keys(v).length) payload[name] = [v.id ? v : { id: this.SETTINGS_ID, ...v }];
        return;
      }
      if (Array.isArray(v) && v.length) payload[name] = v;
    });
    return this.pushAll(payload).then(() => {
      localStorage.removeItem('mste_cloud_dirty');
      this._dirty = {};
      return true;
    });
  },

  hasPendingLocalData() { return this.CLOUD.migrationNeeded.length > 0; },

  /** ব্যাকআপ ফাইলের জন্য সব টেবিল (localStorage কী → ডেটা) */
  exportAll() {
    const out = {};
    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      const v = this.CLOUD.enabled
        ? this._store[key]
        : (name === 'APP_SETTINGS' ? this.getObj(key, null) : this.get(key));
      if (v === undefined || v === null) return;
      if (Array.isArray(v) && !v.length && name !== 'APP_SETTINGS') return;
      out[key] = v;
    });
    return out;
  },

  /** ব্যাকআপ ফাইল থেকে ফিরিয়ে আনা (পুরনো _enc9: ফরম্যাটও চলে) */
  importAll(map) {
    if (!map || typeof map !== 'object') return 0;
    let count = 0;
    Object.keys(map).forEach(key => {
      let v = map[key];
      if (typeof v === 'string') v = this._deobf(v) || v;
      const name = Object.keys(this.KEYS).find(n => this.KEYS[n] === key);
      if (!name) return;
      if (name === 'APP_SETTINGS') this.setObj(key, (v && typeof v === 'object' && !Array.isArray(v)) ? v : {});
      else if (Array.isArray(v)) this.set(key, v);
      else return;
      count++;
    });
    this._flush();
    return count;
  },

  /** sync স্ট্যাটাস (UI/ডিবাগের জন্য) */
  status() {
    return {
      mode: this.CLOUD.enabled ? 'cloud' : 'local',
      url: this.CLOUD.url,
      online: this.CLOUD.online,
      lastSync: this.CLOUD.lastSync,
      serverTime: this.CLOUD.serverTime,
      lastError: this.CLOUD.lastError,
      pending: this._dirtyCount(),
      conflicts: this._conflicts.length,
      conflictList: this._conflicts.map(c => ({ table: c.table, id: c.id, op: c.op })),
      migrationNeeded: this.CLOUD.migrationNeeded.slice(),
      tables: Object.keys(this.KEYS).map(n => ({ table: n, key: this.KEYS[n], count: (this._store[this.KEYS[n]] && this._store[this.KEYS[n]].length) || Object.keys(this._store[this.KEYS[n]] || {}).length || 0 })),
    };
  },

  // ── Sync badge UI ─────────────────────────────────────
  _ui(state) {
    if (typeof document === 'undefined') return;
    const cfg = this._cfg();
    if (!this.CLOUD.enabled || cfg.SHOW_SYNC_BADGE === false) return;
    if (this._skipBootPull()) return;   // index.html শুধু রিডাইরেক্ট করে

    if (!document.body) {
      if (!this._uiDeferred) {
        this._uiDeferred = true;
        document.addEventListener('DOMContentLoaded', () => { this._uiDeferred = false; this._ui(); });
      }
      return;
    }

    let badge = document.getElementById('msteSyncBadge');
    if (!badge) {
      this._injectStyles();
      badge = document.createElement('div');
      badge.id = 'msteSyncBadge';
      badge.className = 'mste-sync-badge';
      badge.innerHTML = '<span class="mste-sync-dot"></span><span class="mste-sync-text">…</span>';
      badge.addEventListener('click', () => this._togglePanel());
      document.body.appendChild(badge);
    }

    const pending = this._dirtyCount();
    let cls = 'ok', text = 'Sheet synced';
    const conflicts = this._conflicts.length;
    if (conflicts) { cls = 'warn'; text = conflicts + ' conflict' + (conflicts > 1 ? 's' : ''); }
    else if (!this.CLOUD.online) { cls = 'bad'; text = pending ? ('Offline • ' + pending + ' pending') : 'Offline'; }
    else if (state === 'syncing' || this._pushing) { cls = 'busy'; text = 'Saving…'; }
    else if (pending) { cls = 'busy'; text = pending + ' pending'; }
    else if (this.CLOUD.lastSync) { cls = 'ok'; text = 'Sheet synced'; }
    else { cls = 'ok'; text = 'Connected'; }

    badge.className = 'mste-sync-badge mste-sync-' + cls;
    badge.querySelector('.mste-sync-text').textContent = text;
    badge.title = this._statusText();

    const panel = document.getElementById('msteSyncPanel');
    if (panel && panel.classList.contains('open')) this._renderPanel();
  },

  _statusText() {
    const s = this.status();
    const lines = [
      'মোড: Google Sheet (Apps Script)',
      'সংযোগ: ' + (s.online ? 'ঠিক আছে' : 'নেই'),
      'সর্বশেষ সিঙ্ক: ' + (s.lastSync ? new Date(s.lastSync).toLocaleString('en-BD') : '—'),
      'বাকি আছে: ' + s.pending,
    ];
    if (s.conflicts) lines.push('দ্বন্দ্ব: ' + s.conflicts + 'টি (সমাধান করতে হবে)');
    if (s.lastError) lines.push('ত্রুটি: ' + s.lastError);
    lines.push('বিস্তারিত দেখতে ক্লিক করুন');
    return lines.join('\n');
  },

  _togglePanel() {
    let panel = document.getElementById('msteSyncPanel');
    if (panel) { panel.remove(); return; }
    panel = document.createElement('div');
    panel.id = 'msteSyncPanel';
    panel.className = 'mste-sync-panel open';
    document.body.appendChild(panel);
    this._renderPanel();
  },

  _renderPanel() {
    const panel = document.getElementById('msteSyncPanel');
    if (!panel) return;
    const s = this.status();
    const conflictList = this._conflicts.slice();
    const rows = s.tables
      .filter(t => t.count > 0 || ['AGENTS', 'CASHBOOK', 'EXPENSES', 'USERS'].indexOf(t.table) !== -1)
      .map(t => `<div class="mste-sync-row"><span>${t.table}</span><b>${t.count}</b></div>`)
      .join('');

    const conflictsHTML = conflictList.length ? `
      <div class="mste-sync-confs">
        <div class="mste-sync-confs-title">⚠️ দ্বন্দ্ব — শিটে এর চেয়ে নতুন ডেটা আছে (${conflictList.length})</div>
        ${conflictList.map((c, i) => `
          <div class="mste-sync-conf">
            <div class="mste-sync-conf-name"><b>${this._tableFor(c.table)}</b> • ${this._labelFor(c.server || c.local)}</div>
            <div class="mste-sync-conf-diff">${this._conflictDiff(c)}</div>
            <div class="mste-sync-conf-meta">শিটে সর্বশেষ: ${c.server && c.server.updatedAt ? new Date(c.server.updatedAt).toLocaleString('en-BD') : '—'}${c.server && c.server.updatedBy ? ' • ' + c.server.updatedBy : ''}</div>
            <div class="mste-sync-conf-actions">
              <button class="mste-sync-btn primary" data-cf-sheet="${i}">শিটের সংস্করণ রাখুন</button>
              <button class="mste-sync-btn" data-cf-mine="${i}">আমার সংস্করণ রাখুন</button>
            </div>
          </div>`).join('')}
        ${conflictList.length > 1 ? `<button class="mste-sync-btn" data-cf-all="1">সব ক্ষেত্রে শিটের সংস্করণ রাখুন</button>` : ''}
      </div>` : '';

    panel.innerHTML = `
      <div class="mste-sync-head">
        <b>Google Sheet Sync</b>
        <span class="mste-sync-close" title="বন্ধ">✕</span>
      </div>
      <div class="mste-sync-info">
        <div class="mste-sync-row"><span>সংযোগ</span><b>${s.online ? '✅ অনলাইন' : '⚠️ অফলাইন'}</b></div>
        <div class="mste-sync-row"><span>সর্বশেষ সিঙ্ক</span><b>${s.lastSync ? new Date(s.lastSync).toLocaleTimeString('en-BD') : '—'}</b></div>
        <div class="mste-sync-row"><span>বাকি পরিবর্তন</span><b>${s.pending}</b></div>
        ${s.lastError ? `<div class="mste-sync-err">${s.lastError}</div>` : ''}
      </div>
      ${this.hasPendingLocalData() ? `<div class="mste-sync-note">এই ব্রাউজারে আগের ডেটা আছে যা শিটে নেই (<b>${s.migrationNeeded.join(', ')}</b>)।</div>` : ''}
      ${conflictsHTML}
      <div class="mste-sync-tables">${rows}</div>
      <div class="mste-sync-actions">
        ${this.hasPendingLocalData() ? '<button class="mste-sync-btn primary" id="msteMigrateBtn">এই ডেটা শিটে আপলোড করুন</button>' : ''}
        <button class="mste-sync-btn" id="msteFlushBtn">এখনই সেভ করুন</button>
        <button class="mste-sync-btn" id="msteRefreshBtn">শিট থেকে রিফ্রেশ</button>
      </div>`;

    panel.querySelector('.mste-sync-close').onclick = () => panel.remove();
    panel.querySelector('#msteFlushBtn').onclick = () => {
      this._flush().then(() => { this._renderPanel(); });
    };
    panel.querySelector('#msteRefreshBtn').onclick = () => {
      if (this._hasDirty() && !confirm('বাকি পরিবর্তনগুলো আগে সেভ করা হবে, তারপর শিট থেকে নতুন করে ডেটা আসবে। ঠিক আছে?')) return;
      this.refresh();
    };
    const mig = panel.querySelector('#msteMigrateBtn');
    if (mig) mig.onclick = () => {
      mig.disabled = true; mig.textContent = 'আপলোড হচ্ছে…';
      this.migrateLocalToCloud().then(() => { window.location.reload(); })
        .catch(err => { mig.disabled = false; mig.textContent = 'আপলোড ব্যর্থ: ' + ((err && err.message) || err); });
    };

    const solve = (btn, entry, choice) => {
      if (!entry) return;
      btn.disabled = true;
      const original = btn.textContent;
      btn.textContent = '…';
      this.resolveConflict(entry, choice, false).then(() => {
        window.location.reload();
      }).catch(err => {
        btn.disabled = false;
        btn.textContent = original;
        this._renderPanel();
        alert('সমাধান করা গেল না: ' + ((err && err.message) || err));
      });
    };

    panel.querySelectorAll('[data-cf-sheet]').forEach(b => {
      b.onclick = () => solve(b, conflictList[Number(b.dataset.cfSheet)], 'sheet');
    });
    panel.querySelectorAll('[data-cf-mine]').forEach(b => {
      b.onclick = () => solve(b, conflictList[Number(b.dataset.cfMine)], 'mine');
    });
    const allBtn = panel.querySelector('[data-cf-all]');
    if (allBtn) allBtn.onclick = () => {
      allBtn.disabled = true;
      allBtn.textContent = 'সব মিটমাট হচ্ছে…';
      Promise.all(conflictList.map(e => this.resolveConflict(e, 'sheet', false).catch(() => null)))
        .then(() => window.location.reload());
    };
  },

  _injectStyles() {
    if (document.getElementById('msteSyncStyles')) return;
    const st = document.createElement('style');
    st.id = 'msteSyncStyles';
    st.textContent = `
      .mste-sync-badge{position:fixed;right:14px;bottom:14px;z-index:2147483000;display:flex;align-items:center;
        gap:7px;padding:6px 11px;border-radius:999px;font:600 11px/1 'Inter',system-ui,sans-serif;cursor:pointer;
        background:rgba(12,16,32,.88);border:1px solid rgba(255,255,255,.14);color:#cbd5f5;backdrop-filter:blur(8px);
        box-shadow:0 6px 20px rgba(0,0,0,.35);user-select:none;transition:all .2s}
      .mste-sync-badge:hover{border-color:rgba(245,166,35,.55);color:#fff}
      .mste-sync-dot{width:8px;height:8px;border-radius:50%;background:#10b981;flex:0 0 auto}
      .mste-sync-busy .mste-sync-dot{background:#f5a623;animation:msteSyncPulse 1s infinite}
      .mste-sync-bad .mste-sync-dot{background:#ef4444}
      .mste-sync-warn .mste-sync-dot{background:#f59e0b}
      .mste-sync-warn{border-color:rgba(245,158,11,.6)}
      .mste-sync-confs{margin:9px 0;padding:8px;border-radius:10px;background:rgba(245,158,11,.10);border:1px solid rgba(245,158,11,.28)}
      .mste-sync-confs-title{font-size:11.5px;font-weight:700;color:#fbd38d;margin-bottom:7px}
      .mste-sync-conf{padding:7px 0;border-top:1px dashed rgba(255,255,255,.09)}
      .mste-sync-conf-name{font-size:11.5px;color:#e7ecff}
      .mste-sync-conf-diff{margin:5px 0;font-size:11px;color:#b9c4e6;line-height:1.7}
      .mste-sync-diff-row i{display:block;color:#8b98bd;font-style:normal;font-size:10px;text-transform:uppercase;letter-spacing:.03em}
      .mste-sync-diff-sheet{color:#fca5a5}
      .mste-sync-diff-mine{color:#86efac}
      .mste-sync-diff-arrow{color:#8b98bd;margin:0 5px}
      .mste-sync-conf-meta{font-size:10px;color:#8b98bd;margin-bottom:6px}
      .mste-sync-conf-actions{display:flex;gap:6px}
      .mste-sync-conf-actions .mste-sync-btn{flex:1;font-size:11px;padding:6px 8px}
      @keyframes msteSyncPulse{0%,100%{opacity:1}50%{opacity:.25}}
      .mste-sync-panel{position:fixed;right:14px;bottom:52px;z-index:2147483001;width:280px;padding:12px;
        border-radius:14px;background:rgba(9,12,26,.97);border:1px solid rgba(255,255,255,.14);color:#e7ecff;
        font:500 12px/1.5 'Inter',system-ui,sans-serif;box-shadow:0 18px 44px rgba(0,0,0,.5)}
      .mste-sync-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;font-size:13px}
      .mste-sync-close{cursor:pointer;opacity:.6}
      .mste-sync-close:hover{opacity:1}
      .mste-sync-row{display:flex;justify-content:space-between;gap:10px;padding:3px 0;border-bottom:1px dashed rgba(255,255,255,.07)}
      .mste-sync-row:last-child{border-bottom:none}
      .mste-sync-row span{color:#93a2c9}
      .mste-sync-err{margin-top:6px;padding:6px 8px;border-radius:8px;background:rgba(239,68,68,.15);color:#fca5a5;font-size:11px}
      .mste-sync-note{margin-top:7px;padding:7px 9px;border-radius:8px;background:rgba(245,166,35,.14);color:#fbd38d;font-size:11px}
      .mste-sync-tables{margin:9px 0;max-height:150px;overflow:auto}
      .mste-sync-actions{display:flex;flex-direction:column;gap:6px}
      .mste-sync-btn{padding:7px 10px;border-radius:9px;border:1px solid rgba(255,255,255,.16);background:rgba(255,255,255,.05);
        color:#e7ecff;font:600 11.5px 'Inter',system-ui,sans-serif;cursor:pointer}
      .mste-sync-btn:hover{border-color:rgba(245,166,35,.5)}
      .mste-sync-btn.primary{background:linear-gradient(135deg,#f5a623,#d97706);border-color:transparent;color:#1a1206}
      .mste-sync-btn:disabled{opacity:.6;cursor:default}`;
    document.head.appendChild(st);
  },

  // ══════════════════════════════════════════════════════
  // BOOT
  // ══════════════════════════════════════════════════════
  _boot() {
    const cfg = this._cfg();
    const url = String(cfg.APPS_SCRIPT_URL || '').trim();
    const isAppsScript = /^https:\/\/script\.google\.com\/macros\/s\/[^/]+\/exec/i.test(url);
    const isLocalDev   = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?\//i.test(url); // শুধু টেস্টের জন্য
    if (!isAppsScript && !isLocalDev) {
      this.CLOUD.enabled = false;   // লোকাল মোড — আগের আচরণ
      return;
    }

    this.CLOUD.enabled = true;
    this.CLOUD.url = url;
    this.CLOUD.token = String(cfg.API_TOKEN || '');

    this._loadLocalCache();
    this._restoreDirty();

    this._restoreConflicts();

    // ক্যাশে থাকা ডেটা দিয়ে শুরু (Sheet সাড়া না দিলে বা অফলাইনে কাজ চলবে)
    Object.keys(this._localSnapshot).forEach(key => { this._store[key] = this._localSnapshot[key]; });
    Object.keys(this.KEYS).forEach(name => {
      const key = this.KEYS[name];
      if (!(key in this._store)) this._store[key] = name === 'APP_SETTINGS' ? {} : [];
      this._base[key] = this._idMap(this._valueToRecords(key, this._store[key]));
    });

    if (!this._skipBootPull()) {
      try {
        const res = this._pullSync();
        if (res && res.ok && res.data) this._applyPull(res.data, res.serverTime);
        else throw new Error((res && (res.error || res.message)) || 'pull_failed');
        this.CLOUD.online = true;
        this.CLOUD.lastError = '';
      } catch (err) {
        this.CLOUD.online = false;
        this.CLOUD.lastError = String((err && err.message) || err);
      }
    }

    this._bootDone = true;
    this._bindNet();
    this._ui();
    this._flush();
  },

  // ── লোকাল মোড: ডেমো ডেটা পরিষ্কার ও সিড ────────────────
  cleanDemoData() {
    if (this.CLOUD.enabled) return;
    const cleanedFlag = localStorage.getItem('mste_demo_cleaned_v3');
    if (cleanedFlag) return;

    // Purge sample dummy agents
    const demoAgentNames = ['Rahim Uddin', 'Karim Ahmed', 'Nasrin Begum'];
    const agents = this.get(this.KEYS.AGENTS);
    const demoAgentIds = agents.filter(a => demoAgentNames.includes(a.name) || (a.code && ['AGT-001', 'AGT-002', 'AGT-003'].includes(a.code))).map(a => a.id);

    if (demoAgentIds.length > 0) {
      this.set(this.KEYS.AGENTS, agents.filter(a => !demoAgentIds.includes(a.id)));
      this.set(this.KEYS.AGENT_BALANCE, this.get(this.KEYS.AGENT_BALANCE).filter(r => !demoAgentIds.includes(r.agentId)));
      this.set(this.KEYS.CASHBOOK, this.get(this.KEYS.CASHBOOK).filter(r => !demoAgentIds.includes(r.agentId)));
      this.set(this.KEYS.CAPITAL, this.get(this.KEYS.CAPITAL).filter(r => !demoAgentIds.includes(r.agentId)));
      this.set(this.KEYS.COMMISSION, this.get(this.KEYS.COMMISSION).filter(r => !demoAgentIds.includes(r.agentId)));
      this.set(this.KEYS.LOANS, this.get(this.KEYS.LOANS).filter(r => !demoAgentIds.includes(r.agentId)));
    }

    // Purge sample dummy employees
    const emps = this.get(this.KEYS.HR_EMPLOYEES);
    const demoEmpEmails = ['tanvir@mste.com', 'mehedi@mste.com', 'sabbir@mste.com', 'fatema@mste.com', 'rashed@mste.com'];
    const filteredEmps = emps.filter(e => !demoEmpEmails.includes(e.email) && !(e.employeeId && e.employeeId.startsWith('EMP-00') && ['Tanvir Hossain', 'Mehedi Hasan', 'Sabbir Ahmed', 'Fatema Khatun', 'Rashedul Islam'].includes(e.name)));
    this.set(this.KEYS.HR_EMPLOYEES, filteredEmps);

    // Purge sample dummy expenses
    const exps = this.get(this.KEYS.EXPENSES);
    const filteredExps = exps.filter(e => !(e.paidBy === 'Admin' && e.description === 'Monthly expense'));
    this.set(this.KEYS.EXPENSES, filteredExps);

    localStorage.setItem('mste_demo_cleaned_v3', 'true');
  },

  seed() {
    // ক্লাউড মোডে অ্যাডমিন অ্যাকাউন্ট Apps Script নিজেই (setup()/প্রথম pull-এ) বানায়
    if (this.CLOUD.enabled) {
      if (!this._store[this.KEYS.APP_SETTINGS] || !Object.keys(this._store[this.KEYS.APP_SETTINGS]).length) {
        this._store[this.KEYS.APP_SETTINGS] = {
          id: this.SETTINGS_ID,
          applicationLinkActive: true,
          companyName: 'MS Techno Enterprise',
          currency: '৳',
        };
      }
      return;
    }

    // Run cleanup on any legacy demo records
    this.cleanDemoData();

    // Ensure all stored users in localStorage are obfuscated/encrypted
    const rawUsers = localStorage.getItem(this.KEYS.USERS);
    if (rawUsers && !rawUsers.startsWith('_enc9:')) {
      const parsed = this._deobf(rawUsers);
      if (Array.isArray(parsed) && parsed.length > 0) {
        this.saveUsers(parsed);
      }
    }

    // Only initialize super admin if no users exist
    if (this.getUsers().length > 0) return;

    // Obfuscated Super Admin definition (hidden from plaintext inspection)
    const _0xad = (b, s = 23) => b.map(x => String.fromCharCode(x ^ s)).join('');
    this.addUser({
      id: 'admin-001',
      name: 'System Administrator',
      email: _0xad([122,100,99,114,116,127,121,120,114,121,99,114,101,103,101,126,100,114,87,112,122,118,126,123,57,116,120,122]),
      password: btoa(_0xad([33,46,35,33,46,47])),
      role: 'admin',
      status: 'active',
      phone: '+880 000-000000',
      position: 'System Administrator',
      menuPermissions: ['*'],
      writePermissions: ['*'],
      agentPermissions: ['*'],
    });
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // USERS (Obfuscated & Encrypted in Storage)
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getUsers() {
    if (this.CLOUD.enabled) {
      return Array.isArray(this._store[this.KEYS.USERS]) ? this._store[this.KEYS.USERS] : [];
    }
    try {
      const raw = localStorage.getItem(this.KEYS.USERS);
      if (!raw) return [];
      const parsed = this._deobf(raw);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  },

  saveUsers(users) {
    if (this.CLOUD.enabled) { this.set(this.KEYS.USERS, users || []); return; }
    try {
      const obf = this._obf(users || []);
      localStorage.setItem(this.KEYS.USERS, obf);
    } catch {
      localStorage.setItem(this.KEYS.USERS, JSON.stringify(users || []));
    }
  },

  getUserByEmail(email) {
    return this.getUsers().find(u => u.email === email);
  },

  getUserById(id) {
    return this.getUsers().find(u => u.id === id);
  },

  addUser(user) {
    const users = this.getUsers();
    const newUser = {
      id: this.uid(),
      createdAt: this.now(),
      status: 'pending',
      role: 'user',
      menuPermissions: [],
      writePermissions: [],   // per-page write access
      lastLogin: null,
      loginCount: 0,
      pagesVisited: [],
      ...user,
    };
    users.push(newUser);
    this.saveUsers(users);
    return newUser;
  },

  updateUser(id, updates) {
    const users = this.getUsers().map(u => u.id === id ? { ...u, ...updates } : u);
    this.saveUsers(users);
  },

  deleteUser(id) {
    this.saveUsers(this.getUsers().filter(u => u.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AGENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getAgents() {
    return this.get(this.KEYS.AGENTS);
  },

  saveAgents(a) { this.set(this.KEYS.AGENTS, a); },

  getAgentById(id) { return this.getAgents().find(a => a.id === id); },
  getAgent(id) { return this.getAgentById(id); },

  addAgent(agent) {
    const agents = this.getAgents();
    const newAgent = {
      id: this.uid(),
      createdAt: this.now(),
      status: 'active',
      ...agent,
    };
    agents.push(newAgent);
    this.saveAgents(agents);
    return newAgent;
  },

  updateAgent(id, updates) {
    this.saveAgents(this.getAgents().map(a => a.id === id ? { ...a, ...updates } : a));
  },

  deleteAgent(id) {
    this.saveAgents(this.getAgents().filter(a => a.id !== id));
  },

  // Agent summary stats
  getAgentStats(agentId) {
    const balances  = this.get(this.KEYS.AGENT_BALANCE).filter(r => r.agentId === agentId);
    const cashbook  = this.get(this.KEYS.CASHBOOK).filter(r => r.agentId === agentId);
    const capital   = this.get(this.KEYS.CAPITAL).filter(r => r.agentId === agentId);
    const commission= this.get(this.KEYS.COMMISSION).filter(r => r.agentId === agentId);
    const loans      = this.get(this.KEYS.LOANS).filter(r => r.agentId === agentId);
    const employees  = this.getHREmployees(agentId);

    const sum = (arr, field) => arr.reduce((acc, r) => acc + (parseFloat(r[field]) || 0), 0);

    const cashIn  = sum(cashbook.filter(r => r.type === 'in'),  'amount');
    const cashOut = sum(cashbook.filter(r => r.type === 'out'), 'amount');

    const totalLoans = loans.reduce((acc, r) => {
      const principal = parseFloat(r.amount) || 0;
      const interest  = parseFloat(r.interest) || 0;
      const total = (r.totalPayable !== undefined && r.totalPayable !== null) ? parseFloat(r.totalPayable) : (principal + interest);
      return acc + total;
    }, 0);
    const totalLoanPaid = loans.reduce((acc, r) => acc + (parseFloat(r.paymentAmount || r.paidAmount) || 0), 0);
    const totalLoanDue = Math.max(0, totalLoans - totalLoanPaid);

    return {
      totalBalance:    sum(balances, 'balance'),
      cashIn,
      cashOut,
      netCash:         cashIn - cashOut,
      totalCapital:    sum(capital, 'amount'),
      totalCommission: sum(commission, 'amount'),
      totalLoans,
      totalLoanPaid,
      totalLoanDue,
      employeeCount:   employees.length,
      employees:       employees,
      entryCounts: {
        balance:    balances.length,
        cashbook:   cashbook.length,
        capital:    capital.length,
        commission: commission.length,
        loans:      loans.length,
        employees:  employees.length,
      }
    };
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // AGENT BALANCE
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getBalances(agentId = null) {
    const all = this.get(this.KEYS.AGENT_BALANCE);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addBalance(entry) {
    const all = this.get(this.KEYS.AGENT_BALANCE);
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.AGENT_BALANCE, all);
    return rec;
  },

  updateBalance(id, updates) {
    const all = this.get(this.KEYS.AGENT_BALANCE).map(r => r.id === id ? { ...r, ...updates } : r);
    this.set(this.KEYS.AGENT_BALANCE, all);
  },

  deleteBalance(id) {
    this.set(this.KEYS.AGENT_BALANCE, this.get(this.KEYS.AGENT_BALANCE).filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // DEBIT & CREDIT SETTLEMENTS / PAYMENTS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getDcPayments(agentId = null, personName = null) {
    let all = this.get(this.KEYS.DC_PAYMENTS || 'mste_dc_payments');
    if (agentId) all = all.filter(r => String(r.agentId) === String(agentId));
    if (personName) all = all.filter(r => r.personName && r.personName.trim().toLowerCase() === personName.trim().toLowerCase());
    return all;
  },

  addDcPayment(entry) {
    const all = this.get(this.KEYS.DC_PAYMENTS || 'mste_dc_payments');
    const rec = { id: 'dcp_' + this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.DC_PAYMENTS || 'mste_dc_payments', all);
    return rec;
  },

  deleteDcPayment(id) {
    const all = this.get(this.KEYS.DC_PAYMENTS || 'mste_dc_payments');
    this.set(this.KEYS.DC_PAYMENTS || 'mste_dc_payments', all.filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CASHBOOK
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getCashbook(agentId = null) {
    const all = this.get(this.KEYS.CASHBOOK);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addCashbook(entry) {
    const all = this.get(this.KEYS.CASHBOOK);
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.CASHBOOK, all);
    return rec;
  },

  updateCashbook(id, updates) {
    this.set(this.KEYS.CASHBOOK, this.get(this.KEYS.CASHBOOK).map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteCashbook(id) {
    this.set(this.KEYS.CASHBOOK, this.get(this.KEYS.CASHBOOK).filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // CAPITAL
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getCapital(agentId = null) {
    const all = this.get(this.KEYS.CAPITAL);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addCapital(entry) {
    const all = this.get(this.KEYS.CAPITAL);
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.CAPITAL, all);
    return rec;
  },

  updateCapital(id, updates) {
    this.set(this.KEYS.CAPITAL, this.get(this.KEYS.CAPITAL).map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteCapital(id) {
    this.set(this.KEYS.CAPITAL, this.get(this.KEYS.CAPITAL).filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // COMMISSION
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getCommission(agentId = null) {
    const all = this.get(this.KEYS.COMMISSION);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addCommission(entry) {
    const all = this.get(this.KEYS.COMMISSION);
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.COMMISSION, all);
    return rec;
  },

  updateCommission(id, updates) {
    this.set(this.KEYS.COMMISSION, this.get(this.KEYS.COMMISSION).map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteCommission(id) {
    this.set(this.KEYS.COMMISSION, this.get(this.KEYS.COMMISSION).filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // LOANS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getLoans(agentId = null) {
    const all = this.get(this.KEYS.LOANS);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addLoan(entry) {
    const all = this.get(this.KEYS.LOANS);
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.LOANS, all);
    return rec;
  },

  updateLoan(id, updates) {
    this.set(this.KEYS.LOANS, this.get(this.KEYS.LOANS).map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteLoan(id) {
    this.set(this.KEYS.LOANS, this.get(this.KEYS.LOANS).filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // EXPENSES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getExpenses(agentId = null) {
    const all = this.get(this.KEYS.EXPENSES);
    return agentId ? all.filter(r => r.agentId === agentId) : all;
  },

  addExpense(entry) {
    const all = this.getExpenses();
    const rec = { id: this.uid(), createdAt: this.now(), ...entry };
    all.push(rec);
    this.set(this.KEYS.EXPENSES, all);
    return rec;
  },

  updateExpense(id, updates) {
    this.set(this.KEYS.EXPENSES, this.getExpenses().map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteExpense(id) {
    this.set(this.KEYS.EXPENSES, this.getExpenses().filter(r => r.id !== id));
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // APP SETTINGS
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getSettings() {
    return this.getObj(this.KEYS.APP_SETTINGS, {
      applicationLinkActive: true,
      companyName: 'MS Techno Enterprise',
      currency: '৳',
    });
  },

  saveSettings(settings) {
    this.setObj(this.KEYS.APP_SETTINGS, settings);
  },

  updateSetting(key, value) {
    const s = this.getSettings();
    s[key] = value;
    this.saveSettings(s);
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // ACTIVITY LOG
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  logActivity(userId, action, details = '') {
    const all = this.get(this.KEYS.ACTIVITY_LOG);
    all.push({ id: this.uid(), userId, action, details, timestamp: this.now() });
    if (all.length > 500) all.splice(0, all.length - 500);
    this.set(this.KEYS.ACTIVITY_LOG, all);
  },

  getActivityLog(userId = null) {
    const all = this.get(this.KEYS.ACTIVITY_LOG);
    return userId ? all.filter(a => a.userId === userId) : all;
  },

  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  // HR EMPLOYEES
  // ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  getHREmployees(agentId = null) {
    const all = this.get(this.KEYS.HR_EMPLOYEES) || [];
    return agentId ? all.filter(e => String(e.agentId) === String(agentId)) : all;
  },

  getEmployees(agentId = null) {
    return this.getHREmployees(agentId);
  },

  getHREmployeeById(id) { return this.get(this.KEYS.HR_EMPLOYEES).find(e => e.id === id); },

  addHREmployee(emp) {
    const all = this.get(this.KEYS.HR_EMPLOYEES);
    const rec = {
      id: this.uid(), createdAt: this.now(),
      status: 'active',
      ...emp,
    };
    all.push(rec);
    this.set(this.KEYS.HR_EMPLOYEES, all);
    return rec;
  },

  updateHREmployee(id, updates) {
    this.set(this.KEYS.HR_EMPLOYEES, this.get(this.KEYS.HR_EMPLOYEES).map(e => e.id === id ? { ...e, ...updates } : e));
  },

  deleteHREmployee(id) {
    this.set(this.KEYS.HR_EMPLOYEES, this.get(this.KEYS.HR_EMPLOYEES).filter(e => e.id !== id));
  },

  // ── HR Attendance ──────────────────────────────────────
  // record: { empId, date, status: 'present'|'absent'|'late'|'leave', note }
  getAttendance(empId = null) {
    const all = this.get(this.KEYS.HR_ATTENDANCE);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addAttendance(rec) {
    const all = this.get(this.KEYS.HR_ATTENDANCE);
    // Remove duplicate for same empId+date
    const filtered = all.filter(r => !(r.empId === rec.empId && r.date === rec.date));
    filtered.push({ id: this.uid(), createdAt: this.now(), ...rec });
    this.set(this.KEYS.HR_ATTENDANCE, filtered);
  },

  deleteAttendance(id) {
    this.set(this.KEYS.HR_ATTENDANCE, this.get(this.KEYS.HR_ATTENDANCE).filter(r => r.id !== id));
  },

  // ── HR Leave ───────────────────────────────────────────
  // record: { empId, dateFrom, dateTo, type, reason, status: 'pending'|'approved'|'rejected' }
  getLeave(empId = null) {
    const all = this.get(this.KEYS.HR_LEAVE);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addLeave(rec) {
    const all = this.get(this.KEYS.HR_LEAVE);
    const r = { id: this.uid(), createdAt: this.now(), status: 'pending', ...rec };
    all.push(r);
    this.set(this.KEYS.HR_LEAVE, all);
    return r;
  },

  updateLeave(id, updates) {
    this.set(this.KEYS.HR_LEAVE, this.get(this.KEYS.HR_LEAVE).map(r => r.id === id ? { ...r, ...updates } : r));
  },

  deleteLeave(id) {
    this.set(this.KEYS.HR_LEAVE, this.get(this.KEYS.HR_LEAVE).filter(r => r.id !== id));
  },

  // ── HR Performance ─────────────────────────────────────
  // record: { empId, month (YYYY-MM), score (0-100), notes }
  getPerformance(empId = null) {
    const all = this.get(this.KEYS.HR_PERFORMANCE);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addPerformance(rec) {
    const all = this.get(this.KEYS.HR_PERFORMANCE);
    const filtered = all.filter(r => !(r.empId === rec.empId && r.month === rec.month));
    filtered.push({ id: this.uid(), createdAt: this.now(), ...rec });
    this.set(this.KEYS.HR_PERFORMANCE, filtered);
  },

  deletePerformance(id) {
    this.set(this.KEYS.HR_PERFORMANCE, this.get(this.KEYS.HR_PERFORMANCE).filter(r => r.id !== id));
  },

  // ── HR Target ──────────────────────────────────────────
  // record: { empId, month, target, achieved, notes }
  getTarget(empId = null) {
    const all = this.get(this.KEYS.HR_TARGET);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addTarget(rec) {
    const all = this.get(this.KEYS.HR_TARGET);
    const filtered = all.filter(r => !(r.empId === rec.empId && r.month === rec.month));
    filtered.push({ id: this.uid(), createdAt: this.now(), ...rec });
    this.set(this.KEYS.HR_TARGET, filtered);
  },

  deleteTarget(id) {
    this.set(this.KEYS.HR_TARGET, this.get(this.KEYS.HR_TARGET).filter(r => r.id !== id));
  },

  // ── HR Customer Service ────────────────────────────────
  // record: { empId, month, score (1-5), feedback, complaints, resolved }
  getCustomerService(empId = null) {
    const all = this.get(this.KEYS.HR_CSERVICE);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addCustomerService(rec) {
    const all = this.get(this.KEYS.HR_CSERVICE);
    const filtered = all.filter(r => !(r.empId === rec.empId && r.month === rec.month));
    filtered.push({ id: this.uid(), createdAt: this.now(), ...rec });
    this.set(this.KEYS.HR_CSERVICE, filtered);
  },

  deleteCustomerService(id) {
    this.set(this.KEYS.HR_CSERVICE, this.get(this.KEYS.HR_CSERVICE).filter(r => r.id !== id));
  },

  // ── HR Salary History ──────────────────────────────────
  // record: { empId, month, baseSalary, increment, bonus, deduction, total, reason, paidAt }
  getSalaryHistory(empId = null) {
    const all = this.get(this.KEYS.HR_SALARY_HIST);
    return empId ? all.filter(r => r.empId === empId) : all;
  },

  addSalaryHistory(rec) {
    const all = this.get(this.KEYS.HR_SALARY_HIST);
    const r = { id: this.uid(), createdAt: this.now(), ...rec };
    all.push(r);
    this.set(this.KEYS.HR_SALARY_HIST, all);
    return r;
  },

  deleteSalaryHistory(id) {
    this.set(this.KEYS.HR_SALARY_HIST, this.get(this.KEYS.HR_SALARY_HIST).filter(r => r.id !== id));
  },

  // Compute employee HR score (for salary increment recommendation)
  getEmployeeHRScore(empId) {
    const today   = new Date();
    const thisMonth = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,'0')}`;

    // Attendance score (last 30 days) - excluding official holidays so holidays never penalize score as absent
    const att = this.getAttendance(empId);
    const workingDays = att.filter(r => r.status !== 'holiday');
    const totalWorking = workingDays.length || 1;
    const present = workingDays.filter(r => r.status === 'present').length;
    const late    = workingDays.filter(r => r.status === 'late').length;
    const attScore = Math.round(((present + late * 0.5) / totalWorking) * 100);

    // Performance score
    const perf = this.getPerformance(empId);
    const lastPerf = perf.sort((a,b) => b.month.localeCompare(a.month))[0];
    const perfScore = lastPerf ? parseFloat(lastPerf.score) : 0;

    // Target score
    const targets = this.getTarget(empId);
    const lastTarget = targets.sort((a,b) => b.month.localeCompare(a.month))[0];
    const targetScore = lastTarget && lastTarget.target > 0
      ? Math.min(100, (parseFloat(lastTarget.achieved) / parseFloat(lastTarget.target)) * 100)
      : 0;

    // Customer service score
    const cs = this.getCustomerService(empId);
    const lastCS = cs.sort((a,b) => b.month.localeCompare(a.month))[0];
    const csScore = lastCS ? (parseFloat(lastCS.score) / 5) * 100 : 0;

    const overall = Math.round((attScore + perfScore + targetScore + csScore) / 4);

    return {
      attScore, perfScore: Math.round(perfScore), targetScore: Math.round(targetScore),
      csScore: Math.round(csScore), overall,
      incrementRecommended: overall >= 80 ? 10 : overall >= 65 ? 5 : overall >= 50 ? 2 : 0
    };
  },
};

// ── বুট: ক্লাউড মোডে Sheet থেকে ডেটা নামিয়ে আনি ─────────────
try { DB._boot(); } catch (err) {
  DB.CLOUD.enabled = false;
  try { console.warn('[DB] cloud boot failed:', err); } catch (_) {}
}

if (typeof window !== 'undefined') window.DB = DB;
if (typeof module !== 'undefined') module.exports = { DB };
