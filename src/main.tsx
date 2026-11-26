import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { Capacitor } from '@capacitor/core'
import App from './App.tsx'
import './index.css'

// Older APK builds registered a PWA service worker inside the Capacitor
// WebView. Its Workbox cache survives APK updates and can keep serving the
// previous JS bundle (e.g. the old volcano/news fetch code). Purge it once.
if (Capacitor.isNativePlatform() && 'serviceWorker' in navigator) {
  void (async () => {
    try {
      const registrations = await navigator.serviceWorker.getRegistrations()
      await Promise.all(registrations.map((r) => r.unregister()))
      if ('caches' in window) {
        const keys = await caches.keys()
        await Promise.all(keys.map((k) => caches.delete(k)))
      }
      if (sessionStorage.getItem('tg_sw_purged') !== '1') {
        sessionStorage.setItem('tg_sw_purged', '1')
        window.location.reload()
      }
    } catch { /* best effort — never block the app */ }
  })()
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
