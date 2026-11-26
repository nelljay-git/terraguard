import { useState, useEffect, useRef, useCallback } from 'react';
import {
  X,
  Megaphone,
  CalendarDays,
} from 'lucide-react';
import { IS_NATIVE } from '../lib/nativeHttp';
import { useIsMobileViewport } from '../lib/useMobileViewport';
import './DevUpdateModal.css';

// ─── EDIT THIS SECTION TO UPDATE THE MODAL CONTENT ───────────────────────────
// Change the `version` string whenever you publish a new update so returning
// users see the modal again. The modal won't reappear until the version changes.

type BadgeType = 'new' | 'improved' | 'fixed' | 'info';

interface UpdateItem {
  badge: BadgeType;
  title: string;
  description: string;
  quick_changes: string;
}

interface UpdateData {
  version: string;
  date: string;
  greeting: string;
  items: UpdateItem[];
}

// Added "quick_changes" field to each item for easy copy paste on history page

const UPDATE_DATA: UpdateData = {
  version: '1.10',
  date: 'November 26, 2026',
  greeting:
    "We've been working hard to make TerraGuard better! Here's what's new in this update:",

  items: [
    {
      badge: 'new',
      title: 'Separate APK Prompt',
      description:
        'The APK download button now has its own modal that appears each session, instead of being buried inside What’s New.',
      quick_changes: 'Moved APK download prompt into a standalone modal'
    },
    {
      badge: 'fixed',
      title: 'Native Data Loading',
      description:
        'Fixed volcano bulletins and earthquake news failing to load in the APK by correcting how JSON responses from the native HTTP layer are handled.',
      quick_changes: 'Fixed volcano bulletin and news loading in the APK'
    },
    {
      badge: 'new',
      title: 'In-app APK Updates',
      description:
        'TerraGuard now checks for a newer APK and shows a download button right in the update modal — no need to hunt for the latest file.',
      quick_changes: 'Added in-app APK update check with direct download link'
    },
    {
      badge: 'new',
      title: 'Community Forum',
      description:
        'Create earthquake posts, share updates, and discuss with the community. Like, bookmark, pin comments, and attach images to your posts.',
      quick_changes: 'Added community forum with posts, reactions, and images'
    },
    {
      badge: 'new',
      title: 'Comments & Replies',
      description:
        'Comment and reply on earthquakes, posts, and news. Tap a notification to jump straight to the comment.',
      quick_changes: 'Added comments, replies, and notification deep-links'
    },
    {
      badge: 'new',
      title: 'Light & Dark Theme',
      description:
        'Choose between Light, Dark, or System theme from Settings. Your preference is saved to your account.',
      quick_changes: 'Added light/dark theme preference saved to your account'
    },
    {
      badge: 'improved',
      title: 'Notifications',
      description:
        'Get notified when someone reacts to or comments on your posts and earthquakes, with one-tap navigation to the exact comment.',
      quick_changes: 'Improved notifications with one-tap navigation'
    },
    {
      badge: 'fixed',
      title: 'Bug Fixes',
      description:
        'Fixed comment deletion refreshing, theme-aware post cards, and various performance improvements.',
      quick_changes: 'Fixed bugs and improved performance'
    },
  ],
};

// ─── END OF EDITABLE SECTION ─────────────────────────────────────────────────

const STORAGE_KEY = 'terraguard_last_seen_update';

const badgeLabel: Record<BadgeType, string> = {
  new: 'New',
  improved: 'Improved',
  fixed: 'Fixed',
  info: 'Info',
};

export function DevUpdateModal() {
  const [showModal, setShowModal] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);
  const isMobileViewport = useIsMobileViewport();
  // The APK is always a mobile client even on a tablet-width WebView.
  const isMobileView = IS_NATIVE || isMobileViewport;
  // Update modals are for mobile view only (including the APK).
  const isOpen = showModal && isMobileView;

  useEffect(() => {
    if (!isMobileView) return;
    // New changelog in this build — show once per version.
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== UPDATE_DATA.version) {
      const timer = setTimeout(() => setShowModal(true), 800);
      return () => clearTimeout(timer);
    }
  }, [isMobileView]);

  const handleDismiss = useCallback(() => {
    localStorage.setItem(STORAGE_KEY, UPDATE_DATA.version);
    setShowModal(false);
  }, []);

  /* Escape to close, body scroll lock, simple focus trap, focus restore */
  useEffect(() => {
    if (!isOpen) return;
    const modal = modalRef.current;
    const previouslyFocused = document.activeElement as HTMLElement | null;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    const firstFocusable = modal?.querySelector<HTMLElement>('button:not([disabled])');
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        handleDismiss();
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
  }, [isOpen, handleDismiss]);

  if (!isOpen) return null;

  return (
    <div
      className="dev-modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) handleDismiss();
      }}
    >
      <div
        ref={modalRef}
        className="dev-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="dev-modal-title"
      >
        {/* Header */}
        <div className="dev-modal-header">
          <div className="dev-modal-header-content">
            <div className="dev-modal-icon" aria-hidden="true">
              <Megaphone size={20} />
            </div>
            <div className="dev-modal-headtext">
              <h2 id="dev-modal-title" className="dev-modal-title">What&rsquo;s New</h2>
              <span className="dev-modal-version tnum">v{UPDATE_DATA.version} · TerraGuard</span>
            </div>
          </div>
          <button
            className="dev-modal-close"
            onClick={handleDismiss}
            aria-label="Close update modal"
          >
            <X size={18} />
          </button>
        </div>

        {/* Date */}
        <div className="dev-modal-date">
          <CalendarDays size={13} aria-hidden="true" />
          <time>{UPDATE_DATA.date}</time>
        </div>

        {/* Body */}
        <div className="dev-modal-body">
          <p className="dev-modal-message">{UPDATE_DATA.greeting}</p>

          <ul className="dev-modal-updates">
            {UPDATE_DATA.items.map((item) => (
              <li key={item.title} className="dev-update-item">
                <span className={`dev-update-tag ${item.badge}`}>
                  <span className="dev-update-tag-dot" aria-hidden="true" />
                  {badgeLabel[item.badge]}
                </span>
                <div className="dev-update-text">
                  <strong>{item.title}</strong>
                  <span>{item.description}</span>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Footer */}
        <div className="dev-modal-footer">
          <button className="dev-modal-dismiss" onClick={handleDismiss}>
            Got it, thanks!
          </button>
          <button
            className="dev-modal-dont-show"
            onClick={handleDismiss}
          >
            Don&rsquo;t show this again for v{UPDATE_DATA.version}
          </button>
        </div>
      </div>
    </div>
  );
}
