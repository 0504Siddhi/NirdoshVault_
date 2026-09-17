/**
 * SchemeFinder.tsx
 * ---------------------------------------------------------------------------
 * Scheme Discovery & Readiness module for Nirdosh Vault.
 *
 * Architecture:
 *   1. Profile Match      — is this citizen's declared profile in scope for a
 *                            scheme's *prototype* screening rules?
 *   2. Document Readiness — of the documents this scheme's *prototype* rules
 *                            currently indicate, which are available?
 *   3. Identity Evidence   — for available documents, does the Consensus
 *                            Engine report a conflict? Tracked separately —
 *                            never blended into the readiness percentage.
 *
 * These three signals are computed independently and rendered independently.
 * Nirdosh Vault never determines final eligibility; every scheme links to its
 * verified official government source for the citizen to confirm.
 *
 * WIRING NOTES FOR INTEGRATION
 * ---------------------------------------------------------------------------
 * - Replace `MOCK_DOCUMENTS` with the real `VaultDocument[]` from your
 *   document store / Consensus Engine. The shape is defined below
 *   (`VaultDocument`) — your mapper should turn a consensus verdict into
 *   { available, evidence, note } (see comment above `VaultDocument`).
 * - `SCHEMES` should eventually be sourced data (CMS/DB), not a hardcoded
 *   array — see the `Scheme` / `SchemeSource` types, which already carry the
 *   provenance fields (source url, jurisdiction, lastReviewed) needed for
 *   that migration. Swapping the data source does not require touching this
 *   component.
 * - `onReviewConflict` should route to your existing Correction Guidance /
 *   Conflict view — this component intentionally never renders raw
 *   conflicting field values (data minimization).
 * - All eligibility functions are explicitly commented as SIMPLIFIED
 *   PROTOTYPE RULES. Do not treat them as a source of truth for actual
 *   government eligibility criteria.
 */

import { useMemo, useState, useCallback } from 'react';

// ============================================================================
// TYPES
// ============================================================================

export type Gender = 'female' | 'male' | 'other' | '';
export type Category = 'general' | 'obc' | 'sc' | 'st' | '';
export type Occupation = 'farmer' | 'student' | 'business' | 'unemployed' | 'other' | '';
export type SchemeCategory = 'farmer' | 'student' | 'women' | 'senior' | 'general';

export interface CitizenProfile {
  filled: boolean;
  age: number | null;
  gender: Gender;
  income: number | null;
  category: Category;
  occupation: Occupation;
}

export const EMPTY_PROFILE: CitizenProfile = {
  filled: false,
  age: null,
  gender: '',
  income: null,
  category: '',
  occupation: '',
};

/**
 * A document as reported by your Consensus Engine.
 *   - available: whether the citizen has uploaded/linked this document at all.
 *   - evidence:  field-level identity-consistency verdict, evaluated only when
 *                available === true. This is intentionally NOT a whole-document
 *                "consistent: boolean" — Nirdosh compares fields, not documents.
 *   - note:      a short, non-sensitive description of *what kind* of conflict
 *                was found (e.g. "Name field differs from Aadhaar"). NEVER put
 *                raw field values here — this string may render directly in the
 *                UI. Detailed evidence belongs in the Report/Conflict view.
 *
 * Suggested mapping from your consensus verdict enum:
 *   consensus_established   -> { available: true,  evidence: 'no_relevant_conflict' }
 *   conflicting_evidence    -> { available: true,  evidence: 'conflict_detected', note: '...' }
 *   insufficient_evidence   -> { available: true,  evidence: 'insufficient_evidence' }
 *   (not uploaded)          -> { available: false, evidence: 'not_applicable' }
 */
export type EvidenceStatus =
  | 'no_relevant_conflict'
  | 'conflict_detected'
  | 'insufficient_evidence'
  | 'not_applicable';

export interface VaultDocument {
  key: string;
  label: string;
  available: boolean;
  evidence: EvidenceStatus;
  note?: string;
}

export type DocTier = 'required' | 'conditional' | 'optional';

export interface DocRequirement {
  key: string;
  tier: DocTier;
  /**
   * Only meaningful when tier === 'conditional'.
   * If provided and returns true for the current profile, this document is
   * treated as REQUIRED for readiness-percentage purposes (e.g. a caste
   * certificate is conditionally required only for SC/ST/OBC applicants).
   * If omitted, the conditional document is shown for awareness but never
   * affects the readiness percentage.
   */
  appliesWhen?: (profile: CitizenProfile) => boolean;
  /** Optional human-readable reason shown next to the doc when active. */
  appliesReason?: string;
}

export type ProfileMatchResult = 'match' | 'no_match' | 'incomplete';

export interface EligibilityRule {
  /**
   * SIMPLIFIED PROTOTYPE SCREENING RULE.
   * This is a preliminary relevance filter only, not the official
   * eligibility determination for the scheme. Real rules are more detailed
   * and may depend on residency, disability status, family composition,
   * land ownership specifics, etc. — none of which this prototype captures.
   */
  evaluate: (profile: CitizenProfile) => 'match' | 'no_match';
}

export interface SchemeSource {
  /** Implementing department / ministry, for attribution on the CTA button. */
  department: string;
  /** Verified official portal URL. */
  url: string;
  jurisdiction: 'central' | 'state';
  state?: string;
  /** ISO date this scheme's data (rules + doc list + link) was last checked against the source. */
  lastReviewed: string;
}

export interface Scheme {
  id: string;
  name: string;
  category: SchemeCategory;
  description: string;
  benefit: string;
  documents: DocRequirement[];
  eligibility: EligibilityRule;
  source: SchemeSource;
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

export function clampAge(v: number): number {
  if (Number.isNaN(v)) return NaN;
  return Math.min(120, Math.max(0, v));
}

export function clampIncome(v: number): number {
  if (Number.isNaN(v)) return NaN;
  return Math.max(0, v);
}

export function isValidAge(v: number | null): v is number {
  return v !== null && !Number.isNaN(v) && v >= 0 && v <= 120;
}

export function isValidIncome(v: number | null): v is number {
  return v !== null && !Number.isNaN(v) && v >= 0;
}

export function isProfileComplete(p: CitizenProfile): boolean {
  return (
    isValidAge(p.age) &&
    isValidIncome(p.income) &&
    p.gender !== '' &&
    p.category !== '' &&
    p.occupation !== ''
  );
}

// ============================================================================
// MOCK VAULT DATA — replace with real data from your document store.
// ============================================================================

export const MOCK_DOCUMENTS: VaultDocument[] = [
  { key: 'aadhaar', label: 'Aadhaar Card', available: true, evidence: 'no_relevant_conflict' },
  { key: 'pan', label: 'PAN Card', available: true, evidence: 'no_relevant_conflict' },
  { key: 'income_certificate', label: 'Income Certificate', available: false, evidence: 'not_applicable' },
  { key: 'land_record', label: 'Land Record', available: false, evidence: 'not_applicable' },
  { key: 'caste_certificate', label: 'Caste Certificate', available: false, evidence: 'not_applicable' },
  {
    key: 'bank_passbook',
    label: 'Bank Passbook',
    available: true,
    evidence: 'conflict_detected',
    note: 'Name field differs from Aadhaar',
  },
  { key: 'ration_card', label: 'Ration Card / SECC proof', available: false, evidence: 'not_applicable' },
  { key: 'age_proof', label: 'Age Proof', available: true, evidence: 'no_relevant_conflict' },
];

// ============================================================================
// SCHEME DATA — verified official links as of Aug 2026.
// MahaDBT (mahadbt.maharashtra.gov.in) does not expose stable per-scheme deep
// links (its scheme pages use per-session encrypted hash URLs), so schemes
// applied for through MahaDBT link to the portal's root / login, not a
// fabricated deep link. Every source below should be re-checked periodically
// — see `lastReviewed` — since government portals do change.
// ============================================================================

export const SCHEMES: Scheme[] = [
  {
    id: 'pmjay',
    category: 'general',
    name: 'Ayushman Bharat (PM-JAY)',
    description:
      'Health cover up to ₹5 lakh per family per year for hospitalisation, for families identified under SECC 2011.',
    benefit: 'Up to ₹5,00,000 cover',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'ration_card', tier: 'required' },
    ],
    eligibility: {
      // Prototype: PM-JAY targets SECC-2011-identified families; we cannot
      // verify SECC status from this profile, so we don't screen it out.
      evaluate: () => 'match',
    },
    source: {
      department: 'National Health Authority',
      url: 'https://pmjay.gov.in',
      jurisdiction: 'central',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'pmkisan',
    category: 'farmer',
    name: 'PM-Kisan Samman Nidhi',
    description: 'Financial support of ₹6,000/year for landholding farmer families.',
    benefit: '₹6,000 / year',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'land_record', tier: 'required' },
      { key: 'bank_passbook', tier: 'required' },
    ],
    eligibility: {
      evaluate: (p) => (p.occupation === 'farmer' ? 'match' : 'no_match'),
    },
    source: {
      department: 'Dept. of Agriculture & Farmers Welfare',
      url: 'https://pmkisan.gov.in',
      jurisdiction: 'central',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'pmfby',
    category: 'farmer',
    name: 'PM Fasal Bima Yojana',
    description: 'Crop insurance covering yield loss from natural causes.',
    benefit: 'Insured payout on crop loss',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'land_record', tier: 'required' },
      { key: 'bank_passbook', tier: 'required' },
    ],
    eligibility: {
      evaluate: (p) => (p.occupation === 'farmer' ? 'match' : 'no_match'),
    },
    source: {
      department: 'Dept. of Agriculture & Farmers Welfare',
      url: 'https://pmfby.gov.in',
      jurisdiction: 'central',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'scholarship',
    category: 'student',
    name: 'Post-Matric Scholarship (MahaDBT)',
    description:
      'Tuition and maintenance support for SC/ST/OBC/SBC/NT students in Maharashtra, paid via DBT.',
    benefit: 'Fee reimbursement, varies by category',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'income_certificate', tier: 'required' },
      { key: 'bank_passbook', tier: 'required' },
      {
        key: 'caste_certificate',
        tier: 'conditional',
        appliesWhen: (p) => ['sc', 'obc', 'st'].includes(p.category),
        appliesReason: 'Required for SC / OBC / ST applicants',
      },
    ],
    eligibility: {
      evaluate: (p) => {
        if (p.occupation !== 'student') return 'no_match';
        if (!['sc', 'obc', 'st'].includes(p.category)) return 'no_match';
        if (p.income !== null && p.income > 250000) return 'no_match';
        return 'match';
      },
    },
    source: {
      department: 'MahaDBT, Govt. of Maharashtra',
      url: 'https://mahadbt.maharashtra.gov.in',
      jurisdiction: 'state',
      state: 'Maharashtra',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'ladki_bahin',
    category: 'women',
    name: 'Mukhyamantri Majhi Ladki Bahin Yojana',
    description:
      'Monthly cash assistance for women aged 21–65 in Maharashtra with family income below ₹2.5 lakh/year.',
    benefit: '₹1,500 / month DBT',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'bank_passbook', tier: 'required' },
      { key: 'income_certificate', tier: 'required' },
    ],
    eligibility: {
      evaluate: (p) => {
        if (p.gender !== 'female') return 'no_match';
        if (p.age === null || p.age < 21 || p.age > 65) return 'no_match';
        if (p.income !== null && p.income > 250000) return 'no_match';
        return 'match';
      },
    },
    source: {
      department: 'Women & Child Development Dept., Maharashtra',
      url: 'https://ladakibahin.maharashtra.gov.in',
      jurisdiction: 'state',
      state: 'Maharashtra',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'sanjay_gandhi',
    category: 'senior',
    name: 'Sanjay Gandhi Niradhar Anudan Yojana',
    description:
      'Monthly pension for destitute, elderly, disabled and widowed persons aged 18–65, family income up to ₹21,000/year.',
    benefit: '₹1,500 / month DBT',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'income_certificate', tier: 'required' },
      { key: 'age_proof', tier: 'required' },
    ],
    eligibility: {
      evaluate: (p) => {
        if (p.age === null || p.age < 18 || p.age >= 65) return 'no_match';
        if (p.income !== null && p.income > 21000) return 'no_match';
        return 'match';
      },
    },
    source: {
      department: 'Social Justice & Special Assistance Dept., Maharashtra',
      url: 'https://sas.mahait.org',
      jurisdiction: 'state',
      state: 'Maharashtra',
      lastReviewed: '2026-08-09',
    },
  },
  {
    id: 'standup_india',
    category: 'general',
    name: 'Stand-Up India',
    description: 'Bank loans between ₹10 lakh and ₹1 crore for SC/ST and women entrepreneurs.',
    benefit: '₹10 lakh – ₹1 crore loan',
    documents: [
      { key: 'aadhaar', tier: 'required' },
      { key: 'pan', tier: 'required' },
      {
        key: 'caste_certificate',
        tier: 'conditional',
        appliesWhen: (p) => ['sc', 'st'].includes(p.category),
        appliesReason: 'Required for SC / ST applicants',
      },
    ],
    eligibility: {
      evaluate: (p) => {
        if (p.category === 'general' && p.gender !== 'female') return 'no_match';
        return 'match';
      },
    },
    source: {
      department: 'Dept. of Financial Services, GOI',
      url: 'https://www.standupmitra.in',
      jurisdiction: 'central',
      lastReviewed: '2026-08-09',
    },
  },
];

// ============================================================================
// STATUS ENGINE — the three independent signals described at the top.
// ============================================================================

export interface ResolvedDoc {
  key: string;
  label: string;
  tier: DocTier;
  /** True when a 'conditional' doc's appliesWhen() matched this profile. */
  active: boolean;
  appliesReason?: string;
  doc: VaultDocument;
}

export interface SchemeInfo {
  profileStatus: ProfileMatchResult;
  whyMatch: string[];
  requiredResolved: ResolvedDoc[];
  conditionalResolved: ResolvedDoc[];
  optionalResolved: ResolvedDoc[];
  missingRequired: ResolvedDoc[];
  availableRequiredCount: number;
  totalRequiredCount: number;
  /** 0-100, computed from REQUIRED-doc AVAILABILITY ONLY (never from conflicts). */
  readiness: number;
  /** Conflicts among available required + active-conditional docs — a separate signal. */
  identityIssues: ResolvedDoc[];
  nextSteps: string[];
}

function findDoc(documents: VaultDocument[], key: string): VaultDocument {
  return (
    documents.find((d) => d.key === key) ?? {
      key,
      label: key,
      available: false,
      evidence: 'not_applicable',
    }
  );
}

/** "Why this appeared" — short, non-sensitive bullets. No raw field values. */
function whyMatchBullets(scheme: Scheme, p: CitizenProfile): string[] {
  if (!p.filled) return [];
  switch (scheme.id) {
    case 'pmkisan':
    case 'pmfby':
      return ['Farmer / landholder declared'];
    case 'scholarship':
      return ['Student declared', 'Category within scheme scope', 'Income within scheme limit'];
    case 'ladki_bahin':
      return ['Gender and age within scheme range', 'Income within scheme limit'];
    case 'sanjay_gandhi':
      return ['Age within scheme range', 'Income within scheme limit'];
    case 'standup_india':
      return ['Category or gender within scheme scope'];
    case 'pmjay':
    default:
      return ['Open to all declared households under SECC 2011'];
  }
}

export function getSchemeInfo(scheme: Scheme, profile: CitizenProfile, documents: VaultDocument[]): SchemeInfo {
  const rawResult = profile.filled ? scheme.eligibility.evaluate(profile) : null;
  const profileStatus: ProfileMatchResult = !profile.filled ? 'incomplete' : rawResult === 'match' ? 'match' : 'no_match';

  const resolve = (req: DocRequirement): ResolvedDoc => {
    const doc = findDoc(documents, req.key);
    const active = req.tier !== 'conditional' ? true : !!req.appliesWhen?.(profile);
    return { key: req.key, label: doc.label, tier: req.tier, active, appliesReason: req.appliesReason, doc };
  };

  const resolved = scheme.documents.map(resolve);

  // Conditional docs whose condition is met count toward REQUIRED readiness.
  const effectiveRequired = resolved.filter((d) => d.tier === 'required' || (d.tier === 'conditional' && d.active));
  const conditionalResolved = resolved.filter((d) => d.tier === 'conditional');
  const optionalResolved = resolved.filter((d) => d.tier === 'optional');
  const requiredResolved = resolved.filter((d) => d.tier === 'required');

  const availableRequired = effectiveRequired.filter((d) => d.doc.available);
  const missingRequired = effectiveRequired.filter((d) => !d.doc.available);
  const totalRequiredCount = effectiveRequired.length;
  const readiness = totalRequiredCount === 0 ? 100 : Math.round((availableRequired.length / totalRequiredCount) * 100);

  const identityIssues = effectiveRequired.filter((d) => d.doc.available && d.doc.evidence === 'conflict_detected');

  const nextSteps: string[] = [];
  if (missingRequired.length) nextSteps.push(`Add ${missingRequired[0].label}`);
  if (identityIssues.length) nextSteps.push('Review conflict →');

  return {
    profileStatus,
    whyMatch: whyMatchBullets(scheme, profile),
    requiredResolved,
    conditionalResolved,
    optionalResolved,
    missingRequired,
    availableRequiredCount: availableRequired.length,
    totalRequiredCount,
    readiness,
    identityIssues,
    nextSteps,
  };
}

// ============================================================================
// PRESENTATION HELPERS
// ============================================================================

const TONE: Record<ProfileMatchResult, { spine: string; stamp: string; dot: string; label: string }> = {
  match: {
    spine: 'bg-emerald-500',
    stamp: 'border-emerald-500 text-emerald-600 dark:text-emerald-400',
    dot: '🟢',
    label: 'Potential Match',
  },
  incomplete: {
    spine: 'bg-amber-400',
    stamp: 'border-amber-400 text-amber-600 dark:text-amber-400',
    dot: '🟠',
    label: 'More Information Needed',
  },
  no_match: {
    spine: 'bg-slate-300',
    stamp: 'border-slate-300 text-slate-400 dark:text-slate-500',
    dot: '⚪',
    label: 'May Not Match',
  },
};

const CATEGORY_ICON: Record<SchemeCategory, string> = {
  farmer: '🌱',
  student: '🎓',
  women: '👤',
  senior: '🤝',
  general: '🏛️',
};

function evidenceBadge(doc: VaultDocument, tier: DocTier): { text: string; cls: string } {
  if (doc.available && doc.evidence === 'no_relevant_conflict') {
    return { text: 'Available · no relevant issue detected', cls: 'border-emerald-300 text-emerald-600 dark:border-emerald-500/40 dark:text-emerald-400' };
  }
  if (doc.available && doc.evidence === 'conflict_detected') {
    return { text: 'Available · identity issue detected', cls: 'border-rose-300 text-rose-500 dark:border-rose-500/40 dark:text-rose-400' };
  }
  if (doc.available && doc.evidence === 'insufficient_evidence') {
    return { text: 'Available · more evidence needed', cls: 'border-amber-300 text-amber-600 dark:border-amber-500/40 dark:text-amber-400' };
  }
  if (doc.available) {
    return { text: 'Available', cls: 'border-slate-300 text-slate-600 dark:border-slate-600 dark:text-slate-400' };
  }
  const missingText = tier === 'required' ? 'Not verified yet' : 'Not provided';
  return { text: missingText, cls: 'border-slate-300 text-slate-400 dark:border-slate-600 dark:text-slate-500' };
}

// ============================================================================
// SUBCOMPONENTS
// ============================================================================

function DocPill({ rd }: { rd: ResolvedDoc }) {
  const badge = evidenceBadge(rd.doc, rd.tier);
  const dashed = rd.tier !== 'required';
  const semanticLabel = badge.text.includes('No conflict') 
    ? 'Agreement: ' 
    : badge.text.includes('Conflict') 
    ? 'Conflict: ' 
    : 'Needs review: ';
  return (
    <div
      className={`flex items-center justify-between gap-2 rounded-lg border px-2.5 py-1.5 text-[11px] ${dashed ? 'border-dashed' : ''} ${badge.cls}`}
    >
      <span className="text-slate-600 dark:text-slate-300">
        {rd.label}
        {rd.tier === 'conditional' && rd.appliesReason && (
          <span className="ml-1 text-slate-400 dark:text-slate-500">({rd.appliesReason})</span>
        )}
      </span>
      <span className={`font-mono font-semibold ${badge.cls}`}>
        <span className="sr-only">{semanticLabel}</span>
        {badge.text}
      </span>
    </div>
  );
}

function ReadinessRing({ pct }: { pct: number }) {
  const color = pct === 100 ? '#10b981' : pct >= 50 ? '#f59e0b' : '#fb7185';
  const r = 15.5;
  const circumference = 2 * Math.PI * r;
  const offset = circumference - (pct / 100) * circumference;
  return (
    <div className="relative flex h-10 w-10 items-center justify-center">
      <svg width="40" height="40" viewBox="0 0 40 40" className="-rotate-90">
        <circle cx="20" cy="20" r={r} fill="none" stroke="currentColor" className="text-slate-100 dark:text-slate-800" strokeWidth="4" />
        <circle
          cx="20"
          cy="20"
          r={r}
          fill="none"
          stroke={color}
          strokeWidth="4"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
        />
      </svg>
      <span className="absolute font-mono text-[10px] font-bold text-slate-700 dark:text-slate-200">{pct}%</span>
    </div>
  );
}

function SchemeCard({
  scheme,
  info,
  onReviewConflict,
}: {
  scheme: Scheme;
  info: SchemeInfo;
  onReviewConflict: (schemeId: string, docKeys: string[]) => void;
}) {
  const tone = TONE[info.profileStatus];
  const readinessColorCls =
    info.readiness === 100
      ? 'text-emerald-600 dark:text-emerald-400'
      : info.readiness >= 50
      ? 'text-amber-600 dark:text-amber-400'
      : 'text-rose-500 dark:text-rose-400';

  return (
    <div className="relative overflow-hidden rounded-2xl border border-slate-200 bg-white pl-4 shadow-sm dark:border-slate-800 dark:bg-slate-900">
      <span className={`absolute left-0 top-0 h-full w-1.5 ${tone.spine}`} />
      <div
        className={`absolute right-4 top-4 flex items-center gap-1 rounded border-2 border-dashed px-2 py-0.5 font-mono text-[9px] font-bold uppercase tracking-wider ${tone.stamp}`}
        style={{ transform: 'rotate(-4deg)' }}
      >
        <span className="sr-only">Eligibility screening result: </span>
        <span>{tone.dot}</span>
        {tone.label}
      </div>
      <div className="absolute right-4 top-14">
        <ReadinessRing pct={info.readiness} />
      </div>

      <div className="p-4 pr-28 sm:pr-32">
        <div className="mb-1 flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-wide text-slate-400 dark:text-slate-500">
          <span>{CATEGORY_ICON[scheme.category]}</span>
          {scheme.category}
        </div>
        <h3 className="text-base font-bold text-slate-900 dark:text-white">{scheme.name}</h3>
        <p className="mt-1 text-[13px] leading-relaxed text-slate-500 dark:text-slate-400">{scheme.description}</p>
        <p className="mt-2 font-mono text-xs font-semibold text-saffron-600 dark:text-saffron-400">{scheme.benefit}</p>
      </div>

      <div className="border-t border-slate-100 px-4 py-3 pr-6 dark:border-slate-800">
        {info.profileStatus === 'no_match' && (
          <div className="flex items-start gap-1.5 rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-500 dark:bg-slate-800/60 dark:text-slate-400">
            <span>ℹ️</span>
            <span>
              Based on your profile, this scheme's conditions don't appear to match. Rules vary — you can still
              verify directly on the official portal.
            </span>
          </div>
        )}
        {info.profileStatus === 'incomplete' && (
          <div className="flex items-start gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:bg-amber-500/10 dark:text-amber-400">
            <span>❓</span>
            <span>Complete your Profile Check above so we can tell whether this scheme's conditions could apply to you.</span>
          </div>
        )}

        {info.profileStatus === 'match' && info.whyMatch.length > 0 && (
          <div className="mb-3">
            <div className="mb-1 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              Why this appeared
            </div>
            <ul className="space-y-0.5">
              {info.whyMatch.map((b) => (
                <li key={b} className="flex items-start gap-1.5 text-[12px] text-slate-600 dark:text-slate-300">
                  <span className="mt-0.5 text-emerald-500">✓</span>
                  {b}
                </li>
              ))}
            </ul>
          </div>
        )}

        <div>
          <div className="mb-1.5 flex items-center justify-between">
            <span className="font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
              DOCUMENT READINESS — {info.availableRequiredCount} of {info.totalRequiredCount} required available
            </span>
            <span className={`font-mono text-[11px] font-bold ${readinessColorCls}`}>{info.readiness}% Document Readiness</span>
          </div>
          <div className="flex flex-col gap-1.5">
            {info.requiredResolved.map((rd) => (
              <DocPill key={rd.key} rd={rd} />
            ))}
          </div>
          {info.conditionalResolved.length > 0 && (
            <>
              <div className="mb-1 mt-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Required if applicable
              </div>
              <div className="flex flex-col gap-1.5">
                {info.conditionalResolved.map((rd) => (
                  <DocPill key={rd.key} rd={rd} />
                ))}
              </div>
            </>
          )}
          {info.optionalResolved.length > 0 && (
            <>
              <div className="mb-1 mt-2 font-mono text-[10px] font-semibold uppercase tracking-wide text-slate-400 dark:text-slate-500">
                Optional / supporting
              </div>
              <div className="flex flex-col gap-1.5">
                {info.optionalResolved.map((rd) => (
                  <DocPill key={rd.key} rd={rd} />
                ))}
              </div>
            </>
          )}
        </div>

        {info.identityIssues.length > 0 && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-rose-50 px-3 py-2 text-xs text-rose-600 dark:bg-rose-500/10 dark:text-rose-400">
            <span>⚠</span>
            <span>
              An identity inconsistency was detected across your documents and should be reviewed before submission.{' '}
              <button
                type="button"
                className="font-semibold underline underline-offset-2"
                onClick={() => onReviewConflict(scheme.id, info.identityIssues.map((d) => d.key))}
              >
                Review securely →
              </button>
            </span>
          </div>
        )}

        {info.profileStatus === 'match' && info.nextSteps.length > 0 && (
          <div className="mt-2 text-[12px] font-semibold text-slate-700 dark:text-slate-200">
            Next step: {info.nextSteps[0]}
          </div>
        )}
        {info.profileStatus === 'match' && info.readiness === 100 && info.identityIssues.length === 0 && (
          <div className="mt-2 flex items-start gap-1.5 rounded-lg bg-emerald-50 px-3 py-2 text-xs text-emerald-700 dark:bg-emerald-500/10 dark:text-emerald-400">
            <span>✅</span>
            <span>All required documents are available with no relevant conflicts detected. Ready to verify.</span>
          </div>
        )}

        <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3 dark:border-slate-800">
          <div className="text-[10px] text-slate-400 dark:text-slate-500">
            Scheme information source: <span className="font-medium text-slate-600 dark:text-slate-400">{scheme.source.department}</span>
            {scheme.source.lastReviewed && (
              <span> · Information reviewed: {scheme.source.lastReviewed}</span>
            )}
          </div>
          
            <a
            href={scheme.source.url}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={`Verify ${scheme.name} on Official Portal (opens in new tab)`}
            className="inline-flex items-center gap-1.5 rounded-lg bg-saffron-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-saffron-600"
          >
            <span>↗</span>
            Verify on Official Portal
          </a>
        </div>
      </div>
    </div>
  );
}

// ============================================================================
// MAIN COMPONENT
// ============================================================================

export interface SchemeFinderProps {
  /** Real vault documents from your Consensus Engine. Defaults to mock data for local dev. */
  documents?: VaultDocument[];
  /** Scheme catalogue. Defaults to the bundled seed list; swap for sourced data when available. */
  schemes?: Scheme[];
  /** Called when the citizen wants to review an identity conflict — route to your Conflict view. */
  onReviewConflict?: (schemeId: string, docKeys: string[]) => void;
  /** Optional i18n hook, e.g. from react-i18next. Falls back to identity. */
  t?: (key: string, fallback: string) => string;
}

export default function SchemeFinder({
  documents = MOCK_DOCUMENTS,
  schemes = SCHEMES,
  onReviewConflict = () => {},
  t = (_key: string, fallback: string) => fallback,
}: SchemeFinderProps) {
  const [profile, setProfile] = useState<CitizenProfile>(EMPTY_PROFILE);
  const [draft, setDraft] = useState({ age: '', gender: '' as Gender, income: '', category: '' as Category, occupation: '' as Occupation });
  const [activeCategory, setActiveCategory] = useState<'all' | SchemeCategory>('all');
  const [activeStatus, setActiveStatus] = useState<'all' | ProfileMatchResult>('all');
  const [search, setSearch] = useState('');

  const handleAgeChange = useCallback((raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      setDraft((d) => ({ ...d, age: raw }));
      return;
    }
    setDraft((d) => ({ ...d, age: String(clampAge(n)) }));
  }, []);

  const handleIncomeChange = useCallback((raw: string) => {
    const n = parseInt(raw, 10);
    if (Number.isNaN(n)) {
      setDraft((d) => ({ ...d, income: raw }));
      return;
    }
    setDraft((d) => ({ ...d, income: String(clampIncome(n)) }));
  }, []);

  const saveProfile = useCallback(() => {
    const age = clampAge(parseInt(draft.age, 10));
    const income = clampIncome(parseInt(draft.income, 10));
    const candidate: CitizenProfile = {
      filled: false,
      age: Number.isNaN(age) ? null : age,
      income: Number.isNaN(income) ? null : income,
      gender: draft.gender,
      category: draft.category,
      occupation: draft.occupation,
    };
    candidate.filled = isProfileComplete(candidate);
    setProfile(candidate);
  }, [draft]);

  const results = useMemo(() => {
    return schemes
      .filter((s) => activeCategory === 'all' || s.category === activeCategory)
      .filter((s) => !search.trim() || s.name.toLowerCase().includes(search.trim().toLowerCase()))
      .map((s) => ({ scheme: s, info: getSchemeInfo(s, profile, documents) }));
  }, [schemes, activeCategory, search, profile, documents]);

  const counts = useMemo(() => {
    const c = { all: 0, match: 0, incomplete: 0, no_match: 0 };
    results.forEach((r) => {
      c.all += 1;
      c[r.info.profileStatus] += 1;
    });
    return c;
  }, [results]);

  const visible = useMemo(
    () => (activeStatus === 'all' ? results : results.filter((r) => r.info.profileStatus === activeStatus)),
    [results, activeStatus]
  );

  const summary = useMemo(() => {
    const matchCount = results.filter((r) => r.info.profileStatus === 'match').length;
    const needDocs = results.filter((r) => r.info.profileStatus === 'match' && r.info.readiness < 100).length;
    const docsAvailable = documents.filter((d) => d.available).length;
    const identityIssues = documents.filter((d) => d.available && d.evidence === 'conflict_detected').length;
    return { matchCount, needDocs, docsAvailable, identityIssues };
  }, [results, documents]);

  return (
    <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
      {/* HEADER */}
      <div className="mb-6 flex flex-col gap-2">
        <div className="inline-flex w-fit items-center gap-1.5 rounded-full border border-saffron-200 bg-saffron-50 px-3 py-1 text-[10px] font-bold uppercase tracking-wider text-saffron-600 dark:border-saffron-500/20 dark:bg-saffron-500/10 dark:text-saffron-400">
          <span>✨</span>
          {t('scheme.eyebrow', 'Scheme Discovery & Readiness')}
        </div>
        <h1 className="text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl dark:text-white">
          {t('scheme.title', 'Discover potentially relevant schemes — and see if your documents are ready')}
        </h1>
        <p className="max-w-2xl text-sm leading-relaxed text-slate-500 dark:text-slate-400">
          {t(
            'scheme.subtitle',
            "Profile match and document readiness are two independent checks, shown separately below. Neither is an eligibility decision — that's always made on the official scheme portal."
          )}
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-slate-400 dark:text-slate-500">
          <span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">1 · Check your profile</span>
          <span className="rounded-full border border-slate-200 px-2.5 py-1 dark:border-slate-700">2 · Review document readiness</span>
          <span className="rounded-full border border-saffron-300 bg-saffron-50 px-2.5 py-1 font-semibold text-saffron-600 dark:border-saffron-500/30 dark:bg-saffron-500/10 dark:text-saffron-400">
            3 · Verify on official portal
          </span>
        </div>
      </div>

      {/* STEP 1: PROFILE CHECK */}
      <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="mb-3 flex items-center gap-2">
          <span className="flex h-5 w-5 items-center justify-center rounded-full bg-slate-800 text-[10px] font-bold text-white dark:bg-white dark:text-slate-900">
            1
          </span>
          <h2 className="text-sm font-bold text-slate-900 dark:text-white">Profile Check</h2>
          <span className={`font-mono text-[10px] uppercase tracking-wide ${profile.filled ? 'text-emerald-600 dark:text-emerald-400' : 'text-amber-600 dark:text-amber-400'}`}>
            {profile.filled ? '✓ Profile complete' : 'Incomplete — fill all fields and save'}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-5">
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Age</label>
            <input
              type="number"
              min={0}
              max={120}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
              placeholder="e.g. 24"
              value={draft.age}
              onChange={(e) => handleAgeChange(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Gender</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
              value={draft.gender}
              onChange={(e) => setDraft((d) => ({ ...d, gender: e.target.value as Gender }))}
            >
              <option value="">Select</option>
              <option value="female">Female</option>
              <option value="male">Male</option>
              <option value="other">Other</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">
              Annual family income (₹)
            </label>
            <input
              type="number"
              min={0}
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
              placeholder="e.g. 180000"
              value={draft.income}
              onChange={(e) => handleIncomeChange(e.target.value)}
            />
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Category</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
              value={draft.category}
              onChange={(e) => setDraft((d) => ({ ...d, category: e.target.value as Category }))}
            >
              <option value="">Select</option>
              <option value="general">General</option>
              <option value="obc">OBC / VJNT / SBC</option>
              <option value="sc">SC</option>
              <option value="st">ST</option>
            </select>
          </div>
          <div>
            <label className="mb-1 block text-[10px] font-semibold uppercase tracking-wide text-slate-400">Occupation</label>
            <select
              className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100"
              value={draft.occupation}
              onChange={(e) => setDraft((d) => ({ ...d, occupation: e.target.value as Occupation }))}
            >
              <option value="">Select</option>
              <option value="farmer">Farmer / landholder</option>
              <option value="student">Student</option>
              <option value="business">Business / self-employed</option>
              <option value="unemployed">Unemployed</option>
              <option value="other">Other</option>
            </select>
          </div>
        </div>
        <button
          type="button"
          onClick={saveProfile}
          className="mt-3 rounded-lg bg-slate-800 px-3 py-1.5 text-xs font-semibold text-white dark:bg-white dark:text-slate-900"
        >
          Save profile
        </button>
        <p className="mt-2 text-[11px] text-slate-400 dark:text-slate-500">
          Provide your profile details to check scheme relevance and compare your available documents against expected requirements.
        </p>
      </div>

      {/* STEP 2: APPLICATION PREPARATION SUMMARY */}
      <div role="status" aria-live="polite" className="mb-8 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm dark:border-slate-800 dark:bg-slate-900 sm:p-5">
        <div className="mb-3 flex items-center gap-2 font-mono text-[11px] uppercase tracking-wider text-slate-400 dark:text-slate-500">
          <span>📋</span>Your application preparation
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className="text-xl font-bold text-emerald-600 dark:text-emerald-400">{summary.matchCount}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Potential schemes</div>
          </div>
          <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className="text-xl font-bold text-slate-900 dark:text-white">{summary.docsAvailable}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Documents available</div>
          </div>
          <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className="text-xl font-bold text-amber-600 dark:text-amber-400">{summary.needDocs}</div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Matches needing documents</div>
          </div>
          <div className="rounded-xl border border-slate-100 p-3 dark:border-slate-800">
            <div className={`text-xl font-bold ${summary.identityIssues ? 'text-rose-500 dark:text-rose-400' : 'text-slate-900 dark:text-white'}`}>
              {summary.identityIssues}
            </div>
            <div className="text-[11px] text-slate-500 dark:text-slate-400">Identity issues to review</div>
          </div>
        </div>
      </div>

      {/* FILTERS */}
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <input
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[13px] outline-none dark:border-slate-700 dark:bg-white/5 dark:text-slate-100 sm:max-w-xs"
          placeholder="Search schemes..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-1.5">
          {(
            [
              ['all', `All (${counts.all})`],
              ['match', `Potential match (${counts.match})`],
              ['incomplete', `More info needed (${counts.incomplete})`],
              ['no_match', `May not match (${counts.no_match})`],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setActiveStatus(key)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                activeStatus === key
                  ? 'border-slate-800 bg-slate-800 text-white dark:border-white dark:bg-white dark:text-slate-900'
                  : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="mb-6 flex flex-wrap gap-1.5">
        {(['all', 'farmer', 'student', 'women', 'senior', 'general'] as const).map((key) => (
          <button
            key={key}
            type="button"
            onClick={() => setActiveCategory(key)}
            className={`flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium ${
              activeCategory === key
                ? 'border-saffron-500 bg-saffron-50 text-saffron-700 dark:border-saffron-500/40 dark:bg-saffron-500/10 dark:text-saffron-400'
                : 'border-slate-200 bg-white text-slate-600 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300'
            }`}
          >
            {key === 'all' ? '▦ All Categories' : `${CATEGORY_ICON[key]} ${key[0].toUpperCase()}${key.slice(1)}`}
          </button>
        ))}
      </div>

      {/* SCHEME CARDS */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        {visible.length === 0 && (
          <p className="col-span-2 py-8 text-center text-sm text-slate-400">No schemes match this filter.</p>
        )}
        {visible.map(({ scheme, info }) => (
          <SchemeCard key={scheme.id} scheme={scheme} info={info} onReviewConflict={onReviewConflict} />
        ))}
      </div>

      <div className="mt-8 text-center text-xs text-slate-400 dark:text-slate-500 space-y-1">
        <p className="flex items-center justify-center gap-1.5">
          <span>🛡️</span>
          Preliminary guidance only. Scheme relevance and document-readiness indicators do not determine official eligibility. Always verify current requirements on the responsible official portal.
        </p>
        <p className="text-[11px]">
          Scheme guidance is based on a curated dataset used for this implementation.
        </p>
      </div>
    </div>
  );
}

