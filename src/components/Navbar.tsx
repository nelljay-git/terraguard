import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import {
  Activity,
  Archive,
  BarChart2,
  Newspaper,
  HelpCircle,
  User,
  LogOut,
  Star,
  Menu,
  X,
  Settings,
  MessagesSquare,
  Shield,
  FileText,
  BookOpen,
  Waves,
} from 'lucide-react';
import { cn } from '../lib/utils';
import { useAuth } from '../context/AuthContext';
import { getPreferredApi, PREFERRED_API_CHANGE_EVENT } from '../lib/apiPreference';
import { SettingsModal } from './SettingsModal';
import { Notifications } from './Notifications';
import logoSrc from '../assets/logo.png';
import './Navbar.css';

type DrawerLink = { name: string; path: string; icon: typeof Activity };

const PRIMARY_LINKS: readonly DrawerLink[] = [
  { name: 'Dashboard', path: '/', icon: Activity },
  { name: 'Archive', path: '/archive', icon: Archive },
  { name: 'Statistics', path: '/stats', icon: BarChart2 },
  { name: 'News', path: '/news', icon: Newspaper },
  { name: 'Blog', path: '/blog', icon: BookOpen },
  { name: 'Safety Guide', path: '/safety', icon: Shield },
  { name: 'Tsunami', path: '/tsunami', icon: Waves },
  { name: 'Forum', path: '/forum', icon: MessagesSquare },
] as const;

const DRAWER_GROUPS: Array<{ label: string; paths: string[] }> = [
  { label: 'Monitor', paths: ['/', '/archive', '/stats'] },
  { label: 'Newsroom', paths: ['/news', '/blog'] },
  { label: 'Safety & guides', paths: ['/safety', '/tsunami'] },
  { label: 'Community', paths: ['/forum'] },
];

export function Navbar() {
  const location = useLocation();
  const navigate = useNavigate();
  const { user, profile, signOut } = useAuth();
  const [menuOpen, setMenuOpen] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [apiSource, setApiSource] = useState<'phivolcs' | 'usgs' | 'emsc'>(() => getPreferredApi());
  const menuRef = useRef<HTMLDivElement | null>(null);
  const drawerRef = useRef<HTMLElement | null>(null);
  const hamburgerRef = useRef<HTMLButtonElement | null>(null);

  /* ── live source indicator ── */
  useEffect(() => {
    const sync = () => setApiSource(getPreferredApi());
    window.addEventListener(PREFERRED_API_CHANGE_EVENT, sync);
    window.addEventListener('storage', sync);
    return () => {
      window.removeEventListener(PREFERRED_API_CHANGE_EVENT, sync);
      window.removeEventListener('storage', sync);
    };
  }, []);

  const closeMenu = () => setMenuOpen(false);
  const closeDrawer = () => setDrawerOpen(false);

  /* Close drawer + account menu on every route change */
  useEffect(() => {
    setDrawerOpen(false);
    setMenuOpen(false);
  }, [location.pathname]);

  /* Account dropdown: click-outside + Escape + arrow-key walk */
  useEffect(() => {
    if (!menuOpen) return;
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setMenuOpen(false);
        return;
      }
      if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Home' && e.key !== 'End') return;
      const menu = menuRef.current;
      if (!menu) return;
      const items = Array.from(menu.querySelectorAll<HTMLElement>('.nav-account-menu-item'));
      if (items.length === 0) return;
      e.preventDefault();
      const current = items.indexOf(document.activeElement as HTMLElement);
      let next: number;
      if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = items.length - 1;
      else if (current === -1) next = e.key === 'ArrowDown' ? 0 : items.length - 1;
      else next = (current + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
      items[next]?.focus();
    };
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKey);
    };
  }, [menuOpen]);

  /* Drawer: Escape to close, scroll lock, simple focus trap, focus restore */
  useEffect(() => {
    if (!drawerOpen) return;
    const drawer = drawerRef.current;
    const hamburger = hamburgerRef.current;
    // Move focus into the drawer so keyboard users land somewhere useful
    const firstFocusable = drawer?.querySelector<HTMLElement>('a, button, [tabindex]:not([tabindex="-1"])');
    firstFocusable?.focus();

    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        setDrawerOpen(false);
        hamburger?.focus();
        return;
      }
      if (e.key !== 'Tab' || !drawer) return;
      const focusables = Array.from(
        drawer.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')
      ).filter((el) => el.offsetParent !== null);
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener('keydown', handleKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', handleKey);
      document.body.style.overflow = prevOverflow;
      hamburger?.focus();
    };
  }, [drawerOpen]);

  const handleSignOut = async () => {
    setMenuOpen(false);
    setDrawerOpen(false);
    await signOut();
    navigate('/');
  };

  const displayName = profile?.username || user?.email?.split('@')[0] || 'User';
  const sourceLabel = apiSource === 'usgs' ? 'USGS' : apiSource === 'emsc' ? 'EMSC' : 'PHIVOLCS';
  const sourceClass = `nav-source${apiSource === 'usgs' ? ' nav-source--usgs' : apiSource === 'emsc' ? ' nav-source--emsc' : ''}`;

  return (
    <header className="nav-bar">
      <div className="nav-inner container">
        {/* Brand */}
        <Link to="/" className="nav-brand" onClick={closeDrawer} aria-label="TerraGuard — home">
          <img src={logoSrc} alt="" className="nav-logo" />
          <span className="nav-brand-text">
            <span className="nav-brand-name">TerraGuard</span>
            <span className="nav-brand-sub">Seismic Monitor</span>
          </span>
        </Link>

        {/* Primary destinations — flat text tabs with a hairline rule for active route */}
        <nav className="nav-primary" aria-label="Primary">
          {PRIMARY_LINKS.map((link) => {
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={cn('nav-link', isActive && 'active')}
                aria-current={isActive ? 'page' : undefined}
              >
                {link.name}
              </Link>
            );
          })}
        </nav>

        {/* Right cluster */}
        <div className="nav-cluster">
          <span className={sourceClass} title={`Data source: ${sourceLabel}`}>
            <span className="nav-source-dot" aria-hidden="true" />
            {sourceLabel}
          </span>

          <Notifications />

          <div className="nav-account" ref={menuRef}>
            {user ? (
              <>
                <button
                  type="button"
                  className={cn('nav-account-btn', menuOpen && 'open')}
                  onClick={() => setMenuOpen((o) => !o)}
                  aria-expanded={menuOpen}
                  aria-haspopup="true"
                  aria-controls="nav-account-menu"
                  title={user.email ?? 'Account'}
                >
                  <span className="nav-account-avatar" aria-hidden="true">
                    {displayName[0]?.toUpperCase()}
                  </span>
                  <span className="nav-account-name">{displayName}</span>
                  <svg className="nav-account-chevron" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="m6 9 6 6 6-6" />
                  </svg>
                </button>
                {menuOpen && (
                  <div className="nav-account-menu" id="nav-account-menu" role="menu" aria-label="Account">
                    <div className="nav-account-menu-head">
                      <span className="nav-account-menu-name">{displayName}</span>
                      <span className="nav-account-menu-email">{user.email}</span>
                    </div>
                    <Link to="/stars" role="menuitem" className="nav-account-menu-item" onClick={closeMenu}>
                      <Star size={16} aria-hidden="true" />
                      My Starred Earthquakes
                    </Link>
                    <button
                      type="button"
                      role="menuitem"
                      className="nav-account-menu-item"
                      onClick={() => {
                        setMenuOpen(false);
                        setSettingsOpen(true);
                      }}
                    >
                      <Settings size={16} aria-hidden="true" />
                      Settings
                    </button>
                    <button type="button" role="menuitem" className="nav-account-menu-item danger" onClick={handleSignOut}>
                      <LogOut size={16} aria-hidden="true" />
                      Sign Out
                    </button>
                  </div>
                )}
              </>
            ) : (
              <Link to="/auth" className="nav-signin" title="Sign in / create account">
                <User size={16} aria-hidden="true" />
                Sign In
              </Link>
            )}
          </div>

          <Link to="/about" className="nav-icon nav-help-btn" title="About TerraGuard" aria-label="About TerraGuard" onClick={closeDrawer}>
            <HelpCircle size={19} aria-hidden="true" />
          </Link>

          <button
            ref={hamburgerRef}
            type="button"
            className="nav-icon nav-menu-btn"
            onClick={() => setDrawerOpen(true)}
            aria-expanded={drawerOpen}
            aria-controls="nav-drawer"
            aria-label="Open menu"
            title="Menu"
          >
            <Menu size={19} aria-hidden="true" />
          </button>
        </div>
      </div>

      {/* Drawer — always mounted, toggled via visibility/transform so it animates both ways */}
      <div className={cn('nav-drawer-backdrop', drawerOpen && 'is-open')} aria-hidden="true" onClick={closeDrawer} />
      <aside
        ref={(el) => { drawerRef.current = el; }}
        id="nav-drawer"
        className={cn('nav-drawer', drawerOpen && 'is-open')}
        role="dialog"
        aria-modal="true"
        aria-label="Navigation menu"
        aria-hidden={!drawerOpen}
      >
        <div className="nav-drawer-header">
          <Link to="/" className="nav-drawer-brand" onClick={closeDrawer} aria-label="TerraGuard — home">
            <img src={logoSrc} alt="" className="nav-logo" />
            <span className="nav-brand-text">
              <span className="nav-brand-name">TerraGuard</span>
              <span className="nav-brand-sub">Seismic Monitor</span>
            </span>
          </Link>
          <button type="button" className="nav-drawer-close" onClick={closeDrawer} aria-label="Close menu" title="Close menu">
            <X size={18} aria-hidden="true" />
          </button>
        </div>

        <nav className="nav-drawer-scroll" aria-label="Site sections">
          {DRAWER_GROUPS.map((group) => (
            <div key={group.label}>
              <div className="nav-drawer-section">{group.label}</div>
              {group.paths.map((path) => {
                const link = PRIMARY_LINKS.find((l) => l.path === path);
                if (!link) return null;
                const isActive = location.pathname === link.path;
                return (
                  <Link
                    key={path}
                    to={path}
                    className={cn('nav-drawer-link', isActive && 'active')}
                    aria-current={isActive ? 'page' : undefined}
                    onClick={closeDrawer}
                  >
                    <link.icon size={18} className="nav-drawer-link-icon" aria-hidden="true" />
                    {link.name}
                  </Link>
                );
              })}
            </div>
          ))}

          <div className="nav-drawer-divider" role="separator" />

          <Link to="/about" className="nav-drawer-link" onClick={closeDrawer}>
            <HelpCircle size={18} className="nav-drawer-link-icon" aria-hidden="true" />
            About TerraGuard
          </Link>
          <Link to="/privacy-policy" className="nav-drawer-link" onClick={closeDrawer}>
            <Shield size={18} className="nav-drawer-link-icon" aria-hidden="true" />
            Privacy Policy
          </Link>
          <Link to="/terms-of-service" className="nav-drawer-link" onClick={closeDrawer}>
            <FileText size={18} className="nav-drawer-link-icon" aria-hidden="true" />
            Terms of Service
          </Link>
        </nav>

        <div className="nav-drawer-footer">
          <span className="nav-drawer-source">
            <span className="nav-source-dot" aria-hidden="true" />
            {sourceLabel}
          </span>
          <span className="nav-drawer-cta">Earthquakes in real time</span>
        </div>
      </aside>

      {settingsOpen && <SettingsModal onClose={() => setSettingsOpen(false)} />}
    </header>
  );
}
