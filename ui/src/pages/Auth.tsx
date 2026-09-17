import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Lock } from 'lucide-react';
import api from '../api/client';
import { useAuthStore } from '../store/auth';
import { useTranslation, type TranslationKey } from '../i18n/useTranslation';
import { LanguageSwitcher } from '../components/LanguageSwitcher';

type PasswordStrength = {
  score: number;
  label: string;
  color: string;
};

type ApiErrorItem = {
  message?: string;
};

type ApiErrorResponse = {
  error?: string | ApiErrorItem[];
  message?: string;
};

function getPasswordStrength(
  password: string,
  t: (key: TranslationKey) => string
): PasswordStrength {
  let score = 0;

  if (password.length >= 8) score += 1;
  if (/[A-Z]/.test(password)) score += 1;
  if (/[0-9]/.test(password)) score += 1;
  if (/[^A-Za-z0-9]/.test(password)) score += 1;

  const labels = [
    '',
    t('auth_strength_weak'),
    t('auth_strength_fair'),
    t('auth_strength_good'),
    t('auth_strength_strong'),
  ];
  const colors = ['', '#ef4444', '#f97316', '#f59e0b', '#10b981'];

  return {
    score,
    label: labels[score] || '',
    color: colors[score] || '#ef4444',
  };
}

function formatAuthError(error: unknown, fallbackMessage: string): string {
  if (
    typeof error === 'object' &&
    error !== null &&
    'response' in error
  ) {
    const responseError = error as {
      response?: {
        data?: ApiErrorResponse;
      };
    };

    const responseData = responseError.response?.data;
    const apiError = responseData?.error;

    if (Array.isArray(apiError)) {
      const messages = apiError
        .map((item) => item.message)
        .filter((message): message is string => Boolean(message));

      if (messages.length > 0) {
        return messages.join(', ');
      }
    }

    if (typeof apiError === 'string' && apiError.trim()) {
      return apiError;
    }

    if (responseData?.message) {
      return responseData.message;
    }
  }

  return fallbackMessage;
}

export default function Auth() {
  const { t } = useTranslation();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const { setAuth } = useAuthStore();
  const navigate = useNavigate();

  const switchMode = (loginMode: boolean) => {
    setIsLogin(loginMode);
    setError('');
    setPassword('');

    if (loginMode) {
      setName('');
    }
  };

  const handleSubmit = async (
    event: React.FormEvent<HTMLFormElement>,
  ) => {
    event.preventDefault();

    const normalizedEmail = email.trim().toLowerCase();
    const normalizedName = name.trim();

    setError('');

    if (!normalizedEmail) {
      setError(t('auth_err_email_required'));
      return;
    }

    if (!password) {
      setError(t('auth_err_password_required'));
      return;
    }

    if (!isLogin && !normalizedName) {
      setError(t('auth_err_name_required'));
      return;
    }

    if (!isLogin) {
      const passwordStrength = getPasswordStrength(password, t);

      if (passwordStrength.score < 3) {
        setError(t('auth_err_password_requirements'));
        return;
      }
    }

    setLoading(true);

    try {
      const endpoint = isLogin ? '/auth/login' : '/auth/signup';

      const payload = isLogin
        ? {
          email: normalizedEmail,
          password,
        }
        : {
          name: normalizedName,
          email: normalizedEmail,
          password,
        };

      const { data } = await api.post(endpoint, payload);

      if (!data?.user || !data?.token) {
        throw new Error(t('auth_err_invalid_response'));
      }

      setAuth(data.user, data.token);
      navigate('/dashboard', { replace: true });
    } catch (authError: unknown) {
      setError(formatAuthError(authError, t('auth_err_default')));
    } finally {
      setLoading(false);
    }
  };

  const passwordStrength = getPasswordStrength(password, t);

  return (
    <div className="min-h-screen flex items-center justify-center p-6 pt-24 relative z-10">
      <div className="w-full max-w-md">
        <div className="card p-8 sm:p-10">
          <div className="flex items-center justify-between mb-8">
            <div className="flex items-center gap-3">
              <div className="w-11 h-11 rounded-xl bg-gradient-to-br from-saffron-500 to-green-600 flex items-center justify-center text-sm font-black text-white tracking-tight shadow-lg shadow-saffron-500/20">
                NV
              </div>

              <div>
                <div className="font-extrabold text-lg leading-tight">
                  Nirdosh Vault
                </div>
                <div className="text-xs text-slate-500">
                  {t('auth_subtitle')}
                </div>
              </div>
            </div>

            <LanguageSwitcher />
          </div>

          <div className="flex bg-white rounded-lg p-1 mb-8">
            <button
              type="button"
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${isLogin
                  ? 'bg-slate-100 text-navy-950'
                  : 'text-slate-500 hover:text-navy-950'
                }`}
              onClick={() => switchMode(true)}
              disabled={loading}
            >
              {t('auth_sign_in')}
            </button>

            <button
              type="button"
              className={`flex-1 py-2 text-sm font-medium rounded-md transition-colors ${!isLogin
                  ? 'bg-slate-100 text-navy-950'
                  : 'text-slate-500 hover:text-navy-950'
                }`}
              onClick={() => switchMode(false)}
              disabled={loading}
            >
              {t('auth_create_account')}
            </button>
          </div>

          <div className="mb-6 text-center">
            <h1 className="text-xl font-bold text-navy-950">
              {isLogin ? t('auth_welcome_back') : t('auth_create_title')}
            </h1>

            <p className="text-sm text-slate-500 mt-1">
              {isLogin
                ? t('auth_sign_in_desc')
                : t('auth_register_desc')}
            </p>
          </div>

          {error && (
            <div
              role="alert"
              aria-live="polite"
              className="p-3.5 rounded-lg bg-red-500/10 border border-red-500/20 text-red-600 text-sm mb-6 text-center"
            >
              {error}
            </div>
          )}

          <form onSubmit={handleSubmit} className="space-y-4">
            {!isLogin && (
              <div>
                <label
                  htmlFor="full-name"
                  className="block text-xs font-medium text-slate-500 mb-1.5"
                >
                  {t('auth_full_name_label')}
                </label>

                <input
                  id="full-name"
                  type="text"
                  className="input"
                  placeholder={t('auth_full_name_placeholder')}
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  autoComplete="name"
                  minLength={2}
                  maxLength={100}
                  disabled={loading}
                  required
                />
              </div>
            )}

            <div>
              <label
                htmlFor="email"
                className="block text-xs font-medium text-slate-500 mb-1.5"
              >
                {t('auth_email_label')}
              </label>

              <input
                id="email"
                type="email"
                className="input"
                placeholder={t('auth_email_placeholder')}
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                autoComplete="email"
                disabled={loading}
                required
              />
            </div>

            <div>
              <label
                htmlFor="password"
                className="block text-xs font-medium text-slate-500 mb-1.5"
              >
                {t('auth_password_label')}
              </label>

              <input
                id="password"
                type="password"
                className="input"
                placeholder={
                  isLogin
                    ? t('auth_password_placeholder_login')
                    : t('auth_password_placeholder_signup')
                }
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                autoComplete={
                  isLogin ? 'current-password' : 'new-password'
                }
                minLength={isLogin ? undefined : 8}
                disabled={loading}
                required
              />

              {!isLogin && password.length > 0 && (
                <div className="mt-2">
                  <div className="flex gap-1 mb-1">
                    {[1, 2, 3, 4].map((level) => (
                      <div
                        key={level}
                        className="h-1.5 flex-1 rounded-full transition-all duration-300"
                        style={{
                          background:
                            level <= passwordStrength.score
                              ? passwordStrength.color
                              : 'rgba(148, 163, 184, 0.2)',
                        }}
                      />
                    ))}
                  </div>

                  <div className="flex items-center justify-between">
                    <span
                      className="text-[11px] font-medium"
                      style={{ color: passwordStrength.color }}
                    >
                      {passwordStrength.label}
                    </span>

                    <span className="text-[11px] text-slate-500">
                      {t('auth_password_hint')}
                    </span>
                  </div>
                </div>
              )}
            </div>

            <button
              type="submit"
              className="btn btn-primary w-full mt-2"
              disabled={loading}
            >
              {loading
                ? isLogin
                  ? t('auth_signing_in')
                  : t('auth_creating_account')
                : isLogin
                  ? t('auth_submit_login')
                  : t('auth_submit_signup')}
            </button>
          </form>

          <div className="relative mt-8 mb-6">
            <div className="absolute inset-0 flex items-center">
              <div className="w-full border-t border-slate-200" />
            </div>

            <div className="relative flex justify-center">
              <span className="bg-white px-3 text-xs text-slate-500">
                {t('auth_privacy_badge')}
              </span>
            </div>
          </div>

          <div className="flex items-start justify-center gap-2 text-xs text-slate-500 text-center">
            <Lock
              className="shrink-0 text-slate-500 mt-0.5"
              size={14}
              aria-hidden="true"
            />

            <span>
              {t('auth_demo_hint')}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}