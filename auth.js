/**
 * auth.js — Authentication & Role Management
 * MS Techno Enterprise
 */

const Auth = {
  SESSION_KEY: 'mste_session',
  LAST_ACTIVITY_KEY: 'mste_last_activity',
  LOGOUT_REASON_KEY: 'mste_logout_reason',
  INACTIVITY_LIMIT_MS: 10 * 60 * 1000, // 10 minutes in milliseconds

  // ── All available menu pages ───────────────────────────
  ALL_PAGES: [
    { id: 'dashboard',       label: 'Dashboard',      icon: 'ri-dashboard-3-line',          file: 'dashboard.html' },
    { id: 'agents-list',     label: 'Agents List',    icon: 'ri-team-line',                 file: 'agents-list.html' },
    { id: 'agent-details',   label: 'Agent Details',  icon: 'ri-user-search-line',          file: 'agent-details.html' },
    { id: 'agent-balance',   label: 'Agent Balance',  icon: 'ri-money-dollar-circle-line',  file: 'agent-balance.html' },
    { id: 'agent-cashbook',  label: 'Cash Book',      icon: 'ri-book-2-line',               file: 'agent-cashbook.html' },
    { id: 'agent-capital',   label: 'Agent Capital',  icon: 'ri-funds-line',                file: 'agent-capital.html' },
    { id: 'employees',       label: 'Employees',      icon: 'ri-group-2-line',              file: 'employees.html' },
    { id: 'expenses',        label: 'Expenses',       icon: 'ri-wallet-3-line',             file: 'expenses.html' },
    { id: 'reports',         label: 'Reports',        icon: 'ri-bar-chart-2-line',          file: 'reports.html' },
  ],

  // ── Activity Tracking (10-minute idle timeout) ───────────
  recordActivity() {
    if (!this.getSessionRaw()) return;
    const now = Date.now();
    // Throttle writing to localStorage (at most once every 1.5 seconds)
    if (this._lastRecordedTime && (now - this._lastRecordedTime < 1500)) return;
    this._lastRecordedTime = now;
    try {
      localStorage.setItem(this.LAST_ACTIVITY_KEY, String(now));
    } catch (_) {}
  },

  getLastActivity() {
    try {
      const v = localStorage.getItem(this.LAST_ACTIVITY_KEY);
      return v ? parseInt(v, 10) : 0;
    } catch { return 0; }
  },

  isSessionExpired() {
    const raw = this.getSessionRaw();
    if (!raw) return false;
    const last = this.getLastActivity();
    if (!last) return false;
    return (Date.now() - last) > this.INACTIVITY_LIMIT_MS;
  },

  initInactivityTracker() {
    if (typeof window === 'undefined') return;
    if (this._inactivityTrackerInitialized) return;
    this._inactivityTrackerInitialized = true;

    // Listen to user interactions to record activity
    const events = ['mousemove', 'mousedown', 'keydown', 'keypress', 'scroll', 'touchstart', 'click'];
    const handleUserActivity = () => {
      this.recordActivity();
    };

    events.forEach(ev => {
      window.addEventListener(ev, handleUserActivity, { passive: true, capture: true });
    });

    // If last activity is missing, record current time
    if (this.getSessionRaw() && !this.getLastActivity()) {
      this.recordActivity();
    }

    // Periodic check every 5 seconds for 10-minute inactivity timeout
    if (this._inactivityTimer) clearInterval(this._inactivityTimer);
    this._inactivityTimer = setInterval(() => {
      if (this.getSessionRaw() && this.isSessionExpired()) {
        this.autoLogout('inactive');
      }
    }, 5000);

    // Synchronize across open tabs
    window.addEventListener('storage', (e) => {
      if (e.key === this.SESSION_KEY && !e.newValue) {
        window.location.href = 'login.html';
      }
    });
  },

  // ── Auto-logout (10-minute Inactivity) ───────────────────
  autoLogout(reason = 'inactive') {
    const sess = this.getSessionRaw();
    if (sess && window.DB && DB.logActivity) {
      DB.logActivity(sess.id, 'logout', reason === 'inactive' ? 'Auto-logout due to 10 minutes inactivity' : 'Auto-logout');
    }
    try {
      localStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.LAST_ACTIVITY_KEY);
      if (reason) {
        sessionStorage.setItem(this.LOGOUT_REASON_KEY, reason);
      }
    } catch (_) {}

    const isLoginPage = typeof window !== 'undefined' && window.location.pathname.endsWith('login.html');
    if (!isLoginPage && typeof window !== 'undefined') {
      window.location.href = 'login.html';
    }
  },

  // ── Manual Logout ─────────────────────────────────────────
  logout() {
    const sess = this.getSessionRaw();
    if (sess && window.DB && DB.logActivity) {
      DB.logActivity(sess.id, 'logout', 'User manual logout');
    }
    try {
      localStorage.removeItem(this.SESSION_KEY);
      localStorage.removeItem(this.LAST_ACTIVITY_KEY);
      sessionStorage.removeItem(this.LOGOUT_REASON_KEY);
    } catch (_) {}
    window.location.href = 'login.html';
  },

  // ── Session ──────────────────────────────────────────────
  getSessionRaw() {
    try {
      const s = localStorage.getItem(this.SESSION_KEY);
      if (!s) return null;
      if (window.DB && DB._deobf) {
        const d = DB._deobf(s);
        if (d) return d;
      }
      return JSON.parse(s);
    } catch { return null; }
  },

  getSession() {
    if (this.isSessionExpired()) {
      this.autoLogout('inactive');
      return null;
    }
    return this.getSessionRaw();
  },

  isLoggedIn() {
    if (this.isSessionExpired()) {
      this.autoLogout('inactive');
      return false;
    }
    return !!this.getSessionRaw();
  },

  isAdmin() {
    const s = this.getSession();
    return s && (s.role === 'admin' || s.role === 'sub-admin');
  },

  isSuperAdmin() {
    const s = this.getSession();
    return s && s.role === 'admin';
  },

  // ── Login ────────────────────────────────────────────────
  login(email, password) {
    const user = DB.getUserByEmail(email.trim().toLowerCase());
    if (!user) return { ok: false, msg: 'No account found with this email.' };

    const encodedPw = btoa(password);
    if (user.password !== encodedPw) return { ok: false, msg: 'Incorrect password.' };

    // Applicants cannot log in until approved
    if (user.role === 'applicant') return { ok: false, msg: 'Your account is pending admin approval.' };

    // Super admin & sub-admin always allowed
    const isAdminRole = user.role === 'admin' || user.role === 'sub-admin';
    if (!isAdminRole && user.status !== 'active') {
      const msgs = {
        pending: 'Your account is pending admin approval.',
        blocked: 'Your account has been blocked. Contact admin.',
      };
      return { ok: false, msg: msgs[user.status] || 'Account unavailable.' };
    }

    DB.updateUser(user.id, {
      lastLogin:  DB.now(),
      loginCount: (user.loginCount || 0) + 1,
    });
    DB.logActivity(user.id, 'login', 'Logged in from browser');

    const session = { ...user };
    delete session.password;
    localStorage.setItem(this.SESSION_KEY, (window.DB && DB._obf) ? DB._obf(session) : JSON.stringify(session));

    // Record login activity timestamp for 10-minute idle timeout
    localStorage.setItem(this.LAST_ACTIVITY_KEY, String(Date.now()));
    try { sessionStorage.removeItem(this.LOGOUT_REASON_KEY); } catch (_) {}

    return { ok: true, user: session };
  },

  // ── Route guard ──────────────────────────────────────────
  guard(pageId = null) {
    if (!this.isLoggedIn()) {
      window.location.href = 'login.html';
      return null;
    }

    // Activate the 10-minute inactivity watcher
    this.initInactivityTracker();
    this.recordActivity();

    const session    = this.getSession();
    const freshUser  = DB.getUserById(session.id);
    if (!freshUser) { this.logout(); return null; }

    const isAdminRole = freshUser.role === 'admin' || freshUser.role === 'sub-admin';
    if (!isAdminRole && freshUser.status !== 'active') { this.logout(); return null; }

    // Update session
    const updated = { ...freshUser };
    delete updated.password;
    localStorage.setItem(this.SESSION_KEY, (window.DB && DB._obf) ? DB._obf(updated) : JSON.stringify(updated));

    // Check page permission for general users
    if (pageId && !isAdminRole) {
      const perms = freshUser.menuPermissions || [];
      if (!perms.includes('*') && !perms.includes(pageId)) {
        window.location.href = 'dashboard.html';
        return null;
      }
    }

    // Log page visit
    if (pageId) {
      const pages = freshUser.pagesVisited || [];
      if (!pages.includes(pageId)) pages.push(pageId);
      DB.updateUser(freshUser.id, { pagesVisited: pages });
      DB.logActivity(freshUser.id, 'page_visit', pageId);
    }

    return updated;
  },

  // ── Permission checks ──────────────────────────────────

  // Can this user enter/edit data on the given page?
  // Logic: Admin/Sub-Admin = always yes.
  // General User: Menu Access only = view only. Menu Access + Data Entry = can write.
  canEdit(pageId = null) {
    const s = this.getSession();
    if (!s) return false;
    if (s.role === 'admin' || s.role === 'sub-admin') return true;

    // General user: check per-page Data Entry permission
    if (pageId) {
      const writePerms = s.writePermissions || [];
      return writePerms.includes('*') || writePerms.includes(pageId);
    }

    // Legacy fallback: any write permission granted
    return (s.writePermissions || []).length > 0 || s.canWrite === true;
  },

  hasPageAccess(pageId) {
    const s = this.getSession();
    if (!s) return false;
    if (s.role === 'admin' || s.role === 'sub-admin') return true;
    const perms = s.menuPermissions || [];
    return perms.includes('*') || perms.includes(pageId);
  },

  // ── Agent access ────────────────────────────────────────
  // Returns true if this user can access the given agentId
  hasAgentAccess(agentId) {
    const s = this.getSession();
    if (!s) return false;
    if (s.role === 'admin' || s.role === 'sub-admin') return true;
    const perms = s.agentPermissions || [];
    // If no agent permissions set (empty array), allow all (backwards compat)
    if (perms.length === 0) return true;
    return perms.includes('*') || perms.includes(agentId);
  },

  // Filter an agents array to only those this user can access
  getAccessibleAgents(allAgents) {
    const s = this.getSession();
    if (!s) return [];
    if (s.role === 'admin' || s.role === 'sub-admin') return allAgents;
    const perms = s.agentPermissions || [];
    if (perms.length === 0 || perms.includes('*')) return allAgents;
    return allAgents.filter(a => perms.includes(a.id));
  },

  // ── Get visible nav items for current user ─────────────
  getVisibleNav() {
    const s = this.getSession();
    if (!s) return [];
    if (s.role === 'admin' || s.role === 'sub-admin') return this.ALL_PAGES;
    const perms = s.menuPermissions || [];
    if (perms.includes('*')) return this.ALL_PAGES;
    return this.ALL_PAGES.filter(p => perms.includes(p.id));
  },
};

if (typeof window !== 'undefined') window.Auth = Auth;
if (typeof module !== 'undefined') module.exports = { Auth };


