import { useState, useRef, useEffect } from "react";
import { useLanguage, LANGUAGES } from "../store/language";

export function LanguageSwitcher() {
  const { lang, setLang } = useLanguage();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }

    document.addEventListener("mousedown", handleClickOutside);

    return () => {
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, []);

  const current = LANGUAGES.find((l) => l.code === lang);

  return (
    <div ref={ref} className="relative">
      <button
        id="language-switcher-btn"
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label="Choose language"
        aria-expanded={open}
        className="h-8 px-2.5 rounded-lg flex items-center justify-center gap-1.5
                   text-slate-500 dark:text-slate-300
                   hover:bg-slate-100 dark:hover:bg-white/10
                   transition-colors text-sm"
      >
        <span role="img" aria-hidden="true">
          🌐
        </span>

        <span>{current?.native ? (current.code === 'en' ? current.label : `${current.native}`) : "English"}</span>
      </button>

      {open && (
        <div
          id="language-dropdown-menu"
          className="absolute top-10 right-0 min-w-[150px]
                     bg-white dark:bg-[#1a1a1a]
                     border border-slate-200 dark:border-white/15
                     rounded-lg overflow-hidden shadow-xl z-[9999]"
        >
          {LANGUAGES.map((l) => (
            <button
              key={l.code}
              id={`lang-option-${l.code}`}
              type="button"
              onClick={() => {
                setLang(l.code);
                setOpen(false);
              }}
              className={`w-full text-left px-3.5 py-2.5 text-sm transition-colors flex items-center justify-between ${
                l.code === lang
                  ? "text-green-500 bg-green-500/10 font-medium"
                  : "text-slate-700 dark:text-white hover:bg-slate-100 dark:hover:bg-white/10"
              }`}
            >
              <span>{l.native}</span>
              {l.native !== l.label && (
                <span className="text-xs text-slate-400 ml-2">({l.label})</span>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
