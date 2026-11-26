import { ArrowLeft, Clock } from 'lucide-react';
import { Link } from 'react-router-dom';
import './History.css';

const VERSION_HISTORY = [
  {
    version: '1.9',
    date: 'November 26, 2026',
    changes: [
      'Fixed volcano bulletins and earthquake news failing to load in the APK',
    ],
  },
  {
    version: '1.8',
    date: 'November 26, 2026',
    changes: [
      'Added in-app APK update check with a direct download button',
      'Moved install/update prompts to mobile view only',
    ],
  },
  {
    version: '1.7',
    date: 'August 4, 2026',
    changes: [
      'Added community forum with posts, reactions, bookmarking, and image attachments',
      'Added comments and replies with notification deep-links to the exact comment',
      'Added light/dark/system theme preference saved to your account',
      'Improved notifications with one-tap navigation to your posts and earthquakes',
      'Fixed bugs and improved overall performance',
    ],
  },
  {
    version: '1.6',
    date: 'July 24, 2026',
    changes: [
      'Added earthquake alert zones with push notifications',
      'Added aftershock tracker on earthquake details page',
      'PWA installation support for a native app experience',
    ],
  },
  {
    version: '1.5',
    date: 'June 15, 2026',
    changes: [
      'Added PWA installation support for Android & iOS native app experience',
      'Added first modal pop up for developer updates',
      'Integrated official PHIVOLCS trench WMS layers on interactive maps',
      'Added a dedicated Version History page',
    ],
  },
  {
    version: '1.4',
    date: 'June 14, 2026',
    changes: [
      'Added historical earthquake events to Archives with anti-reset',
      'Improved loading states and fixed syncing problems for phone users',
      'Added Philippine trenches visualization to the interactive maps',
    ],
  },
  {
    version: '1.3',
    date: 'June 13, 2026',
    changes: [
      'Enhanced Details page with more comprehensive PHIVOLCS event records',
      'Fixed and improved Intensity scale displays',
    ],
  },
  {
    version: '1.2',
    date: 'June 12, 2026',
    changes: [
      'Added News feature for the latest earthquake updates',
      'Redesigned Stats page for better data visualization',
      'Added easy zoom controls to maps for desktop users',
      'Added glassmorphism blur effect on navigation bar',
      'Fixed map point modal data rendering',
    ],
  },
  {
    version: '1.1',
    date: 'June 11, 2026',
    changes: [
      'Redesigned UI across multiple pages for better responsiveness',
      'Fixed dynamic seismograph animation on details page',
      'Added background images to the Details page',
    ],
  },
  {
    version: '1.0',
    date: 'June 10, 2026',
    changes: [
      'Initial release of TerraGuard',
      'Real-time earthquake monitoring via PHIVOLCS API with caching',
      'Interactive Leaflet map integration',
      'Added About Us page',
    ],
  },
];

export function History() {
  return (
    <div className="history-page container">
      <header className="history-header">
        <Link to="/about" className="history-back">
          <ArrowLeft size={17} aria-hidden="true" />
          <span>About TerraGuard</span>
        </Link>
        <div className="history-masthead">
          <span className="history-kicker">Changelog</span>
          <h1 className="history-title">
            <Clock size={24} aria-hidden="true" />
            Update History
          </h1>
          <p className="history-subtitle">
            Every release, in order. Newest at the top — {VERSION_HISTORY.length} releases and
            counting.
          </p>
        </div>
      </header>

      <ol className="history-timeline">
        {VERSION_HISTORY.map((update) => (
          <li key={update.version} className="timeline-item">
            <div className="timeline-rail" aria-hidden="true">
              <span className="timeline-dot" />
            </div>
            <article className="timeline-content">
              <header className="timeline-header">
                <span className="version-badge tnum">v{update.version}</span>
                <time className="version-date">{update.date}</time>
              </header>
              <ul className="version-changes">
                {update.changes.map((change) => (
                  <li key={change}>{change}</li>
                ))}
              </ul>
            </article>
          </li>
        ))}
      </ol>
    </div>
  );
}
