import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, ZoomIn, ZoomOut, RotateCcw } from 'lucide-react';
import './ImageModal.css';

interface ImageModalProps {
  isOpen: boolean;
  onClose: () => void;
  imageUrl?: string;
  altText?: string;
}

export function ImageModal({ isOpen, onClose, imageUrl, altText }: ImageModalProps) {
  const [scale, setScale] = useState(1);
  const constraintsRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) setScale(1);
  }, [isOpen]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  return (
    <AnimatePresence>
      {isOpen && imageUrl && (
        <motion.div
          className="image-modal-overlay"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={(e) => {
            if (e.target === e.currentTarget) onClose();
          }}
        >
          <div className="image-modal-toolbar">
            <div className="image-modal-actions glass">
              <button className="image-modal-btn" onClick={() => setScale((s) => Math.min(s + 0.5, 5))} title="Zoom In">
                <ZoomIn size={18} />
              </button>
              <button className="image-modal-btn" onClick={() => setScale((s) => Math.max(s - 0.5, 0.5))} title="Zoom Out">
                <ZoomOut size={18} />
              </button>
              <button className="image-modal-btn" onClick={() => setScale(1)} title="Reset View">
                <RotateCcw size={18} />
              </button>
              <div className="image-modal-divider"></div>
              <button className="image-modal-btn close" onClick={onClose} title="Close">
                <X size={20} />
              </button>
            </div>
          </div>
          
          <div className="image-modal-viewport" ref={constraintsRef}>
            <motion.img
              src={imageUrl}
              alt={altText}
              className="image-modal-content"
              drag
              dragConstraints={constraintsRef}
              dragElastic={0.1}
              style={{ scale, cursor: 'grab' }}
              whileTap={{ cursor: 'grabbing' }}
              animate={{ scale }}
              transition={{ type: 'spring', stiffness: 300, damping: 30 }}
            />
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
