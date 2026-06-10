import { Link, useLocation } from 'react-router-dom';
import { Activity, Globe2, BarChart2, HelpCircle } from 'lucide-react';
import { cn } from '../lib/utils';
import logoSrc from '../assets/logo.png';
import './Navbar.css';

export function Navbar() {
  const location = useLocation();

  const links = [
    { name: 'Dashboard', path: '/', icon: Activity },
    { name: 'Archive', path: '/archive', icon: Globe2 },
    { name: 'Statistics', path: '/stats', icon: BarChart2 },
  ];

  return (
    <nav className="navbar glass">
      <div className="container flex-between nav-content">
        <Link to="/" className="nav-brand flex-center">
          <img src={logoSrc} alt="TerraGuard Logo" className="brand-logo" />
          <div className="brand-text-group">
            <span className="brand-text">TerraGuard</span>
            <span className="brand-sub">Seismic Monitor</span>
          </div>
        </Link>
        
        <div className="nav-links flex-center">
          {links.map((link) => {
            const Icon = link.icon;
            const isActive = location.pathname === link.path;
            return (
              <Link
                key={link.path}
                to={link.path}
                className={cn('nav-link flex-center', isActive && 'active')}
              >
                <Icon size={17} />
                <span>{link.name}</span>
                {isActive && <div className="nav-active-dot"></div>}
              </Link>
            );
          })}
        </div>

        <div className="nav-source-badge">
          <span className="source-dot"></span>
          PHIVOLCS
        </div>
        
        <Link to="/about" className="nav-help-btn flex-center" title="About TerraGuard">
          <HelpCircle size={18} />
        </Link>
      </div>
    </nav>
  );
}
