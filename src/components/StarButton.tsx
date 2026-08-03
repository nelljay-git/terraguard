import { useState, type MouseEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { Star, Loader2 } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { toggleStar, earthquakeToEqId } from '../lib/supabase';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import './StarButton.css';

interface StarButtonProps {
  earthquake: PhivolcsEarthquake;
  className?: string;
}

export function StarButton({ earthquake, className }: StarButtonProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const [starred, setStarred] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleClick = async (e: MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!user) {
      navigate('/auth', { state: { from: window.location.pathname } });
      return;
    }
    setBusy(true);
    try {
      const result = await toggleStar(earthquakeToEqId(earthquake), earthquake);
      setStarred(result.starred);
    } catch (err) {
      console.error('Failed to toggle star', err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <button
      type="button"
      className={`star-btn ${starred ? 'active' : ''} ${className ?? ''}`}
      onClick={handleClick}
      title={starred ? 'Starred' : 'Star this earthquake'}
    >
      {busy ? (
        <Loader2 size={16} className="spin" />
      ) : (
        <Star size={16} fill={starred ? 'currentColor' : 'none'} />
      )}
    </button>
  );
}
