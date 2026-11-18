import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Star, Trash2, LogIn, Clock, Activity, MapPin } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { fetchUserStars, deleteStar, getErrorMessage, type StarredEarthquake } from '../lib/supabase';
import { getSeverityColor } from '../lib/utils';
import type { PhivolcsEarthquake } from '../api/phivolcs';
import './Stars.css';

function StarsEmpty({ icon, title, children, action }: {
  icon: ReactNode;
  title: string;
  children: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="stars-empty">
      <div className="stars-empty-icon" aria-hidden="true">{icon}</div>
      <h2 className="stars-empty-title">{title}</h2>
      <p className="stars-empty-body">{children}</p>
      {action && <div className="stars-empty-action">{action}</div>}
    </div>
  );
}

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
      <div className="stars-page container stars-loading">
        <span className="stars-loading-text">Loading your stars…</span>
      </div>
    );
  }

  if (!user) {
    return (
      <div className="stars-page container">
        <StarsEmpty
          icon={<LogIn size={26} />}
          title="Sign in to star earthquakes"
          action={
            <button className="stars-cta" onClick={() => navigate('/auth')}>
              Go to Sign In
            </button>
          }
        >
          Create a free account to save earthquakes you want to track and revisit later.
        </StarsEmpty>
      </div>
    );
  }

  if (error) {
    return (
      <div className="stars-page container">
        <StarsEmpty icon={<Activity size={26} />} title="Something went wrong">
          {error}
        </StarsEmpty>
      </div>
    );
  }

  const stars = data?.forUser === user.id ? data.items : null;

  if (!stars) {
    return (
      <div className="stars-page container stars-loading">
        <span className="stars-loading-text">Loading your stars…</span>
      </div>
    );
  }

  return (
    <div className="stars-page container">
      <header className="stars-header">
        <div>
          <span className="stars-kicker">My collection</span>
          <h1 className="stars-title">Starred Earthquakes</h1>
          <p className="stars-subtitle">
            {stars.length === 0
              ? 'Earthquakes you star will show up here.'
              : `${stars.length} saved ${stars.length === 1 ? 'event' : 'events'} — newest first`}
          </p>
        </div>
        <Link to="/archive" className="stars-browse-btn">Browse the Archive</Link>
      </header>

      {stars.length === 0 ? (
        <StarsEmpty
          icon={<Star size={26} />}
          title="No stars yet"
          action={<Link to="/archive" className="stars-cta">Browse the Archive</Link>}
        >
          Open any earthquake from the dashboard or archive and hit the star button to save it here.
        </StarsEmpty>
      ) : (
        <ul className="stars-list">
          {stars.map((s) => {
            const mag = parseFloat(s.magnitude ?? '');
            const color = getSeverityColor(isNaN(mag) ? 0 : mag);
            return (
              <li key={s.id} className="stars-row">
                <Link
                  to={`/details/${s.eq_id}`}
                  state={{ earthquake: snapshotToEarthquake(s) }}
                  className="stars-row-link"
                >
                  <span className="stars-mag tnum" style={{ color }} aria-label={`Magnitude ${s.magnitude ?? 'unknown'}`}>
                    {s.magnitude ?? '—'}
                  </span>
                  <span className="stars-row-body">
                    <span className="stars-row-loc">{s.location ?? 'Unknown location'}</span>
                    <span className="stars-row-meta">
                      <span className="stars-meta-item"><Clock size={13} aria-hidden="true" /> {s.datetime ?? 'Unknown'}</span>
                      <span className="stars-meta-item tnum"><Activity size={13} aria-hidden="true" /> {s.depth ?? '—'} km deep</span>
                      <span className="stars-meta-item tnum"><MapPin size={13} aria-hidden="true" /> {s.latitude}, {s.longitude}</span>
                    </span>
                  </span>
                </Link>
                <button
                  type="button"
                  className="stars-remove"
                  onClick={() => handleRemove(s)}
                  title="Unstar"
                  aria-label={`Unstar ${s.location ?? 'earthquake'}`}
                >
                  <Trash2 size={17} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
