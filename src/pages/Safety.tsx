import { Activity, Shield, AlertTriangle, HelpCircle, MapPin, Clock, Bell, Mountain } from 'lucide-react';
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
            Practical, plain-language guidance on how earthquakes work, what the numbers on TerraGuard mean, and what to do before, during, and after the ground shakes.
          </p>
        </div>
      </div>

      {/* ── Why the Philippines ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Activity size={20} className="safety-section-icon" />
          <h2>Why the Philippines Has So Many Earthquakes</h2>
        </div>
        <p>
          The Philippines sits on the edge of the Pacific Ring of Fire, where several tectonic plates grind against one another. The Philippine Sea Plate is slowly sliding underneath the Eurasian Plate along deep trenches — such as the Manila Trench to the west and the Philippine Trench to the east — and the country is also crossed end-to-end by the active Philippine Fault System. These moving plates release built-up stress as earthquakes, which is why seismic activity here is a normal, recurring part of life rather than a rare event.
        </p>
        <p>
          That doesn't mean every rumble is dangerous. Most quakes the PHIVOLCS network records are small and go barely noticed. The ones worth paying attention to are the moderate and strong events — the ones that can cause shaking, damage, and, in rare cases, tsunamis when they strike offshore.
        </p>
      </section>

      {/* ── Magnitude vs Intensity ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <Mountain size={20} className="safety-section-icon" />
          <h2>Magnitude vs. Intensity: Reading the Numbers</h2>
        </div>
        <p>
          Two numbers often get confused: <strong>magnitude</strong> and <strong>intensity</strong>. On TerraGuard, the headline number on every event is the magnitude.
        </p>
        <ul className="safety-list">
          <li>
            <strong>Magnitude</strong> is a single number that describes the size of the earthquake at its source — how much energy was released. A magnitude 6.0 event releases roughly 32 times more energy than a 5.0. This number does not change no matter where you are.
          </li>
          <li>
            <strong>Intensity</strong> describes how strongly the ground shook at a particular place. It depends on how close you are to the epicenter, the depth of the quake, and the local soil. That is why a magnitude 5.5 quake can feel weak in one town and violent in another.
          </li>
        </ul>
        <p>
          As a rule of thumb: below magnitude 4.0 you will rarely feel a thing, 4.0–4.9 causes noticeable shaking but little damage, 5.0–5.9 can damage poorly built structures near the epicenter, 6.0–6.9 is a strong event capable of serious damage, and 7.0 or higher is a major earthquake that can be destructive across a wide area.
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
          <li>Secure heavy furniture, shelves, and appliances to walls so they can't topple over.</li>
          <li>Agree on a family meeting point and practice your route out of the house.</li>
          <li>Prepare a go-bag with water, food, a flashlight, batteries, a first-aid kit, and copies of important documents.</li>
          <li>Know where the nearest evacuation area is, especially if you live near the coast — a strong offshore quake can trigger a tsunami warning.</li>
          <li>Set up earthquake alerts in TerraGuard so you are notified the moment an event near your zones is recorded.</li>
        </ul>

        <h3 className="safety-subheading">During an earthquake</h3>
        <ul className="safety-list">
          <li><strong>Drop, Cover, and Hold On.</strong> Drop to your hands and knees, cover your head and neck under a sturdy table or desk, and hold on until the shaking stops.</li>
          <li>If you cannot reach cover, crouch against an interior wall, away from windows, glass, and anything that could fall.</li>
          <li>If you are outside, move to an open area away from buildings, trees, and power lines.</li>
          <li>If you are driving, pull over to a clear spot and stay in your vehicle until the shaking ends.</li>
          <li>Do not run outside during the shaking — most injuries come from falling debris, not from the shaking itself.</li>
        </ul>

        <h3 className="safety-subheading">After an earthquake</h3>
        <ul className="safety-list">
          <li>Expect aftershocks — they are normal and can sometimes be almost as strong as the main quake.</li>
          <li>Check yourself and those around you for injuries before helping others.</li>
          <li>Watch out for fallen debris, broken glass, and downed power lines.</li>
          <li>If you are near the coast and felt a strong shaking, move to higher ground immediately and wait for the tsunami warning to be lifted.</li>
          <li>Only re-enter buildings once authorities confirm they are safe.</li>
        </ul>
      </section>

      {/* ── Reading TerraGuard data ── */}
      <section className="safety-section glass">
        <div className="safety-section-head">
          <MapPin size={20} className="safety-section-icon" />
          <h2>How To Read TerraGuard's Event Data</h2>
        </div>
        <p>
          Every earthquake on TerraGuard is a PHIVOLCS or USGS record with a consistent set of fields. Understanding them helps you judge how much an event matters to you:
        </p>
        <ul className="safety-list">
          <li><strong>Location</strong> — the closest named area to the epicenter, such as "032 km N 85° W of Balut Island (Sarangani)." The distance shown is from the epicenter, not from your own position.</li>
          <li><strong>Magnitude</strong> — the size of the quake at its source, as described above.</li>
          <li><strong>Depth</strong> — how far below the surface the earthquake began. Shallow quakes (under 70 km) feel much stronger than deep ones of the same magnitude.</li>
          <li><strong>Coordinates</strong> — the exact latitude and longitude, so you can see the epicenter on the map.</li>
        </ul>
        <p>
          Use the <Link to="/archive" className="safety-inline-link">Earthquake Database</Link> to filter events by date, location, and minimum magnitude, and open any event's page for its full bulletin.
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
            <summary>Are earthquakes getting more frequent in the Philippines?</summary>
            <p>
              No. The number of recorded quakes appears to rise because monitoring networks are more sensitive now than in the past, so more small events get detected. The Philippines has always had thousands of earthquakes every year — the vast majority are harmless.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>Can earthquakes be predicted?</summary>
            <p>
              Scientists can estimate where earthquakes are likely over long time scales, but no one can predict the exact time and place of a specific quake. That is why preparedness matters far more than prediction — a well-practiced response saves lives.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>Should I use doorways during an earthquake?</summary>
            <p>
              Not anymore. Modern advice is to Drop, Cover, and Hold On under a sturdy table or desk. Doorways in older buildings may have been load-bearing and safe, but in modern construction they are no more protective and can expose you to swinging doors and falling items.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>What is the difference between an earthquake and a volcanic earthquake?</summary>
            <p>
              Both are ground movements recorded the same way, but tectonic earthquakes come from the movement of fault lines, while volcanic earthquakes are triggered by magma moving underground near a volcano. Either type can be felt, and both appear on TerraGuard's feed.
            </p>
          </details>
          <details className="safety-faq-item">
            <summary>How do I know if a tsunami could follow an earthquake?</summary>
            <p>
              Tsunamis are most often generated by strong (magnitude 7.0+) earthquakes that strike under the ocean and push the seafloor upward. If you feel strong shaking while near the coast, do not wait for a warning — move to higher ground immediately.
            </p>
          </details>
        </div>
      </section>

      {/* ── CTA ── */}
      <div className="safety-cta glass">
        <Bell size={22} className="text-accent" />
        <div className="safety-cta-text">
          <h3>Stay a step ahead of the shaking</h3>
          <p>Set up custom alert zones and magnitude thresholds so TerraGuard notifies you the moment a quake is recorded near you.</p>
        </div>
        <Link to="/alerts" className="safety-cta-btn">Set Up Alerts</Link>
      </div>

      <div className="safety-disclaimer">
        <AlertTriangle size={14} />
        <span>
          TerraGuard is an informational tool and does not issue official warnings. For authoritative guidance and tsunami alerts in the Philippines, always follow official channels such as PHIVOLCS and the local disaster risk reduction office.
        </span>
      </div>
    </div>
  );
}
