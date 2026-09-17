import React, { useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuthStore } from '../store/auth';
import { LogOut, Settings, Moon, Sun, Menu, X } from 'lucide-react';
import { useDarkMode } from '../store/darkMode';
import { useFontSize } from '../store/fontSize';
import { useTranslation } from '../i18n/useTranslation';
import { LanguageSwitcher } from './LanguageSwitcher';

export default function Navbar() {
  const { user, logout } = useAuthStore();
  const location = useLocation();
  const { dark, toggle } = useDarkMode();
  const { fontSize, setFontSize } = useFontSize();
  const { t } = useTranslation();
  const [menuOpen, setMenuOpen] = useState(false);

  if (['/', '/auth'].includes(location.pathname)) return null;

  const links: { to: string; key: 'nav_dashboard' | 'nav_upload_docs' | 'nav_report' | 'nav_schemes' | 'nav_centres'; label: string }[] = [
    { to: '/dashboard', key: 'nav_dashboard', label: 'Dashboard' },
    { to: '/upload', key: 'nav_upload_docs', label: 'Upload Docs' },
    { to: '/report', key: 'nav_report', label: 'Report' },
    { to: '/schemes', key: 'nav_schemes', label: 'Schemes' },
    { to: '/centres', key: 'nav_centres', label: 'Centres' },
  ];

  return (
    <nav className="fixed top-0 left-0 right-0 z-50 h-16 px-4 sm:px-6 flex items-center justify-between bg-[#f6f5f0]/90 dark:bg-navy-950/90 border-b border-slate-200 dark:border-white/10 backdrop-blur-xl">

      {/* Logo */}
      <Link
        to="/dashboard"
        className="flex items-center gap-2.5 font-extrabold text-lg text-navy-950 dark:text-white"
      >
        <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-saffron-500 to-green-600 flex items-center justify-center text-[11px] font-black text-white tracking-tight shadow-sm">
          NV
        </div>

        <span className="hidden sm:inline">
          Nirdosh Vault
        </span>
      </Link>

      {/* Desktop nav */}
      <div className="hidden md:flex items-center gap-1">
        {links.map(l => (
          <NavLink key={l.to} to={l.to}>
            {t(l.key)}
          </NavLink>
        ))}
      </div>

      {/* Right controls */}
      <div className="flex items-center gap-2">

        {/* Font size controls */}
        <div
          role="group"
          aria-label="Font size controls"
          className="flex items-center rounded-lg border border-slate-200 dark:border-white/10 bg-white/60 dark:bg-white/5 p-0.5"
        >
          <button
            type="button"
            onClick={() => setFontSize('sm')}
            className={`px-1.5 py-0.5 text-xs font-semibold rounded transition-colors ${
              fontSize === 'sm'
                ? 'bg-saffron-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-label="Decrease font size"
            aria-pressed={fontSize === 'sm'}
          >
            A-
          </button>
          <button
            type="button"
            onClick={() => setFontSize('md')}
            className={`px-1.5 py-0.5 text-xs font-semibold rounded transition-colors ${
              fontSize === 'md'
                ? 'bg-saffron-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-label="Default font size"
            aria-pressed={fontSize === 'md'}
          >
            A
          </button>
          <button
            type="button"
            onClick={() => setFontSize('lg')}
            className={`px-1.5 py-0.5 text-xs font-semibold rounded transition-colors ${
              fontSize === 'lg'
                ? 'bg-saffron-500 text-white shadow-xs'
                : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
            }`}
            aria-label="Increase font size"
            aria-pressed={fontSize === 'lg'}
          >
            A+
          </button>
        </div>

        {/* Dark mode toggle */}
        <button
          id="dark-mode-toggle"
          onClick={toggle}
          className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          aria-label="Toggle dark mode"
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>

        {/* Language selector */}
        <LanguageSwitcher />

        {user && (
          <>
            {/* Settings */}
            <Link
              to="/settings"
              id="settings-link"
              className="w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
              aria-label="Settings"
            >
              <Settings size={16} />
            </Link>

            {/* User + Logout */}
            <div className="hidden sm:flex items-center gap-2">

              <div className="w-8 h-8 rounded-full bg-navy-900 dark:bg-saffron-500 text-white flex items-center justify-center font-bold text-sm">
                {user.name.charAt(0).toUpperCase()}
              </div>

              <button
                onClick={logout}
                className="text-slate-500 dark:text-slate-300 hover:text-navy-950 dark:hover:text-white transition-colors"
                aria-label="Logout"
              >
                <LogOut size={16} />
              </button>

            </div>
          </>
        )}

        {/* Mobile hamburger */}
        <button
          id="mobile-menu-toggle"
          onClick={() => setMenuOpen(v => !v)}
          className="md:hidden w-8 h-8 rounded-lg flex items-center justify-center text-slate-500 hover:bg-slate-100 dark:hover:bg-white/10 transition-colors"
          aria-label="Open menu"
        >
          {menuOpen ? <X size={18} /> : <Menu size={18} />}
        </button>
      </div>

      {/* Mobile dropdown */}
      {menuOpen && (
        <div className="absolute top-16 left-0 right-0 bg-[#f6f5f0]/98 dark:bg-navy-950/98 border-b border-slate-200 dark:border-white/10 backdrop-blur-xl md:hidden p-4 flex flex-col gap-1 shadow-xl">

          {links.map(l => (
            <Link
              key={l.to}
              to={l.to}
              onClick={() => setMenuOpen(false)}
              className={`px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                location.pathname.startsWith(l.to)
                  ? 'text-navy-950 dark:text-white bg-slate-200/60 dark:bg-white/10'
                  : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10'
              }`}
            >
              {t(l.key)}
            </Link>
          ))}

          {/* Mobile Settings */}
          <Link
            to="/settings"
            onClick={() => setMenuOpen(false)}
            className="px-4 py-3 rounded-xl text-sm font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-white/10 flex items-center gap-2"
          >
            <Settings size={14} />
            {t('nav_settings')}
          </Link>

          {/* Mobile Sign Out */}
          {user && (
            <button
              onClick={() => {
                logout();
                setMenuOpen(false);
              }}
              className="px-4 py-3 rounded-xl text-sm font-medium text-red-400 hover:bg-red-500/10 flex items-center gap-2 text-left"
            >
              <LogOut size={14} />
              {t('auth_logout')}
            </button>
          )}

        </div>
      )}
    </nav>
  );
}

function NavLink({
  to,
  children
}: {
  to: string;
  children: React.ReactNode;
}) {
  const location = useLocation();

  const isActive =
    location.pathname.startsWith(to) &&
    (to !== '/' || location.pathname === '/');

  return (
    <Link
      to={to}
      className={`px-3.5 py-1.5 rounded-lg text-sm font-medium transition-colors ${
        isActive
          ? 'text-navy-950 dark:text-white bg-slate-200/50 dark:bg-white/10'
          : 'text-slate-500 dark:text-slate-300 hover:text-navy-950 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/10'
      }`}
    >
      {children}
    </Link>
  );
}
