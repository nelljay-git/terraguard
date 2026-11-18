import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowUp, ArrowRight, Shield, AlertTriangle, Globe, Zap,
} from 'lucide-react';
import './Safety.css';

const TOC = [
  { id: 'safety-basics', num: '01', label: 'Why the Ground Moves' },
  { id: 'safety-before', num: '02', label: 'Before an Earthquake' },
  { id: 'safety-during', num: '03', label: 'During — Drop, Cover, Hold On' },
  { id: 'safety-after', num: '04', label: 'After an Earthquake' },
  { id: 'safety-myths', num: '05', label: 'Myths & Reality' },
  { id: 'safety-tsunami', num: '06', label: 'Tsunami' },
  { id: 'safety-history', num: '07', label: 'Historic Quakes' },
  { id: 'safety-reading-data', num: '08', label: 'Reading Event Data' },
  { id: 'safety-faq', num: '09', label: 'FAQ' },
] as const;

export function Safety() {
  const [active, setActive] = useState<string>(TOC[0].id);
  const [showTop, setShowTop] = useState(false);

  useEffect(() => {
    const onScroll = () => setShowTop(window.scrollY > 480);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined' || !('IntersectionObserver' in window)) return;
    const targets = TOC
      .map(item => document.getElementById(item.id))
      .filter((el): el is HTMLElement => el !== null);
    if (targets.length === 0) return;
    const io = new IntersectionObserver(
      entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) setActive(entry.target.id);
        }
      },
      { rootMargin: '-10% 0px -65% 0px', threshold: 0 }
    );
    targets.forEach(el => io.observe(el));
    return () => io.disconnect();
  }, []);

  const handleTopClick = () => {
    const smooth = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: no-preference)').matches;
    window.scrollTo({ top: 0, behavior: smooth ? 'smooth' : 'auto' });
  };

  return (
    <div className="safety-page container">
      {/* ── Masthead ── */}
      <header className="safety-mast">
        <div className="safety-mast-left">
          <span className="safety-eyebrow">TerraGuard · Preparedness Handbook</span>
          <h1 className="safety-title">Safety Guide</h1>
          <p className="safety-sub">
            Why the ground moves, what the numbers mean, and exactly what to do before, during, and after the shaking — written plainly, so you can act faster than you can think.
          </p>
          <nav className="safety-quicknav" aria-label="Jump to life-safety sections">
            <a href="#safety-during">During — Drop, Cover, Hold On</a>
            <a href="#safety-before">Before</a>
            <a href="#safety-after">After</a>
            <a href="#safety-tsunami">Tsunami</a>
          </nav>
        </div>
        <div className="safety-mast-note" role="note">
          <AlertTriangle size={13} aria-hidden="true" />
          <span>General preparedness guidance — not an official warning. For alerts, follow PHIVOLCS &amp; NDRRMC.</span>
        </div>
      </header>

      {/* ── Quick reference: before · during · after ── */}
      <section className="safety-quick" aria-label="Quick reference — what to do before, during, and after an earthquake">
        <div className="safety-quick-head">
          <span className="safety-quick-cap">Quick reference</span>
          <span className="safety-quick-note">The first minutes, condensed — tap a card for the full chapter</span>
        </div>
        <div className="safety-quick-grid">
          <a href="#safety-before" className="safety-quick-card">
            <span className="safety-quick-step">01 — BEFORE</span>
            <ul className="safety-quick-list">
              <li>Secure tall furniture to walls</li>
              <li>Agree on a family meeting point</li>
              <li>Pack a go-bag: water, food, torch, meds</li>
              <li>Know your nearest open space</li>
              <li>Turn on TerraGuard alert zones</li>
            </ul>
            <span className="safety-quick-more">Full chapter <ArrowRight size={12} aria-hidden="true" /></span>
          </a>
          <a href="#safety-during" className="safety-quick-card safety-quick-card--critical">
            <span className="safety-quick-step">02 — DURING · PRIORITY</span>
            <p className="safety-quick-words">DROP<span>·</span>COVER<span>·</span>HOLD&nbsp;ON</p>
            <ul className="safety-quick-list">
              <li>Drop to hands and knees</li>
              <li>Crawl under a sturdy table — hold on</li>
              <li>No cover? Crouch against an interior wall</li>
              <li>Stay clear of glass and heavy objects</li>
              <li>Never run outside during shaking</li>
            </ul>
            <span className="safety-quick-more">Full chapter <ArrowRight size={12} aria-hidden="true" /></span>
          </a>
          <a href="#safety-after" className="safety-quick-card">
            <span className="safety-quick-step">03 — AFTER</span>
            <ul className="safety-quick-list">
              <li>Expect aftershocks for days</li>
              <li>Check yourself and others for injuries</li>
              <li>Check gas, power lines, and damage</li>
              <li>Coastal shaking = straight to high ground</li>
              <li>Stay out of buildings until cleared</li>
            </ul>
            <span className="safety-quick-more">Full chapter <ArrowRight size={12} aria-hidden="true" /></span>
          </a>
        </div>
      </section>

      <div className="safety-body">
        {/* ── Sticky TOC rail ── */}
        <nav className="safety-toc" aria-label="Table of contents">
          <span className="safety-toc-cap">In this guide</span>
          <ol className="safety-toc-list">
            {TOC.map(item => (
              <li key={item.id}>
                <a
                  href={`#${item.id}`}
                  className={`safety-toc-link${active === item.id ? ' is-active' : ''}`}
                  aria-current={active === item.id ? 'true' : undefined}
                >
                  <span className="safety-toc-num tnum">{item.num}</span>
                  <span className="safety-toc-text">{item.label}</span>
                </a>
              </li>
            ))}
          </ol>
          <div className="safety-toc-foot">
            <Shield size={14} aria-hidden="true" />
            <span>Content preserved from the original guide — no invention, no omission.</span>
          </div>
        </nav>

        <div className="safety-content">
          {/* ── 01 The Basics ── */}
          <section id="safety-basics" className="safety-chapter" aria-labelledby="h-basics">
            <span className="safety-ch-num">01</span>
            <h2 id="h-basics" className="safety-ch-title">Why the Ground Moves</h2>

            <p>
              Picture the Earth's outer shell as a giant eggshell that has already cracked into a dozen or so pieces — the <strong>tectonic plates</strong>. Unlike an eggshell, these pieces are enormous (some are whole continents) and they are not sitting still. They drift, at roughly the speed your fingernails grow, carried on slow currents of hot rock deep beneath the surface. Where plates meet, they don't slide smoothly: they grind, jam, and buckle. Stress builds for years, decades, or centuries until the rock finally snaps and lurches — and that sudden release of energy is an earthquake.
            </p>
            <p>
              The busiest of these meeting places is the <strong>Pacific Ring of Fire</strong>, a 40,000 km horseshoe around the Pacific Ocean. It threads through Japan, Indonesia, the Philippines, New Zealand, Chile, Peru, Mexico, Alaska, and the west coast of the United States. But earthquakes are not a Pacific-only story: the <strong>Alpide belt</strong> runs from the Mediterranean, through Turkey and Iran, over the Himalayas (Nepal, India, China) and into Indonesia; and even the middle of a plate isn't immune — the central United States (New Madrid), Australia, and parts of Africa have all been shaken hard in the past.
            </p>

            <div className="safety-stat-grid">
              <div className="safety-stat"><span className="safety-stat-num tnum">~500,000</span><span className="safety-stat-label">quakes detected worldwide each year</span></div>
              <div className="safety-stat"><span className="safety-stat-num tnum">1–2</span><span className="safety-stat-label">"great" quakes (M8+) in a typical year</span></div>
              <div className="safety-stat"><span className="safety-stat-num tnum">32×</span><span className="safety-stat-label">more energy per whole magnitude step</span></div>
              <div className="safety-stat"><span className="safety-stat-num tnum">800 km/h</span><span className="safety-stat-label">speed of a tsunami in open ocean</span></div>
            </div>

            <div className="safety-callout">
              <Zap size={16} className="safety-callout-icon" aria-hidden="true" />
              <p><strong>The takeaway:</strong> most quakes are tiny and forgettable. The ones that matter — the ones worth a plan — are the moderate-to-strong events that strike near people, especially offshore where they can launch a tsunami.</p>
            </div>

            <h3 className="safety-h3">Magnitude vs. intensity</h3>
            <p>
              When TerraGuard shows an earthquake, the big number is the <strong>magnitude</strong>. But magnitude and intensity mean very different things, and confusing them is the source of most "why was that one scarier than the last?" questions.
            </p>
            <ul className="safety-list">
              <li><strong>Magnitude</strong> measures the size of the earthquake at its source — the total energy released. It is one fixed number for that quake. A magnitude 6.0 releases about <strong>32 times</strong> more energy than a 5.0, and roughly <strong>1,000 times</strong> more than a 4.0.</li>
              <li><strong>Intensity</strong> measures how strongly the shaking was felt at a specific place. It depends on your distance from the epicenter, how deep the quake was, and the local ground (soft, wet soil amplifies shaking; solid rock dampens it). That is why a magnitude 5.5 can feel like a gentle sway in one town and knock items off shelves in another.</li>
            </ul>
            <p>A handy rule of thumb for what a quake near you might feel like:</p>
            <div className="safety-feel-table" role="table" aria-label="How earthquakes feel at different magnitudes">
              <div className="safety-feel-row safety-feel-head" role="row"><span role="columnheader">Mag</span><span role="columnheader">What you may feel</span></div>
              <div className="safety-feel-row" role="row"><span className="safety-feel-mag tnum" role="cell">M2–3</span><span role="cell">Felt by very few people, usually indoors and on upper floors — like a truck rumbling past.</span></div>
              <div className="safety-feel-row" role="row"><span className="safety-feel-mag tnum" role="cell">M4</span><span role="cell">Windows rattle, hanging lights swing, pets notice. Most people realize it's a quake.</span></div>
              <div className="safety-feel-row" role="row"><span className="safety-feel-mag tnum" role="cell">M5</span><span role="cell">Most people feel it; unstable objects fall; some minor damage near the epicenter.</span></div>
              <div className="safety-feel-row" role="row"><span className="safety-feel-mag tnum" role="cell">M6</span><span role="cell">Frightening to many; plaster cracks, chimneys and weak walls damaged.</span></div>
              <div className="safety-feel-row" role="row"><span className="safety-feel-mag tnum" role="cell">M7+</span><span role="cell">Hard to stand; serious damage over a wide area; potential for collapse.</span></div>
            </div>
          </section>

          {/* ── 02 Before ── */}
          <section id="safety-before" className="safety-chapter" aria-labelledby="h-before">
            <span className="safety-ch-num">02</span>
            <h2 id="h-before" className="safety-ch-title">Before an Earthquake</h2>
            <ul className="safety-list">
              <li>Secure heavy furniture, shelves, and appliances to walls so they can't topple onto a sleeping child or block a doorway.</li>
              <li>Agree on a family meeting point and a way to check in if phone networks are jammed (text often gets through when calls don't).</li>
              <li>Pack a go-bag: water, non-perishable food, a flashlight, spare batteries, a first-aid kit, medications, and copies of key documents.</li>
              <li>Know your nearest safe open space and, if you live near the coast or a large lake, the route to high ground — a strong offshore quake can trigger a tsunami warning.</li>
              <li>Turn on earthquake alerts in TerraGuard so you're notified the moment a quake near your saved zones is recorded, day or night.</li>
            </ul>
          </section>

          {/* ── 03 During — DCH ── */}
          <section id="safety-during" className="safety-chapter safety-chapter--critical" aria-labelledby="h-during">
            <span className="safety-ch-num">03</span>
            <h2 id="h-during" className="safety-ch-title">During an Earthquake</h2>

            <div className="safety-dch" role="note" aria-label="If shaking starts: drop, cover, hold on">
              <span className="safety-dch-cap">If shaking starts — do this now</span>
              <p className="safety-dch-words"><span>DROP</span><em>·</em><span>COVER</span><em>·</em><span>HOLD&nbsp;ON</span></p>
              <p className="safety-dch-sub">Drop to your hands and knees, crawl under a sturdy table or desk, and hold on until the shaking stops.</p>
            </div>

            <div className="safety-ifgrid">
              <div className="safety-if-card">
                <span className="safety-if-cap">If indoors</span>
                <ul className="safety-list safety-list--compact">
                  <li>Drop, Cover, Hold On — under a table or desk, away from windows and glass.</li>
                  <li>No cover nearby? Crouch against an interior wall, protecting your head and neck.</li>
                  <li>Stay inside until the shaking stops — falling debris injures more people than the ground does.</li>
                </ul>
              </div>
              <div className="safety-if-card">
                <span className="safety-if-cap">If outdoors</span>
                <ul className="safety-list safety-list--compact">
                  <li>Move to an open area, away from buildings, trees, streetlights and power lines.</li>
                  <li>Drop to the ground and protect your head and neck.</li>
                </ul>
              </div>
              <div className="safety-if-card">
                <span className="safety-if-cap">If driving</span>
                <ul className="safety-list safety-list--compact">
                  <li>Pull over somewhere clear — not under bridges, overpasses, or power lines — and stay inside with your seatbelt on.</li>
                  <li>Brake gently and keep the car away from traffic when it's safe to stop.</li>
                </ul>
              </div>
              <div className="safety-if-card">
                <span className="safety-if-cap">If trapped</span>
                <ul className="safety-list safety-list--compact">
                  <li>Cover your mouth and nose with a cloth. Protect what light and air you have.</li>
                  <li>Tap in a steady three-count — on a pipe or wall — or blow a whistle if you have one. Shouting wastes air.</li>
                  <li>Do not move debris around you — you may bring the structure down further.</li>
                </ul>
              </div>
            </div>

            <div className="safety-warning" role="note">
              <AlertTriangle size={16} aria-hidden="true" />
              <p><strong>Do not run outside during shaking.</strong> Most injuries come from falling debris, not from the movement of the ground itself.</p>
            </div>
          </section>

          {/* ── 04 After ── */}
          <section id="safety-after" className="safety-chapter" aria-labelledby="h-after">
            <span className="safety-ch-num">04</span>
            <h2 id="h-after" className="safety-ch-title">After an Earthquake</h2>
            <ul className="safety-list">
              <li>Expect aftershocks. They're normal and can sometimes be nearly as strong as the main shock, so keep your guard up for days.</li>
              <li>Check yourself and others for injuries before moving them; control serious bleeding first.</li>
              <li>Watch for broken glass, fallen objects, and downed power lines; smell for gas and evacuate if you suspect a leak.</li>
              <li>If you're near the coast and felt strong shaking, move to higher ground immediately — don't wait for an official tsunami warning. See <a href="#safety-tsunami">Tsunami</a> below.</li>
              <li>Only re-enter buildings once authorities confirm they're structurally safe, and use stairs, not elevators.</li>
            </ul>
          </section>

          {/* ── 05 Myths ── */}
          <section id="safety-myths" className="safety-chapter" aria-labelledby="h-myths">
            <span className="safety-ch-num">05</span>
            <h2 id="h-myths" className="safety-ch-title">Earthquake Myths — and What's Actually True</h2>
            <div className="safety-myth-table">
              <div className="safety-myth-row safety-myth-head"><span>They say</span><span>Actually</span></div>
              <div className="safety-myth-row">
                <span className="safety-myth-q">"Animals can predict earthquakes."</span>
                <span className="safety-myth-a">There's no reliable evidence that any animal senses quakes before they happen. Pets may react to the first tiny vibrations — just like we do — but they don't give useful warnings ahead of time.</span>
              </div>
              <div className="safety-myth-row">
                <span className="safety-myth-q">"The ground can open up and swallow a city."</span>
                <span className="safety-myth-a">Dramatic in movies, rare in reality. Earthquake ground cracks are usually inches wide and close back up. The real killers are collapsing buildings and landslides, not chasms.</span>
              </div>
              <div className="safety-myth-row">
                <span className="safety-myth-q">"Small quakes relieve pressure and prevent the big one."</span>
                <span className="safety-myth-a">Unfortunately no. A magnitude 6 releases about 30 times less energy than a 7, and a 4 is a thousand times weaker than a 7. Tiny quakes barely dent the strain locked in a fault.</span>
              </div>
              <div className="safety-myth-row">
                <span className="safety-myth-q">"I'll have time to run outside."</span>
                <span className="safety-myth-a">Most people are injured by falling debris on their way out. Staying inside and taking cover is consistently safer than dashing through a doorway full of hazard.</span>
              </div>
            </div>
          </section>

          {/* ── 06 Tsunami ── */}
          <section id="safety-tsunami" className="safety-chapter" aria-labelledby="h-tsunami">
            <span className="safety-ch-num">06</span>
            <h2 id="h-tsunami" className="safety-ch-title">When the Sea Itself Becomes the Threat</h2>
            <p>
              The scariest earthquakes are the ones under the ocean. When the seafloor jumps upward, it lifts the entire column of water above it, launching waves that travel as fast as a jet airliner across the deep ocean — yet are barely a meter tall and harmless to ships. The danger arrives at the coast, where the wave slows, piles up, and can surge far inland.
            </p>
            <div className="safety-warning safety-warning--strong" role="note">
              <Zap size={16} aria-hidden="true" />
              <p><strong>Nature's tsunami warning:</strong> if you are near the coast and feel strong, prolonged shaking — or if you see the sea suddenly retreat farther than any low tide has ever exposed it — move to high ground immediately. Do not wait for an official alert; that retreat is the ocean "drawing back to strike."</p>
            </div>
            <p>
              For live PHIVOLCS tsunami bulletins, advisories and the full coastal handbook — warning signs, step-by-step actions, and how to read an official bulletin — open the dedicated <Link to="/tsunami" className="safety-inline-link">Tsunami Guide</Link>.
            </p>
          </section>

          {/* ── 07 History ── */}
          <section id="safety-history" className="safety-chapter" aria-labelledby="h-history">
            <span className="safety-ch-num">07</span>
            <h2 id="h-history" className="safety-ch-title">Quakes That Changed How We Understand the Earth</h2>
            <p>
              Behind today's early-warning apps and building codes are centuries of painful lessons. A few earthquakes, scattered across the globe, rewrote the science:
            </p>
            <ol className="safety-timeline">
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">1755</span><span className="safety-timeline-body"><strong>Lisbon, Portugal</strong> — A tsunami-generating quake on All Saints' Day killed tens of thousands and shook Enlightenment Europe into studying disasters systematically.</span></li>
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">1906</span><span className="safety-timeline-body"><strong>San Francisco, USA</strong> — Surface rupture along the San Andreas Fault and the fires that followed led directly to modern earthquake engineering.</span></li>
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">1960</span><span className="safety-timeline-body"><strong>Valdivia, Chile</strong> — The largest quake ever instrumentally recorded at <strong>magnitude 9.5</strong>; its tsunami crossed the entire Pacific.</span></li>
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">2004</span><span className="safety-timeline-body"><strong>Sumatra, Indonesia</strong> — A magnitude 9.1 megathrust triggered Indian Ocean tsunamis and spawned the global warning systems we rely on today.</span></li>
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">2011</span><span className="safety-timeline-body"><strong>Tohoku, Japan</strong> — A magnitude 9.0 offshore quake and tsunami overwhelmed even a highly prepared nation, reshaping nuclear and coastal policy worldwide.</span></li>
              <li className="safety-timeline-item"><span className="safety-timeline-year tnum">2023</span><span className="safety-timeline-body"><strong>Türkiye–Syria</strong> — A magnitude 7.8 event showed, again, how deadly old, unreinforced buildings can be when a fault ruptures near dense cities.</span></li>
            </ol>
            <p>
              The pattern across all of them is the same: the quake itself is only part of the story. Collapsing buildings, fire, and tsunamis cause most of the harm — which is exactly what preparation is designed to prevent.
            </p>
          </section>

          {/* ── 08 Reading data ── */}
          <section id="safety-reading-data" className="safety-chapter" aria-labelledby="h-reading">
            <span className="safety-ch-num">08</span>
            <h2 id="h-reading" className="safety-ch-title">How To Read TerraGuard's Event Data</h2>
            <p>
              Every earthquake on TerraGuard is a PHIVOLCS, USGS, or EMSC record with a consistent set of fields, covering events anywhere in the world. Knowing what each field means helps you judge how much an event matters to you:
            </p>
            <ul className="safety-list">
              <li><strong>Location</strong> — the closest named area to the epicenter, such as "032 km N 85° W of Balut Island (Sarangani)" or "18 km S of a coastal town in Indonesia." The distance shown is measured from the epicenter, not from your own position.</li>
              <li><strong>Magnitude</strong> — the size of the quake at its source, as described above.</li>
              <li><strong>Depth</strong> — how far below the surface the earthquake began. Shallow quakes (under ~70 km) concentrate their energy near the surface and feel much stronger than deep ones of the same magnitude.</li>
              <li><strong>Coordinates</strong> — the exact latitude and longitude, so you can see the epicenter on the map and gauge your own distance to it.</li>
            </ul>
            <p>
              Use the <Link to="/archive" className="safety-inline-link">Earthquake Database</Link> to filter events by date, location, and minimum magnitude, and open any event's page for its full bulletin, intensities, and official bulletins.
            </p>
          </section>

          {/* ── 09 FAQ ── */}
          <section id="safety-faq" className="safety-chapter" aria-labelledby="h-faq">
            <span className="safety-ch-num">09</span>
            <h2 id="h-faq" className="safety-ch-title">Frequently Asked Questions</h2>
            <div className="safety-faq">
              <details className="safety-faq-item">
                <summary>Are earthquakes getting more frequent worldwide?</summary>
                <p>No. The number of recorded quakes appears to rise because monitoring networks are more sensitive now than in the past, so more small events get detected. Earth has always had thousands of earthquakes every year — the vast majority are harmless, no matter where they occur.</p>
              </details>
              <details className="safety-faq-item">
                <summary>Can earthquakes be predicted?</summary>
                <p>Not the exact time and place of a specific quake. Scientists can identify where large earthquakes are likely over long time scales and can issue <em>forecasts</em> of probability, but a precise prediction remains out of reach. That is exactly why preparedness and fast alerts matter more than prediction.</p>
              </details>
              <details className="safety-faq-item">
                <summary>Should I stand in a doorway during an earthquake?</summary>
                <p>Not anymore. Older advice came from masonry buildings where doorways were the strongest part. In modern construction a sturdy table offers better protection from falling objects, and a doorway just exposes you to swinging doors and debris. Drop, Cover, and Hold On instead.</p>
              </details>
              <details className="safety-faq-item">
                <summary>What is the difference between a tectonic and a volcanic earthquake?</summary>
                <p>Both are recorded the same way, but tectonic earthquakes come from the movement of fault lines, while volcanic earthquakes are triggered by magma moving underground near a volcano. Either type can be felt, and both appear on TerraGuard's feed.</p>
              </details>
              <details className="safety-faq-item">
                <summary>How do I know if a tsunami could follow an earthquake?</summary>
                <p>Tsunamis are most often generated by strong (magnitude 7.0+) earthquakes that strike under the ocean and push the seafloor upward. If you feel strong shaking while near the coast, do not wait for a warning — move to higher ground immediately.</p>
              </details>
              <details className="safety-faq-item">
                <summary>Is it true that you can't feel most earthquakes?</summary>
                <p>Yes. The vast majority of the half-million quakes a year are tiny — magnitude 2 or 3 — felt only by sensitive instruments (and sometimes pets on upper floors). It's the rare moderate-to-large events that become part of everyone's memory.</p>
              </details>
            </div>
          </section>

          {/* ── Closing CTA + disclaimers ── */}
          <aside className="safety-cta">
            <div className="safety-cta-text">
              <span className="safety-cta-cap">Ready?</span>
              <h3 className="safety-cta-title">Stay a step ahead of the shaking</h3>
              <p>Set up custom alert zones and magnitude thresholds so TerraGuard notifies you the moment a quake is recorded — day or night.</p>
            </div>
            <Link to="/alerts" className="safety-cta-btn">Set up alerts <ArrowRight size={15} aria-hidden="true" /></Link>
          </aside>

          <div className="safety-disclaimer safety-disclaimer--alert" role="note">
            <AlertTriangle size={14} aria-hidden="true" />
            <p>TerraGuard is an informational tool and does not issue official warnings. For authoritative guidance and tsunami alerts, always follow official channels in your region — such as USGS (United States), PHIVOLCS (Philippines), JMA (Japan), or your national geological survey and disaster management agency.</p>
          </div>

          <div className="safety-disclaimer" role="note">
            <Globe size={14} aria-hidden="true" />
            <p>This guide is written for everyone, everywhere. Earthquake science, preparedness, and the Drop–Cover–Hold-On response are the same whether you're in Tokyo, Lima, Istanbul, or Manila.</p>
          </div>
        </div>
      </div>

      {/* ── Back to top ── */}
      <button
        type="button"
        className={`safety-backtop${showTop ? ' is-visible' : ''}`}
        onClick={handleTopClick}
        aria-label="Back to top"
        hidden={!showTop}
      >
        <ArrowUp size={18} aria-hidden="true" />
      </button>
    </div>
  );
}
