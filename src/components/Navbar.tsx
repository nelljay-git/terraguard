import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import { Activity, Globe2, BarChart2, Newspaper, HelpCircle, User, LogOut, Star, Menu, X, Settings, MessagesSquare, Shield, FileText, BookOpen } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { getPreferredApi, PREFERRED_API_CHANGE_EVENT } from '../lib/apiPreference';
import { SettingsModal } from './SettingsModal';
import { Notifications } from './Notifications';
import logoSrc from '../assets/logo.png';
import './Navbar.css';

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiSource, setApiSource] = useState<'phivolcs' | 'usgs'>(() => getPreferredApi());
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const sync = () => setApiSource(getPreferredApi());
    window.addEventListener(PREFERRED_API_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFERRED_API_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const links = [
    { name: 'Dashboard', path: '/', icon: Activity },
    { name: 'Archive', path: '/archive', icon: Globe2 },
    { name: 'Statistics', path: '/stats', icon: BarChart2 },
    { name: 'News', path: '/news', icon: Newspaper },
    { name: 'Blog', path: '/blog', icon: BookOpen },
    { name: 'Safety Guide', path: '/safety', icon: Shield },
    { name: 'Forum', path: '/forum', icon: MessagesSquare },
  ];

  const closeMenu = () => setMenuOpen(false);
  const closeSidebar = () => setSidebarOpen(false);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  useEffect(() => {
    if (!sidebarOpen) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setSidebarOpen(false);
    };
    document.addEventListener('keydown', handleKey);
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = '';
    };
  }, [sidebarOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    await signOut();
    navigate('/');
  };

  const displayName = profile?.username || user?.email?.split('@')[0] || 'User';

  return (
    <nav className="navbar glass">
      <div className="container flex-between nav-content">
        <Link to="/" className="nav-brand flex-center" onClick={closeSidebar}>
          <img src={logoSrc} alt="TerraGuard Logo" className="brand-logo" />
          <div className="brand-text-group">
            <span className="brand-text">TerraGuard</span>
            <span className="brand-sub">Seismic Monitor</span>
          </div>
        </Link>

        <div className={cn('nav-links', sidebarOpen && 'nav-links-hidden')}>
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={cn('nav-link flex-center', isActive && 'active')}
                onClick={closeSidebar}
              >
                <Icon size={17} />
                <span>{link.name}</span>
                {isActive && <div className="nav-active-dot"></div>}
              </Link>
            );
          })}
        </div>

        <div className={`nav-source-badge${apiSource === 'usgs' ? ' nav-source-badge--usgs' : ''}`}>
          <span className="source-dot"></span>
          {apiSource === 'usgs' ? 'USGS' : 'PHIVOLCS'}
        </div>

        <div className="nav-right-actions">
          <Notifications />

          <div className="nav-user-area" ref={menuRef}>
            {user ? (
              <>
                <button
                  type="button"
                  className={cn('nav-user-btn flex-center', menuOpen && 'open')}
                  onClick={() => setMenuOpen((o) => !o)}
                  title={user.email ?? 'Account'}
                >
                  <span className="nav-user-avatar">{displayName[0]?.toUpperCase()}</span>
                  <span className="nav-user-name">{displayName}</span>
                </button>
                {menuOpen && (
                  <div className="nav-user-menu">
                    <div className="nav-user-menu-header">
                      <span className="nav-user-menu-name">{displayName}</span>
                      <span className="nav-user-menu-email text-muted">{user.email}</span>
                    </div>
                    <Link to="/stars" className="nav-user-menu-item flex-center" onClick={closeMenu}>
                      <Star size={16} />
                      My Starred Earthquakes
                    </Link>
                    <button
                      type="button"
                      className="nav-user-menu-item flex-center"
                      onClick={() => {
                        closeMenu();
                        setSettingsOpen(true);
                      }}
                    >
                      <Settings size={16} />
                      Settings
                    </button>
                    <button
                      type="button"
                      className="nav-user-menu-item flex-center"
                      onClick={handleSignOut}
                    >
                      <LogOut size={16} />
                      Sign Out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Link to="/auth" className="nav-user-btn flex-center" title="Sign in / Create account">
                <User size={17} />
                <span className="nav-user-name">Sign In</span>
              </Link>
            )}
          </div>

          <Link to="/about" className="nav-help-btn" title="About TerraGuard" onClick={closeSidebar}>
            <HelpCircle size={18} />
          </Link>

          <button
            type="button"
            className="nav-menu-btn"
            onClick={() => setSidebarOpen(true)}
            title="Menu"
          >
            <Menu size={20} />
          </button>
        </div>
      </div>

      <AnimatePresence>
        {sidebarOpen && (
          <>
            <motion.div
              className="sidebar-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={closeSidebar}
            />
            <motion.aside
              className="sidebar"
              initial={{ x: '100%' }}
              animate={{ x: 0 }}
              exit={{ x: '100%' }}
              transition={{ type: 'spring', damping: 32, stiffness: 320 }}
            >
              <div className="sidebar-header">
                <Link to="/" className="sidebar-brand flex-center" onClick={closeSidebar}>
                  <img src={logoSrc} alt="TerraGuard Logo" className="brand-logo" />
                  <div className="brand-text-group">
                    <span className="brand-text">TerraGuard</span>
                    <span className="brand-sub">Seismic Monitor</span>
                  </div>
                </Link>
                <button type="button" className="sidebar-close-btn flex-center" onClick={closeSidebar} title="Close menu">
                  <X size={20} />
                </button>
              </div>

              <nav className="sidebar-links">
                {links.map((link) => {
                  const Icon = link.icon;
                  const isActive = location.pathname === link.path;
                  return (
                    <Link
                      key={link.path}
                      to={link.path}
                      className={cn('sidebar-link', isActive && 'active')}
                      onClick={closeSidebar}
                    >
                      <Icon size={18} className="sidebar-link-icon" />
                      <span>{link.name}</span>
                    </Link>
                  );
                })}
                <div className="sidebar-divider"></div>
                <Link to="/about" className="sidebar-link" onClick={closeSidebar}>
                  <HelpCircle size={18} className="sidebar-link-icon" />
                  <span>About</span>
                </Link>
                <Link to="/privacy-policy" className="sidebar-link" onClick={closeSidebar}>
                  <Shield size={18} className="sidebar-link-icon" />
                  <span>Privacy Policy</span>
                </Link>
                <Link to="/terms-of-service" className="sidebar-link" onClick={closeSidebar}>
                  <FileText size={18} className="sidebar-link-icon" />
                  <span>Terms of Service</span>
                </Link>
              </nav>

              <div className="sidebar-footer">
                <span className="sidebar-source">
                  <span className="source-dot"></span>
                  PHIVOLCS
                </span>
              </div>
            </motion.aside>
          </>
        )}
      </AnimatePresence>

      <AnimatePresence>
        {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
      </AnimatePresence>
    </nav>
  );
}
