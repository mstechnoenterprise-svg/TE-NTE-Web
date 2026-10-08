/**
 * app.js — Shared UI utilities
 * MS Techno Enterprise
 */

// ── Toast notifications ───────────────────────────────────────
const Toast = {
  container: null,

  init() {
    if (!document.querySelector('.toast-container')) {
      this.container = document.createElement('div');
      this.container.className = 'toast-container';
      document.body.appendChild(this.container);
    } else {
      this.container = document.querySelector('.toast-container');
    }
  },

  show(msg, type = 'info', duration = 3500) {
    if (!this.container) this.init();

    const icons = {
      success: 'ri-checkbox-circle-fill',
      error:   'ri-error-warning-fill',
      warning: 'ri-alert-fill',
      info:    'ri-information-fill',
    };

    const toast = document.createElement('div');
    toast.className = `toast ${type}`;
    toast.innerHTML = `
      <i class="${icons[type] || icons.info} toast-icon"></i>
      <span class="toast-msg">${msg}</span>
    `;

    this.container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('removing');
      toast.addEventListener('animationend', () => toast.remove());
    }, duration);
  },

  success(msg) { this.show(msg, 'success'); },
  error(msg)   { this.show(msg, 'error'); },
  warning(msg) { this.show(msg, 'warning'); },
  info(msg)    { this.show(msg, 'info'); },
};

// ── Sidebar builder ───────────────────────────────────────────
const Sidebar = {
  collapsed: false,

  build(activePageId) {
    const session = Auth.getSession();
    if (!session) return;

    const navItems = Auth.getVisibleNav();
    const settings = DB.getSettings();

    const navGroups = {
      main: ['dashboard'],
      agents: ['agents-list','agent-details','agent-balance','agent-cashbook','agent-capital'],
      management: ['employees','expenses','reports'],
    };

    const groupLabels = {
      main: 'Main',
      agents: 'Agents',
      management: 'Management',
    };

    let navHTML = '';
    let itemIdx = 0;

    for (const [group, ids] of Object.entries(navGroups)) {
      const items = navItems.filter(p => ids.includes(p.id));
      if (!items.length) continue;

      itemIdx++;
      navHTML += `<div class="nav-section-label" style="--nav-idx: ${itemIdx}"><span>${groupLabels[group]}</span></div>`;
      items.forEach(page => {
        itemIdx++;
        const isActive = page.id === activePageId;
        navHTML += `
          <a href="${page.file}" class="nav-item${isActive ? ' active' : ''}" id="nav-${page.id}" style="--nav-idx: ${itemIdx}">
            <i class="${page.icon}"></i>
            <span>${page.label}</span>
            <i class="ri-arrow-right-s-line nav-indicator"></i>
          </a>`;
      });
    }

    // Admin-only section (admin & sub-admin)
    const isAdminRole = session.role === 'admin' || session.role === 'sub-admin';
    if (isAdminRole) {
      itemIdx++;
      navHTML += `
        <div class="nav-section-label" style="--nav-idx: ${itemIdx}"><span>Admin</span></div>`;
      itemIdx++;
      navHTML += `
        <a href="user-management.html" class="nav-item${activePageId === 'user-management' ? ' active' : ''}" id="nav-user-management" style="--nav-idx: ${itemIdx}">
          <i class="ri-shield-user-line"></i>
          <span>User Management</span>
          <i class="ri-arrow-right-s-line nav-indicator"></i>
        </a>`;
    }

    const avatarColor = this._avatarColor(session.name);
    const initials = this._initials(session.name);

    const sidebarHTML = `
      <div class="sidebar-brand">
        <div class="brand-logo">
          <img src="logot.jpg" alt="TE &amp; NTE Logo" class="brand-logo-img">
        </div>
        <div class="brand-text">
          <h2>TE &amp; NTE</h2>
          <p>Web Portal</p>
        </div>
      </div>
      <nav class="sidebar-nav" id="sidebarNav">
        ${navHTML}
      </nav>`;

    const sidebar = document.getElementById('sidebar');
    if (sidebar) sidebar.innerHTML = sidebarHTML;

    // ── Auto-close sidebar on mobile when a nav item is clicked ──
    const sidebarNav = document.getElementById('sidebarNav');
    if (sidebarNav) {
      sidebarNav.addEventListener('click', (e) => {
        const link = e.target.closest('.nav-item');
        if (link && window.innerWidth <= 1024) {
          document.getElementById('sidebar')?.classList.remove('mobile-open');
          document.getElementById('sidebarOverlay')?.classList.remove('visible');
        }
      });
    }

    // Restore collapsed state
    const wasCollapsed = localStorage.getItem('mste_sidebar_collapsed') === 'true';
    if (wasCollapsed) this.collapse(true);
  },

  toggle() {
    if (window.innerWidth <= 900) {
      const sidebar = document.getElementById('sidebar');
      const overlay = document.getElementById('sidebarOverlay');
      sidebar.classList.toggle('mobile-open');
      overlay?.classList.toggle('visible');
    } else {
      this.collapsed ? this.expand() : this.collapse();
    }
  },

  collapse(silent = false) {
    this.collapsed = true;
    document.getElementById('sidebar')?.classList.add('collapsed');
    document.querySelector('.main-content')?.classList.add('sidebar-collapsed');
    document.querySelector('.top-header')?.classList.add('sidebar-collapsed');
    if (!silent) localStorage.setItem('mste_sidebar_collapsed', 'true');
  },

  expand() {
    this.collapsed = false;
    document.getElementById('sidebar')?.classList.remove('collapsed');
    document.querySelector('.main-content')?.classList.remove('sidebar-collapsed');
    document.querySelector('.top-header')?.classList.remove('sidebar-collapsed');
    localStorage.setItem('mste_sidebar_collapsed', 'false');
  },

  _initials(name) {
    if (!name) return 'U';
    return name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0,2);
  },

  _avatarColor(name) {
    // Extended to 10 vibrant gradient classes
    const colors = ['av-1','av-2','av-3','av-4','av-5','av-6','av-7','av-8','av-9','av-10'];
    let hash = 0;
    for (const c of (name || 'U')) hash += c.charCodeAt(0);
    return colors[hash % colors.length];
  },
};

// ── Modal helpers ─────────────────────────────────────────────
const Modal = {
  open(id)  { document.getElementById(id)?.classList.add('open'); },
  close(id) { document.getElementById(id)?.classList.remove('open'); },
  closeAll() {
    document.querySelectorAll('.modal-overlay.open').forEach(m => m.classList.remove('open'));
  },
};
window.Modal = Modal;

// ── Confirm dialog ────────────────────────────────────────────
const Confirm = {
  show(msg, onConfirm, onCancel) {
    const existing = document.getElementById('confirmModal');
    if (existing) existing.remove();

    const modal = document.createElement('div');
    modal.id = 'confirmModal';
    modal.className = 'modal-overlay open';
    modal.innerHTML = `
      <div class="modal" style="max-width:380px">
        <div class="modal-header">
          <div class="modal-title"><i class="ri-question-line"></i> Confirm Action</div>
          <div class="modal-close" onclick="Confirm.dismiss()"><i class="ri-close-line"></i></div>
        </div>
        <div class="modal-body">
          <p style="font-size:14px;color:var(--text-secondary);line-height:1.6">${msg}</p>
        </div>
        <div class="modal-footer">
          <button class="btn btn-ghost" onclick="Confirm.dismiss()">Cancel</button>
          <button class="btn btn-danger" id="confirmOkBtn">Confirm</button>
        </div>
      </div>`;

    document.body.appendChild(modal);
    document.getElementById('confirmOkBtn').onclick = () => {
      this.dismiss();
      onConfirm?.();
    };

    modal.addEventListener('click', e => {
      if (e.target === modal) { this.dismiss(); onCancel?.(); }
    });
  },

  dismiss() { document.getElementById('confirmModal')?.remove(); },
};

// ── Number formatting ─────────────────────────────────────────
function fmt(n, currency = '৳') {
  const num = parseFloat(n) || 0;
  return `${currency}${num.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleDateString('en-BD', { year:'numeric', month:'short', day:'2-digit' });
}

function fmtDateTime(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return d.toLocaleString('en-BD', { year:'numeric', month:'short', day:'2-digit', hour:'2-digit', minute:'2-digit' });
}

// ── Animated counter ──────────────────────────────────────────
function animateCount(el, target, duration = 1200, prefix = '৳') {
  const start = 0;
  const startTime = performance.now();
  const isFloat = target % 1 !== 0;

  function step(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / duration, 1);
    const eased = 1 - Math.pow(1 - progress, 3);
    const current = start + (target - start) * eased;

    if (isFloat) {
      el.textContent = `${prefix}${current.toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    } else {
      el.textContent = `${prefix}${Math.floor(current).toLocaleString('en-BD')}`;
    }

    if (progress < 1) requestAnimationFrame(step);
  }

  requestAnimationFrame(step);
}

// ── Table helpers ─────────────────────────────────────────────
function sortTable(data, key, dir = 'asc') {
  return [...data].sort((a, b) => {
    let va = a[key], vb = b[key];
    if (!isNaN(parseFloat(va))) { va = parseFloat(va); vb = parseFloat(vb); }
    if (va < vb) return dir === 'asc' ? -1 : 1;
    if (va > vb) return dir === 'asc' ? 1 : -1;
    return 0;
  });
}

function filterData(data, searchTerm, fields) {
  if (!searchTerm) return data;
  const t = searchTerm.toLowerCase();
  return data.filter(row => fields.some(f => (row[f] || '').toString().toLowerCase().includes(t)));
}

// ── Export helpers ────────────────────────────────────────────
function exportCSV(data, filename, headers) {
  const rows = [headers.map(h => h.label)];
  data.forEach(row => rows.push(headers.map(h => row[h.key] ?? '')));
  const csv = rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a'); a.href = url; a.download = filename;
  a.click(); URL.revokeObjectURL(url);
}

// ── Theme Manager ─────────────────────────────────────────────
const ThemeManager = {
  STORAGE_KEY: 'teNte_theme',

  init() {
    const saved = localStorage.getItem(this.STORAGE_KEY) || 'dark';
    this.apply(saved, false);
  },

  get() {
    return localStorage.getItem(this.STORAGE_KEY) || 'dark';
  },

  apply(theme, triggerEvent = true) {
    // Add transition class for smooth color change
    document.body.classList.add('theme-transitioning');

    if (theme === 'light') {
      document.documentElement.setAttribute('data-theme', 'light');
      document.body.classList.add('light-mode');
      if (window.Chart) {
        Chart.defaults.color = '#1e293b';
        Chart.defaults.borderColor = '#e2d7c5';
      }
    } else {
      document.documentElement.removeAttribute('data-theme');
      document.body.classList.remove('light-mode');
      if (window.Chart) {
        Chart.defaults.color = '#9ba8cc';
        Chart.defaults.borderColor = 'rgba(255,255,255,0.06)';
      }
    }
    localStorage.setItem(this.STORAGE_KEY, theme);

    // Remove transition class after animation completes
    setTimeout(() => document.body.classList.remove('theme-transitioning'), 550);

    if (triggerEvent) {
      window.dispatchEvent(new CustomEvent('themeChanged', { detail: { theme } }));
    }
  },

  toggle() {
    const next = this.get() === 'light' ? 'dark' : 'light';
    this.apply(next);
    return next;
  }
};
ThemeManager.init();


// ── Backup Manager ────────────────────────────────────────────
const BackupManager = {
  getSummary() {
    let agentsCount = 0, balanceCount = 0, cashbookCount = 0, capitalCount = 0,
        commissionCount = 0, loanCount = 0, empCount = 0, expCount = 0, usersCount = 0;
    try { agentsCount = DB.getAgents().length; } catch(e){}
    try { balanceCount = DB.get(DB.KEYS.AGENT_BALANCE).length; } catch(e){}
    try { cashbookCount = DB.getCashbook().length; } catch(e){}
    try { capitalCount = DB.getCapital().length; } catch(e){}
    try { commissionCount = DB.get(DB.KEYS.COMMISSION).length; } catch(e){}
    try { loanCount = DB.get(DB.KEYS.LOANS).length; } catch(e){}
    try { empCount = DB.getHREmployees().length; } catch(e){}
    try { expCount = DB.getExpenses().length; } catch(e){}
    try { usersCount = DB.getUsers().length; } catch(e){}
    return { agentsCount, balanceCount, cashbookCount, capitalCount, commissionCount, loanCount, empCount, expCount, usersCount };
  },

  download() {
    const backupData = {
      metadata: {
        appName: 'TE & NTE Enterprise',
        version: '1.0',
        exportedAt: new Date().toISOString(),
        exportedBy: App.currentUser ? { name: App.currentUser.name, email: App.currentUser.email, role: App.currentUser.role } : null,
        recordCounts: this.getSummary()
      },
      database: {},
      drafts: {}
    };

    // Store all DB.KEYS — ক্লাউড মোডেও একই ফরম্যাটে ব্যাকআপ হয়
    if (window.DB && DB.KEYS) {
      if (typeof DB.exportAll === 'function') {
        backupData.database = DB.exportAll();
      } else {
        Object.entries(DB.KEYS).forEach(([name, key]) => {
          const raw = localStorage.getItem(key);
          if (raw !== null) {
            try { backupData.database[key] = JSON.parse(raw); } catch(e) { backupData.database[key] = raw; }
          }
        });
      }
    }

    // Backup drafts & local settings
    const extraKeys = [
      'teNte_agent_cashbook_drafts_v1',
      'teNte_agent_capital_drafts_v2',
      'teNte_agent_balance_drafts_v1',
      'teNte_theme',
      'mste_sidebar_collapsed'
    ];
    extraKeys.forEach(k => {
      const raw = localStorage.getItem(k);
      if (raw !== null) {
        try { backupData.drafts[k] = JSON.parse(raw); } catch(e) { backupData.drafts[k] = raw; }
      }
    });

    const jsonStr = JSON.stringify(backupData, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const nowStr = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
    a.href = url;
    a.download = `TE_NTE_Full_Backup_${nowStr}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);

    Toast.success('সকল ডাটা সফলভাবে ব্যাকআপ ফাইল হিসেবে ডাউনলোড হয়েছে!');
  },

  restore(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
      try {
        const data = JSON.parse(e.target.result);
        if (!data.database && !data.metadata) {
          Toast.error('ত্রুটি: এটি সঠিক ব্যাকআপ ফাইল নয়।');
          return;
        }

        Confirm.show(
          'সতর্কতা: ব্যাকআপ ফাইলটি রিস্টোর করলে বর্তমান ডাটাবেজ ব্যাকআপ ফাইল দ্বারা প্রতিস্থাপিত হবে। আপনি কি নিশ্চিত?',
          () => {
            let restoredCount = 0;
            if (data.database && typeof data.database === 'object') {
              if (window.DB && typeof DB.importAll === 'function') {
                // Cloud মোডে রিস্টোর করা ডেটা Google Sheet-এও পাঠানো হয়
                restoredCount = DB.importAll(data.database);
              } else {
                Object.entries(data.database).forEach(([k, v]) => {
                  if (v !== undefined && v !== null) {
                    localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
                    restoredCount++;
                  }
                });
              }
            }
            if (data.drafts && typeof data.drafts === 'object') {
              Object.entries(data.drafts).forEach(([k, v]) => {
                if (v !== undefined && v !== null) {
                  localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v));
                }
              });
            }

            // Google Sheet মোডে: রিস্টোর করা ডেটা আগে শিটে পাঠানো, তারপর রিলোড
            if (window.DB && typeof DB.isCloud === 'function' && DB.isCloud()) {
              Toast.success(`${restoredCount}টি টেবিল রিস্টোর হয়েছে — Google Sheet-এ সিঙ্ক হচ্ছে...`);
              DB.flush().then(() => window.location.reload());
              return;
            }

            Toast.success(`সফলভাবে ${restoredCount}টি ডাটা টেবিল রিস্টোর হয়েছে! পেজ রিলোড হচ্ছে...`);
            setTimeout(() => window.location.reload(), 1200);
          }
        );
      } catch(err) {
        Toast.error('ফাইল পার্সিংয়ে ত্রুটি: ' + err.message);
      }
    };
    reader.readAsText(file);
  }
};

// ── Main App object ───────────────────────────────────────────
const App = {
  currentUser: null,

  init(pageId, title, subtitle) {
    ThemeManager.init();
    DB.seed();
    this.currentUser = Auth.guard(pageId);
    if (!this.currentUser) return;

    Sidebar.build(pageId);

    const hTitle = document.getElementById('headerTitle');
    const hSub   = document.getElementById('headerSubtitle');
    if (hTitle) hTitle.textContent = title || '';
    if (hSub)   hSub.textContent   = subtitle || '';

    document.getElementById('sidebarToggle')?.addEventListener('click', () => Sidebar.toggle());

    document.getElementById('sidebarOverlay')?.addEventListener('click', () => {
      document.getElementById('sidebar')?.classList.remove('mobile-open');
      document.getElementById('sidebarOverlay')?.classList.remove('visible');
    });

    // Ensure Settings button & User Menu exist in header-actions (replacing old logout button)
    const ha = document.querySelector('.header-actions');
    if (ha) {
      // Remove any standalone logout button in header-actions
      document.getElementById('logoutBtn')?.remove();

      // Ensure Settings button exists
      if (!document.getElementById('settingsBtn')) {
        const btn = document.createElement('div');
        btn.className = 'header-btn header-btn-settings';
        btn.id = 'settingsBtn';
        btn.title = 'Settings';
        btn.innerHTML = `<i class="ri-settings-3-line"></i><span class="header-btn-label">Settings</span>`;
        ha.appendChild(btn);
      }

      // Ensure User Menu exists to the right of Settings
      if (!document.getElementById('headerUserMenu')) {
        const session = this.currentUser || Auth.getSession();
        const userName = session?.name || 'User';
        const avatarColor = Sidebar._avatarColor(userName);
        const initials = Sidebar._initials(userName);
        const roleLabel = session?.role === 'admin' ? 'Super Admin' : session?.role === 'sub-admin' ? 'Sub-Admin' : (session?.position || 'User');

        const menuWrapper = document.createElement('div');
        menuWrapper.className = 'header-user-menu';
        menuWrapper.id = 'headerUserMenu';
        menuWrapper.innerHTML = `
          <div class="header-user-btn" id="headerUserBtn" title="${userName}" tabindex="0" role="button" aria-haspopup="true" aria-expanded="false">
            <div class="user-avatar ${avatarColor}" style="width:32px;height:32px;font-size:12px;font-weight:700;">${initials}</div>
            <div class="header-user-text">
              <span class="header-user-name">${userName}</span>
            </div>
            <i class="ri-arrow-down-s-line header-user-arrow"></i>
          </div>
          <div class="header-user-dropdown" id="headerUserDropdown">
            <div class="dropdown-user-header">
              <div class="user-avatar ${avatarColor}" style="width:36px;height:36px;font-size:13px;font-weight:700;">${initials}</div>
              <div style="min-width:0;flex:1">
                <div style="font-weight:700;font-size:13px;color:var(--text-primary);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${userName}</div>
                <div style="font-size:11px;color:var(--gold);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${roleLabel}</div>
              </div>
            </div>
            <div class="dropdown-divider"></div>
            <button type="button" class="dropdown-item" id="menuItemProfile">
              <i class="ri-user-line"></i>
              <span>My Profile</span>
            </button>
            <button type="button" class="dropdown-item text-danger" id="menuItemLogout">
              <i class="ri-logout-box-r-line"></i>
              <span>Logout</span>
            </button>
          </div>
        `;
        ha.appendChild(menuWrapper);

        const btn = menuWrapper.querySelector('#headerUserBtn');
        const dropdown = menuWrapper.querySelector('#headerUserDropdown');

        btn.addEventListener('click', (e) => {
          e.stopPropagation();
          const isOpen = menuWrapper.classList.toggle('open');
          btn.setAttribute('aria-expanded', isOpen);
        });

        menuWrapper.querySelector('#menuItemProfile')?.addEventListener('click', (e) => {
          e.stopPropagation();
          menuWrapper.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
          App.openProfileModal();
        });

        menuWrapper.querySelector('#menuItemLogout')?.addEventListener('click', (e) => {
          e.stopPropagation();
          menuWrapper.classList.remove('open');
          btn.setAttribute('aria-expanded', 'false');
          Confirm.show('Are you sure you want to log out?', () => Auth.logout());
        });
      }
    }

    // Close header user dropdown when clicking outside or pressing Escape
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('headerUserMenu');
      if (menu && !menu.contains(e.target)) {
        menu.classList.remove('open');
        menu.querySelector('#headerUserBtn')?.setAttribute('aria-expanded', 'false');
      }
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        const menu = document.getElementById('headerUserMenu');
        if (menu && menu.classList.contains('open')) {
          menu.classList.remove('open');
          menu.querySelector('#headerUserBtn')?.setAttribute('aria-expanded', 'false');
        }
      }
    });

    document.getElementById('settingsBtn')?.addEventListener('click', () => {
      App.openSettingsModal();
    });

    document.querySelectorAll('.modal-overlay').forEach(overlay => {
      overlay.addEventListener('click', e => {
        if (e.target === overlay) overlay.classList.remove('open');
      });
    });

    document.querySelectorAll('.modal-close').forEach(btn => {
      btn.addEventListener('click', () => btn.closest('.modal-overlay')?.classList.remove('open'));
    });

    Toast.init();
    return this.currentUser;
  },

  // ── Show Settings Modal ──────────────────────────────────
  openSettingsModal() {
    document.getElementById('settingsModalOverlay')?.remove();
    const currentTheme = ThemeManager.get();
    const summary = BackupManager.getSummary();

    const overlay = document.createElement('div');
    overlay.id = 'settingsModalOverlay';
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:580px; width:95vw;">
        <div class="modal-header">
          <div class="modal-title"><i class="ri-settings-3-line"></i> Settings (সেটিংস)</div>
          <div id="setClose1" style="cursor:pointer;padding:4px 8px;color:var(--text-muted)"><i class="ri-close-line" style="font-size:20px"></i></div>
        </div>
        <div class="modal-body" style="padding:24px;">

          <!-- 1. Theme / Appearance -->
          <div style="margin-bottom:28px;">
            <div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:14px;">
              <div>
                <h4 style="font-size:15px; font-weight:700; color:var(--text-primary); margin:0; display:flex; align-items:center; gap:8px;">
                  <i class="ri-palette-line" style="color:var(--gold);"></i> 1. ডার্ক / লাইট মুড (Theme)
                </h4>
                <p style="font-size:12px; color:var(--text-muted); margin:3px 0 0 0;">আপনার পছন্দের থিম নির্বাচন করুন</p>
              </div>
              <span class="badge ${currentTheme==='light'?'badge-info':'badge-gold'}" id="currentThemeBadge">
                ${currentTheme==='light' ? '☀️ Light Mode' : '🌙 Dark Mode'}
              </span>
            </div>

            <div style="display:grid; grid-template-columns:1fr 1fr; gap:12px;">
              <!-- Dark Card -->
              <div class="theme-card ${currentTheme==='dark'?'active':''}" id="btnThemeDark" style="padding:16px; border-radius:var(--r-md); border:2px solid ${currentTheme==='dark'?'var(--gold)':'var(--border)'}; background:rgba(6,10,35,0.7); display:flex; align-items:center; gap:12px;">
                <div style="width:40px; height:40px; border-radius:50%; background:rgba(245,166,35,0.15); color:var(--gold); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">
                  <i class="ri-moon-fill"></i>
                </div>
                <div>
                  <div style="font-weight:700; font-size:14px; color:var(--text-primary);">Dark Mode</div>
                  <div style="font-size:11px; color:var(--text-muted);">মিডনাইট ব্লু ও গোল্ড থিম</div>
                </div>
              </div>

              <!-- Light Card -->
              <div class="theme-card ${currentTheme==='light'?'active':''}" id="btnThemeLight" style="padding:16px; border-radius:var(--r-md); border:2px solid ${currentTheme==='light'?'var(--gold)':'var(--border)'}; background:rgba(255,255,255,0.06); display:flex; align-items:center; gap:12px;">
                <div style="width:40px; height:40px; border-radius:50%; background:rgba(2,132,199,0.15); color:var(--blue-bright); display:flex; align-items:center; justify-content:center; font-size:20px; flex-shrink:0;">
                  <i class="ri-sun-fill"></i>
                </div>
                <div>
                  <div style="font-weight:700; font-size:14px; color:var(--text-primary);">Light Mode</div>
                  <div style="font-size:11px; color:var(--text-muted);">উজ্জ্বল ও ফ্রেশ লাইট থিম</div>
                </div>
              </div>
            </div>
          </div>

          <hr style="border:0; border-top:1px solid var(--border); margin:20px 0;">

          <!-- 2. Data Backup & Restore -->
          <div>
            <div style="margin-bottom:14px;">
              <h4 style="font-size:15px; font-weight:700; color:var(--text-primary); margin:0; display:flex; align-items:center; gap:8px;">
                <i class="ri-database-2-line" style="color:var(--gold);"></i> 2. ডাটা ব্যাকআপ ও রিস্টোর (Backup &amp; Restore)
              </h4>
              <p style="font-size:12px; color:var(--text-muted); margin:3px 0 0 0;">সিস্টেমের সমস্ত ডাটা, এজেন্ট, ক্যাশ বুক ও শিট এক ক্লিকে ব্যাকআপ ফাইল হিসেবে ডাউনলোড করুন</p>
            </div>

            <!-- Stats Box -->
            <div style="background:var(--bg-glass); border:1px solid var(--border); border-radius:var(--r-md); padding:14px; margin-bottom:16px;">
              <div style="font-size:11px; font-weight:600; text-transform:uppercase; color:var(--text-muted); letter-spacing:0.5px; margin-bottom:10px;">
                <i class="ri-pie-chart-line"></i> বর্তমান সিস্টেম ডাটা স্ট্যাটাস
              </div>
              <div style="display:grid; grid-template-columns:repeat(auto-fit, minmax(75px, 1fr)); gap:6px; text-align:center;">
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:var(--gold);">${summary.agentsCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Agents</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:#38bdf8;">${summary.balanceCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Balances</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:var(--success);">${summary.cashbookCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Cash Book</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:var(--blue-bright);">${summary.capitalCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Capital</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:#a78bfa;">${summary.empCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Employees</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:#f43f5e;">${summary.loanCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Loans</div>
                </div>
                <div style="padding:6px 2px; background:rgba(255,255,255,0.03); border-radius:6px;">
                  <div style="font-size:16px; font-weight:800; color:var(--danger);">${summary.expCount}</div>
                  <div style="font-size:10px; color:var(--text-secondary);">Expenses</div>
                </div>
              </div>
            </div>

            <!-- Actions -->
            <div style="display:flex; flex-direction:column; gap:10px;">
              <button class="btn btn-primary" id="btnDownloadBackup" style="height:44px; justify-content:center; font-weight:600; font-size:14px;">
                <i class="ri-download-cloud-2-line" style="font-size:18px;"></i> সম্পূর্ণ ডাটা ব্যাকআপ ডাউনলোড করুন (Export Backup)
              </button>
              
              <div style="display:flex; gap:10px;">
                <input type="file" id="backupFileInput" accept=".json" style="display:none;" />
                <button class="btn btn-outline" id="btnTriggerRestore" style="flex:1; height:40px; justify-content:center; font-size:13px;">
                  <i class="ri-upload-cloud-2-line"></i> ব্যাকআপ ফাইল থেকে রিস্টোর (Restore JSON)
                </button>
              </div>
            </div>
          </div>

        </div>
        <div class="modal-footer" style="justify-content:flex-end;">
          <button class="btn btn-ghost" id="setClose2">Close</button>
        </div>
      </div>
    `;

    document.body.appendChild(overlay);

    // Theme switch handlers
    const updateThemeUI = (theme) => {
      ThemeManager.apply(theme);
      const darkBtn = overlay.querySelector('#btnThemeDark');
      const lightBtn = overlay.querySelector('#btnThemeLight');
      const badge = overlay.querySelector('#currentThemeBadge');
      if (theme === 'light') {
        darkBtn.classList.remove('active');
        darkBtn.style.borderColor = 'var(--border)';
        lightBtn.classList.add('active');
        lightBtn.style.borderColor = 'var(--gold)';
        if (badge) {
          badge.className = 'badge badge-info';
          badge.textContent = '☀️ Light Mode';
        }
      } else {
        lightBtn.classList.remove('active');
        lightBtn.style.borderColor = 'var(--border)';
        darkBtn.classList.add('active');
        darkBtn.style.borderColor = 'var(--gold)';
        if (badge) {
          badge.className = 'badge badge-gold';
          badge.textContent = '🌙 Dark Mode';
        }
      }
    };

    overlay.querySelector('#btnThemeDark')?.addEventListener('click', () => updateThemeUI('dark'));
    overlay.querySelector('#btnThemeLight')?.addEventListener('click', () => updateThemeUI('light'));

    // Backup actions
    overlay.querySelector('#btnDownloadBackup')?.addEventListener('click', () => {
      BackupManager.download();
    });

    const fileInput = overlay.querySelector('#backupFileInput');
    overlay.querySelector('#btnTriggerRestore')?.addEventListener('click', () => {
      fileInput?.click();
    });
    fileInput?.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (file) BackupManager.restore(file);
    });

    // Close buttons
    ['setClose1', 'setClose2'].forEach(id => {
      overlay.querySelector('#' + id)?.addEventListener('click', () => overlay.remove());
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
  },

  // ── Show user profile modal (called from sidebar avatar) ──
  showUserMenu() {
    this.openProfileModal();
  },

  // ── Profile & Password Modal ──────────────────────────────
  openProfileModal() {
    document.getElementById('profileModalOverlay')?.remove();
    const u = this.currentUser;
    if (!u) return;

    const initials = (u.name || 'U').split(' ').map(w => w[0]).join('').slice(0,2).toUpperCase();
    const roleColors = { admin: '#a78bfa', 'sub-admin': 'var(--blue-bright)', user: 'var(--text-muted)' };
    const roleBg     = { admin: 'rgba(139,92,246,0.15)', 'sub-admin': 'rgba(79,195,247,0.15)', user: 'rgba(255,255,255,0.06)' };
    const roleBorder = { admin: 'rgba(139,92,246,0.3)', 'sub-admin': 'rgba(79,195,247,0.3)', user: 'var(--border)' };
    const roleLabel  = { admin: '&#x1F451; Super Admin', 'sub-admin': '&#x1F6E1; Sub-Admin', user: '&#x1F464; User' };

    const overlay = document.createElement('div');
    overlay.id = 'profileModalOverlay';
    overlay.className = 'modal-overlay open';
    overlay.innerHTML = `
      <div class="modal" style="max-width:500px">
        <div class="modal-header">
          <div class="modal-title"><i class="ri-user-settings-line"></i> My Profile</div>
          <div id="profClose1" style="cursor:pointer;padding:4px 8px;color:var(--text-muted)"><i class="ri-close-line" style="font-size:18px"></i></div>
        </div>
        <div class="modal-body">
          <!-- User badge -->
          <div style="display:flex;align-items:center;gap:14px;padding:14px;background:var(--bg-glass);border:1px solid var(--border-gold);border-radius:var(--r-md);margin-bottom:20px">
            <div class="user-avatar av-2" style="width:52px;height:52px;font-size:18px;font-weight:800;font-family:'Outfit',sans-serif;flex-shrink:0">${initials}</div>
            <div style="flex:1;min-width:0">
              <div style="font-weight:700;font-size:15px;color:var(--text-primary)">${u.name}</div>
              <div style="font-size:12px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${u.email}</div>
              <span style="display:inline-block;margin-top:5px;font-size:11px;padding:2px 10px;border-radius:20px;
                background:${roleBg[u.role]||roleBg.user};color:${roleColors[u.role]||roleColors.user};
                border:1px solid ${roleBorder[u.role]||roleBorder.user}">
                ${roleLabel[u.role]||roleLabel.user}
              </span>
            </div>
          </div>

          <!-- Tabs -->
          <div class="tabs mb-16" id="profTabs">
            <button class="tab-btn active" data-ptab="info"><i class="ri-user-line"></i> Profile Info</button>
            <button class="tab-btn" data-ptab="pw"><i class="ri-lock-line"></i> Change Password</button>
          </div>

          <!-- Profile Tab -->
          <div id="profInfoTab">
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Full Name *</label>
                <input type="text" id="pName" class="form-control" value="${u.name || ''}" placeholder="Full name">
              </div>
              <div class="form-group">
                <label class="form-label">Position / Title</label>
                <input type="text" id="pPosition" class="form-control" value="${u.position || ''}" placeholder="e.g. Manager">
              </div>
            </div>
            <div class="form-row">
              <div class="form-group">
                <label class="form-label">Phone</label>
                <input type="tel" id="pPhone" class="form-control" value="${u.phone || ''}" placeholder="+880...">
              </div>
              <div class="form-group">
                <label class="form-label">Email *</label>
                <input type="email" id="pEmail" class="form-control" value="${u.email || ''}">
              </div>
            </div>
            <div style="display:flex;justify-content:center;margin-top:16px">
              <button class="btn btn-primary" id="profSaveBtn" style="min-width:180px;height:44px;justify-content:center">
                <i class="ri-save-line"></i> Save Profile
              </button>
            </div>
          </div>

          <!-- Password Tab -->
          <div id="profPwTab" style="display:none">
            <div class="form-group">
              <label class="form-label">Current Password *</label>
              <input type="password" id="pOldPw" class="form-control" placeholder="Enter your current password">
            </div>
            <div class="form-group">
              <label class="form-label">New Password *</label>
              <input type="password" id="pNewPw" class="form-control" placeholder="Minimum 6 characters">
            </div>
            <div class="form-group">
              <label class="form-label">Confirm New Password *</label>
              <input type="password" id="pConfPw" class="form-control" placeholder="Repeat new password">
            </div>
            <div id="pwErr" style="display:none;font-size:13px;padding:8px 12px;color:var(--danger);
              background:rgba(239,68,68,0.08);border:1px solid rgba(239,68,68,0.2);
              border-radius:var(--r-sm);margin-bottom:10px"></div>
            <div style="display:flex;justify-content:center;margin-top:16px">
              <button class="btn btn-primary" id="profSavePwBtn" style="min-width:180px;height:44px;justify-content:center">
                <i class="ri-lock-password-line"></i> Update Password
              </button>
            </div>
          </div>
        </div>
        <div class="modal-footer" style="justify-content:space-between">
          <button class="btn btn-danger" id="profLogoutBtn"><i class="ri-logout-box-r-line"></i> Logout</button>
          <button class="btn btn-ghost" id="profClose2">Close</button>
        </div>
      </div>`;

    document.body.appendChild(overlay);

    // Tab switch
    overlay.querySelectorAll('#profTabs .tab-btn').forEach(btn => {
      btn.addEventListener('click', function() {
        overlay.querySelectorAll('#profTabs .tab-btn').forEach(b => b.classList.remove('active'));
        this.classList.add('active');
        document.getElementById('profInfoTab').style.display = this.dataset.ptab === 'info' ? '' : 'none';
        document.getElementById('profPwTab').style.display   = this.dataset.ptab === 'pw'   ? '' : 'none';
      });
    });

    // Close buttons
    ['profClose1', 'profClose2'].forEach(id => {
      overlay.querySelector('#' + id)?.addEventListener('click', () => overlay.remove());
    });
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    // Logout
    overlay.querySelector('#profLogoutBtn')?.addEventListener('click', () => Auth.logout());

    // Save Profile Info
    overlay.querySelector('#profSaveBtn')?.addEventListener('click', () => {
      const name  = document.getElementById('pName').value.trim();
      const email = document.getElementById('pEmail').value.trim().toLowerCase();
      if (!name)  { Toast.error('Name is required.'); return; }
      if (!email) { Toast.error('Email is required.'); return; }
      const existing = DB.getUserByEmail(email);
      if (existing && existing.id !== u.id) { Toast.error('Email already used by another account.'); return; }

      DB.updateUser(u.id, {
        name,
        email,
        position: document.getElementById('pPosition').value.trim(),
        phone:    document.getElementById('pPhone').value.trim(),
      });

      // Refresh session
      const fresh = DB.getUserById(u.id);
      const sess = { ...fresh }; delete sess.password;
      localStorage.setItem(Auth.SESSION_KEY, JSON.stringify(sess));
      App.currentUser = sess;

      Toast.success('Profile updated successfully!');
      overlay.remove();
      Sidebar.build(null);
    });

    // Change Password
    overlay.querySelector('#profSavePwBtn')?.addEventListener('click', () => {
      const oldPw = document.getElementById('pOldPw').value;
      const newPw = document.getElementById('pNewPw').value;
      const conPw = document.getElementById('pConfPw').value;
      const errDiv = document.getElementById('pwErr');
      errDiv.style.display = 'none';
      const showErr = msg => { errDiv.textContent = msg; errDiv.style.display = ''; };

      const freshUser = DB.getUserById(u.id);
      if (!freshUser) { showErr('Session error. Please reload.'); return; }
      if (freshUser.password !== btoa(oldPw)) { showErr('Current password is incorrect.'); return; }
      if (newPw.length < 6) { showErr('New password must be at least 6 characters.'); return; }
      if (newPw !== conPw)  { showErr('New passwords do not match.'); return; }

      DB.updateUser(u.id, { password: btoa(newPw) });
      Toast.success('Password updated successfully!');
      overlay.remove();
    });
  },

  requireAdmin() {
    if (!Auth.isAdmin()) {
      Toast.error('Admin access required.');
      setTimeout(() => window.location.href = 'dashboard.html', 1500);
      return false;
    }
    return true;
  },

  requireSuperAdmin() {
    if (!Auth.isSuperAdmin()) {
      Toast.error('Super Admin access required.');
      setTimeout(() => window.location.href = 'dashboard.html', 1500);
      return false;
    }
    return true;
  },
};

// ── Header HTML builder ───────────────────────────────────────
function buildPageShell(pageTitle, pageSubtitle) {
  return `
    <div id="sidebar" class="sidebar"></div>
    <div id="sidebarOverlay" class="sidebar-overlay"></div>
    <div class="main-content" id="mainContent">
      <header class="top-header" id="topHeader">
        <button class="header-toggle" id="sidebarToggle" aria-label="Toggle sidebar">
          <i class="ri-menu-line"></i>
        </button>
        <div class="header-title">
          <h1 id="headerTitle">${pageTitle}</h1>
          <p id="headerSubtitle">${pageSubtitle}</p>
        </div>
        <div class="header-actions">
          <div class="header-btn" title="Notifications">
            <i class="ri-notification-3-line"></i>
            <div class="header-notif-dot"></div>
          </div>
          <div class="header-btn header-btn-settings" id="settingsBtn" title="Settings">
            <i class="ri-settings-3-line"></i>
            <span class="header-btn-label">Settings</span>
          </div>
        </div>
      </header>
      <div class="page-wrapper" id="pageContent">`;
  // Close with </div></div> in each page
}

// ── UI Enhancements v2.0 ──────────────────────────────────────
const UIEnhancements = {

  /**
   * Add ripple effect to all .btn elements globally.
   * Call once on DOMContentLoaded.
   */
  initRipple() {
    document.addEventListener('pointerdown', (e) => {
      const btn = e.target.closest('.btn, .header-btn, .tbl-btn, .nav-item');
      if (!btn) return;

      const rect = btn.getBoundingClientRect();
      const size = Math.max(rect.width, rect.height) * 1.5;
      const x = e.clientX - rect.left - size / 2;
      const y = e.clientY - rect.top  - size / 2;

      const wave = document.createElement('span');
      wave.className = 'ripple-wave';
      wave.style.cssText = `width:${size}px;height:${size}px;left:${x}px;top:${y}px`;
      btn.appendChild(wave);
      wave.addEventListener('animationend', () => wave.remove());
    }, { passive: true });
  },

  /**
   * Initialize Floating Action Button (FAB) on mobile.
   * @param {string} label  - tooltip label
   * @param {Function} onClick - click callback
   */
  initFAB(label = 'Add New', onClick = null) {
    // Remove existing FAB
    document.querySelector('.fab')?.remove();

    const fab = document.createElement('div');
    fab.className = 'fab';
    fab.innerHTML = `
      <button class="fab-btn" id="fabBtn" aria-label="${label}" title="${label}">
        <i class="ri-add-line"></i>
      </button>
      <span class="fab-label">${label}</span>`;
    document.body.appendChild(fab);

    if (onClick) {
      document.getElementById('fabBtn').addEventListener('click', onClick);
    }
  },

  /**
   * Render a breadcrumb trail in an element.
   * @param {string} containerId - element id
   * @param {Array<{label, href?}>} crumbs
   */
  setBreadcrumb(containerId, crumbs = []) {
    const el = document.getElementById(containerId);
    if (!el) return;
    const home = { label: '<i class="ri-home-4-line"></i> Home', href: 'dashboard.html' };
    const all = [home, ...crumbs];
    el.innerHTML = all.map((c, i) => {
      const isLast = i === all.length - 1;
      const item = isLast
        ? `<span class="breadcrumb-item active">${c.label}</span>`
        : `<span class="breadcrumb-item"><a href="${c.href || '#'}">${c.label}</a></span>`;
      const sep = isLast ? '' : `<i class="ri-arrow-right-s-line breadcrumb-separator"></i>`;
      return item + sep;
    }).join('');
  },

  /**
   * Replace table body with skeleton loader rows.
   * @param {string} tbodyId - tbody element id
   * @param {number} cols - number of columns
   * @param {number} rows - number of skeleton rows (default 5)
   */
  skeletonRows(tbodyId, cols = 4, rows = 5) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const widths = ['70%', '50%', '80%', '40%', '60%', '55%', '75%'];
    let html = '';
    for (let r = 0; r < rows; r++) {
      html += '<tr class="skeleton-row">';
      for (let c = 0; c < cols; c++) {
        const w = widths[(r * cols + c) % widths.length];
        html += `<td><span style="width:${w}"></span></td>`;
      }
      html += '</tr>';
    }
    tbody.innerHTML = html;
  },

  /**
   * Put a KPI card into loading skeleton state.
   * @param {string} cardId
   */
  skeletonKPI(cardId) {
    const card = document.getElementById(cardId);
    if (card) card.classList.add('loading');
  },

  /**
   * Animate a KPI card: remove skeleton, counter animation, progress bar, sparkline.
   * @param {Object} opts
   * @param {string} opts.cardId
   * @param {number} opts.value       - numeric value
   * @param {string} opts.valueEl     - id of value element
   * @param {number} opts.progress    - 0-100 for progress bar
   * @param {number[]} opts.sparkData - array of relative heights [0-100]
   * @param {string} opts.prefix      - currency prefix default '৳'
   * @param {string} opts.changeEl    - id of change badge element
   * @param {number} opts.changePct   - % change
   */
  animateKPI({ cardId, value = 0, valueEl, progress = 0, sparkData = [], prefix = '৳', changeEl, changePct }) {
    const card = document.getElementById(cardId);
    if (card) card.classList.remove('loading');

    // Counter animation
    if (valueEl) {
      const el = document.getElementById(valueEl);
      if (el) animateCount(el, value, 1200, prefix);
    }

    // Progress bar
    if (card) {
      let bar = card.querySelector('.kpi-progress-fill');
      if (!bar) {
        const wrap = document.createElement('div');
        wrap.className = 'kpi-progress';
        bar = document.createElement('div');
        bar.className = 'kpi-progress-fill';
        wrap.appendChild(bar);
        card.appendChild(wrap);
      }
      // animate after paint
      requestAnimationFrame(() => {
        requestAnimationFrame(() => { bar.style.width = Math.min(100, Math.max(0, progress)) + '%'; });
      });
    }

    // Sparkline bars
    if (card && sparkData.length) {
      let sparkEl = card.querySelector('.kpi-sparkline');
      if (!sparkEl) {
        sparkEl = document.createElement('div');
        sparkEl.className = 'kpi-sparkline';
        card.appendChild(sparkEl);
      }
      sparkEl.innerHTML = sparkData.map(h =>
        `<span style="height:${Math.max(4, (h/100)*28)}px"></span>`
      ).join('');
    }

    // Change badge
    if (changeEl && changePct !== undefined) {
      const el = document.getElementById(changeEl);
      if (el) {
        const isUp = changePct >= 0;
        el.className = `kpi-change ${isUp ? 'up' : 'down'}`;
        el.innerHTML = `<i class="ri-arrow-${isUp ? 'up' : 'down'}-s-line"></i> ${Math.abs(changePct).toFixed(1)}%`;
      }
    }
  },

  /**
   * Animate table row entrances with stagger.
   * @param {string} tbodyId
   */
  animateTableRows(tbodyId) {
    const tbody = document.getElementById(tbodyId);
    if (!tbody) return;
    const rows = tbody.querySelectorAll('tr:not(.skeleton-row)');
    rows.forEach((row, i) => {
      row.style.opacity = '0';
      row.style.transform = 'translateX(-6px)';
      row.style.transition = 'none';
      requestAnimationFrame(() => {
        setTimeout(() => {
          row.style.transition = 'opacity 0.3s ease, transform 0.3s ease';
          row.style.opacity = '1';
          row.style.transform = 'translateX(0)';
        }, i * 35);
      });
    });
  },

  /**
   * Set a button into loading state with spinner.
   * Returns a function to reset the button.
   * @param {HTMLElement|string} btn - element or id
   * @param {string} loadingText
   */
  btnLoading(btn, loadingText = 'Saving...') {
    if (typeof btn === 'string') btn = document.getElementById(btn);
    if (!btn) return () => {};
    const original = btn.innerHTML;
    btn.innerHTML = `<span class="btn-spinner"></span> ${loadingText}`;
    btn.classList.add('btn-loading');
    return () => {
      btn.innerHTML = original;
      btn.classList.remove('btn-loading');
    };
  },

  /**
   * Init all UI enhancements — call this once on page load.
   */
  init() {
    this.initRipple();
  }
};

// Auto-initialize UI enhancements when DOM is ready
window.UIEnhancements = UIEnhancements;
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => UIEnhancements.init());
} else {
  UIEnhancements.init();
}

