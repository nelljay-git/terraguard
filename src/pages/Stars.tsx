import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Star, Trash2, LogIn, Clock, Activity, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUserStars, deleteStar, getErrorMessage, type StarredEarthquake } from '../lib/supabase';
import { getSeverityColor } from '../lib/utils';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import './Stars.css';

export function Stars() {
  const { user, loading: authLoading } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState<{ forUser: string; items: StarredEarthquake[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    fetchUserStars()
      .then((items) => {
        if (!cancelled) setData({ forUser: user.id, items });
      })
      .catch((err) => {
        console.error(err);
        if (!cancelled) setError(getErrorMessage(err));
      });
    return () => {
      cancelled = true;
    };
  }, [user]);

  const snapshotToEarthquake = (s: StarredEarthquake): PhivolcsEarthquake => ({
    datetime: s.datetime ?? '',
    latitude: s.latitude ?? '',
    longitude: s.longitude ?? '',
    depth: s.depth ?? '',
    magnitude: s.magnitude ?? '',
    location: s.location ?? 'Unknown location',
    link: '',
  });

  const handleRemove = async (s: StarredEarthquake) => {
    try {
      await deleteStar(s.eq_id);
      setData((prev) =>
        prev ? { ...prev, items: prev.items.filter((x) => x.id !== s.id) } : prev
      );
    } catch (err) {
      console.error(err);
    }
  };

  if (authLoading) {
    return (
      <div className="stars-container container flex-center" style={{ minHeight: '40vh' }}>
        <div className="loader">Loading your stars...</div>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="stars-container container">
        <div className="stars-empty glass">
          <LogIn size={40} className="stars-empty-icon" />
          <h2>Sign in to star earthquakes</h2>
          <p className="text-muted">
            Create a free account to save earthquakes you want to track and revisit later.
          </p>
          <button className="stars-cta" onClick={() => navigate('/auth')}>
            Go to Sign In
          </button>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stars-container container">
        <div className="stars-empty glass">
          <h2>Something went wrong</h2>
          <p className="text-muted">{error}</p>
        </div>
      </div>
    );
  }

  const stars = data?.forUser === user.id ? data.items : null;

  if (!stars) {
    return (
      <div className="stars-container container flex-center" style={{ minHeight: '40vh' }}>
        <div className="loader">Loading your stars...</div>
      </div>
    );
  }

  return (
    <div className="stars-container container">
      <div className="stars-header">
        <h1 className="stars-title">My Starred Earthquakes</h1>
        <p className="stars-subtitle text-muted">
          {stars.length === 0
            ? 'Earthquakes you star will show up here.'
            : `${stars.length} saved ${stars.length === 1 ? 'event' : 'events'}`}
        </p>
      </div>

      {stars.length === 0 ? (
        <div className="stars-empty glass">
          <Star size={40} className="stars-empty-icon" />
          <h2>No stars yet</h2>
          <p className="text-muted">
            Open any earthquake from the dashboard or archive and hit the star button to save it here.
          </p>
          <Link to="/archive" className="stars-cta">
            Browse the Archive
          </Link>
        </div>
      ) : (
        <div className="stars-grid">
          {stars.map((s) => {
            const mag = parseFloat(s.magnitude ?? '');
            const color = getSeverityColor(isNaN(mag) ? 0 : mag);
            return (
              <div key={s.id} className="stars-card glass-card">
                <Link
                  to={`/details/${s.eq_id}`}
                  state={{ earthquake: snapshotToEarthquake(s) }}
                  className="stars-card-link"
                >
                  <div className="stars-card-mag" style={{ backgroundColor: `${color}20`, color }}>
                    {s.magnitude ?? '—'}
                  </div>
                  <div className="stars-card-info">
                    <h3 className="stars-card-loc">{s.location ?? 'Unknown location'}</h3>
                    <div className="stars-card-meta">
                      <span className="flex-center" style={{ gap: '4px' }}>
                        <Clock size={14} /> {s.datetime ?? 'Unknown'}
                      </span>
                      <span className="flex-center" style={{ gap: '4px' }}>
                        <Activity size={14} /> {s.depth ?? '—'} km depth
                      </span>
                      <span className="flex-center" style={{ gap: '4px' }}>
                        <MapPin size={14} /> {s.latitude}, {s.longitude}
                      </span>
                    </div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="stars-remove"
                  onClick={() => handleRemove(s)}
                  title="Unstar"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
