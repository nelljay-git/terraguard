import {
  Activity,
  Archive,
  Bell,
  ChevronRight,
  Clock,
  Code2,
  Map,
  MessagesSquare,
  Newspaper,
  Radio,
  Shield,
  Star,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import './About.css';

const OFFERINGS = [
  {
    icon: Activity,
    title: 'Live monitoring',
    body: 'The PHIVOLCS feed refreshes roughly every minute while the app is open. The latest recorded event is always front and centre, with the last successful sync shown.',
  },
  {
    icon: Map,
    title: 'Interactive map',
    body: 'Every recorded event is plotted by its own coordinates with severity colour-coding, so you can see at a glance where the ground moved.',
  },
  {
    icon: Radio,
    title: 'Earthquake statistics',
    body: 'Monthly and yearly breakdowns of magnitude and depth, distributions over time, and which regions are most active — charted, not just listed.',
  },
  {
    icon: Archive,
    title: 'Searchable archive',
    body: 'Look up historical events by year, magnitude, depth and location. PHIVOLCS records from 2018, USGS from 1900, EMSC from 1998.',
  },
  {
    icon: Newspaper,
    title: 'Earthquake news',
    body: 'A curated feed of quake-related headlines — scoped to the Philippines for PHIVOLCS, global when you switch to USGS or EMSC.',
  },
  {
    icon: Bell,
    title: 'Custom alerts',
    body: 'Draw alert zones and set magnitude thresholds. TerraGuard sends a browser notification when a matching event is recorded.',
  },
  {
    icon: Star,
    title: 'Saved events',
    body: 'Star any event to keep a personal shortlist across sessions — handy for tracking swarms or events you want to follow up.',
  },
  {
    icon: MessagesSquare,
    title: 'Community & guides',
    body: 'A bulletin forum for discussion, plus a written earthquake safety guide and tsunami guidance for the Pacific seaboard.',
  },
] as const;

const STEPS = [
  {
    num: '01',
    title: 'Gather',
    body: 'Events are pulled from PHIVOLCS bulletins by default, or from the USGS and EMSC APIs if you prefer. Switch sources any time in Settings.',
  },
  {
    num: '02',
    title: 'Normalize',
    body: 'Every source is normalized into one record — magnitude, depth, time, coordinates — then cached locally so the dashboard survives flaky connections.',
  },
  {
    num: '03',
    title: 'Present',
    body: 'Map, statistics, archive, news and alerts all render from that same record, so the numbers you see agree with each other.',
  },
  {
    num: '04',
    title: 'Act',
    body: 'Star events, set up alert zones, get notified, or read the bulletins. The dashboard always shows when the data was last refreshed.',
  },
] as const;

const SOURCES = [
  {
    name: 'PHIVOLCS-DOST',
    coverage: 'Philippines only',
    archive: '2018 – present',
    notes: 'Official Philippine bulletins. Default source; richest detail for local events.',
  },
  {
    name: 'USGS',
    coverage: 'Worldwide',
    archive: '1900 – present',
    notes: 'Global catalogue, events magnitude 4.5 and above.',
  },
  {
    name: 'EMSC-CSEM',
    coverage: 'Worldwide',
    archive: '1998 – present',
    notes: 'Global catalogue including minor events (M1.0+). Best for dense, low-magnitude coverage.',
  },
] as const;

export function About() {
  return (
    <div className="abt">
      {/* ══════════ Masthead ══════════ */}
      <header className="abt-masthead" aria-labelledby="abt-title">
        <div className="abt-masthead-veil" aria-hidden="true" />
        <div className="container abt-masthead-inner">
          <span className="abt-kicker">About TerraGuard</span>
          <h1 id="abt-title" className="abt-headline">
            Every Philippine earthquake,<br />
            one clear view.
          </h1>
          <p className="abt-lede">
            TerraGuard is an independent, free-to-use earthquake monitoring dashboard. It gathers
            live records from PHIVOLCS, USGS and EMSC — live maps, statistics, a historical
            archive, news and alerts — and presents them plainly, so you can understand the
            ground moving near you without digging through scattered official sites.
          </p>
          <div className="abt-meta" role="list" aria-label="Key facts">
            <span role="listitem"><strong>3</strong> live sources</span>
            <span role="listitem"><strong>60s</strong> feed refresh</span>
            <span role="listitem"><strong>Free</strong> to use</span>
            <span role="listitem"><strong>Not</strong> an official agency</span>
          </div>
        </div>
      </header>

      <div className="container">
        {/* ══════════ 01 · Why it exists ══════════ */}
        <section className="abt-section abt-why" aria-labelledby="abt-why-title">
          <div className="abt-index" aria-hidden="true"><span>01</span></div>
          <div className="abt-section-body">
            <h2 id="abt-why-title" className="abt-section-title">Why it exists</h2>
            <p className="abt-pull">Official agencies publish the record. TerraGuard makes it readable.</p>
            <p>
              Earthquake information in the Philippines is published by several different agencies
              in different formats, which makes it hard to get a quick, complete picture when it
              matters. TerraGuard was built to fix that: pull the official record, keep it updated
              every minute, and present it in a way anyone can read at a glance — then let you
              drill down into the details when you need them.
            </p>
            <p>
              It is deliberately boring in the best way: no predictions, no mystique, no
              paywalls. Just the recorded facts, organized so a family, a student, or a classroom
              can make sense of them.
            </p>
          </div>
        </section>

        {/* ══════════ 02 · What it offers ══════════ */}
        <section className="abt-section" aria-labelledby="abt-offers-title">
          <div className="abt-index" aria-hidden="true"><span>02</span></div>
          <div className="abt-section-body">
            <h2 id="abt-offers-title" className="abt-section-title">What it offers</h2>
            <p className="abt-section-sub">The full toolkit, in one place.</p>
            <ul className="abt-ledger">
              {OFFERINGS.map((o) => (
                <li key={o.title} className="abt-ledger-row">
                  <o.icon size={20} className="abt-ledger-icon" aria-hidden="true" />
                  <span className="abt-ledger-text">
                    <strong>{o.title}</strong>
                    <span>{o.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* ══════════ 03 · How it works ══════════ */}
        <section className="abt-section" aria-labelledby="abt-how-title">
          <div className="abt-index" aria-hidden="true"><span>03</span></div>
          <div className="abt-section-body">
            <h2 id="abt-how-title" className="abt-section-title">How it works</h2>
            <p className="abt-section-sub">From agency bulletin to your screen, in four steps.</p>
            <ol className="abt-steps">
              {STEPS.map((s) => (
                <li key={s.num} className="abt-step">
                  <span className="abt-step-num tnum" aria-hidden="true">{s.num}</span>
                  <strong className="abt-step-title">{s.title}</strong>
                  <p className="abt-step-body">{s.body}</p>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* ══════════ 04 · Where the data comes from ══════════ */}
        <section className="abt-section" aria-labelledby="abt-sources-title">
          <div className="abt-index" aria-hidden="true"><span>04</span></div>
          <div className="abt-section-body">
            <h2 id="abt-sources-title" className="abt-section-title">Where the data comes from</h2>
            <p className="abt-section-sub">
              Three independent catalogues. You choose which one drives the app in Settings.
            </p>
            <div className="abt-source-table-wrap">
              <table className="abt-source-table">
                <thead>
                  <tr>
                    <th scope="col">Source</th>
                    <th scope="col">Coverage</th>
                    <th scope="col">Archive</th>
                    <th scope="col">Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {SOURCES.map((s) => (
                    <tr key={s.name}>
                      <th scope="row">{s.name}</th>
                      <td>{s.coverage}</td>
                      <td className="tnum">{s.archive}</td>
                      <td>{s.notes}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="abt-transparency">
              <li>Availability, reporting times and completeness vary by source — and by event. A small quake may appear in EMSC within minutes and reach PHIVOLCS later, or vice versa.</li>
              <li>PHIVOLCS occasionally revises bulletins. TerraGuard reflects updates when they are published, and flags revised magnitudes on the details page.</li>
              <li>Maps, charts and coverage statistics are interpretations of the public record — official bulletins remain the authority.</li>
              <li>The live badge in the navbar shows which source is currently active. Everything is attributed — no silent substitutions.</li>
            </ul>
          </div>
        </section>

        {/* ══════════ 05 · What TerraGuard is not ══════════ */}
        <section className="abt-not" aria-labelledby="abt-not-title">
          <div className="abt-not-lead">
            <Shield size={22} aria-hidden="true" />
            <h2 id="abt-not-title">What TerraGuard is not</h2>
          </div>
          <p className="abt-not-line">
            <strong>It is not an earthquake early warning system.</strong> TerraGuard cannot
            predict earthquakes, and its maps, charts and visuals do not represent future events.
          </p>
          <p className="abt-not-line">
            <strong>It is not an official agency.</strong> TerraGuard is independent of PHIVOLCS,
            NDRRMC and any government office. In an emergency, always follow official
            announcements and instructions from PHIVOLCS, NDRRMC and your local disaster risk
            reduction office.
          </p>
          <p className="abt-not-line">
            <strong>It is not a substitute for preparedness.</strong> The best moment to know
            what to do is before the ground moves — read the{' '}
            <Link to="/safety" className="abt-inline-link">Earthquake Safety Guide</Link> and the{' '}
            <Link to="/tsunami" className="abt-inline-link">tsunami guidance</Link> today.
          </p>
        </section>

        {/* ══════════ 06 · FAQ ══════════ */}
        <section className="abt-section" aria-labelledby="abt-faq-title">
          <div className="abt-index" aria-hidden="true"><span>06</span></div>
          <div className="abt-section-body">
            <h2 id="abt-faq-title" className="abt-section-title">Common questions</h2>
            <div className="abt-faq">
              <details className="abt-faq-item">
                <summary>Is TerraGuard an official source?</summary>
                <p>
                  No. TerraGuard is an independent tool that presents data published by PHIVOLCS,
                  USGS and EMSC. For official warnings and tsunami alerts, always refer to the
                  issuing agencies and your local disaster risk reduction office.
                </p>
              </details>
              <details className="abt-faq-item">
                <summary>How up to date is the data?</summary>
                <p>
                  The live feed refreshes roughly every minute while the app is open, and the
                  dashboard shows the time of the last successful sync so you always know how
                  fresh the data is.
                </p>
              </details>
              <details className="abt-faq-item">
                <summary>Can I use TerraGuard offline?</summary>
                <p>
                  TerraGuard works as a Progressive Web App, so after your first visit you can
                  install it on your phone or desktop. Previously loaded data can be viewed
                  offline, though live updates require a connection.
                </p>
              </details>
              <details className="abt-faq-item">
                <summary>Does TerraGuard collect my data?</summary>
                <p>
                  We keep things minimal. Basic usage analytics and any optional account features
                  are handled with your consent — full details are in our{' '}
                  <Link to="/privacy-policy" className="abt-inline-link">Privacy Policy</Link>.
                </p>
              </details>
            </div>
          </div>
        </section>

        {/* ══════════ 07 · Where to go next ══════════ */}
        <section className="abt-section" aria-labelledby="abt-next-title">
          <div className="abt-index" aria-hidden="true"><span>07</span></div>
          <div className="abt-section-body">
            <h2 id="abt-next-title" className="abt-section-title">Where to go next</h2>
            <div className="abt-next">
              <Link to="/" className="abt-next-link">
                <span>
                  <strong>Open the dashboard</strong>
                  <small>Live map, latest event, and what the ground is doing right now.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/alerts" className="abt-next-link">
                <span>
                  <strong>Set up alerts</strong>
                  <small>Get a browser notification when a matching event is recorded.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
              <Link to="/safety" className="abt-next-link">
                <span>
                  <strong>Read the safety guide</strong>
                  <small>What to do before, during and after an earthquake.</small>
                </span>
                <ChevronRight size={18} aria-hidden="true" />
              </Link>
            </div>
          </div>
        </section>

        {/* ══════════ Support & credits ══════════ */}
        <section className="abt-support" aria-label="Support and credits">
          <div className="abt-support-block">
            <h3 className="abt-support-title">Support the project</h3>
            <p className="abt-support-desc">
              TerraGuard is free and stays free. If it helped you or your family, consider buying
              the developer a coffee.
            </p>
            <div className="abt-qr-wrap">
              <img
                src="/assets/support-qr.png"
                alt="QR code to support TerraGuard"
                className="abt-qr"
                width={150}
                height={150}
              />
              <span className="abt-qr-label">Scan to support</span>
            </div>
          </div>
          <div className="abt-support-block">
            <span className="abt-dev-label"><Code2 size={16} aria-hidden="true" /> Built by</span>
            <span className="abt-dev-name">WG</span>
            <span className="abt-dev-sub">An independent project — not an official publication of any agency.</span>
            <div className="abt-tech" aria-label="Technologies used">
              {['React', 'TypeScript', 'Vite', 'Recharts', 'Leaflet'].map((t) => (
                <span key={t} className="abt-tech-tag">{t}</span>
              ))}
            </div>
            <Link to="/history" className="abt-history-link">
              <Clock size={15} aria-hidden="true" /> Version history
            </Link>
          </div>
        </section>

        {/* ══════════ Legal footer ══════════ */}
        <footer className="abt-legal">
          <nav className="abt-legal-links" aria-label="Legal">
            <Link to="/privacy-policy">Privacy Policy</Link>
            <span aria-hidden="true">·</span>
            <Link to="/terms-of-service">Terms of Service</Link>
            <span aria-hidden="true">·</span>
            <Link to="/history">Version History</Link>
          </nav>
          <span className="abt-legal-copy">© {new Date().getFullYear()} TerraGuard. All rights reserved.</span>
        </footer>
      </div>
    </div>
  );
}
