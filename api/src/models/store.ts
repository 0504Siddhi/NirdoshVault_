/**
 * In-memory store — used when MONGODB_URI is not set.
 * Provides the same interface as Mongoose models so the rest of the app
 * doesn't care which backend is active.
 */
import { v4 as uuidv4 } from 'uuid';
import type { ConsensusSummary, DocumentSpecificField, FieldStatus } from '../types/nirdosh-vault';
import type { IdentityResolutionConfidenceResult } from '../scoring/scoringTypes';
import type { IdentityTrustGraphData } from '../services/identityTrustGraphService';

export interface IUser {
  _id: string;
  name: string;
  email: string;
  password: string;
  roles: ('user' | 'admin')[];
  languagePreference: string;
  createdAt: Date;
}

export interface IDocument {
  _id: string;
  userId: string;
  docType: string;
  title: string;
  status: 'uploaded' | 'processing' | 'ready' | 'failed';
  originalFilename: string;
  storedFilename: string;
  contentType: string;
  size: number;
  quality?: {
    blurScore: number;
    brightness: string;
    orientation: string;
    resolution: string;
    warnings: string[];
  };
  extractedFields?: IDocumentField[];
  needsReview: boolean;
  createdAt: Date;
}

export interface IDocumentField {
  fieldKey: string;
  label: string;
  value: string;
  normalized: string;
  type: string;
  page: number;
  confidence: number;
  evidenceText: string;
  incomplete?: boolean; // year-only DOB
  invalidReason?: string | null;
}

export interface IAnalysis {
  _id: string;
  userId: string;
  documentIds: string[];
  status: 'processing' | 'complete' | 'failed';
  fieldResults: IFieldResult[];
  summary: ConsensusSummary; // Updated to match the new engine summary structure
  documentSpecificFields?: DocumentSpecificField[]; // Added to store non-comparable metadata
  guidance: IGuidanceItem[];
  checklist: IChecklistItem[];
  healthScore?: number;
  identityResolutionConfidence?: IdentityResolutionConfidenceResult;
  identityTrustGraph?: IdentityTrustGraphData;
  createdAt: Date;
}

export interface IFieldResult {
  fieldKey: string;
  label: string;
  status: FieldStatus;
  confidence: 'high' | 'medium' | 'review' | 'no_consensus';
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
  documentsContainingField?: number;
  supportingDocumentTypes?: string[];
  contributingDocumentTypes?: string[];
  averageExtractionConfidence?: number | null;
  peerEvidenceAvailable?: boolean;
}

export interface IGuidanceItem {
  fieldKey: string;
  fieldLabel: string;
  issueStatus: string;
  explanation: string;
  rules: IGuidanceRule[];
  steps: string[];
  disclaimer: string;
}

export interface IChecklistItem {
  id: string;
  schemeName: string;
  ministry: string;
  category: 'financial' | 'housing' | 'health' | 'identity' | 'education' | 'agriculture';
  description: string;
  requiredDocTypes: string[]; // which doc types qualify the user
  requiredDocuments: string[];
  applicationUrl: string;
  formName?: string;
  readiness: 'uploaded' | 'not_uploaded';
  disclaimer: string;
}

export interface IGuidanceRule {
  ruleId: string;
  authority: string;
  documentType: string;
  field: string;
  action: string;
  requiredDocuments: string[];
  severity: string;
  humanReview: boolean;
  sourceUrl: string;
  sourceTitle: string;
  version: string;
}

export interface IAuditEvent {
  _id: string;
  userId: string;
  event: string;
  meta: Record<string, unknown>;
  timestamp: Date;
}

// ─── In-Memory Collections ────────────────────────────────────────
const users = new Map<string, IUser>();
const documents = new Map<string, IDocument>();
const analyses = new Map<string, IAnalysis>();
const auditEvents: IAuditEvent[] = [];

// ─── User Store ───────────────────────────────────────────────────
export const UserStore = {
  findByEmail: (email: string) =>
    [...users.values()].find(u => u.email === email.toLowerCase()),

  findById: (id: string) => users.get(id),

  create: (data: Omit<IUser, '_id' | 'createdAt'>): IUser => {
    const user: IUser = { _id: uuidv4(), ...data, email: data.email.toLowerCase(), createdAt: new Date() };
    users.set(user._id, user);
    return user;
  },

  update: (id: string, data: Partial<Pick<IUser, 'name' | 'languagePreference' | 'password'>>): IUser | null => {
    const user = users.get(id);
    if (!user) return null;
    const updated = { ...user, ...data };
    users.set(id, updated);
    return updated;
  },

  delete: (id: string) => users.delete(id),
};

// ─── Document Store ───────────────────────────────────────────────
export const DocumentStore = {
  findById: (id: string) => documents.get(id),

  findByUser: (userId: string) =>
    [...documents.values()].filter(d => d.userId === userId),

  create: (data: Omit<IDocument, '_id' | 'createdAt'>): IDocument => {
    const doc: IDocument = { _id: uuidv4(), ...data, createdAt: new Date() };
    documents.set(doc._id, doc);
    return doc;
  },

  update: (id: string, data: Partial<IDocument>): IDocument | null => {
    const doc = documents.get(id);
    if (!doc) return null;
    const updated = { ...doc, ...data };
    documents.set(id, updated);
    return updated;
  },

  delete: (id: string) => documents.delete(id),
};

// ─── Analysis Store ───────────────────────────────────────────────
export const AnalysisStore = {
  findById: (id: string) => analyses.get(id),

  findByUser: (userId: string) =>
    [...analyses.values()].filter(a => a.userId === userId),

  create: (data: Omit<IAnalysis, '_id' | 'createdAt'>): IAnalysis => {
    const analysis: IAnalysis = { _id: uuidv4(), ...data, createdAt: new Date() };
    analyses.set(analysis._id, analysis);
    return analysis;
  },

  update: (id: string, data: Partial<IAnalysis>): IAnalysis | null => {
    const a = analyses.get(id);
    if (!a) return null;
    const updated = { ...a, ...data };
    analyses.set(id, updated);
    return updated;
  },

  delete: (id: string) => analyses.delete(id),
};

// ─── Audit Store ──────────────────────────────────────────────────
export const AuditStore = {
  add: (event: Omit<IAuditEvent, '_id' | 'timestamp'>): IAuditEvent => {
    const entry: IAuditEvent = { _id: uuidv4(), ...event, timestamp: new Date() };
    auditEvents.push(entry);
    return entry;
  },
  findByUser: (userId: string) =>
    auditEvents.filter(e => e.userId === userId).slice(-100),
};

/** Deletes temporary in-memory PII after the configured purpose window. */
export function purgeExpiredUserData(retentionMinutes: number): { documents: number; analyses: number } {
  const cutoff = Date.now() - retentionMinutes * 60_000;
  let removedDocuments = 0;
  let removedAnalyses = 0;
  for (const [id, document] of documents) if (document.createdAt.getTime() < cutoff) { documents.delete(id); removedDocuments++; }
  for (const [id, analysis] of analyses) if (analysis.createdAt.getTime() < cutoff) { analyses.delete(id); removedAnalyses++; }
  return { documents: removedDocuments, analyses: removedAnalyses };
}