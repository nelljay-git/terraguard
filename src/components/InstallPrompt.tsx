import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Download, Share, X, Smartphone } from 'lucide-react';
import './InstallPrompt.css';

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>;
}

const DISMISSED_KEY = 'terraguard_install_dismissed';
const SHOW_DELAY_MS = 4000;

function isIOS() {
  return /iphone|ipad|ipod/i.test(navigator.userAgent) && !(window as any).MSStream;
}

function isInStandaloneMode() {
  return (
    window.matchMedia('(display-mode: standalone)').matches ||
    (window.navigator as any).standalone === true
  );
}

export function InstallPrompt() {
  const [visible, setVisible] = useState(false);
  const [isIos, setIsIos] = useState(false);
  const deferredPrompt = useRef<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    // Never show if already running as installed PWA
    if (isInStandaloneMode()) return;

    // Don't show if dismissed in this session
    if (sessionStorage.getItem(DISMISSED_KEY)) return;

    const ios = isIOS();
    setIsIos(ios);

    // Capture the Chrome/Edge install event
    const onBeforeInstall = (e: Event) => {
      e.preventDefault();
      deferredPrompt.current = e as BeforeInstallPromptEvent;
    };
    window.addEventListener('beforeinstallprompt', onBeforeInstall);

    // Show the prompt after a delay regardless of whether the browser
    // event fired — on iOS and in dev mode it won't fire, but we still
    // want to surface the install instructions.
    const timer = setTimeout(() => {
      setVisible(true);
    }, SHOW_DELAY_MS);

    return () => {
      clearTimeout(timer);
      window.removeEventListener('beforeinstallprompt', onBeforeInstall);
    };
  }, []);

  const handleInstall = async () => {
    if (deferredPrompt.current) {
      // Native install dialog
      await deferredPrompt.current.prompt();
      const { outcome } = await deferredPrompt.current.userChoice;
      deferredPrompt.current = null;
      if (outcome === 'accepted') {
        setVisible(false);
      }
    } else if (!isIos) {
      // Guide the user to use the browser's address bar install icon
      alert('To install TerraGuard, click the install icon (⊕) in your browser\'s address bar, or use the browser menu → "Install TerraGuard".');
    }
  };

  const handleDismiss = () => {
    sessionStorage.setItem(DISMISSED_KEY, '1');
    setVisible(false);
  };

  const showInstallButton = !isIos;

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="install-prompt"
          initial={{ opacity: 0, y: 80, scale: 0.95 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 60, scale: 0.95 }}
          transition={{ type: 'spring', damping: 26, stiffness: 320, mass: 0.9 }}
          role="dialog"
          aria-label="Install TerraGuard"
        >
          <div className="install-prompt-inner">
            {/* App icon */}
            <div className="install-prompt-icon">
              <img src="/pwa-192x192.png" alt="TerraGuard" />
            </div>

            {/* Text */}
            <div className="install-prompt-text">
              <div className="install-prompt-title">
                <Smartphone size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle', opacity: 0.7 }} />
                Install TerraGuard
              </div>
              <div className="install-prompt-sub">
                {isIos
                  ? 'Tap Share → "Add to Home Screen"'
                  : 'Faster access'}
              </div>
            </div>

            {/* Actions */}
            <div className="install-prompt-actions">
              {showInstallButton && (
                <button
                  id="pwa-install-btn"
                  className="install-prompt-btn primary"
                  onClick={handleInstall}
                >
                  <Download size={13} style={{ display: 'inline', marginRight: 5, verticalAlign: 'middle' }} />
                  Install
                </button>
              )}
              <button
                id="pwa-dismiss-btn"
                className="install-prompt-btn secondary"
                onClick={handleDismiss}
                aria-label="Dismiss"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* iOS manual instructions */}
          {isIos && (
            <motion.div
              className="install-ios-hint"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: 0.25 }}
            >
              <Share size={13} />
              Tap the <strong style={{ color: 'var(--text-secondary)', margin: '0 3px' }}>Share</strong>
              icon in Safari, then
              <strong style={{ color: 'var(--text-secondary)', margin: '0 3px' }}>"Add to Home Screen"</strong>
            </motion.div>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  );
}
