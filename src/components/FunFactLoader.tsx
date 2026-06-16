import { useEffect, useState, useRef, type ReactNode } from 'react';
import { Sparkles, Waves } from 'lucide-react';
import factsData from './FunFacts.json';
import './FunFactLoader.css';

type FunFactItem = {
  id: number;
  fact: string;
};

type FunFactLoaderProps = {
  title: string;
  subtitle: string;
  icon?: ReactNode;
  className?: string;
};

const facts = (factsData.earthquakeFunFacts as FunFactItem[]) ?? [];

export function FunFactLoader({ title, subtitle, icon, className = '' }: FunFactLoaderProps) {
  const [factIndex, setFactIndex] = useState(0);
  const [factVisible, setFactVisible] = useState(true);
  const timeoutRef = useRef<number | null>(null);

  const fact = facts[factIndex % Math.max(facts.length, 1)];

  useEffect(() => {
    if (facts.length <= 1) return;

    const interval = window.setInterval(() => {
      setFactVisible(false);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
      timeoutRef.current = window.setTimeout(() => {
        setFactIndex((current) => (current + 1) % facts.length);
        setFactVisible(true);
      }, 260);
    }, 7000);

    return () => {
      window.clearInterval(interval);
      if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    };
  }, []);

  return (
    <div className={`funfact-loader ${className}`.trim()}>
      <div className="funfact-loader__shell">
        <div className="funfact-loader__orb funfact-loader__orb--one" />
        <div className="funfact-loader__orb funfact-loader__orb--two" />

        <div className="funfact-loader__spinner">
          <div className="spinner-ring"></div>
          {icon ?? <Waves size={28} className="spinner-icon" />}
        </div>

        <div className="funfact-loader__copy">
          <p className="loading-text">{title}</p>
          <p className="loading-sub">{subtitle}</p>
        </div>

        <div className="funfact-loader__fact-card" aria-live="polite">
          <div className="funfact-loader__fact-label">
            <Sparkles size={14} />
            <span>Earthquake fact</span>
          </div>
          <p className={`funfact-loader__fact ${factVisible ? 'is-visible' : 'is-hiding'}`}>
            {fact?.fact ?? 'Tracking seismic facts...'}
          </p>
        </div>
      </div>
    </div>
  );
}
