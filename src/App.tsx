import { Routes, Route, useParams } from 'react-router-dom';
import { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DevUpdateModal } from './components/DevUpdateModal';
import { InstallPrompt } from './components/InstallPrompt';
import { AuthProvider } from './context/AuthContext';
import { Dashboard } from './pages/Dashboard';
import { Archive } from './pages/Archive';
import { Details } from './pages/Details';
import { Stats } from './pages/Stats';
import { News } from './pages/News';
import { About } from './pages/About';
import { Safety } from './pages/Safety';
import { History } from './pages/History';
import { PrivacyPolicy } from './pages/PrivacyPolicy';
import { TermsOfService } from './pages/TermsOfService';
import { Alerts } from './pages/Alerts';
import { Auth } from './pages/Auth';
import { Stars } from './pages/Stars';
import { Forum } from './pages/Forum';
import { ForumPost } from './pages/ForumPost';
import { ForumEdit } from './pages/ForumEdit';
import './App.css';

// Keyed wrapper so navigating between two /details/:id URLs remounts the
// component. Without this, React reuses the instance and the previously loaded
// earthquake state persists, causing the wrong event to be displayed.
function DetailsByUrl() {
  const { id } = useParams<{ id: string }>();
  return <Details key={id} />;
}

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
    <AuthProvider>
      <div className="app-container">
        <DevUpdateModal />
        <InstallPrompt />
        <Navbar />
        <main className="main-content">
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/archive" element={<Archive />} />
            <Route path="/details/:id" element={<DetailsByUrl />} />
            <Route path="/stats" element={<Stats />} />
            <Route path="/news" element={<News />} />
            <Route path="/alerts" element={<Alerts />} />
            <Route path="/about" element={<About />} />
            <Route path="/safety" element={<Safety />} />
            <Route path="/history" element={<History />} />
            <Route path="/privacy-policy" element={<PrivacyPolicy />} />
            <Route path="/terms-of-service" element={<TermsOfService />} />
            <Route path="/auth" element={<Auth />} />
            <Route path="/stars" element={<Stars />} />
            <Route path="/forum" element={<Forum />} />
            <Route path="/forum/new" element={<ForumEdit />} />
            <Route path="/forum/:id" element={<ForumPost />} />
            <Route path="/forum/:id/edit" element={<ForumEdit />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}

export default App;
