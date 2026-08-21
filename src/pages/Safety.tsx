import { Activity, Shield, AlertTriangle, HelpCircle, MapPin, Clock, Bell, Mountain, Globe, Zap, Waves, Flame, BookOpen } from 'lucide-react';
import { Link } from 'react-router-dom';
import './Safety.css';

export function Safety() {
  return (
    <div className="safety-container container">
      {/* ── Header ── */}
      <div className="safety-header glass">
        <div className="safety-header-left">
          <h1 className="safety-title">
            <Shield size={28} className="text-accent" />
            Earthquake Safety Guide
          </h1>
          <p className="safety-subtitle">
            Earthquakes are the planet's oldest and most widespread natural hazard — they don't care about borders. This guide explains, in plain language, why the ground moves, what the numbers on TerraGuard actually mean, the difference between a harmless rumble and a dangerous one, and exactly what to do before, during, and after the shaking starts. Read it once, and the next quake will feel a lot less mysterious.
          </p>
        </div>
      </div>

      {/* ── Why earthquakes happen ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Activity size={20} className="safety-section-icon" />
          <h2>Why the Ground Moves — and Why Some Places Get More</h2>
        </div>
        <p>
          Picture the Earth's outer shell as a giant eggshell that has already cracked into a dozen or so pieces — the <strong>tectonic plates</strong>. Unlike an eggshell, these pieces are enormous (some are whole continents) and they are not sitting still. They drift, at roughly the speed your fingernails grow, carried on slow currents of hot rock deep beneath the surface. Where plates meet, they don't slide smoothly: they grind, jam, and buckle. Stress builds for years, decades, or centuries until the rock finally snaps and lurches — and that sudden release of energy is an earthquake.
        </p>
        <p>
          The busiest of these meeting places is the <strong>Pacific Ring of Fire</strong>, a 40,000 km horseshoe around the Pacific Ocean. It threads through Japan, Indonesia, the Philippines, New Zealand, Chile, Peru, Mexico, Alaska, and the west coast of the United States. But earthquakes are not a Pacific-only story: the <strong>Alpide belt</strong> runs from the Mediterranean, through Turkey and Iran, over the Himalayas (Nepal, India, China) and into Indonesia; and even the middle of a plate isn't immune — the central United States (New Madrid), Australia, and parts of Africa have all been shaken hard in the past.
        </p>

        <div className="safety-stat-grid">
          <div className="safety-stat">
            <div className="safety-stat-num">~500,000</div>
            <div className="safety-stat-label">earthquakes detected worldwide each year</div>
          </div>
          <div className="safety-stat">
            <div className="safety-stat-num">1–2</div>
            <div className="safety-stat-label">"great" quakes (magnitude 8+) in a typical year</div>
          </div>
          <div className="safety-stat">
            <div className="safety-stat-num">32×</div>
            <div className="safety-stat-label">more energy released per whole step up the magnitude scale</div>
          </div>
          <div className="safety-stat">
            <div className="safety-stat-num">800 km/h</div>
            <div className="safety-stat-label">how fast a tsunami can travel across open ocean</div>
          </div>
        </div>

        <div className="safety-callout">
          <Zap size={18} className="safety-callout-icon" />
          <p>
            The takeaway: most quakes are tiny and forgettable. The ones that matter — the ones worth a plan — are the moderate-to-strong events that strike near people, especially offshore where they can launch a tsunami.
          </p>
        </div>
      </section>

      {/* ── Magnitude vs Intensity ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Mountain size={20} className="safety-section-icon" />
          <h2>Magnitude vs. Intensity: Two Numbers People Mix Up</h2>
        </div>
        <p>
          When TerraGuard shows an earthquake, the big number is the <strong>magnitude</strong>. But "magnitude" and "intensity" mean very different things, and confusing them is the source of most "why was that one scarier than the last?" questions.
        </p>
        <ul className="safety-list">
          <li>
            <strong>Magnitude</strong> measures the size of the earthquake at its source — the total energy released. It is a single, fixed number for that quake. A magnitude 6.0 releases about <strong>32 times</strong> more energy than a 5.0, and roughly <strong>1,000 times</strong> more than a 4.0.
          </li>
          <li>
            <strong>Intensity</strong> measures how strongly the shaking was felt at a specific place. It depends on your distance from the epicenter, how deep the quake was, and the local ground (soft, wet soil amplifies shaking; solid rock dampens it). That is why a magnitude 5.5 can feel like a gentle sway in one town and knock items off shelves in another.
          </li>
        </ul>
        <p>
          A handy rule of thumb for what a quake near you might feel like:
        </p>
        <div className="safety-feel-grid">
          <div className="safety-feel-row"><span className="safety-feel-mag">M2–3</span><span>Felt by very few people, usually indoors and on upper floors — like a truck rumbling past.</span></div>
          <div className="safety-feel-row"><span className="safety-feel-mag">M4</span><span>Windows rattle, hanging lights swing, pets notice. Most people realize it's a quake.</span></div>
          <div className="safety-feel-row"><span className="safety-feel-mag">M5</span><span>Most people feel it; unstable objects fall; some minor damage near the epicenter.</span></div>
          <div className="safety-feel-row"><span className="safety-feel-mag">M6</span><span>Frightening to many; plaster cracks, chimneys and weak walls damaged.</span></div>
          <div className="safety-feel-row"><span className="safety-feel-mag">M7+</span><span>Hard to stand; serious damage over a wide area; potential for collapse.</span></div>
        </div>
      </section>

      {/* ── Famous quakes ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <BookOpen size={20} className="safety-section-icon" />
          <h2>Quakes That Changed How We Understand the Earth</h2>
        </div>
        <p>
          Behind today's early-warning apps and building codes are centuries of painful lessons. A few earthquakes, scattered across the globe, rewrote the science:
        </p>
        <div className="safety-timeline">
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">1755</div>
            <div className="safety-timeline-body">
              <strong>Lisbon, Portugal</strong> — A tsunami-generating quake on All Saints' Day killed tens of thousands and shook Enlightenment Europe into studying disasters systematically.
            </div>
          </div>
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">1906</div>
            <div className="safety-timeline-body">
              <strong>San Francisco, USA</strong> — Surface rupture along the San Andreas Fault and the fires that followed led directly to modern earthquake engineering.
            </div>
          </div>
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">1960</div>
            <div className="safety-timeline-body">
              <strong>Valdivia, Chile</strong> — The largest quake ever instrumentally recorded at <strong>magnitude 9.5</strong>; its tsunami crossed the entire Pacific.
            </div>
          </div>
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">2004</div>
            <div className="safety-timeline-body">
              <strong>Sumatra, Indonesia</strong> — A magnitude 9.1 megathrust triggered Indian Ocean tsunamis and spawned the global warning systems we rely on today.
            </div>
          </div>
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">2011</div>
            <div className="safety-timeline-body">
              <strong>Tohoku, Japan</strong> — A magnitude 9.0 offshore quake and tsunami overwhelmed even a highly prepared nation, reshaping nuclear and coastal policy worldwide.
            </div>
          </div>
          <div className="safety-timeline-item">
            <div className="safety-timeline-year">2023</div>
            <div className="safety-timeline-body">
              <strong>Türkiye–Syria</strong> — A magnitude 7.8 event showed, again, how deadly old, unreinforced buildings can be when a fault ruptures near dense cities.
            </div>
          </div>
        </div>
        <p>
          The pattern across all of them is the same: the quake itself is only part of the story. Collapsing buildings, fire, and tsunamis cause most of the harm — which is exactly what preparation is designed to prevent.
        </p>
      </section>

      {/* ── Before / During / After ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Clock size={20} className="safety-section-icon" />
          <h2>What To Do Before, During, and After</h2>
        </div>

        <h3 className="safety-subheading">Before an earthquake</h3>
        <ul className="safety-list">
          <li>Secure heavy furniture, shelves, and appliances to walls so they can't topple onto a sleeping child or block a doorway.</li>
          <li>Agree on a family meeting point and a way to check in if phone networks are jammed (text often gets through when calls don't).</li>
          <li>Pack a go-bag: water, non-perishable food, a flashlight, spare batteries, a first-aid kit, medications, and copies of key documents.</li>
          <li>Know your nearest safe open space and, if you live near the coast or a large lake, the route to high ground — a strong offshore quake can trigger a tsunami warning.</li>
          <li>Turn on earthquake alerts in TerraGuard so you're notified the moment a quake near your saved zones is recorded, day or night.</li>
        </ul>

        <h3 className="safety-subheading">During an earthquake</h3>
        <ul className="safety-list">
          <li><strong>Drop, Cover, and Hold On.</strong> Drop to your hands and knees, crawl under a sturdy table or desk, and hold on until the shaking stops.</li>
          <li>If there's no cover nearby, crouch against an interior wall, away from windows, glass, and anything that could fall.</li>
          <li>Outdoors? Move to an open area away from buildings, trees, streetlights, and power lines.</li>
          <li>Driving? Pull over somewhere clear and stay in the vehicle with your seatbelt on until it's over.</li>
          <li>Do <strong>not</strong> run outside during the shaking — most injuries come from falling debris, not from the movement of the ground itself.</li>
        </ul>

        <h3 className="safety-subheading">After an earthquake</h3>
        <ul className="safety-list">
          <li>Expect aftershocks. They're normal and can sometimes be nearly as strong as the main shock, so keep your guard up for days.</li>
          <li>Check yourself and others for injuries before moving them; control serious bleeding first.</li>
          <li>Watch for broken glass, fallen objects, and downed power lines; smell for gas and evacuate if you suspect a leak.</li>
          <li>If you're near the coast and felt strong shaking, move to higher ground immediately — don't wait for an official tsunami warning.</li>
          <li>Only re-enter buildings once authorities confirm they're structurally safe, and use stairs, not elevators.</li>
        </ul>
      </section>

      {/* ── Myths vs facts ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Flame size={20} className="safety-section-icon" />
          <h2>Earthquake Myths — and What's Actually True</h2>
        </div>
        <div className="safety-myth">
          <div className="safety-myth-q">"Animals can predict earthquakes."</div>
          <div className="safety-myth-a">There's no reliable evidence that any animal senses quakes before they happen. Pets may react to the first tiny vibrations — just like we do — but they don't give useful warnings ahead of time.</div>
        </div>
        <div className="safety-myth">
          <div className="safety-myth-q">"The ground can open up and swallow a city."</div>
          <div className="safety-myth-a">Dramatic in movies, rare in reality. Earthquake ground cracks are usually inches wide and close back up. The real killers are collapsing buildings and landslides, not chasms.</div>
        </div>
        <div className="safety-myth">
          <div className="safety-myth-q">"Small quakes relieve pressure and prevent the big one."</div>
          <div className="safety-myth-a">Unfortunately no. A magnitude 6 releases about 30 times less energy than a 7, and a 4 is a thousand times weaker than a 7. Tiny quakes barely dent the strain locked in a fault.</div>
        </div>
        <div className="safety-myth">
          <div className="safety-myth-q">"I'll have time to run outside."</div>
          <div className="safety-myth-a">Most people are injured by falling debris on their way out. Staying inside and taking cover is consistently safer than dashing through a doorway full of hazard.</div>
        </div>
      </section>

      {/* ── Tsunami ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Waves size={20} className="safety-section-icon" />
          <h2>When the Sea Itself Becomes the Threat</h2>
        </div>
        <p>
          The scariest earthquakes are the ones under the ocean. When the seafloor jumps upward, it lifts the entire column of water above it, launching waves that travel as fast as a jet airliner across the deep ocean — yet are barely a meter tall and harmless to ships. The danger arrives at the coast, where the wave slows, piles up, and can surge far inland.
        </p>
        <div className="safety-callout">
          <Waves size={18} className="safety-callout-icon" />
          <p>
            <strong>Nature's tsunami warning:</strong> if you are near the coast and feel strong, prolonged shaking — or if you see the sea suddenly retreat farther than any low tide has ever exposed it — move to high ground immediately. Do not wait for an official alert; that retreat is the ocean "drawing back to strike."
          </p>
        </div>
      </section>

      {/* ── Reading TerraGuard data ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <MapPin size={20} className="safety-section-icon" />
          <h2>How To Read TerraGuard's Event Data</h2>
        </div>
        <p>
          Every earthquake on TerraGuard is a PHIVOLCS or USGS record with a consistent set of fields, covering events from anywhere in the world. Knowing what each field means helps you judge how much an event matters to you:
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

      {/* ── FAQ ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <HelpCircle size={20} className="safety-section-icon" />
          <h2>Frequently Asked Questions</h2>
        </div>
        <div className="safety-faq">
          <details className="safety-faq-item">
            <summary>Are earthquakes getting more frequent worldwide?</summary>
            <p>
              No. The number of recorded quakes appears to rise because monitoring networks are more sensitive now than in the past, so more small events get detected. Earth has always had thousands of earthquakes every year — the vast majority are harmless, no matter where they occur.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>Can earthquakes be predicted?</summary>
            <p>
              Not the exact time and place of a specific quake. Scientists can identify where large earthquakes are likely over long time scales and can issue <em>forecasts</em> of probability, but a precise prediction remains out of reach. That is exactly why preparedness and fast alerts matter more than prediction.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>Should I stand in a doorway during an earthquake?</summary>
            <p>
              Not anymore. Older advice came from masonry buildings where doorways were the strongest part. In modern construction a sturdy table offers better protection from falling objects, and a doorway just exposes you to swinging doors and debris. Drop, Cover, and Hold On instead.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>What is the difference between a tectonic and a volcanic earthquake?</summary>
            <p>
              Both are recorded the same way, but tectonic earthquakes come from the movement of fault lines, while volcanic earthquakes are triggered by magma moving underground near a volcano. Either type can be felt, and both appear on TerraGuard's feed.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>How do I know if a tsunami could follow an earthquake?</summary>
            <p>
              Tsunamis are most often generated by strong (magnitude 7.0+) earthquakes that strike under the ocean and push the seafloor upward. If you feel strong shaking while near the coast, do not wait for a warning — move to higher ground immediately.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>Is it true that you can't feel most earthquakes?</summary>
            <p>
              Yes. The vast majority of the half-million quakes a year are tiny — magnitude 2 or 3 — felt only by sensitive instruments (and sometimes pets on upper floors). It's the rare moderate-to-large events that become part of everyone's memory.
            </p>
          </details>
        </div>
      </section>

      {/* ── CTA ── */}
      <div className="safety-cta glass">
        <Bell size={22} className="text-accent" />
        <div className="safety-cta-text">
          <h3>Stay a step ahead of the shaking</h3>
          <p>Set up custom alert zones and magnitude thresholds so TerraGuard notifies you the moment a quake is recorded anywhere you care about.</p>
        </div>
        <Link to="/alerts" className="safety-cta-btn">Set Up Alerts</Link>
      </div>

      <div className="safety-disclaimer">
        <AlertTriangle size={14} />
        <span>
          TerraGuard is an informational tool and does not issue official warnings. For authoritative guidance and tsunami alerts, always follow official channels in your region — such as USGS (United States), PHIVOLCS (Philippines), JMA (Japan), or your national geological survey and disaster management agency.
        </span>
      </div>

      {/* ── Global scope note ── */}
      <div className="safety-disclaimer">
        <Globe size={14} />
        <span>
          This guide is written for everyone, everywhere. Earthquake science, preparedness, and the Drop-Cover-Hold-On response are the same whether you're in Tokyo, Lima, Istanbul, or Manila.
        </span>
      </div>
    </div>
  );
}
