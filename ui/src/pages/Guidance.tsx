import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  MapPin,
  CheckCircle,
  Clock,
  IndianRupee,
  FileText,
  AlertTriangle,
  ExternalLink,
  ShieldCheck,
  Loader2,
  Volume2,
  Square,
  Play,
  Pause,
} from 'lucide-react';
import api from '../api/client';
import { useLanguage } from '../store/language';

type CorrectionKitResponse = {
  guide_status?: string;
  selected_rule_id?: string | null;
  correction_guide?: {
    title?: string;
    citizen_message?: string;
    authority?: string;
    jurisdiction?: string;
    channel?: string[];
    steps?: string[];
    supporting_document_categories?: string[];
    online_allowed?: boolean | null;
    offline_required?: boolean | null;
    update_limit?: string;
    human_review_required?: boolean;
    source_checked_date?: string;
    expires_for_review_on?: string | null;
    disclaimer?: string;
  } | null;
  official_evidence?: Array<{
    authority?: string;
    title?: string;
    url?: string;
    publication_date?: string | null;
    exact_support?: string;
  }>;
  next_action?: string;
  legal_boundary?: string;
  rag_metadata?: {
    enabled?: boolean;
    generated_by?: 'rag_gemini' | 'rag_template' | string;
    grounding_rule_ids?: string[];
    retrieved_record_count?: number;
    last_verified?: string;
  };
};

type GuideState = {
  loading: boolean;
  error: string;
  data: CorrectionKitResponse | null;
  documentId: string | null;
};

const conflictStatuses = [
  'mismatch',
  'outlier',
  'outlier_detected',
  'possible_variant',
  'conflict',
  'conflicting_evidence',
  'no_consensus',
  'incomplete_date_conflict',
  'extraction_uncertain',
  'extraction_invalid',
];

const normalizeFieldKey = (value: unknown): string =>
  String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s./-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');

const normalizeDocumentType = (value: unknown): string =>
  normalizeFieldKey(value);

const isAadhaarType = (value: unknown): boolean => {
  const normalized = normalizeDocumentType(value);
  return ['aadhaar', 'aadhar', 'aadhaar_card', 'aadhar_card'].includes(
    normalized,
  );
};

function formatDate(value?: string | null): string {
  if (!value) return 'Not specified';

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;

  return parsed.toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function getEvidence(conflict: any) {
  const evidence: Array<{
    document: string;
    documentId?: string;
    docType?: string;
    value: string;
    type: 'supporting' | 'outlier' | 'other';
  }> = [];

  const addEntry = (
    document: any,
    value: unknown,
    type: 'supporting' | 'outlier' | 'other',
  ) => {
    evidence.push({
      document:
        document?.docTitle ||
        document?.documentTitle ||
        document?.title ||
        document?.docType ||
        document?.documentType ||
        'Document',
      documentId:
        document?.documentId ||
        document?.docId ||
        document?._id ||
        document?.id,
      docType:
        document?.docType ||
        document?.documentType ||
        document?.type,
      value: String(
        value ??
        document?.value ??
        document?.rawValue ??
        document?.normalizedValue ??
        'Not available',
      ),
      type,
    });
  };

  if (Array.isArray(conflict?.supportingDocs)) {
    conflict.supportingDocs.forEach((document: any) =>
      addEntry(document, undefined, 'supporting'),
    );
  }

  if (Array.isArray(conflict?.outliers)) {
    conflict.outliers.forEach((document: any) =>
      addEntry(document, undefined, 'outlier'),
    );
  }

  if (Array.isArray(conflict?.evidence)) {
    conflict.evidence.forEach((document: any) =>
      addEntry(document, undefined, 'other'),
    );
  }

  if (Array.isArray(conflict?.groups)) {
    conflict.groups.forEach((group: any) => {
      const documents = group?.docs || group?.documents || [];
      documents.forEach((document: any) =>
        addEntry(document, group?.value, 'other'),
      );
    });
  }

  if (
    evidence.length === 0 &&
    conflict?.consensusValue !== undefined
  ) {
    evidence.push({
      document: 'Consensus value',
      value: String(conflict.consensusValue),
      type: 'supporting',
    });
  }

  const seen = new Set<string>();

  return evidence.filter((item) => {
    const key = [
      item.documentId ?? '',
      item.document,
      item.value,
      item.type,
    ].join('|');

    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function findAadhaarDocumentId(
  conflict: any,
  documents: any[],
): string | null {
  const evidence = getEvidence(conflict);

  const evidenceAadhaar = evidence.find(
    (item) =>
      item.documentId &&
      (isAadhaarType(item.docType) ||
        item.document.toLowerCase().includes('aadhaar') ||
        item.document.toLowerCase().includes('aadhar')),
  );

  if (evidenceAadhaar?.documentId) {
    return evidenceAadhaar.documentId;
  }

  const uploadedAadhaar = documents.find(
    (document) =>
      isAadhaarType(document?.docType) &&
      (!document?.status || document.status === 'ready'),
  );

  return uploadedAadhaar?._id || uploadedAadhaar?.id || null;
}

function fallbackRuleForField(fieldKey: unknown) {
  const key = normalizeFieldKey(fieldKey);

  if (key === 'date_of_birth' || key === 'dob') {
    return {
      authority:
        'UIDAI, Registrar of Births and Deaths, or the relevant issuing authority',
      form:
        'Date of Birth Correction or Document Update Application',
      fee: 'Check the latest official authority fee',
      timeline: 'Authority-dependent',
      docs: [
        'Accepted proof of date of birth',
        'Original document containing the mismatch',
        'Identity proof',
        'Official correction application',
      ],
      steps: [
        'Compare the detected values and identify the document requiring review.',
        'Confirm the correct date from an original or legally accepted record.',
        'Contact the authority that issued the selected document.',
        'Follow the authority’s current correction process.',
        'Retain the acknowledgement and verify the corrected document.',
      ],
    };
  }

  if (
    key === 'full_name' ||
    key === 'name' ||
    key.includes('applicant_name')
  ) {
    return {
      authority:
        'Authority that issued the document containing the incorrect name',
      form: 'Name Correction Application',
      fee: 'Check the latest official authority fee',
      timeline: 'Authority-dependent',
      docs: [
        'Accepted proof of identity containing the correct name',
        'Document containing the mismatch',
        'Official correction application',
        'Affidavit or Gazette record only when officially required',
      ],
      steps: [
        'Determine whether the difference is a minor variation or a legal name change.',
        'Select the document that requires review.',
        'Contact its issuing authority.',
        'Follow the current official name-correction process.',
        'Provide stronger legal evidence only when the authority requires it.',
      ],
    };
  }

  if (key.includes('address')) {
    return {
      authority: 'Relevant issuing authority',
      form: 'Address Update Application',
      fee: 'Check the latest official authority fee',
      timeline: 'Authority-dependent',
      docs: [
        'Accepted proof of address',
        'Document containing the outdated or incorrect address',
        'Identity proof',
        'Official correction application',
      ],
      steps: [
        'Confirm the current address using an accepted proof.',
        'Select the document requiring review.',
        'Contact the relevant issuing authority.',
        'Follow its current address-update procedure.',
        'Retain the acknowledgement and verify the corrected document.',
      ],
    };
  }

  return {
    authority: 'Authority that issued the selected document',
    form: 'Official Document Correction Application',
    fee: 'Check the latest official authority fee',
    timeline: 'Authority-dependent',
    docs: [
      'Document containing the mismatch',
      'Strong supporting document containing the correct value',
      'Identity proof',
      'Official correction application',
    ],
    steps: [
      'Review the conflicting values.',
      'Select the document requiring review.',
      'Contact the authority that issued it.',
      'Follow the current official correction process.',
      'Retain the acknowledgement and verify the corrected document.',
    ],
  };
}

export default function Guidance() {
  const { id } = useParams<{ id: string }>();

  const [analysis, setAnalysis] = useState<any>(null);
  const [documents, setDocuments] = useState<any[]>([]);
  const [guides, setGuides] = useState<Record<string, GuideState>>({});
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const currentLang = useLanguage((s) => s.lang);
  const [speakingKey, setSpeakingKey] = useState<string | null>(null);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleStopSpeech = () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    setSpeakingKey(null);
    setIsPaused(false);
  };

  const handleToggleSpeech = (key: string, text: string) => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      alert('Text-to-speech is not supported in this browser.');
      return;
    }

    const synth = window.speechSynthesis;

    if (speakingKey === key) {
      if (synth.speaking) {
        if (synth.paused) {
          synth.resume();
          setIsPaused(false);
        } else {
          synth.pause();
          setIsPaused(true);
        }
      } else {
        setSpeakingKey(null);
        setIsPaused(false);
      }
      return;
    }

    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    const voices = synth.getVoices();
    const langPrefix = currentLang.toLowerCase();

    const matchingVoice =
      voices.find((v) => v.lang.toLowerCase().replace('_', '-').startsWith(langPrefix)) ||
      voices.find((v) => v.lang.toLowerCase().includes(langPrefix)) ||
      voices.find((v) => v.lang.toLowerCase().startsWith('en'));

    if (matchingVoice) {
      utterance.voice = matchingVoice;
    }

    const defaultLangMap: Record<string, string> = {
      hi: 'hi-IN',
      mr: 'mr-IN',
      ta: 'ta-IN',
      te: 'te-IN',
      bn: 'bn-IN',
      gu: 'gu-IN',
      kn: 'kn-IN',
      en: 'en-IN',
    };
    utterance.lang = matchingVoice?.lang || defaultLangMap[langPrefix] || 'en-IN';
    utterance.rate = 0.95;

    utterance.onend = () => {
      setSpeakingKey(null);
      setIsPaused(false);
    };

    utterance.onerror = () => {
      setSpeakingKey(null);
      setIsPaused(false);
    };

    setSpeakingKey(key);
    setIsPaused(false);
    synth.speak(utterance);
  };

  const conflicts = useMemo(() => {
    if (!Array.isArray(analysis?.fieldResults)) return [];

    return analysis.fieldResults.filter(
      (field: any) =>
        conflictStatuses.includes(field?.status) ||
        (Array.isArray(field?.outliers) && field.outliers.length > 0) ||
        (Array.isArray(field?.groups) && field.groups.length > 1),
    );
  }, [analysis]);

  useEffect(() => {
    if (!id) {
      setError('Analysis ID is missing.');
      setLoading(false);
      return;
    }

    let cancelled = false;

    Promise.all([
      api.get(`/analysis/${id}`),
      api.get('/documents'),
    ])
      .then(([analysisResponse, documentsResponse]) => {
        if (cancelled) return;

        setAnalysis(analysisResponse.data);

        const responseDocuments = Array.isArray(documentsResponse.data)
          ? documentsResponse.data
          : Array.isArray(documentsResponse.data?.documents)
            ? documentsResponse.data.documents
            : [];

        setDocuments(responseDocuments);
      })
      .catch((err) => {
        if (cancelled) return;

        console.error('Guidance loading failed:', err);
        setError(
          err?.response?.data?.error ||
          'Unable to load correction guidance.',
        );
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    if (!id || loading || conflicts.length === 0) return;

    let cancelled = false;

    const missingGuideEntries: Array<{
      conflict: any;
      key: string;
    }> = conflicts
      .map((conflict: any, index: number) => ({
        conflict,
        key: `${conflict.fieldKey || conflict.field || index}-${index}`,
      }))
      .filter((entry: { conflict: any; key: string }) => !guides[entry.key]);

    if (missingGuideEntries.length === 0) {
      return;
    }

    missingGuideEntries.forEach((entry) => {
      const { conflict, key } = entry;
      const documentId = findAadhaarDocumentId(conflict, documents);

      setGuides((current) => ({
        ...current,
        [key]: {
          loading: true,
          error: '',
          data: null,
          documentId,
        },
      }));

      if (!documentId) {
        setGuides((current) => ({
          ...current,
          [key]: {
            loading: false,
            error:
              'No Aadhaar document was available for official UIDAI guidance. Showing safe fallback guidance.',
            data: null,
            documentId: null,
          },
        }));
        return;
      }

      void api
        .post(`/analysis/${id}/correction-kit`, {
          fieldKey:
            conflict.fieldKey ||
            conflict.field ||
            normalizeFieldKey(conflict.label),
          documentId,
        })
        .then((response) => {
          if (cancelled) return;

          setGuides((current) => ({
            ...current,
            [key]: {
              loading: false,
              error: '',
              data: response.data,
              documentId,
            },
          }));
        })
        .catch((err: any) => {
          if (cancelled) return;

          console.error('Correction Kit request failed:', err);

          setGuides((current) => ({
            ...current,
            [key]: {
              loading: false,
              error:
                err?.response?.data?.error ||
                'Official-source guidance could not be loaded. Showing safe fallback guidance.',
              data: null,
              documentId,
            },
          }));
        });
    });

    return () => {
      cancelled = true;
    };
  }, [conflicts, documents, id, loading]);

  if (loading) {
    return (
      <div className="pt-32 text-center text-slate-500">
        Loading official correction guidelines...
      </div>
    );
  }

  if (error) {
    return (
      <div className="pt-28 px-6 max-w-3xl mx-auto">
        <div className="card p-8 text-center">
          <AlertTriangle
            className="mx-auto text-red-500 mb-3"
            size={40}
          />

          <h2 className="text-xl font-bold mb-2">
            Guidance Could Not Be Loaded
          </h2>

          <p className="text-sm text-slate-500">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="pt-24 px-6 max-w-4xl mx-auto min-h-screen relative z-10 pb-20">
      <div className="flex flex-wrap items-center gap-2 mb-6 text-sm">
        <Link
          to={`/report/${id}`}
          aria-label="Back to Report"
          className="text-slate-500 hover:text-saffron-600 flex items-center gap-1 font-medium"
        >
          <ArrowLeft size={16} />
          Back to Report
        </Link>

        <span className="text-slate-300" aria-hidden="true">/</span>

        <span className="text-saffron-600 font-bold uppercase tracking-wider text-xs bg-saffron-50 px-2.5 py-1 rounded-md border border-saffron-200">
          Correction Kit &amp; SOPs
        </span>
      </div>

      <div role="status" aria-live="polite" className="mb-8">
        <h2 className="text-3xl font-bold mb-2">
          Official Correction Guidance Kit
        </h2>

        <p className="text-slate-500 text-sm">
          <span className="sr-only">Status: </span>
          Detected conflicts: {conflicts.length}
        </p>
      </div>

      {conflicts.length === 0 ? (
        <div className="card p-8 text-center bg-white border-slate-200">
          <CheckCircle
            className="mx-auto text-green-500 mb-3"
            size={40}
          />

          <h3 className="font-bold text-lg mb-1">
            No Conflicts Detected
          </h3>
        </div>
      ) : (
        <div className="space-y-6">
          {conflicts.map((conflict: any, index: number) => {
            const key = `${conflict.fieldKey || conflict.field || index}-${index}`;
            const guideState = guides[key];
            const kit = guideState?.data;
            const backendGuide = kit?.correction_guide;
            const fallback = fallbackRuleForField(
              conflict.fieldKey || conflict.field || conflict.label,
            );
            const evidence = getEvidence(conflict);
            const label =
              conflict.label ||
              conflict.field ||
              conflict.fieldKey ||
              'Document Field';

            const steps =
              backendGuide?.steps?.length
                ? backendGuide.steps
                : fallback.steps;

            const requiredDocuments =
              backendGuide?.supporting_document_categories?.length
                ? backendGuide.supporting_document_categories
                : fallback.docs;

            const authority =
              backendGuide?.authority || fallback.authority;

            const officialEvidence = Array.isArray(kit?.official_evidence)
              ? kit?.official_evidence ?? []
              : [];

            const ragEnabled = Boolean(kit?.rag_metadata?.enabled);
            const isSpeakingThis = speakingKey === key;
            const textToRead = [
              backendGuide?.title || `${label} Correction`,
              `Governing authority: ${authority}.`,
              backendGuide?.citizen_message,
              steps.length > 0 ? `Steps: ${steps.map((s: string, i: number) => `Step ${i + 1}: ${s}`).join('. ')}` : '',
              requiredDocuments.length > 0 ? `Required documents: ${requiredDocuments.join(', ')}.` : '',
            ].filter(Boolean).join('. ');

            return (
              <div
                key={key}
                className="card p-6 bg-white border-slate-200 shadow-sm"
              >
                <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4 mb-4 border-b border-slate-100 pb-4">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-amber-600 bg-amber-50 border border-amber-200 px-2.5 py-0.5 rounded-full">
                        <span className="sr-only">Needs review / Conflict: </span>
                        {conflict.status === 'extraction_invalid'
                          ? 'Extraction Issue — Re-upload Required'
                          : 'Conflict Resolution Required'}
                      </span>

                      {ragEnabled && (
                        <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-700 bg-emerald-50 border border-emerald-200 px-2.5 py-0.5 rounded-full flex items-center gap-1">
                          <ShieldCheck size={11} />
                          Official-source RAG
                        </span>
                      )}
                    </div>

                    <h3 className="text-xl font-bold text-navy-950 mt-2">
                      {backendGuide?.title || `${label} Correction`}
                    </h3>

                    <p className="text-xs text-slate-500 mt-1">
                      Status: <strong>{conflict.status}</strong>
                    </p>

                    <p className="text-xs text-slate-500 mt-1">
                      Governing body: <strong>{authority}</strong>
                    </p>
                  </div>

                  <div className="text-left sm:text-right shrink-0">
                    <div className="text-xs font-semibold text-slate-700 flex items-center gap-1 sm:justify-end">
                      <Clock size={14} />
                      {backendGuide?.source_checked_date
                        ? `Verified ${formatDate(backendGuide.source_checked_date)}`
                        : fallback.timeline}
                    </div>

                    <div className="text-xs font-bold text-saffron-600 mt-1 flex items-center gap-1 sm:justify-end">
                      <IndianRupee size={12} />
                      {fallback.fee}
                    </div>

                    <div className="mt-3 flex items-center gap-1.5 sm:justify-end">
                      <button
                        type="button"
                        onClick={() => handleToggleSpeech(key, textToRead)}
                        className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold border transition-colors shadow-xs ${
                          isSpeakingThis
                            ? 'bg-saffron-50 text-saffron-700 border-saffron-300 hover:bg-saffron-100'
                            : 'bg-white text-slate-700 border-slate-200 hover:bg-slate-50'
                        }`}
                        aria-label={
                          isSpeakingThis
                            ? isPaused
                              ? 'Resume audio guidance'
                              : 'Pause audio guidance'
                            : 'Listen to audio guidance'
                        }
                      >
                        {isSpeakingThis ? (
                          isPaused ? (
                            <>
                              <Play size={13} className="text-saffron-600" />
                              <span>Resume</span>
                            </>
                          ) : (
                            <>
                              <Pause size={13} className="text-saffron-600" />
                              <span>Pause</span>
                            </>
                          )
                        ) : (
                          <>
                            <Volume2 size={13} className="text-slate-500" />
                            <span>🔊 Listen</span>
                          </>
                        )}
                      </button>

                      {isSpeakingThis && (
                        <button
                          type="button"
                          onClick={handleStopSpeech}
                          className="inline-flex items-center justify-center p-1.5 rounded-lg text-xs border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900"
                          title="Stop audio readout"
                          aria-label="Stop audio readout"
                        >
                          <Square size={13} />
                        </button>
                      )}
                    </div>
                  </div>
                </div>

                {guideState?.loading && (
                  <div className="mb-6 rounded-xl border border-blue-100 bg-blue-50/60 p-4 text-xs text-blue-800 flex items-center gap-2">
                    <Loader2 size={15} className="animate-spin" />
                    Retrieving official UIDAI guidance...
                  </div>
                )}

                {guideState?.error && (
                  <div className="mb-6 rounded-xl border border-amber-200 bg-amber-50 p-4 text-xs text-amber-800">
                    {guideState.error}
                  </div>
                )}

                {backendGuide?.citizen_message && (
                  <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
                    <p className="text-xs text-emerald-900 leading-relaxed">
                      {backendGuide.citizen_message}
                    </p>
                  </div>
                )}

                <div className="bg-slate-50 rounded-xl p-4 mb-6 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-700 uppercase tracking-wider text-[10px] mb-3">
                    Conflicting Evidence Found
                  </div>

                  {evidence.length > 0 ? (
                    evidence.map((item, evidenceIndex) => (
                      <div
                        key={evidenceIndex}
                        className="flex flex-col sm:flex-row sm:justify-between gap-2 py-2 border-b border-slate-200 last:border-0"
                      >
                        <span className="text-slate-600 font-medium">
                          {item.document}
                        </span>

                        <span
                          className={`font-bold px-2 py-1 rounded border ${item.type === 'outlier'
                            ? 'bg-red-50 text-red-700 border-red-200'
                            : 'bg-white text-navy-950 border-slate-200'
                            }`}
                        >
                          <span className="sr-only">{item.type === 'outlier' ? 'Outlier / Discrepancy: ' : 'Supporting value: '}</span>
                          {item.value}
                        </span>
                      </div>
                    ))
                  ) : (
                    <p className="text-slate-500">
                      Conflict detected, but detailed document values
                      were not included.
                    </p>
                  )}
                </div>

                <div className="mb-6">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3">
                    Recommended Correction Procedure
                  </h4>

                  <div className="space-y-3">
                    {steps.map((step: string, stepIndex: number) => (
                      <div
                        key={stepIndex}
                        className="flex items-start gap-3 text-xs text-slate-700"
                      >
                        <span className="w-5 h-5 rounded-full bg-saffron-500/10 text-saffron-600 font-bold flex items-center justify-center shrink-0">
                          {stepIndex + 1}
                        </span>

                        <p>{step}</p>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="bg-blue-50/50 rounded-xl p-4 border border-blue-100 mb-6 text-xs">
                  <div className="font-bold text-blue-900 mb-3 flex items-center gap-2">
                    <FileText size={14} />
                    Supporting Documents That May Be Required
                  </div>

                  <ul className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {requiredDocuments.map(
                      (document: string, documentIndex: number) => (
                        <li
                          key={documentIndex}
                          className="flex items-start gap-2"
                        >
                          <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1.5 shrink-0" />
                          {document}
                        </li>
                      ),
                    )}
                  </ul>
                </div>

                {backendGuide?.update_limit && (
                  <div className="mb-6 rounded-xl border border-amber-100 bg-amber-50/60 p-4 text-xs">
                    <strong className="text-amber-900">Update limit:</strong>{' '}
                    <span className="text-amber-800">
                      {backendGuide.update_limit}
                    </span>
                  </div>
                )}

                {officialEvidence.length > 0 && (
                  <div className="mb-6 rounded-xl border border-emerald-100 bg-emerald-50/40 p-4">
                    <div className="font-bold text-emerald-900 mb-3 flex items-center gap-2 text-xs">
                      <ShieldCheck size={15} />
                      Official Evidence
                    </div>

                    <div className="space-y-3">
                      {officialEvidence.map((source, sourceIndex) => (
                        <div
                          key={`${source.title || 'source'}-${sourceIndex}`}
                          className="rounded-lg border border-emerald-100 bg-white p-3 text-xs"
                        >
                          <p className="font-semibold text-slate-800">
                            {source.title || 'Official UIDAI source'}
                          </p>

                          <p className="text-slate-500 mt-1">
                            {source.authority || authority}
                          </p>

                          {source.exact_support && (
                            <p className="text-slate-500 mt-2">
                              {source.exact_support}
                            </p>
                          )}

                          {source.url && (
                            <a
                              href={source.url}
                              target="_blank"
                              rel="noreferrer"
                              aria-label={`Open official source: ${source.title || 'Official source'} (opens in a new tab)`}
                              className="inline-flex items-center gap-1 mt-2 font-semibold text-emerald-700 hover:text-emerald-900"
                            >
                              Open official source
                              <ExternalLink size={12} />
                            </a>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {kit?.next_action && (
                  <p className="mb-5 text-xs text-slate-600">
                    <strong>Next action:</strong> {kit.next_action}
                  </p>
                )}

                <div className="flex flex-col sm:flex-row justify-between gap-4 pt-4 border-t border-slate-100">
                  <div className="text-[11px] text-slate-400 space-y-1">
                    <p>
                      Rule:{' '}
                      <strong>
                        {kit?.selected_rule_id || fallback.form}
                      </strong>
                    </p>

                    {kit?.rag_metadata?.last_verified && (
                      <p>
                        Last verified:{' '}
                        <strong>
                          {formatDate(kit.rag_metadata.last_verified)}
                        </strong>
                      </p>
                    )}
                  </div>

                  <Link
                    to={`/centres/${id}`}
                    className="btn btn-secondary text-xs py-2 px-4 flex items-center justify-center gap-2"
                  >
                    <MapPin size={14} />
                    Find Nearest Assistance Centre
                  </Link>
                </div>

                {(backendGuide?.disclaimer || kit?.legal_boundary) && (
                  <p className="mt-4 text-[10px] leading-relaxed text-slate-400">
                    {backendGuide?.disclaimer || kit?.legal_boundary}
                  </p>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}