/**
 * ═══════════════════════════════════════════════════════════════════════════
 *  TE & NTE Enterprise — Google Sheets Backend (Apps Script Web App)
 * ═══════════════════════════════════════════════════════════════════════════
 *
 *  এই স্ক্রিপ্টটি Google Sheet-কে অ্যাপের ডেটাবেজ বানায়। ওয়েব অ্যাপের
 *  HTML/JS ফাইলগুলো doGet/doPost দিয়ে JSON আকারে ডেটা আনে ও পাঠায়।
 *
 *  সেটআপ:
 *   1. একটা Google Sheet খুলুন → Extensions → Apps Script
 *   2. এই ফাইলের পুরো কোড পেস্ট করে Save করুন
 *   3. উপরের CONFIG.API_TOKEN এ একটা নিজের গোপন স্ট্রিং বসান
 *   4. (ঐচ্ছিক) CONFIG.SPREADSHEET_ID খালি রাখলে যে শিটে স్క্রিপ্ট পেস্ট করেছেন
 *      সেটাই ব্যবহার হবে; অন্য শিট ব্যবহার করতে চাইলে তার ID বসান।
 *   5. একবার setup() ফাংশন Run করুন — ট্যাব, হেডার আর ডিফল্ট অ্যাডমিন তৈরি হবে
 *   6. Deploy → New deployment → Web app
 *        Execute as : Me
 *        Who has access : Anyone
 *      → Deploy করে Web app URL কপি করুন → js/config.js এর APPS_SCRIPT_URL এ বসান
 *
 *  API:
 *   GET  .../exec?action=ping&token=XYZ
 *   GET  .../exec?action=pull&token=XYZ
 *   POST .../exec            body(JSON) = {token, action:'push', ops:[...]}
 *
 *   op → { sheet:'AGENTS', op:'upsert', record:{...}, baseVersion:2, updatedBy:'...' }
 *        { sheet:'AGENTS', op:'delete', id:'...',     baseVersion:2, updatedBy:'...' }
 *
 *  প্রতিটি ট্যাবে ১ম সারি = হেডার (কলামের নাম)। ডেটা ম্যানুয়ালি Sheet-এ
 *  এডিট করলেও অ্যাপে সেটা ধরা পড়বে — শুধু 'id' কলামটা বদলাবেন না।
 *
 *  ── দ্বন্দ্ব (conflict) সুরক্ষা ─────────────────────────────────────
 *  প্রতি রেকর্ডে তিনটি মেটা কলাম থাকে:
 *      version    : প্রতি সফল পরিবর্তনে ১ করে বাড়ে (সার্ভারই ঠিক করে)
 *      updatedAt  : সর্বশেষ পরিবর্তনের সময়
 *      updatedBy  : কে বদলালো
 *  ক্লায়েন্ট যে সংস্করণ পড়ে editing শুরু করেছিল সেটা `baseVersion` হিসেবে
 *  পাঠায়। শিটে তার চেয়ে নতুন সংস্করণ থাকলে সার্ভার লেখাটা **গ্রহণ করে না**
 *  এবং response এ শিটের সর্বশেষ রেকর্ড ফেরত দেয় — তখন অ্যাপ ব্যবহারকারীকে
 *  জিজ্ঞেস করে "আপনার সংস্করণ রাখবেন না শিটেরটা"। এতে একটি ডিভাইসের
 *  লেখা নিঃশব্দে মুছে যায় না।
 * ═══════════════════════════════════════════════════════════════════════════
 */

var CONFIG = {
  /** খালি = এই স্ক্রিপ্টের সাথে বাউন্ড করা শিট। অথবা শিটের ID বসান। */
  SPREADSHEET_ID: '',

  /** ⚠️ অবশ্যই বদলান। একই টোকেন js/config.js এর API_TOKEN এ বসবে। */
  API_TOKEN: 'MSTE-17238487c260a9f644',

  /** Sheet খালি থাকলে যে অ্যাডমিন অ্যাকাউন্ট তৈরি হবে */
  DEFAULT_ADMIN_EMAIL: 'mstechnoenterprise@gmail.com',
  DEFAULT_ADMIN_PASSWORD: '694698',
  DEFAULT_ADMIN_NAME: 'System Administrator',

  /** একই সময়ে দুটো ডিভাইস লিখলে সিরিয়ালি হবে */
  LOCK_WAIT_MS: 25000
};

/** অ্যাপের ডেটা-টেবিল → Google Sheet ট্যাবের নাম */
var TABS = {
  USERS: 'Users',
  AGENTS: 'Agents',
  AGENT_BALANCE: 'AgentBalance',
  DC_PAYMENTS: 'DCPayments',
  CASHBOOK: 'CashBook',
  CAPITAL: 'Capital',
  COMMISSION: 'Commission',
  LOANS: 'Loans',
  EXPENSES: 'Expenses',
  APP_SETTINGS: 'Settings',
  ACTIVITY_LOG: 'ActivityLog',
  HR_EMPLOYEES: 'HREmployees',
  HR_ATTENDANCE: 'HRAttendance',
  HR_LEAVE: 'HRLeave',
  HR_PERFORMANCE: 'HRPerformance',
  HR_TARGET: 'HRTarget',
  HR_CSERVICE: 'HRCustomerService',
  HR_SALARY_HIST: 'HRSalaryHistory'
};

/** প্রতিটি রেকর্ডে থাকা মেটা কলাম (হেডারে অটো যোগ হয়) */
var META_COLS = ['version', 'updatedAt', 'updatedBy'];

/** প্রতিটি ট্যাবের শুরুর হেডার (নতুন ফিল্ড নিজে থেকেই যোগ হবে) */
var BASE_HEADERS = {
  USERS: ['id', 'name', 'email', 'password', 'role', 'status', 'phone', 'position', 'menuPermissions', 'writePermissions', 'agentPermissions', 'lastLogin', 'loginCount', 'pagesVisited', 'createdAt'],
  AGENTS: ['id', 'name', 'code', 'bank', 'area', 'phone', 'status', 'createdAt'],
  AGENT_BALANCE: ['id', 'agentId', 'date', 'balance', 'note', 'createdAt'],
  DC_PAYMENTS: ['id', 'agentId', 'personName', 'type', 'amount', 'date', 'note', 'createdAt'],
  CASHBOOK: ['id', 'agentId', 'date', 'type', 'amount', 'category', 'note', 'createdAt'],
  CAPITAL: ['id', 'agentId', 'date', 'amount', 'note', 'createdAt'],
  COMMISSION: ['id', 'agentId', 'date', 'amount', 'note', 'createdAt'],
  LOANS: ['id', 'agentId', 'date', 'amount', 'interest', 'totalPayable', 'paymentAmount', 'note', 'createdAt'],
  EXPENSES: ['id', 'agentId', 'date', 'category', 'amount', 'description', 'paidBy', 'createdAt'],
  APP_SETTINGS: ['id', 'applicationLinkActive', 'companyName', 'currency'],
  ACTIVITY_LOG: ['id', 'userId', 'action', 'details', 'timestamp'],
  HR_EMPLOYEES: ['id', 'agentId', 'employeeId', 'name', 'email', 'phone', 'position', 'department', 'baseSalary', 'joinDate', 'status', 'createdAt'],
  HR_ATTENDANCE: ['id', 'empId', 'date', 'status', 'note', 'createdAt'],
  HR_LEAVE: ['id', 'empId', 'dateFrom', 'dateTo', 'type', 'reason', 'status', 'createdAt'],
  HR_PERFORMANCE: ['id', 'empId', 'month', 'score', 'notes', 'createdAt'],
  HR_TARGET: ['id', 'empId', 'month', 'target', 'achieved', 'notes', 'createdAt'],
  HR_CSERVICE: ['id', 'empId', 'month', 'score', 'feedback', 'complaints', 'resolved', 'createdAt'],
  HR_SALARY_HIST: ['id', 'empId', 'month', 'baseSalary', 'increment', 'bonus', 'deduction', 'total', 'reason', 'paidAt', 'createdAt']
};

/** যে টেবিলগুলোতে সাধারণত একটাই রেকর্ড থাকে (id = 'app_settings') */
var SINGLE_RECORD_TABLES = ['APP_SETTINGS'];

/* ═════════════════════════════════════════════════════════════════════════
 *  ENTRY POINTS
 * ═════════════════════════════════════════════════════════════════════════ */

function doGet(e) {
  var p = (e && e.parameter) || {};
  if (!checkToken(p.token)) return jsonOut({ ok: false, error: 'unauthorized' });

  var action = p.action || 'ping';

  try {
    if (action === 'ping') {
      var ss = getSpreadsheet();
      return jsonOut({ ok: true, action: 'ping', spreadsheet: ss.getName(), spreadsheetId: ss.getId(), serverTime: new Date().toISOString() });
    }
    if (action === 'pull') {
      return jsonOut({ ok: true, action: 'pull', serverTime: new Date().toISOString(), data: pullAll() });
    }
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  }
}

function doPost(e) {
  var body = {};
  try {
    body = e && e.postData && e.postData.contents ? JSON.parse(e.postData.contents) : {};
  } catch (err) {
    return jsonOut({ ok: false, error: 'bad_json' });
  }

  if (!checkToken(body.token)) return jsonOut({ ok: false, error: 'unauthorized' });

  var action = body.action;
  try {
    if (action === 'push') {
      var res = applyOps(body.ops || []);
      return jsonOut({
        ok: true,
        action: 'push',
        applied: res.applied,
        touched: res.touched,
        updates: res.updates,
        conflicts: res.conflicts,
        serverTime: new Date().toISOString()
      });
    }
    if (action === 'pushAll') {
      // পুরো ডেটাসেট (লোকাল থেকে Sheet-এ একবারে মাইগ্রেশনের জন্য)
      var lockAll = LockService.getScriptLock();
      lockAll.waitLock(CONFIG.LOCK_WAIT_MS);
      try {
        var r2 = pushAll(body.data || {});
        return jsonOut({ ok: true, action: 'pushAll', touched: r2.touched, serverTime: new Date().toISOString() });
      } finally {
        try { lockAll.releaseLock(); } catch (err) {}
      }
    }
    return jsonOut({ ok: false, error: 'unknown_action', action: action });
  } catch (err) {
    return jsonOut({ ok: false, error: 'server_error', message: String(err && err.message ? err.message : err) });
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 *  PULL / PUSH
 * ═════════════════════════════════════════════════════════════════════════ */

function pullAll() {
  var ss = getSpreadsheet();
  var out = {};
  Object.keys(TABS).forEach(function (key) {
    out[key] = readTab(ss, key);
  });

  // Sheet একেবারে খালি হলে ডিফল্ট অ্যাডমিন বসিয়ে দিই
  if (!out.USERS || out.USERS.length === 0) {
    var admin = defaultAdmin();
    writeRecords(ss, 'USERS', [admin]);
    out.USERS = [admin];
  }
  if (!out.APP_SETTINGS || out.APP_SETTINGS.length === 0) {
    var settings = {
      id: 'app_settings', applicationLinkActive: true, companyName: 'MS Techno Enterprise', currency: '৳',
      version: 1, updatedAt: new Date().toISOString(), updatedBy: 'setup'
    };
    writeRecords(ss, 'APP_SETTINGS', [settings]);
    out.APP_SETTINGS = [settings];
  }
  return out;
}

function pushAll(data) {
  var ss = getSpreadsheet();
  var touched = [];
  Object.keys(TABS).forEach(function (key) {
    if (!data[key]) return;
    // একবারে পুরো টেবিল বসানো (মাইগ্রেশন) — তাই দ্বন্দ্ব-যাচাই ছাড়াই মেটা বসিয়ে দিই
    var rows = toRecordArray(data[key]).map(function (r) {
      if (!r.id) r.id = genId();
      r.version = r.version ? (parseFloat(r.version) || 0) + 1 : 1;
      r.updatedAt = r.updatedAt || new Date().toISOString();
      r.updatedBy = r.updatedBy || 'migration';
      return r;
    });
    writeRecords(ss, key, rows);
    touched.push(key);
  });
  return { touched: touched };
}

/** ops = [{sheet, op:'upsert'|'delete', record|id, baseVersion, updatedBy}] */
function applyOps(ops) {
  var lock = LockService.getScriptLock();
  var applied = 0;
  var touched = {};
  var updates = [];    // [{sheet, id, version, deleted}] — ক্লায়েন্টের _versions আপডেট করার জন্য
  var conflicts = [];  // [{sheet, id, op, server, yourVersion}] — শিটে এর চেয়ে নতুন সংস্করণ আছে

  lock.waitLock(CONFIG.LOCK_WAIT_MS);
  try {
    var ss = getSpreadsheet();
    var bySheet = {};

    ops.forEach(function (op) {
      if (!op || !TABS[op.sheet]) return;
      bySheet[op.sheet] = bySheet[op.sheet] || [];
      bySheet[op.sheet].push(op);
    });

    Object.keys(bySheet).forEach(function (key) {
      var rows = readTab(ss, key);
      var index = {};
      rows.forEach(function (r, i) { index[String(r.id)] = i; });
      var dirty = false;

      bySheet[key].forEach(function (op) {
        var id = String(op.op === 'delete' ? op.id : ((op.record && op.record.id) || ''));
        if (!id) return;

        var at = index[id];
        var stored = at === undefined ? null : rows[at];
        var storedV = stored ? (parseFloat(stored.version) || 0) : 0;
        var baseV = (op.baseVersion === undefined || op.baseVersion === null || op.baseVersion === '')
          ? null : (parseFloat(op.baseVersion) || 0);

        // শিটে এর চেয়ে নতুন সংস্করণ থাকলে লেখা গ্রহণ করি না
        if (stored && baseV !== null && storedV > baseV) {
          conflicts.push({ sheet: key, id: id, op: op.op === 'delete' ? 'delete' : 'upsert', server: stored, yourVersion: baseV });
          return;
        }

        if (op.op === 'delete') {
          if (at !== undefined) {
            rows.splice(at, 1);
            rebuildIndex(rows, index);
            applied++;
            dirty = true;
          }
          updates.push({ sheet: key, id: id, version: null, deleted: true });
          return;
        }

        var rec = op.record || {};
        if (!rec.id) rec.id = genId();
        rec.version = storedV + 1;                      // সার্ভারই সংস্করণ ঠিক করে
        rec.updatedAt = new Date().toISOString();
        rec.updatedBy = String(op.updatedBy || '');

        var rid = String(rec.id);
        var ui = index[rid];
        if (ui === undefined) {
          rows.push(rec);
          index[rid] = rows.length - 1;
        } else {
          rows[ui] = rec; // পুরো রেকর্ড রিপ্লেস — কিন্তু শুধু সংস্করণ মিলে গেলেই
        }
        applied++;
        dirty = true;
        updates.push({ sheet: key, id: rid, version: rec.version });
      });

      if (dirty || !rows.length) writeRecords(ss, key, rows);
      touched[key] = rows.length;
    });
  } finally {
    try { lock.releaseLock(); } catch (err) {}
  }

  return { applied: applied, touched: touched, updates: updates, conflicts: conflicts };
}

function rebuildIndex(rows, index) {
  Object.keys(index).forEach(function (k) { delete index[k]; });
  rows.forEach(function (r, i) { index[String(r.id)] = i; });
}

/* ═════════════════════════════════════════════════════════════════════════
 *  SHEET READ / WRITE
 * ═════════════════════════════════════════════════════════════════════════ */

function readTab(ss, key) {
  var sheet = ss.getSheetByName(TABS[key]);
  if (!sheet || sheet.getLastRow() < 1) return [];

  var values = sheet.getDataRange().getValues();
  if (values.length < 2) return [];

  var header = values[0].map(function (h) { return String(h).trim(); });
  var records = [];

  for (var i = 1; i < values.length; i++) {
    var row = values[i];
    if (isBlankRow(row)) continue;
    var rec = {};
    var hasValue = false;
    for (var j = 0; j < header.length; j++) {
      if (!header[j]) continue;
      var v = fromCell(row[j]);
      if (v !== '' && v !== null && v !== undefined) hasValue = true;
      rec[header[j]] = v;
    }
    if (!hasValue) continue;
    if (!rec.id) rec.id = 'row-' + (i + 1) + '-' + Math.random().toString(36).slice(2, 8);
    records.push(rec);
  }
  return records;
}

function writeRecords(ss, key, records) {
  var name = TABS[key];
  var sheet = ss.getSheetByName(name) || ss.insertSheet(name);

  var header = (BASE_HEADERS[key] || ['id']).slice();
  records.forEach(function (r) {
    Object.keys(r).forEach(function (f) { if (header.indexOf(f) === -1) header.push(f); });
  });
  // মেটা কলামগুলো সবার শেষে
  META_COLS.forEach(function (f) { if (header.indexOf(f) === -1) header.push(f); });

  var matrix = [header];
  records.forEach(function (r) {
    matrix.push(header.map(function (h) { return toCell(r[h]); }));
  });

  // আগের ডেটা/হেডার মুছে নতুন করে লেখা (ফরম্যাটিং অটুট থাকে)
  var needRows = Math.max(matrix.length, 2);
  var needCols = Math.max(header.length, 1);
  if (sheet.getMaxRows() < needRows) sheet.insertRowsAfter(sheet.getMaxRows(), needRows - sheet.getMaxRows());
  if (sheet.getMaxColumns() < needCols) sheet.insertColumnsAfter(sheet.getMaxColumns(), needCols - sheet.getMaxColumns());

  sheet.getRange(1, 1, needRows, sheet.getMaxColumns()).clearContent();
  sheet.getRange(1, 1, matrix.length, header.length).setValues(matrix);

  // আগের বেশি কলাম থাকলে হেডার-সারিতেও মুছে দিই
  if (sheet.getMaxColumns() > header.length) {
    sheet.getRange(1, header.length + 1, 1, sheet.getMaxColumns() - header.length).clearContent();
  }
}

/* ═════════════════════════════════════════════════════════════════════════
 *  HELPERS
 * ═════════════════════════════════════════════════════════════════════════ */

function getSpreadsheet() {
  if (CONFIG.SPREADSHEET_ID) return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) throw new Error('কোনো Spreadsheet পাওয়া যায়নি — CONFIG.SPREADSHEET_ID সেট করুন।');
  return ss;
}

function checkToken(token) {
  return !!token && String(token) === String(CONFIG.API_TOKEN);
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function genId() {
  return 'id' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

function isBlankRow(row) {
  for (var i = 0; i < row.length; i++) {
    if (row[i] !== '' && row[i] !== null && row[i] !== undefined) return false;
  }
  return true;
}

function toRecordArray(value) {
  if (Array.isArray(value)) return value.filter(function (v) { return v && typeof v === 'object'; });
  if (value && typeof value === 'object') return [value];
  return [];
}

/** JS value → Sheet cell */
function toCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return JSON.stringify(v);
  if (typeof v === 'boolean') return v;
  return v;
}

/** Sheet cell → JS value */
function fromCell(v) {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'object') return v;
  if (typeof v === 'string') {
    var t = v.trim();
    if (t.charAt(0) === '[' || t.charAt(0) === '{') {
      try { return JSON.parse(t); } catch (err) { return v; }
    }
    return v;
  }
  return v;
}

function defaultAdmin() {
  return {
    id: 'admin-001',
    name: CONFIG.DEFAULT_ADMIN_NAME,
    email: CONFIG.DEFAULT_ADMIN_EMAIL,
    // অ্যাপ btoa(password) দিয়ে যাচাই করে
    password: Utilities.base64Encode(CONFIG.DEFAULT_ADMIN_PASSWORD),
    role: 'admin',
    status: 'active',
    phone: '+880 000-000000',
    position: 'System Administrator',
    menuPermissions: ['*'],
    writePermissions: ['*'],
    agentPermissions: ['*'],
    lastLogin: '',
    loginCount: 0,
    pagesVisited: [],
    createdAt: new Date().toISOString(),
    version: 1,
    updatedAt: new Date().toISOString(),
    updatedBy: 'setup'
  };
}

/* ═════════════════════════════════════════════════════════════════════════
 *  SETUP — এডিটর থেকে একবার Run করুন
 * ═════════════════════════════════════════════════════════════════════════ */

function setup() {
  var ss = getSpreadsheet();
  Object.keys(TABS).forEach(function (key) {
    var sheet = ss.getSheetByName(TABS[key]) || ss.insertSheet(TABS[key]);
    if (sheet.getLastRow() === 0) {
      var header = BASE_HEADERS[key] || ['id'];
      sheet.getRange(1, 1, 1, header.length).setValues([header]);
      sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });

  var users = readTab(ss, 'USERS');
  if (users.length === 0) writeRecords(ss, 'USERS', [defaultAdmin()]);

  var settings = readTab(ss, 'APP_SETTINGS');
  if (settings.length === 0) {
    writeRecords(ss, 'APP_SETTINGS', [{
      id: 'app_settings', applicationLinkActive: true, companyName: 'MS Techno Enterprise', currency: '৳',
      version: 1, updatedAt: new Date().toISOString(), updatedBy: 'setup'
    }]);
  }

  // ডিফল্ট ট্যাব (Sheet1) থাকলে রেখে দেওয়া হয় — দরকার হলে নিজে ডিলিট করুন
  Logger.log('✅ সেটআপ সম্পন্ন। ট্যাব: ' + Object.keys(TABS).map(function (k) { return TABS[k]; }).join(', '));
}

/** একবার Run করলে API ঠিক আছে কি না পরীক্ষা করা যাবে */
function testPull() {
  var ss = getSpreadsheet();
  Logger.log(JSON.stringify({ ok: true, spreadsheet: ss.getName(), agents: readTab(ss, 'AGENTS').length, users: readTab(ss, 'USERS').length }));
}
