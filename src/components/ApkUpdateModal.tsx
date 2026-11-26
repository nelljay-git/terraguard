import { useState, useEffect, useRef, useCallback } from 'react';
import { X, Download, Smartphone } from 'lucide-react';
import { IS_NATIVE } from '../lib/nativeHttp';
import { useIsMobileViewport } from '../lib/useMobileViewport';
import {
  checkForApkUpdate,
  fetchLatestRelease,
  openApkDownload,
  type LatestRelease,
} from '../lib/appUpdate';
import './ApkUpdateModal.css';

/**
 * Standalone APK prompt. Unlike the "What's New" modal this is not persisted —
 * it appears on every app session while an APK is available to download.
 */
export function ApkUpdateModal() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [open, setOpen] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const isMobileViewport = useIsMobileViewport();
  // The APK is a native client even on a tablet-width WebView.
  const isMobileView = IS_NATIVE || isMobileViewport;

  useEffect(() => {
    if (!isMobileView) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | undefined;

    // Native compares against the installed version; mobile web simply offers
    // the latest published APK (there is no installed version to compare).
    const request = IS_NATIVE ? checkForApkUpdate() : fetchLatestRelease();
    void request.then((rel) => {
      if (!cancelled && rel) {
        setRelease(rel);
        // Let the changelog modal show first if this is a new version.
        timer = setTimeout(() => { if (!cancelled) setOpen(true); }, 1800);
      }
    });

    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [isMobileView]);

  const handleClose = useCallback(() => setOpen(false), []);

  /* Escape to close, scroll lock, focus trap, focus restore */
  useEffect(() => {
    if (!open) return;
    const modal = modalRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstFocusable = modal?.querySelector<HTMLElement>('button:not([disabled])');
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleClose();
        return;
      }
      if (e.key !== 'Tab' || !modal) return;
      const focusables = Array.from(
        modal.querySelectorAll<HTMLElement>('button:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])')
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      previouslyFocused?.focus?.();
    };
  }, [open, handleClose]);

  if (!open || !release) return null;

  const features = (release.notes ?? '')
    .split('\n')
    .map((line) => line.replace(/^\s*[-*]\s*/, '').trim())
    .filter((line) => line && !/^install\b/i.test(line) && !/^terra\s*guard v/i.test(line))
    .slice(0, 4);

  return (
    <div
      className="apk-modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) handleClose(); }}
    >
      <div
        ref={modalRef}
        className="apk-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="apk-modal-title"
      >
        <div className="apk-modal-header">
          <div className="apk-modal-header-content">
            <div className="apk-modal-icon" aria-hidden="true">
              <Smartphone size={19} />
            </div>
            <div>
              <h2 id="apk-modal-title" className="apk-modal-title">TerraGuard APK</h2>
              <span className="apk-modal-subtitle">Android app · v{release.version}</span>
            </div>
          </div>
          <button className="apk-modal-close" onClick={handleClose} aria-label="Close APK prompt">
            <X size={18} />
          </button>
        </div>

        <div className="apk-modal-body">
          <p className="apk-modal-message">
            {IS_NATIVE
              ? 'A newer APK is available. Download it on this device, then tap the file to install.'
              : 'Get the native Android app for real push notifications and faster access. Download the APK, then open the file on your phone to install.'}
          </p>
          {features.length > 0 && (
            <ul className="apk-modal-features">
              {features.map((feature) => (
                <li key={feature}>{feature}</li>
              ))}
            </ul>
          )}
        </div>

        <div className="apk-modal-footer">
          <button
            className="apk-modal-download"
            onClick={() => { openApkDownload(release.apkUrl); handleClose(); }}
          >
            <Download size={16} aria-hidden="true" />
            Download APK (v{release.version})
          </button>
          <button className="apk-modal-later" onClick={handleClose}>
            Not now
          </button>
        </div>
      </div>
    </div>
  );
}
