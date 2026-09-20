import React, { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  ChevronRight,
  FileText,
  Loader2,
  ShieldCheck,
} from 'lucide-react';

import { useAuthStore } from '../store/auth';
import api from '../api/client';
import EmptyState from '../components/EmptyState';

export default function Dashboard() {
  const { user } = useAuthStore();
  const navigate = useNavigate();

  const [docs, setDocs] = useState<any[]>([]);
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  // DigiLocker modal states
  const [showDigiLockerModal, setShowDigiLockerModal] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);

  // Sample document loading state
  const [loadingSample, setLoadingSample] = useState(false);

  const handleLoadSampleSet = async () => {
    setLoadingSample(true);
    try {
      const res = await api.post('/samples/load', { setId: 'set-2' });
      const analysisId = res.data?.analysis?._id;
      if (analysisId) {
        navigate(`/report/${analysisId}`);
      } else {
        throw new Error('Analysis ID missing from sample load response');
      }
    } catch (err: any) {
      console.error('Failed to load sample set:', err);
      const msg =
        err.response?.data?.error ||
        err.message ||
        'Failed to load sample documents';
      alert(msg);
    } finally {
      setLoadingSample(false);
    }
  };

  // DPDP consent modal states
  const [showConsentModal, setShowConsentModal] = useState(false);
  const [consent1, setConsent1] = useState(false);
  const [consent2, setConsent2] = useState(false);
  const [consent3, setConsent3] = useState(false);

  /**
   * Consent is stored separately for each signed-in user.
   * Email is used as a fallback in case the user object does not expose _id.
   */
  const consentStorageKey = useMemo(() => {
    const userIdentifier =
      (user as any)?._id ??
      user?.id ??
      user?.email ??
      'anonymous';

    return `nirdosh_dpdp_consent_${String(userIdentifier)}`;
  }, [user]);

  useEffect(() => {
    /**
     * Remove the older shared key used by the previous implementation.
     * This prevents a previously accepted generic consent from hiding
     * the new user-specific consent modal.
     */
    sessionStorage.removeItem('nirdosh_dpdp_consent');

    const hasConsented =
      sessionStorage.getItem(consentStorageKey) === 'true';

    setShowConsentModal(!hasConsented);

    Promise.all([
      api.get('/documents'),
      api.get('/analysis'),
    ])
      .then(([docRes, analysisRes]) => {
        setDocs(docRes.data.documents || []);
        setAnalyses(analysisRes.data.analyses || []);
      })
      .catch((error) => {
        console.error('Failed to load dashboard data:', error);
      })
      .finally(() => {
        setLoading(false);
      });
  }, [consentStorageKey]);

  const latestAnalysis =
    analyses.length > 0 ? analyses[0] : null;

  const issues = latestAnalysis
    ? latestAnalysis.summary?.conflictFieldsCount ?? 0
    : 0;

  const allConsentItemsConfirmed =
    consent1 && consent2 && consent3;

  const handleConsentConfirm = () => {
    if (!allConsentItemsConfirmed) {
      return;
    }

    sessionStorage.setItem(consentStorageKey, 'true');
    setShowConsentModal(false);
  };

  function scoreColor(score: number) {
    if (score >= 80) return 'text-green-500';
    if (score >= 60) return 'text-saffron-500';
    if (score >= 40) return 'text-orange-500';
    return 'text-red-500';
  }

  function scoreBg(score: number) {
    if (score >= 80) {
      return 'bg-green-500/10 border-green-500/20';
    }

    if (score >= 60) {
      return 'bg-saffron-500/10 border-saffron-500/20';
    }

    if (score >= 40) {
      return 'bg-orange-500/10 border-orange-500/20';
    }

    return 'bg-red-500/10 border-red-500/20';
  }

  const firstName =
    user?.name?.trim().split(/\s+/)[0] || 'User';

  return (
    <div className="relative z-10 mx-auto min-h-screen max-w-5xl px-6 pb-20 pt-24">
      {/* Header */}
      <div className="mb-8 flex flex-col justify-between gap-4 md:flex-row md:items-center">
        <div>
          <p className="mb-1 text-sm text-slate-500">
            {new Date().toLocaleDateString('en-IN', {
              weekday: 'long',
              year: 'numeric',
              month: 'long',
              day: 'numeric',
            })}
          </p>

          <h2 className="text-3xl font-bold">
            Welcome, {firstName}
          </h2>
        </div>

        <Link to="/upload" className="btn btn-primary">
          + Upload Documents
        </Link>
      </div>

      {/* Stats */}
      <div className="mb-8 grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatCard
          icon={<FileText className="text-saffron-500" />}
          value={docs.length}
          label="Documents Uploaded"
        />

        <StatCard
          icon={<CheckCircle className="text-green-500" />}
          value={
            latestAnalysis?.summary?.consensusFieldsCount ?? '-'
          }
          label="Fields in Consensus"
        />

        <StatCard
          icon={<AlertTriangle className="text-red-500" />}
          value={latestAnalysis ? issues : '-'}
          label="Conflicts Found"
        />

        <StatCard
          icon={<Activity className="text-blue-500" />}
          value={analyses.length}
          label="Analyses Run"
        />
      </div>

      {/* Privacy notice */}
      <div className="mb-8 flex gap-3 rounded-xl border border-saffron-500/20 bg-saffron-500/10 p-4">
        <span className="text-saffron-400">🔒</span>

        <div>
          <strong className="mb-1 block text-sm text-saffron-400">
            Privacy Notice (Demo)
          </strong>

          <p className="text-xs text-slate-600">
            Use synthetic documents only — never upload real
            Aadhaar, PAN, or sensitive personal information.
            Documents are processed temporarily and deleted after
            extraction according to the demo workflow.
          </p>
        </div>
      </div>

      {/* Quick actions */}
      <div className="mb-10 grid grid-cols-1 gap-6 md:grid-cols-3">
        <div className="card flex flex-col justify-between p-6">
          <div>
            <div className="mb-3 text-3xl">📁</div>

            <h3 className="mb-2 text-lg font-bold">
              Upload Documents
            </h3>

            <p className="mb-6 text-sm text-slate-500">
              Upload Aadhaar, PAN, Voter ID, Driving Licence,
              Passport, Birth Certificate, or Marksheet for
              cross-document consistency checking.
            </p>
          </div>

          <Link
            to="/upload"
            className="btn btn-primary flex w-full items-center justify-center px-4 py-2 text-sm"
          >
            Upload Now →
          </Link>
        </div>

        {/* Interactive DigiLocker card */}
        <div className="card flex flex-col justify-between border-slate-200 bg-white p-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-3xl">🏛️</div>

              <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] font-bold text-green-600">
                Simulated API
              </span>
            </div>

            <h3 className="mb-2 text-lg font-bold">
              DigiLocker Integration
            </h3>

            <p className="mb-6 text-sm text-slate-500">
              Simulate importing government-issued documents with
              explicit user authorization and secure consent.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setShowDigiLockerModal(true)}
            className="btn btn-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm"
          >
            Connect DigiLocker →
          </button>
        </div>

        {/* Pre-built Sample Documents card */}
        <div className="card flex flex-col justify-between border-slate-200 bg-white p-6">
          <div>
            <div className="mb-3 flex items-center justify-between">
              <div className="text-3xl">⚡</div>

              <span className="rounded-full border border-saffron-500/20 bg-saffron-500/10 px-2 py-0.5 text-[10px] font-bold text-saffron-600">
                Instant Demo
              </span>
            </div>

            <h3 className="mb-2 text-lg font-bold">
              Try Sample Documents
            </h3>

            <p className="mb-3 text-sm text-slate-500">
              Instantly analyze a pre-built 3-document mismatch scenario (Ration Card, Aadhaar, Driving Licence) with zero OCR wait.
            </p>

            <p className="mb-6 text-xs text-slate-400">
              Loads a ready-made example instantly, no upload needed.
            </p>
          </div>

          <button
            type="button"
            onClick={handleLoadSampleSet}
            disabled={loadingSample}
            className="btn btn-secondary flex w-full items-center justify-center gap-2 px-4 py-2 text-sm hover:border-saffron-500/50 hover:text-saffron-600"
          >
            {loadingSample ? (
              <>
                <Loader2 size={16} className="animate-spin text-saffron-500" />
                <span>Loading Demo Set...</span>
              </>
            ) : (
              <span>Try with Sample Documents →</span>
            )}
          </button>
        </div>
      </div>

      {/* Analysis history */}
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-xl font-bold">Analysis History</h3>

        <Link
          to="/upload"
          className="text-sm font-medium text-saffron-500 hover:text-saffron-400"
        >
          New Analysis →
        </Link>
      </div>

      {loading ? (
        <div className="card p-12 text-center text-slate-500">
          Loading...
        </div>
      ) : analyses.length === 0 ? (
        <div className="card">
          <EmptyState
            emoji="📊"
            title="No Analyses Yet"
            description="Upload at least 2 documents and run your first consensus analysis to see identity consistency results here."
            action={{
              label: 'Upload Documents →',
              onClick: () => navigate('/upload'),
            }}
          />
        </div>
      ) : (
        <div className="space-y-3">
          {analyses.map((analysis: any) => {
            const analysisIssues =
              analysis.summary?.conflictFieldsCount ?? 0;

            const score =
              analysis.identityResolutionConfidence?.score ??
              analysis.healthScore ??
              0;

            return (
              <Link
                key={analysis._id}
                to={`/report/${analysis._id}`}
                className="card flex flex-col gap-4 p-5 transition-all hover:border-saffron-500/30 sm:flex-row sm:items-center"
              >
                {/* Score badge */}
                <div
                  className={`flex h-16 w-16 shrink-0 flex-col items-center justify-center rounded-xl border ${scoreBg(
                    score,
                  )}`}
                >
                  <span
                    className={`text-2xl font-black ${scoreColor(
                      score,
                    )}`}
                  >
                    {score}
                  </span>

                  <span className="text-[9px] text-slate-500">
                    /100
                  </span>
                </div>

                {/* Analysis information */}
                <div className="min-w-0 flex-1">
                  <div className="mb-1 flex flex-wrap items-center gap-2">
                    <span className="text-sm font-semibold">
                      {analysis.documentIds?.length ?? 0} documents
                    </span>

                    {analysisIssues > 0 ? (
                      <span className="rounded-full border border-red-500/20 bg-red-500/10 px-2 py-0.5 text-[10px] text-red-400">
                        {analysisIssues}{' '}
                        {analysisIssues === 1
                          ? 'conflict'
                          : 'conflicts'}
                      </span>
                    ) : (
                      <span className="rounded-full border border-green-500/20 bg-green-500/10 px-2 py-0.5 text-[10px] text-green-400">
                        ✓ Consistent
                      </span>
                    )}

                    <span className="rounded-full bg-slate-500/10 px-2 py-0.5 text-[10px] text-slate-500">
                      {analysis.summary?.consensusFieldsCount ?? 0}/
                      {analysis.summary?.comparableFieldsCount ?? 0}{' '}
                      fields consistent
                    </span>
                  </div>

                  <div className="text-xs text-slate-500">
                    {new Date(analysis.createdAt).toLocaleString(
                      'en-IN',
                      {
                        day: 'numeric',
                        month: 'short',
                        year: 'numeric',
                        hour: '2-digit',
                        minute: '2-digit',
                      },
                    )}
                  </div>
                </div>

                <ChevronRight
                  size={18}
                  className="shrink-0 text-slate-400"
                />
              </Link>
            );
          })}
        </div>
      )}

      {/* DPDP post-login data-processing consent modal */}
      {showConsentModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/70 p-4 backdrop-blur-md">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="data-processing-consent-title"
            className="animate-in fade-in zoom-in-95 w-full max-w-lg rounded-2xl border border-slate-800 bg-slate-900 p-6 text-white shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-3 border-b border-slate-800 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-saffron-500/20 text-saffron-400">
                <ShieldCheck size={24} />
              </div>

              <div>
                <h3
                  id="data-processing-consent-title"
                  className="text-base font-bold"
                >
                  Data Processing Consent
                </h3>

                <p className="text-xs text-slate-400">
                  Please read and confirm before accessing your
                  workspace
                </p>
              </div>
            </div>

            <div className="mb-6 space-y-3 text-xs text-slate-300">
              <ConsentOption
                checked={consent1}
                onChange={setConsent1}
                title="Demo Environment Only"
                description="I understand this is a demonstration application and I will only upload synthetic or redacted sample documents — never real identity documents."
              />

              <ConsentOption
                checked={consent2}
                onChange={setConsent2}
                title="Temporary Processing"
                description="I consent to uploaded files being temporarily processed for AI-assisted data extraction and cross-document consistency analysis."
              />

              <ConsentOption
                checked={consent3}
                onChange={setConsent3}
                title="No Permanent Document Storage"
                description="I acknowledge that original uploaded files are not intended for permanent storage in this demonstration and are removed according to the processing workflow."
              />
            </div>

            <div className="mb-4 flex items-center justify-between px-1 text-xs text-slate-400">
              <span>Progress</span>

              <span className="font-bold text-saffron-400">
                {Number(consent1) +
                  Number(consent2) +
                  Number(consent3)}
                /3 confirmed
              </span>
            </div>

            <button
              type="button"
              onClick={handleConsentConfirm}
              disabled={!allConsentItemsConfirmed}
              className={`flex w-full items-center justify-center gap-2 rounded-xl py-3 text-sm font-bold transition-all ${allConsentItemsConfirmed
                  ? 'cursor-pointer bg-saffron-500 text-white shadow-lg shadow-saffron-500/20 hover:bg-saffron-600'
                  : 'cursor-not-allowed border border-slate-700/40 bg-slate-800 text-slate-500'
                }`}
            >
              {allConsentItemsConfirmed
                ? 'Confirm & Continue to Dashboard'
                : 'Please confirm all 3 items above'}
            </button>

            <p className="mt-3 text-center text-[10px] text-slate-500">
              Consent is stored for the current signed-in session.
              It should be cleared when you log out.
            </p>
          </div>
        </div>
      )}

      {/* DigiLocker consent simulation modal */}
      {showDigiLockerModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-navy-950/60 p-4 backdrop-blur-sm">
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="digilocker-modal-title"
            className="w-full max-w-md rounded-2xl border border-slate-100 bg-white p-6 shadow-2xl"
          >
            <div className="mb-4 flex items-center gap-3 border-b border-slate-100 pb-4">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-600 text-lg font-black text-white">
                DL
              </div>

              <div>
                <h4
                  id="digilocker-modal-title"
                  className="text-base font-bold text-navy-950"
                >
                  DigiLocker Consent Gateway
                </h4>

                <p className="text-xs text-slate-500">
                  Demonstration of a consent-based document-provider
                  flow
                </p>
              </div>
            </div>

            <p className="mb-4 text-xs leading-relaxed text-slate-600">
              <strong>Nirdosh Vault</strong> is requesting temporary
              access to simulate fetching digital documents for
              pre-submission identity-consistency checking:
            </p>

            <div className="mb-6 space-y-2 rounded-xl border border-slate-200/60 bg-slate-50 p-3 text-xs text-slate-700">
              <div className="flex items-center gap-2">
                ✅ Primary demographic details
              </div>

              <div className="flex items-center gap-2">
                ✅ Tax identification document
              </div>

              <div className="flex items-center gap-2">
                ✅ Birth certificate
              </div>
            </div>

            <div className="mb-6 rounded-xl border border-saffron-500/20 bg-saffron-50 p-3 text-[11px] text-saffron-800">
              🔒 <strong>Demo privacy control:</strong> Data is
              temporarily processed for the demonstration and should
              not be treated as a live DigiLocker integration.
            </div>

            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={() => setShowDigiLockerModal(false)}
                className="btn btn-secondary flex-1 py-2.5 text-xs"
              >
                Deny
              </button>

              <button
                type="button"
                onClick={() => {
                  setIsConnecting(true);

                  window.setTimeout(() => {
                    setIsConnecting(false);
                    setShowDigiLockerModal(false);
                    navigate('/upload');
                  }, 1200);
                }}
                disabled={isConnecting}
                className="btn btn-primary flex flex-1 items-center justify-center gap-2 py-2.5 text-xs"
              >
                {isConnecting
                  ? 'Authenticating...'
                  : 'Allow & Continue'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface ConsentOptionProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  title: string;
  description: string;
}

function ConsentOption({
  checked,
  onChange,
  title,
  description,
}: ConsentOptionProps) {
  return (
    <label className="flex cursor-pointer items-start gap-3 rounded-xl border border-slate-700/60 bg-slate-800/60 p-3 transition-colors hover:bg-slate-800">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
        className="mt-0.5 rounded border-slate-600 text-saffron-500 focus:ring-saffron-500"
      />

      <div>
        <strong className="mb-0.5 block text-white">
          {title}
        </strong>

        <span className="leading-relaxed text-slate-400">
          {description}
        </span>
      </div>
    </label>
  );
}

function StatCard({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: React.ReactNode;
  label: string;
}) {
  return (
    <div className="card p-6">
      <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-white shadow-sm">
        {icon}
      </div>

      <div className="mb-1 text-3xl font-black">{value}</div>

      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}