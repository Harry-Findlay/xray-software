import { create } from 'zustand';

export const useLicenseStore = create((set, get) => ({
  isLicensed: false,
  license: null,
  status: null,

  checkLicense: async () => {
    try {
      const status = await window.electronAPI?.license?.validate();

      // Dev bypass — licenseManager returns { active: true, dev: true }
      // when no real public key is configured
      if (status?.active) {
        set({ isLicensed: true, status, license: status.license });
        return true;
      }

      set({ isLicensed: false, status, license: null });
      return false;
    } catch (err) {
      console.error('License check failed:', err);
      // If the IPC call itself errors in dev, allow through
      if (process.env.NODE_ENV === 'development') {
        const devStatus = { active: true, dev: true, license: { tier: 'dev', seats: 99 } };
        set({ isLicensed: true, status: devStatus });
        return true;
      }
      return false;
    }
  },

  activate: async (key) => {
    try {
      const result = await window.electronAPI?.license?.activate(key);
      if (result?.success) {
        set({ isLicensed: true, license: result.license, status: { active: true, license: result.license } });
      }
      return result;
    } catch (err) {
      return { success: false, error: 'Could not reach license server: ' + err.message };
    }
  },

  deactivate: async () => {
    try {
      const result = await window.electronAPI?.license?.deactivate();
      if (result?.success) {
        set({ isLicensed: false, license: null, status: { active: false } });
      }
      return result;
    } catch (err) {
      return { success: false, error: err.message };
    }
  },
}));
