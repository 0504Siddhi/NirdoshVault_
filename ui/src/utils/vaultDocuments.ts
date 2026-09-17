import api from '../api/client';
import type { VaultDocument, EvidenceStatus } from '../components/schemes/SchemeFinder';
import type { IFieldResult } from '../types/nirdosh-vault';

interface IDocument {
  _id: string;
  docType: string;
  title: string;
  status: string;
}

const DOC_TYPE_MAP: Record<string, { key: string; label: string }> = {
  aadhaar: { key: 'aadhaar', label: 'Aadhaar Card' },
  aadhar: { key: 'aadhaar', label: 'Aadhaar Card' },
  pan: { key: 'pan', label: 'PAN Card' },
  voter_id: { key: 'voter_id', label: 'Voter ID' },
  voterid: { key: 'voter_id', label: 'Voter ID' },
  epic: { key: 'voter_id', label: 'Voter ID' },
  driving_licence: { key: 'driving_licence', label: 'Driving Licence' },
  driving_license: { key: 'driving_licence', label: 'Driving Licence' },
  dl: { key: 'driving_licence', label: 'Driving Licence' },
  birth_certificate: { key: 'birth_certificate', label: 'Birth Certificate' },
  passport: { key: 'passport', label: 'Passport' },
  marksheet: { key: 'marksheet', label: 'Marksheet' },
  school_leaving_certificate: { key: 'school_leaving_certificate', label: 'School Leaving Certificate' },
  ration_card: { key: 'ration_card', label: 'Ration Card' },
  bank_passbook: { key: 'bank_passbook', label: 'Bank Passbook' },
  bank_record: { key: 'bank_passbook', label: 'Bank Passbook' },
  passbook: { key: 'bank_passbook', label: 'Bank Passbook' },
  income_certificate: { key: 'income_certificate', label: 'Income Certificate' },
  caste_certificate: { key: 'caste_certificate', label: 'Caste Certificate' },
  land_record: { key: 'land_record', label: 'Land Record' },
  age_proof: { key: 'age_proof', label: 'Age Proof' },
};

function normalizeDocType(docType: string): { key: string; label: string } {
  const clean = String(docType || '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');

  if (DOC_TYPE_MAP[clean]) {
    return DOC_TYPE_MAP[clean];
  }

  const label = clean
    .split('_')
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(' ');

  return { key: clean, label: label || 'Document' };
}

export async function fetchVaultDocuments(): Promise<VaultDocument[]> {
  const [docRes, analysisRes] = await Promise.all([
    api.get('/documents'),
    api.get('/analysis'),
  ]);

  const rawDocs: IDocument[] = docRes.data?.documents || [];
  const readyDocs = rawDocs.filter((d) => d.status === 'ready');

  if (readyDocs.length === 0) {
    return [];
  }

  const analyses = analysisRes.data?.analyses || [];
  const latestAnalysis = analyses.length > 0 ? analyses[0] : null;
  const fieldResults: IFieldResult[] = latestAnalysis?.fieldResults || [];

  const mappedDocMap = new Map<string, VaultDocument>();

  for (const doc of readyDocs) {
    const { key, label } = normalizeDocType(doc.docType);

    let hasAttributableConflict = false;
    const conflictingFieldLabels: string[] = [];
    let hasExtractionIssue = false;
    const extractionIssueFieldLabels: string[] = [];

    let participatedComparableCount = 0;
    let consistentParticipatedCount = 0;

    for (const field of fieldResults) {
      const fieldAny = field as any;
      const isSupportingDoc =
        field.supportingDocs?.some((s) => s.docId === doc._id || s.docType === doc.docType) ?? false;

      const isOutlierDoc =
        (field.outliers?.some((o) => o.docId === doc._id || o.docType === doc.docType) ?? false) ||
        (field.likelyOutlierDocumentIds?.includes(doc._id) ?? false);

      const isInGroupDoc =
        field.groups?.some((g) =>
          g.docs.some((gd) => gd.docId === doc._id || gd.docType === doc.docType)
        ) ?? false;

      const isContributingDocType =
        Array.isArray(fieldAny.contributingDocumentTypes) &&
        fieldAny.contributingDocumentTypes.includes(doc.docType);

      const participatedInField =
        isSupportingDoc || isOutlierDoc || isInGroupDoc || isContributingDocType;

      if (!participatedInField) {
        continue;
      }

      participatedComparableCount += 1;

      if (field.status === 'consistent') {
        consistentParticipatedCount += 1;
      } else if (field.status === 'conflicting_evidence') {
        if (isInGroupDoc || isSupportingDoc || isContributingDocType) {
          hasAttributableConflict = true;
          if (field.label && !conflictingFieldLabels.includes(field.label)) {
            conflictingFieldLabels.push(field.label);
          }
        }
      } else if (field.status === 'outlier_detected') {
        if (isOutlierDoc) {
          hasAttributableConflict = true;
          if (field.label && !conflictingFieldLabels.includes(field.label)) {
            conflictingFieldLabels.push(field.label);
          }
        }
      } else if (field.status === 'extraction_invalid') {
        if (isOutlierDoc) {
          hasExtractionIssue = true;
          if (field.label && !extractionIssueFieldLabels.includes(field.label)) {
            extractionIssueFieldLabels.push(field.label);
          }
        }
      }
    }

    let evidence: EvidenceStatus = 'insufficient_evidence';
    let note: string | undefined = undefined;

    if (hasAttributableConflict) {
      evidence = 'conflict_detected';
      if (conflictingFieldLabels.length === 1) {
        note = `${conflictingFieldLabels[0]} field has conflicting cross-document evidence`;
      } else if (conflictingFieldLabels.length > 1) {
        note = 'Multiple identity fields require review';
      } else {
        note = 'Identity field needs review';
      }
    } else if (hasExtractionIssue) {
      evidence = 'insufficient_evidence';
      note = `${extractionIssueFieldLabels[0] || 'Identity'} field has an extraction issue — re-upload recommended`;
    } else if (
      participatedComparableCount > 0 &&
      participatedComparableCount === consistentParticipatedCount
    ) {
      evidence = 'no_relevant_conflict';
    } else {
      evidence = 'insufficient_evidence';
    }

    const existing = mappedDocMap.get(key);
    if (!existing) {
      mappedDocMap.set(key, {
        key,
        label,
        available: true,
        evidence,
        note,
      });
    } else {
      let priorityEvidence = existing.evidence;
      let priorityNote = existing.note;

      if (evidence === 'conflict_detected') {
        priorityEvidence = 'conflict_detected';
        priorityNote = note || priorityNote;
      } else if (evidence === 'no_relevant_conflict' && priorityEvidence !== 'conflict_detected') {
        priorityEvidence = 'no_relevant_conflict';
      }

      mappedDocMap.set(key, {
        ...existing,
        available: true,
        evidence: priorityEvidence,
        note: priorityNote,
      });
    }
  }

  return Array.from(mappedDocMap.values());
}
