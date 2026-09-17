import { create } from 'zustand';

export type FontSize = 'sm' | 'md' | 'lg';

interface FontSizeStore {
  fontSize: FontSize;
  setFontSize: (size: FontSize) => void;
}

const STORAGE_KEY = 'nirdosh_font_size';

function applyFontSizeClass(size: FontSize) {
  if (typeof document !== 'undefined') {
    document.documentElement.classList.remove('font-sm', 'font-md', 'font-lg');
    document.documentElement.classList.add(`font-${size}`);
  }
}

function getInitialFontSize(): FontSize {
  if (typeof localStorage !== 'undefined') {
    const saved = localStorage.getItem(STORAGE_KEY) as FontSize | null;
    if (saved && (saved === 'sm' || saved === 'md' || saved === 'lg')) {
      return saved;
    }
  }
  return 'md';
}

const initialSize = getInitialFontSize();
applyFontSizeClass(initialSize);

export const useFontSize = create<FontSizeStore>((set) => ({
  fontSize: initialSize,
  setFontSize: (size: FontSize) => {
    set({ fontSize: size });
    localStorage.setItem(STORAGE_KEY, size);
    applyFontSizeClass(size);
  },
}));
