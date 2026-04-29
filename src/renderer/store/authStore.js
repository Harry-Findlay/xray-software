import { create } from 'zustand';

export const useAuthStore = create((set, get) => ({
  user: null,
  isAuthenticated: false,
  sessionTimer: null,

  /** Called at startup — sessions are not persisted across launches for security */
  checkSession: async () => false,

  login: async (username, password) => {
    try {
      const result = await window.electronAPI?.auth.login(username, password);
      if (result?.success) {
        set({ user: result.user, isAuthenticated: true });
        get().startSessionTimer();
        return { success: true };
      }
      return { success: false, error: result?.error || 'Invalid credentials' };
    } catch (err) {
      console.error('Login error:', err);
      return { success: false, error: 'Login failed — check the database connection' };
    }
  },

  logout: () => {
    const { sessionTimer } = get();
    if (sessionTimer) clearTimeout(sessionTimer);
    set({ user: null, isAuthenticated: false, sessionTimer: null });
  },

  startSessionTimer: () => {
    const { sessionTimer } = get();
    if (sessionTimer) clearTimeout(sessionTimer);
    // Default 30 min — future: read from settings
    const timer = setTimeout(() => {
      console.log('[Auth] Session timed out');
      get().logout();
    }, 30 * 60 * 1000);
    set({ sessionTimer: timer });
  },

  extendSession: () => {
    if (get().user) get().startSessionTimer();
  },

  hasPermission: (permission) => {
    const { user } = get();
    if (!user) return false;
    const map = {
      admin:        ['*'],
      dentist:      ['patients:read','patients:write','imaging:read','imaging:write','reports:write'],
      hygienist:    ['patients:read','imaging:read','imaging:write'],
      receptionist: ['patients:read','patients:write','appointments:read','appointments:write'],
      readonly:     ['patients:read','imaging:read'],
    };
    const perms = map[user.role] || [];
    return perms.includes('*') || perms.includes(permission);
  },
}));
