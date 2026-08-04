import { useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Image as ImageIcon, ExternalLink, Download } from 'lucide-react';
import './ImageLightbox.css';

interface ImageLightboxProps {
  src: string;
  alt?: string;
  open: boolean;
  onClose: () => void;
  caption?: string;
}

export function ImageLightbox({ src, alt = '', open, onClose, caption }: ImageLightboxProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="lightbox-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <motion.div
            className="lightbox-modal"
            initial={{ opacity: 0, scale: 0.92, y: 24 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: 16 }}
            transition={{ type: 'spring', damping: 26, stiffness: 320 }}
          >
            <div className="lightbox-modal-header">
              <div className="lightbox-modal-header-content">
                <div className="lightbox-modal-icon">
                  <ImageIcon size={18} />
                </div>
                <div className="lightbox-modal-title">{caption || 'Image'}</div>
              </div>
              <button
                type="button"
                className="lightbox-modal-close"
                onClick={onClose}
                aria-label="Close image (Esc)"
              >
                <X size={18} />
              </button>
            </div>

            <div className="lightbox-modal-image-wrap">
              <img
                src={src}
                alt={alt}
                className="lightbox-modal-image"
                onClick={(e) => e.stopPropagation()}
              />
            </div>

            <div className="lightbox-modal-footer">
              <a
                href={src}
                target="_blank"
                rel="noreferrer"
                className="lightbox-footer-btn"
                title="Open in new tab"
              >
                <ExternalLink size={15} />
                Open
              </a>
              <a
                href={src}
                download
                className="lightbox-footer-btn"
                title="Download image"
              >
                <Download size={15} />
                Download
              </a>
              <span className="lightbox-footer-hint">Click outside or press Esc to close</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}