import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.terraguard.app',
  appName: 'TerraGuard',
  webDir: 'dist',
  server: {
    // Allow the WebView to load the deployed Pages host so /api/* proxy
    // calls reach the real backend instead of the WebView's own origin.
    allowNavigation: ['terraguard-ph.pages.dev'],
  },
  plugins: {
    StatusBar: {
      style: 'dark',
      backgroundColor: '#0f172a',
    },
  },
};

export default config;
