import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Share, X } from 'lucide-react';
import './InstallPrompt.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'terraguard_install_dismissed';

function isIOS() {
  return (
    /iphone|ipad|ipod/i.test(navigator.userAgent) &&
    !(window as any).MSStream
  );
}

function isInStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function InstallPrompt() {
  const [deferredPrompt, setDeferredPrompt] =
    useState<BeforeInstallPromptEvent | null>(null);
  const [showIOSHint, setShowIOSHint] = useState(false);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Don't show if already installed or previously dismissed
    if (isInStandaloneMode()) return;
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    if (isIOS()) {
      // iOS doesn't fire beforeinstallprompt — show manual instructions
      const timer = setTimeout(() => setShowIOSHint(true), 3000);
      setVisible(true);
      return () => clearTimeout(timer);
    }

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      // Slight delay so it doesn't compete with the update modal
      setTimeout(() => setVisible(true), 3500);
    };

    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const handleInstall = async () => {
    if (!deferredPrompt) return;
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === 'accepted') {
      setVisible(false);
    }
    setDeferredPrompt(null);
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  // Nothing to show: no prompt and not iOS
  if (!deferredPrompt && !showIOSHint) return null;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="install-prompt"
          initial={{ opacity: 0, y: 80, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 60, scale: 0.95 }}
          transition={{
            type: 'spring',
            damping: 26,
            stiffness: 320,
            mass: 0.9,
          }}
          role="dialog"
          aria-label="Install TerraGuard"
        >
          <div className="install-prompt-inner">
            {/* App icon */}
            <div className="install-prompt-icon">
              <img src="/pwa-192x192.png" alt="TerraGuard icon" />
            </div>

            {/* Text */}
            <div className="install-prompt-text">
              <div className="install-prompt-title">Install TerraGuard</div>
              <div className="install-prompt-sub">
                {showIOSHint
                  ? 'Add to Home Screen for offline access'
                  : 'Get the app for a faster experience'}
              </div>
            </div>

            {/* Actions */}
            <div className="install-prompt-actions">
              {!showIOSHint && (
                <button
                  id="pwa-install-btn"
                  className="install-prompt-btn primary"
                  onClick={handleInstall}
                >
                  <Download size={14} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
                  Install
                </button>
              )}
              <button
                id="pwa-dismiss-btn"
                className="install-prompt-btn secondary"
                onClick={handleDismiss}
                aria-label="Dismiss install prompt"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* iOS-specific instructions */}
          {showIOSHint && (
            <motion.div
              className="install-ios-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.2 }}
            >
              <Share size={14} />
              Tap the <strong style={{ color: 'var(--text-secondary)', margin: '0 3px' }}>Share</strong>
              button, then
              <strong style={{ color: 'var(--text-secondary)', margin: '0 3px' }}>"Add to Home Screen"</strong>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
