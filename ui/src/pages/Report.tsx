import React, { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import api from '../api/client';
import { CheckCircle2, AlertTriangle, BookOpen } from 'lucide-react';
import ExportPDF from '../components/ExportPDF';
import IdentityResolutionConfidenceCard from '../components/IdentityResolutionConfidenceCard';
import IdentityTrustGraph from '../components/IdentityTrustGraph';
import FieldResolutionBreakdown from '../components/FieldResolutionBreakdown';
import type { ConsensusSummary, DocumentSpecificField, IFieldResult } from '../types/nirdosh-vault';
import type { IdentityTrustGraphData } from '../types/identityTrustGraph';

interface ReportData {
  summary: ConsensusSummary;
  fieldResults: IFieldResult[];
  documentSpecificFields: DocumentSpecificField[];
  documentIds?: string[];
  checklist?: any[];
  identityResolutionConfidence?: any;
  identityTrustGraph?: IdentityTrustGraphData;
  _id?: string;
}

export default function Report() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [analysis, setAnalysis] = useState<ReportData | null>(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('fields');

  useEffect(() => {
    if (!id) {
      // If no ID, fetch the latest analysis
      api.get('/analysis').then(res => {
        const analyses = res.data.analyses;
        if (analyses?.length > 0) {
          navigate(`/report/${analyses[0]._id}`, { replace: true });
        } else {
          setLoading(false);
        }
      }).catch(err => {
        console.error(err);
        setLoading(false);
      });
    } else {
      api.get(`/analysis/${id}`)
        .then(res => setAnalysis(res.data))
        .catch(err => console.error(err))
        .finally(() => setLoading(false));
    }
  }, [id, navigate]);

  if (loading) return <div className="pt-32 text-center text-slate-500">Loading report...</div>;
  
  if (!analysis) return (
    <div className="pt-32 px-6 max-w-4xl mx-auto text-center">
      <div className="card p-12">
        <div className="text-4xl mb-4">⚠️</div>
        <h2 className="text-xl font-bold mb-2">No Analysis Found</h2>
        <p className="text-slate-500 mb-6">You haven't run any document consensus checks yet.</p>
        <Link to="/upload" className="btn btn-primary">Go to Upload</Link>
      </div>
    </div>
  );

  const { summary, fieldResults, documentSpecificFields } = analysis;
  const issues = summary.conflictFieldsCount;
  const hasIssues = issues > 0;
  // Use summary.totalDocuments for counts to ensure safety if documentIds array is missing
  const docCount = analysis.documentIds?.length || summary.totalDocuments || 0;

  return (
    <div className="pt-24 px-6 max-w-5xl mx-auto min-h-screen relative z-10 pb-20">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-6 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider text-saffron-500 bg-saffron-500/10 border border-saffron-500/20 mb-3">
            📊 Consensus Report
          </div>
          <h2 className="text-3xl font-bold mb-2">Document Consistency Report</h2>
          <p className="text-slate-500">Cross-document consistency only — not legal correctness or scheme eligibility.</p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <ExportPDF analysis={analysis} />
          {hasIssues && (
            <Link to={`/guidance/${analysis._id}`} className="btn btn-primary" aria-label="View Correction Kit">
              <BookOpen size={16} /> Correction Kit
            </Link>
          )}
        </div>
      </div>

      <IdentityResolutionConfidenceCard data={analysis.identityResolutionConfidence} />

      <IdentityTrustGraph graph={analysis.identityTrustGraph} />

      <div 
        role="status" 
        aria-live="polite" 
        className={`card p-8 mb-8 border-2 ${hasIssues ? 'border-amber-500/30 bg-amber-50/50 dark:bg-saffron-500/5' : 'border-emerald-500/30 bg-emerald-50/50 dark:bg-green-500/5'}`}
      >
        <div className="flex flex-col sm:flex-row items-center gap-6">
          <div className={`w-16 h-16 shrink-0 rounded-full flex items-center justify-center text-3xl ${hasIssues ? 'bg-amber-100 text-amber-600 dark:bg-saffron-500/20 dark:text-saffron-500' : 'bg-emerald-100 text-emerald-600 dark:bg-green-500/20 dark:text-green-500'}`}>
            <span className="sr-only">{hasIssues ? 'Needs review: ' : 'Agreement: '}</span>
            {hasIssues ? <AlertTriangle size={32} /> : <CheckCircle2 size={32} />}
          </div>
          <div className="flex-1 text-center sm:text-left">
            <h3 className="text-2xl font-bold mb-1 text-slate-900 dark:text-white">
              {hasIssues ? `${issues} Identity Conflict${issues > 1 ? 's' : ''} Detected — Review Required` : 'Documents Consistent — No Conflicts Detected'}
            </h3>
            <p className="text-slate-600 dark:text-slate-300 text-sm mb-2">
              Analysed <strong>{docCount} documents</strong> across <strong>{summary.comparableFieldsCount} comparable fields</strong>. 
              <span className="text-emerald-700 dark:text-green-400 font-semibold ml-1">{summary.consensusFieldsCount} fields in consensus</span>
              {issues > 0 && <span className="text-amber-700 dark:text-saffron-400 font-semibold ml-1">, {issues} conflicts</span>}.
            </p>
            <p className="text-xs text-slate-500 dark:text-slate-400">A strict majority requires more than half of usable values. This report does not determine legal correctness or scheme eligibility.</p>
          </div>
        </div>
      </div>

      {/* Health Score Tabs */}
      <div className="flex gap-1 border-b border-slate-200 dark:border-slate-800 mb-8 overflow-x-auto">
        <TabButton active={activeTab === 'fields'} onClick={() => setActiveTab('fields')}>Field-by-Field Results</TabButton>
        <TabButton active={activeTab === 'profile'} onClick={() => setActiveTab('profile')}>Consensus Profile</TabButton>
      </div>

      {activeTab === 'fields' && (
        <div className="space-y-4">
          <FieldResolutionBreakdown fieldScores={analysis.identityResolutionConfidence?.fieldScores} />

          {fieldResults.map((res: any, idx: number) => (
            <FieldRow key={idx} result={res} />
          ))}
          
          {/* New Document Specific Fields Grid */}
          {documentSpecificFields && documentSpecificFields.length > 0 && (
            <div className="mt-10 mb-8 border-t border-slate-200 dark:border-slate-800 pt-8">
              <div className="flex items-center gap-2 mb-4">
                <h3 className="text-sm font-bold uppercase text-slate-500 dark:text-slate-400 tracking-wider">
                  Document-Specific Attributes
                </h3>
                <span className="text-[10px] bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400 px-2 py-0.5 rounded-full font-medium border border-slate-200 dark:border-slate-700">
                  Non-Comparable Metadata
                </span>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {documentSpecificFields.map((item) => (
                  <div key={`${item.docId}-${item.fieldName}`} className="p-4 bg-slate-50 dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm">
                    <span className="text-xs font-semibold text-slate-500 dark:text-slate-400 block uppercase tracking-wider">{item.fieldName}</span>
                    <span className="text-sm font-bold text-slate-900 dark:text-white block mt-1 truncate" title={item.value}>{item.value}</span>
                    <div className="mt-3 inline-flex items-center text-[10px] font-medium bg-indigo-50 text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300 px-2 py-1 rounded border border-indigo-100 dark:border-indigo-800/50">
                      📄 {item.docType.replace('_', ' ').toUpperCase()}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {activeTab === 'profile' && (
        <ConsensusProfile fieldResults={fieldResults} documentCount={docCount} />
      )}
    </div>
  );
}

function ConsensusProfile({ fieldResults, documentCount }: { fieldResults: any[]; documentCount: number }) {
  const included = fieldResults.filter((r: any) => r.status === 'consistent' || r.status === 'outlier_detected' || r.status === 'possible_variant');
  const conflicts = fieldResults.filter((r: any) => r.needsManualVerification === true).length;
  
  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
        {[['Documents analysed', documentCount], ['Consensus fields', included.length], ['Conflicting fields', conflicts]].map(([label, value]) => (
          <div key={String(label)} className="card p-4 text-center">
            <div className="text-2xl font-black text-slate-900 dark:text-white">{value}</div>
            <div className="text-xs text-slate-500 dark:text-slate-400">{label}</div>
          </div>
        ))}
      </div>
      {included.length === 0 ? (
        <div className="card p-10 text-center border-slate-200 dark:border-slate-800">
          <div className="mx-auto mb-4 h-14 w-14 rounded-full bg-slate-100 dark:bg-slate-800 flex items-center justify-center text-2xl">⚖️</div>
          <h3 className="text-xl font-bold mb-2 text-slate-900 dark:text-white">No reliable consensus profile was created</h3>
          <p className="text-slate-600 dark:text-slate-300 max-w-2xl mx-auto">The current evidence does not support a safe majority. Add another independent document or confirm uncertain extracted fields to strengthen the evidence.</p>
          <div className="mt-5 inline-flex rounded-full bg-slate-100 dark:bg-slate-800 px-3 py-1 text-sm text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">The engine responsibly withheld a result</div>
        </div>
      ) : (
        <div className="card p-6">
          <h3 className="text-xl font-bold mb-5 text-slate-900 dark:text-white">Consensus Identity Profile</h3>
          {included.map((res:any, i:number)=>(
            <div key={i} className="py-4 border-b last:border-0 border-slate-200 dark:border-slate-800">
              <div className="text-sm text-slate-500 dark:text-slate-400">{res.label}</div>
              <div className="font-bold text-lg text-slate-900 dark:text-white">{res.consensusValue || 'Value requires review'}</div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mt-1">Supported by {res.supportingDocs?.length || 0} document(s)</div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }: { active: boolean, onClick: () => void, children: React.ReactNode }) {
  return (
    <button 
      onClick={onClick}
      className={`px-5 py-3 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active ? 'border-saffron-500 text-saffron-600 dark:text-saffron-400 font-semibold' : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
      }`}
    >
      {children}
    </button>
  );
}

function FieldRow({ result }: { result: any }) {
  const getStatusBadge = () => {
    switch(result.status) {
      case 'consistent':
      case 'consensus_established': 
        return (
          <span className="badge bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20">
            <span className="sr-only">Agreement: </span>✓ Consensus Established
          </span>
        );
      case 'outlier_detected':
      case 'possible_variant':
      case 'outliers_found': 
        return (
          <span className="badge bg-amber-50 text-amber-700 border border-amber-200 dark:bg-saffron-500/10 dark:text-saffron-400 dark:border-saffron-500/20">
            <span className="sr-only">Needs review: </span>⚠ Outlier Detected
          </span>
        );
      case 'conflicting_evidence':
      case 'no_consensus': 
        return (
          <span className="badge bg-rose-50 text-rose-700 border border-rose-200 dark:bg-red-500/10 dark:text-red-500 dark:border-red-500/20">
            <span className="sr-only">Conflict: </span>Conflicting evidence · no strict majority
          </span>
        );
      case 'incomplete_date_conflict': 
        return (
          <span className="badge bg-rose-50 text-rose-700 border border-rose-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20">
            <span className="sr-only">Conflict: </span>📅 Incomplete Date Conflict
          </span>
        );
      case 'extraction_invalid':
        return (
          <span className="badge bg-amber-50 text-amber-800 border border-amber-300 dark:bg-amber-500/10 dark:text-amber-300 dark:border-amber-500/30">
            <span className="sr-only">Needs review: </span>⚠ Extraction Issue
          </span>
        );
      default: return null;
    }
  };

  const getConfIcon = (conf: string) => {
    if (conf === 'high') return '🟢';
    if (conf === 'medium') return '🟡';
    if (conf === 'limited') return '🟠';
    return '🔴';
  };

  return (
    <div className="card p-6 transition-colors hover:border-slate-300 dark:hover:border-slate-700">
      <div className="flex flex-col md:flex-row md:items-start justify-between gap-4 mb-5 border-b border-slate-200 dark:border-slate-800 pb-4">
        <div>
          <div className="font-bold text-lg mb-1 text-slate-900 dark:text-white">{result.label}</div>
          <div className="font-mono text-xs text-slate-500 dark:text-slate-400">{result.fieldKey}</div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="badge bg-slate-50 text-slate-700 border border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700" title={result.confidenceLabel}>
            {getConfIcon(result.confidence)} {result.confidenceLabel}
          </span>
          {getStatusBadge()}
        </div>
      </div>

      <div className="mb-6">
        {result.status === 'consistent' && (
          <>
            <div className="text-2xl font-bold text-emerald-600 dark:text-emerald-400 mb-3">{result.consensusValue}</div>
            <div className="flex flex-wrap gap-2">
              {result.supportingDocs.map((d: any, i: number) => <DocChip key={i} title={d.docTitle} type="good" />)}
            </div>
          </>
        )}

        {(result.status === 'outlier_detected' || result.status === 'possible_variant') && (
          <div className="space-y-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Consensus Value</div>
              <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400 mb-2">{result.consensusValue}</div>
              <div className="flex flex-wrap gap-2">
                {result.supportingDocs.map((d: any, i: number) => <DocChip key={i} title={d.docTitle} type="good" />)}
              </div>
            </div>
            <div>
              <div className="text-xs text-amber-700 dark:text-saffron-400 mb-1 font-medium">Likely Outlier(s)</div>
              <div className="flex flex-wrap gap-2">
                {result.outliers.map((o: any, i: number) => <DocChip key={i} title={`${o.docTitle}: "${o.value}"`} type="warn" />)}
              </div>
            </div>
          </div>
        )}

        {result.status === 'conflicting_evidence' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {result.groups.map((g: any, i: number) => (
              <div key={i} className={`p-4 rounded-xl border ${i === 0 ? 'bg-blue-50/80 border-blue-200 dark:bg-blue-500/5 dark:border-blue-500/20' : 'bg-purple-50/80 border-purple-200 dark:bg-purple-500/5 dark:border-purple-500/20'}`}>
                <div className={`text-[10px] font-bold uppercase tracking-wider mb-2 ${i === 0 ? 'text-blue-700 dark:text-blue-400' : 'text-purple-700 dark:text-purple-400'}`}>
                  Group {i === 0 ? 'A' : 'B'} — {g.docs.length} doc{g.docs.length > 1 ? 's' : ''}
                </div>
                <div className="text-lg font-bold mb-3 text-slate-900 dark:text-white">"{g.value}"</div>
                <div className="flex flex-wrap gap-1.5">
                  {g.docs.map((d: any, j: number) => <span key={j} className="text-xs px-2 py-1 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300">{d.docTitle}</span>)}
                </div>
              </div>
            ))}
          </div>
        )}

        {result.status === 'incomplete_date_conflict' && (
          <div className="space-y-4">
            <div>
              <div className="text-xs text-slate-500 dark:text-slate-400 mb-1">Complete date documents</div>
              <div className="flex flex-wrap gap-2">
                {result.completeEntries.map((d: any, i: number) => <DocChip key={i} title={`${d.docTitle}: "${d.value}"`} type="good" icon="📅" />)}
              </div>
            </div>
            <div>
              <div className="text-xs text-rose-700 dark:text-red-400 mb-1 font-medium">Year-only documents (Declared DOB)</div>
              <div className="flex flex-wrap gap-2">
                {result.incompleteEntries.map((d: any, i: number) => <DocChip key={i} title={`${d.docTitle}: "${d.value}"`} type="danger" icon="📅" />)}
              </div>
            </div>
          </div>
        )}

        {result.status === 'extraction_invalid' && (
          <div className="p-4 rounded-xl border bg-amber-50/60 border-amber-200 dark:bg-amber-500/10 dark:border-amber-500/20">
            <div className="flex items-center gap-2 text-amber-800 dark:text-amber-300 font-semibold mb-2">
              <span aria-hidden="true">⚠️</span>
              <span>Extraction issue — please re-upload a clearer photo</span>
            </div>
            <p className="text-xs text-amber-700 dark:text-amber-400/90 mb-3">
              The extracted identifier failed checksum or format validation (likely distorted or incomplete OCR).
            </p>
            {result.outliers && result.outliers.length > 0 && (
              <div>
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Affected Document(s)</div>
                <div className="flex flex-wrap gap-2">
                  {result.outliers.map((o: any, i: number) => (
                    <DocChip key={i} title={`${o.docTitle}: "${o.value}"`} type="warn" icon="⚠" />
                  ))}
                </div>
              </div>
            )}
            {result.supportingDocs && result.supportingDocs.length > 0 && (
              <div className="mt-3">
                <div className="text-[11px] font-medium text-slate-500 dark:text-slate-400 mb-1">Valid Document(s)</div>
                <div className="flex flex-wrap gap-2">
                  {result.supportingDocs.map((d: any, i: number) => (
                    <DocChip key={i} title={`${d.docTitle}: "${d.value}"`} type="good" />
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="bg-slate-50 dark:bg-slate-900/60 rounded-lg p-4 border border-slate-200 dark:border-slate-800">
        <div className="text-xs font-bold text-slate-500 dark:text-slate-400 mb-2 uppercase tracking-wide">Why this result?</div>
        <p className="text-sm text-slate-700 dark:text-slate-300 leading-relaxed">{result.explanation}</p>
      </div>
    </div>
  );
}

function DocChip({ title, type, icon = '✓' }: { title: string, type: 'good'|'warn'|'danger', icon?: string }) {
  const styles = {
    good: 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-green-500/10 dark:text-green-400 dark:border-green-500/20',
    warn: 'bg-amber-50 text-amber-700 border-amber-200 dark:bg-saffron-500/10 dark:text-saffron-400 dark:border-saffron-500/20',
    danger: 'bg-rose-50 text-rose-700 border-rose-200 dark:bg-red-500/10 dark:text-red-400 dark:border-red-500/20'
  };
  const semanticLabel = type === 'good' ? 'Agreement: ' : type === 'warn' ? 'Needs review: ' : 'Conflict: ';
  return (
    <div className={`px-3 py-1.5 rounded-full text-xs font-medium border ${styles[type]} flex items-center gap-1.5`}>
      <span className="sr-only">{semanticLabel}</span>
      <span aria-hidden="true">{icon}</span> {title}
    </div>
  );
}
