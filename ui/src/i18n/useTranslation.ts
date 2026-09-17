import { useLanguage } from "../store/language";
import { translations } from "./translations";

export type TranslationKey = keyof typeof translations["en"];

export function useTranslation() {
  const lang = useLanguage((s) => s.lang);

  const t = (key: TranslationKey): string => {
    const dict = translations[lang as keyof typeof translations] ?? translations.en;
    return (dict as Record<string, string>)[key] ?? translations.en[key] ?? key;
  };

  return { t, lang };
}
