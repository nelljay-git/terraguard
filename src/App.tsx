import { Routes, Route } from 'react-router-dom';
import { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DevUpdateModal } from './components/DevUpdateModal';
import { InstallPrompt } from './components/InstallPrompt';
import { Dashboard } from './pages/Dashboard';
import { Archive } from './pages/Archive';
import { Details } from './pages/Details';
import { Stats } from './pages/Stats';
import { News } from './pages/News';
import { About } from './pages/About';
import { History } from './pages/History';
import { Alerts } from './pages/Alerts';
import './App.css';

function App() {
  // Strip the internal _spa query param used by the OG rewrite
  useEffect(() => {
    const url = new URL(window.location.href);
    if (url.searchParams.has('_spa')) {
      url.searchParams.delete('_spa');
      window.history.replaceState({}, '', url.pathname + url.search + url.hash);
    }
  }, []);
  return (
    <div className="app-container">
      <DevUpdateModal />
      <InstallPrompt />
      <Navbar />
      <main className="main-content">
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/archive" element={<Archive />} />
          <Route path="/details/:id" element={<Details />} />
          <Route path="/stats" element={<Stats />} />
          <Route path="/news" element={<News />} />
          <Route path="/alerts" element={<Alerts />} />
          <Route path="/about" element={<About />} />
          <Route path="/history" element={<History />} />
        </Routes>
      </main>
    </div>
  );
}

export default App;
