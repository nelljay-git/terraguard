import { Routes, Route, useParams, Navigate } from 'react-router-dom';
import { useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { useFcmRegistration } from './lib/fcm';
import { useFcmDeepLinks } from './lib/deepLinks';
import { DevUpdateModal } from './components/DevUpdateModal';
import { InstallPrompt } from './components/InstallPrompt';
import { ScrollToTop } from './components/ScrollToTop';
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
import { TikTokCallback } from './pages/TikTokCallback';
import { Blog } from './pages/Blog';
import { BlogPost } from './pages/BlogPost';
import { VolcanoBulletin } from './pages/VolcanoBulletin';
import { Tsunami } from './pages/Tsunami';
import { AiStudio } from './pages/AiStudio';
import { MotionLab } from './pages/MotionLab';
import { MOTION_FEATURE_ENABLED } from './lib/featureFlags';
import RememberingDebug from './pages/RememberingDebug';
import './App.css';

// Keyed wrapper so navigating between two /details/:id URLs remounts the
// component. Without this, React reuses the instance and the previously loaded
// earthquake state persists, causing the wrong event to be displayed.
function DetailsByUrl() {
  const { id } = useParams<{ id: string }>();
  return <Details key={id} />;
}

function App() {
  useFcmRegistration();
  useFcmDeepLinks();
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
        <ScrollToTop />
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
            <Route path="/blog" element={<Blog />} />
            <Route path="/blog/:slug" element={<BlogPost />} />
            <Route path="/bulletin/*" element={<VolcanoBulletin />} />
            <Route path="/tsunami" element={<Tsunami />} />
            <Route path="/tiktok-callback" element={<TikTokCallback />} />
          {/* Unlisted admin page: no nav link. The page itself enforces the
              email allowlist, and /post-news re-checks the signed-in user. */}
          <Route path="/ai" element={<AiStudio />} />
          <Route path="/motion-lab" element={MOTION_FEATURE_ENABLED ? <MotionLab /> : <Navigate to="/" replace />} />
          <Route path="/remembering-debug" element={<RememberingDebug />} />
          </Routes>
        </main>
      </div>
    </AuthProvider>
  );
}

export default App;
