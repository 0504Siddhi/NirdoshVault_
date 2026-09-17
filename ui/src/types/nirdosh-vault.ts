export const DOCUMENT_TYPES = [
  'aadhaar', 'pan', 'birth_certificate', 'school_leaving_certificate', 'marksheet',
] as const;
export type DocumentType = typeof DOCUMENT_TYPES[number];

export type FieldStatus =
  | 'consistent' | 'possible_variant' | 'mismatch' | 'outlier_detected'
  | 'conflicting_evidence' | 'not_comparable' | 'missing' | 'extraction_uncertain'
  | 'extraction_invalid';
export type ConfidenceLabel = 'high' | 'medium' | 'review' | 'no_consensus';
export type GuideStatus = 'guide_available' | 'authority_dependent' | 'requires_user_input' | 'no_consensus' | 'unsupported_rule';
export type RuleStatus = 'verified' | 'derived' | 'authority-dependent' | 'unverified';

export interface ExtractedField {
  raw_value: string | null;
  normalized_value: string | null;
  confidence_label: 'high' | 'medium' | 'low' | 'unknown';
  valid_for_comparison: boolean;
  reason_invalid?: string | null;
}

export interface EvidenceValue {
  documentId: string;
  documentType: DocumentType | 'unknown';
  rawValue: string;
  normalizedValue: string;
}

export interface OfficialSource {
  authority: string;
  title: string;
  url: string;
  publication_date?: string | null;
  exact_support: string;
}

export interface CorrectionRule {
  rule_id: string;
  document_type: DocumentType;
  field_key: string; // Updated from 'field' to match correction-rules.json
  scenario: string;
  priority: number;
  trigger_source: 'automatic' | 'user_reported' | 'authority_rejection' | 'manual_selection';
  requires_user_input: boolean;
  title: string;
  citizen_message: string;
  recommended_steps: string[];
  supporting_document_categories: string[];
  authority: string;
  channel: string[];
  jurisdiction: string;
  rule_status: RuleStatus;
  human_review_required: boolean;
  official_sources: OfficialSource[];
  source_checked_date: string;
  expires_for_review_on?: string | null;
  disclaimer: string;
}

export interface ConsensusSummary {
  totalDocuments: number;
  comparableFieldsCount: number;
  consensusFieldsCount: number;
  conflictFieldsCount: number;
}

export interface DocumentSpecificField {
  fieldName: string;
  docId: string;
  docType: string;
  value: string;
}

export interface IFieldResult {
  fieldKey: string;
  label: string;
  status: FieldStatus;
  confidence: ConfidenceLabel;
  confidenceLabel: string;
  consensusValue?: string;
  scenario?: string;
  supportingDocs?: { docId: string; docTitle: string; value: string; docType?: string }[];
  outliers?: { docId: string; docTitle: string; value: string; docType?: string }[];
  likelyOutlierDocumentIds?: string[];
  evidence?: unknown[];
  groups?: { value: string; docs: { docId: string; docTitle: string; docType?: string }[] }[];
  completeEntries?: { docId: string; docTitle: string; value: string }[];
  incompleteEntries?: { docId: string; docTitle: string; value: string }[];
  explanation: string;
  needsManualVerification: boolean;
}