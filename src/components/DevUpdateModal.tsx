import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Megaphone,
  Sparkles,
  Zap,
  Wrench,
  Info,
  CalendarDays,
} from 'lucide-react';
import './DevUpdateModal.css';

// ─── EDIT THIS SECTION TO UPDATE THE MODAL CONTENT ───────────────────────────
// Change the `version` string whenever you publish a new update so returning
// users see the modal again. The modal won't reappear until the version changes.

type BadgeType = 'new' | 'improved' | 'fixed' | 'info';

interface UpdateItem {
  badge: BadgeType;
  title: string;
  description: string;
}

interface UpdateData {
  version: string;
  date: string;
  greeting: string;
  items: UpdateItem[];
}

const UPDATE_DATA: UpdateData = {
  version: '2.1.0',
  date: 'June 15, 2026',
  greeting:
    "We've been working hard to make TerraGuard better! Here's what's new in this update:",
  items: [
    {
      badge: 'new',
      title: 'PWA Support',
      description:
        'Install TerraGuard on your device for offline access and a native app experience.',
    },
    {
      badge: 'improved',
      title: 'Interactive Map',
      description:
        'Better marker clustering, heatmap overlays, and smoother pan/zoom performance.',
    },
    {
      badge: 'fixed',
      title: 'News Feed',
      description:
        'Resolved issues with article loading and improved headline accuracy.',
    },
    {
      badge: 'fixed',
      title: 'Bug Fixes',
      description:
        'Fixed various bugs and improved overall performance.',
    },
  ],
};

// ─── END OF EDITABLE SECTION ─────────────────────────────────────────────────

const STORAGE_KEY = 'terraguard_last_seen_update';

const badgeIcons: Record<BadgeType, React.ReactNode> = {
  new: <Sparkles size={16} />,
  improved: <Zap size={16} />,
  fixed: <Wrench size={16} />,
  info: <Info size={16} />,
};

export function DevUpdateModal() {
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    const lastSeen = localStorage.getItem(STORAGE_KEY);
    if (lastSeen !== UPDATE_DATA.version) {
      // Small delay so it doesn't flash on initial load
      const timer = setTimeout(() => setIsOpen(true), 800);
      return () => clearTimeout(timer);
    }
  }, []);

  const handleDismiss = () => {
    localStorage.setItem(STORAGE_KEY, UPDATE_DATA.version);
    setIsOpen(false);
  };

  const handleDontShowAgain = () => {
    localStorage.setItem(STORAGE_KEY, UPDATE_DATA.version);
    setIsOpen(false);
  };

  return (
    <AnimatePresence>
      {isOpen && (
        <motion.div
          className="dev-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.25 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) handleDismiss();
          }}
        >
          <motion.div
            className="dev-modal"
            initial={{ opacity: 0, scale: 0.92, y: 30 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 20 }}
            transition={{
              type: 'spring',
              damping: 28,
              stiffness: 350,
              mass: 0.8,
            }}
          >
            {/* Header */}
            <div className="dev-modal-header">
              <div className="dev-modal-header-content">
                <div className="dev-modal-icon">
                  <Megaphone size={22} />
                </div>
                <div>
                  <h2 className="dev-modal-title">What's New</h2>
                  <span className="dev-modal-version">
                    v{UPDATE_DATA.version}
                  </span>
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
              <CalendarDays size={13} />
              {UPDATE_DATA.date}
            </div>

            {/* Body */}
            <div className="dev-modal-body">
              <p className="dev-modal-message">{UPDATE_DATA.greeting}</p>

              <div className="dev-modal-updates">
                {UPDATE_DATA.items.map((item, i) => (
                  <motion.div
                    key={i}
                    className="dev-update-item"
                    initial={{ opacity: 0, x: -12 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.08 }}
                  >
                    <div className={`dev-update-badge ${item.badge}`}>
                      {badgeIcons[item.badge]}
                    </div>
                    <div className="dev-update-text">
                      <strong>{item.title}</strong>
                      <span>{item.description}</span>
                    </div>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Footer */}
            <div className="dev-modal-footer">
              <button className="dev-modal-dismiss" onClick={handleDismiss}>
                Got it, thanks!
              </button>
              <button
                className="dev-modal-dont-show"
                onClick={handleDontShowAgain}
              >
                Don't show again for this version
              </button>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
