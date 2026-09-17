import {
  IDocument,
  IFieldResult,
} from '../models/store';

import {
  canonicalFieldKey,
  normalizeField,
  validateAadhaarVerhoeff,
  validatePanFormat,
} from './normalizationService';

import type {
  ConfidenceLabel,
  FieldStatus,
  DocumentSpecificField,
  ConsensusSummary,
} from '../types/nirdosh-vault';

interface Entry {
  docId: string;
  docTitle: string;
  docType: string;
  value: string;
  normalized: string;
  incomplete: boolean;
  confidence: number | null;
}

export const FIELD_WEIGHTS: Record<string, number> = {};

/**
 * Sensitive identifiers should not be used for identity consensus.
 *
 * Nirdosh Vault should compare identity attributes such as name,
 * date of birth, gender and address—not decide whether a full Aadhaar
 * or PAN number is correct.
 */
const NON_COMPARABLE_SENSITIVE_FIELDS = new Set([
  'aadhaar',
  'aadhar',
  'aadhaar_number',
  'aadhar_number',
  'aadhaar_no',
  'aadhar_no',
  'aadhaar_card_number',
  'aadhar_card_number',
  'uid',
  'uid_number',
  'uidai',
  'uidai_number',
  'unique_identification_number',

  'pan',
  'pan_no',
  'pan_number',
  'pan_card_number',
  'permanent_account_number',
]);

function normalizeKey(fieldKey: unknown): string {
  return String(fieldKey ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '');
}

function isSensitiveIdentifierField(
  fieldKey: unknown
): boolean {
  return NON_COMPARABLE_SENSITIVE_FIELDS.has(
    normalizeKey(fieldKey)
  );
}

function scenarioFor(
  field: string,
  values: Entry[]
): string {
  if (field === 'date_of_birth') {
    const years = new Set(
      values
        .map((entry) =>
          entry.normalized.slice(0, 4)
        )
        .filter(Boolean)
    );

    const incomplete = values.some(
      (entry) => entry.incomplete
    );

    if (incomplete && years.size === 1) {
      return 'year_only_same_year';
    }

    if (years.size > 1) {
      return 'year_difference';
    }

    return 'different_full_date';
  }

  if (field === 'full_name') {
    const initials = values.some((entry) =>
      /(^|\s)[a-z](\s|$)/i.test(
        entry.value.replace(/[.]/g, ' ')
      )
    );

    return initials
      ? 'possible_initial_or_order_variant'
      : 'name_difference_standard';
  }

  return `${field}_difference`;
}

function confidence(
  status: FieldStatus,
  support: number,
  total: number
): ConfidenceLabel {
  if (status === 'conflicting_evidence') {
    return 'no_consensus';
  }

  if (
    status === 'possible_variant' ||
    status === 'extraction_uncertain'
  ) {
    return 'review';
  }

  if (support === total) {
    return 'high';
  }

  return 'medium';
}

function validField(field: any): boolean {
  const confidenceValue =
    typeof field?.confidence === 'number'
      ? field.confidence
      : 0;

  return Boolean(
    typeof field?.value === 'string' &&
    field.value.trim() &&
    typeof field?.normalized === 'string' &&
    field.normalized.trim() &&
    !field.invalidReason &&
    confidenceValue >= 0.6
  );
}

export interface AuditReportResponse {
  summary: ConsensusSummary;
  fieldResults: IFieldResult[];
  documentSpecificFields: DocumentSpecificField[];
  allComparableFieldResults?: IFieldResult[];
}

export function runConsensusEngine(
  documents: IDocument[]
): AuditReportResponse {
  const byField = new Map<string, Entry[]>();
  const extractionInvalidResults: IFieldResult[] = [];

  /*
   * Prevent one document from voting more than once for the same field.
   *
   * Key format:
   * documentId::canonicalFieldKey
   */
  const seenDocumentFields = new Set<string>();

  // 1. Data ingestion and normalization
  for (const doc of documents) {
    for (const field of doc.extractedFields || []) {
      const key = canonicalFieldKey(
        field.fieldKey
      );

      if (!key) {
        continue;
      }

      // Check Aadhaar/PAN checksum & format BEFORE comparison logic
      const isAadhaarKey = key === 'aadhaar_number';
      const isPanKey = key === 'pan_number';

      if (isAadhaarKey || isPanKey) {
        const isInvalid = isAadhaarKey
          ? !validateAadhaarVerhoeff(field.value)
          : !validatePanFormat(field.value);

        if (isInvalid) {
          const invalidResult: IFieldResult = {
            fieldKey: key,
            label: field.label || (isAadhaarKey ? 'Aadhaar Number' : 'PAN Number'),
            status: 'extraction_invalid',
            confidence: 'review',
            confidenceLabel: 'Extraction Issue - Checksum / Format Failed',
            scenario: isAadhaarKey ? 'aadhaar_verhoeff_failed' : 'pan_format_failed',
            consensusValue: undefined,
            supportingDocs: [],
            outliers: [
              {
                docId: doc._id,
                docTitle: doc.title,
                value: field.value,
                docType: doc.docType,
              },
            ],
            explanation: isAadhaarKey
              ? 'Aadhaar number failed Verhoeff checksum validation. Likely OCR extraction issue — please re-upload a clearer photo.'
              : 'PAN number failed standard format validation. Likely OCR extraction issue — please re-upload a clearer photo.',
            needsManualVerification: true,
            documentsContainingField: 1,
            supportingDocumentTypes: [],
            contributingDocumentTypes: [doc.docType],
            averageExtractionConfidence:
              typeof field.confidence === 'number' && Number.isFinite(field.confidence)
                ? Math.max(0, Math.min(1, field.confidence))
                : null,
          };
          extractionInvalidResults.push(invalidResult);
          continue;
        }
      }

      /*
       * Do not include other non-comparable sensitive identifiers in the consensus profile.
       */
      if (isSensitiveIdentifierField(key) && !isAadhaarKey && !isPanKey) {
        continue;
      }

      if (!validField(field)) {
        continue;
      }

      const documentFieldKey = `${doc._id}::${key}`;

      /*
       * A document receives only one vote per canonical field.
       */
      if (
        seenDocumentFields.has(documentFieldKey)
      ) {
        continue;
      }

      const normalizedResult = normalizeField(
        key,
        field.value
      );

      const normalized =
        normalizedResult.normalized;

      if (!normalized) {
        continue;
      }

      seenDocumentFields.add(documentFieldKey);

      const list = byField.get(key) || [];

      list.push({
        docId: doc._id,
        docTitle: doc.title,
        docType: doc.docType,
        value: field.value,
        normalized,
        incomplete: Boolean(
          field.incomplete ||
          normalizedResult.incomplete
        ),
        confidence:
          typeof field.confidence === 'number' && Number.isFinite(field.confidence)
            ? Math.max(0, Math.min(1, field.confidence))
            : null,
      });

      byField.set(key, list);
    }
  }

  const comparableFieldResults: IFieldResult[] = [];
  const allComparableFieldResults: IFieldResult[] = [];
  const documentSpecificFields: DocumentSpecificField[] = [];

  // Group extraction-invalid results by fieldKey and pair with any valid supporting documents
  const groupedInvalid = new Map<string, IFieldResult>();
  for (const inv of extractionInvalidResults) {
    const existing = groupedInvalid.get(inv.fieldKey);
    if (!existing) {
      const validEntries = byField.get(inv.fieldKey) || [];
      const supportingDocs = validEntries.map((e) => ({
        docId: e.docId,
        docTitle: e.docTitle,
        value: e.value,
        docType: e.docType,
      }));
      const supportingTypes = Array.from(new Set(validEntries.map((e) => e.docType)));
      const contributingTypes = Array.from(
        new Set([...supportingTypes, ...(inv.contributingDocumentTypes || [])])
      );
      groupedInvalid.set(inv.fieldKey, {
        ...inv,
        supportingDocs,
        supportingDocumentTypes: supportingTypes,
        contributingDocumentTypes: contributingTypes,
        documentsContainingField: supportingDocs.length + (inv.outliers?.length || 0),
      });
    } else {
      if (inv.outliers) {
        existing.outliers = [...(existing.outliers || []), ...inv.outliers];
      }
      existing.documentsContainingField =
        (existing.supportingDocs?.length || 0) + (existing.outliers?.length || 0);
      existing.contributingDocumentTypes = Array.from(
        new Set([...(existing.contributingDocumentTypes || []), ...(inv.contributingDocumentTypes || [])])
      );
    }
  }

  // 2. Readiness router and consensus matrix
  for (const [fieldKey, entries] of byField) {
    // If this field had an extraction error in one or more documents, it is handled as extraction_invalid
    if (groupedInvalid.has(fieldKey)) {
      continue;
    }

    const label = fieldKey
      .replace(/_/g, ' ')
      .replace(
        /\b\w/g,
        (character) => character.toUpperCase()
      );

    const documentsContainingField = new Set(entries.map((entry) => entry.docId)).size;
    const validConfs = entries.map((e) => e.confidence).filter((c): c is number => c !== null);
    const avgConfidence = validConfs.length > 0 ? validConfs.reduce((s, c) => s + c, 0) / validConfs.length : null;
    const contributingDocumentTypes = Array.from(new Set(entries.map((e) => e.docType)));

    /*
     * Compare a field only when at least two different documents
     * contain a valid version of it.
     */
    if (entries.length < 2) {
      const entry = entries[0];

      if (entry) {
        documentSpecificFields.push({
          fieldName: label,
          docId: entry.docId,
          docType: entry.docType,
          value: entry.value,
        });

        const singleDocResult: IFieldResult = {
          fieldKey,
          label,
          status: 'consistent',
          confidence: 'review',
          confidenceLabel: 'Review - single document evidence',
          scenario: 'exact_normalized_match',
          consensusValue: entry.value,
          supportingDocs: [{ docId: entry.docId, docTitle: entry.docTitle, value: entry.value, docType: entry.docType }],
          explanation: 'Field present in single uploaded document; cross-document peer consensus unavailable.',
          needsManualVerification: true,
          documentsContainingField: 1,
          supportingDocumentTypes: [entry.docType],
          contributingDocumentTypes: [entry.docType],
          averageExtractionConfidence: entry.confidence,
          peerEvidenceAvailable: false,
        };
        allComparableFieldResults.push(singleDocResult);
      }

      continue;
    }

    const groupedEntries = entries.reduce(
      (
        map: Map<string, Entry[]>,
        entry
      ) => {
        const existing =
          map.get(entry.normalized) || [];

        existing.push(entry);
        map.set(entry.normalized, existing);

        return map;
      },
      new Map<string, Entry[]>()
    );

    const groups = [
      ...groupedEntries.values(),
    ].sort(
      (first, second) =>
        second.length - first.length
    );

    const largest = groups[0];

    if (!largest?.length) {
      continue;
    }

    const supportingDocumentTypes = Array.from(new Set(largest.map((e) => e.docType)));

    const hasYearOnly =
      fieldKey === 'date_of_birth' &&
      entries.some(
        (entry) => entry.incomplete
      );

    const birthYears =
      fieldKey === 'date_of_birth'
        ? new Set(
          entries.map((entry) =>
            entry.normalized.slice(0, 4)
          )
        )
        : new Set<string>();

    if (
      hasYearOnly &&
      birthYears.size === 1
    ) {
      const fullDateEntries = entries.filter((e) => !e.incomplete);
      const supportingTypesForYearOnly = Array.from(
        new Set((fullDateEntries.length > 0 ? fullDateEntries : largest).map((e) => e.docType))
      );

      const res: IFieldResult = {
        fieldKey,
        label,
        status: 'possible_variant',
        confidence: 'review',
        confidenceLabel:
          'Review - year-only date evidence',
        scenario: 'year_only_same_year',
        evidence: entries,
        explanation:
          'The year agrees, but at least one document contains only a year of birth. This is incomplete evidence, not an exact full-date match.',
        needsManualVerification: true,
        documentsContainingField,
        supportingDocumentTypes: supportingTypesForYearOnly,
        contributingDocumentTypes,
        averageExtractionConfidence: avgConfidence,
      };
      comparableFieldResults.push(res);
      allComparableFieldResults.push(res);

      continue;
    }

    if (groups.length === 1) {
      const res: IFieldResult = {
        fieldKey,
        label,
        status: 'consistent',
        confidence: 'high',
        confidenceLabel:
          'High - all comparable documents agree',
        scenario: 'exact_normalized_match',
        consensusValue: largest[0].value,

        supportingDocs: largest.map(
          (entry) => ({
            docId: entry.docId,
            docTitle: entry.docTitle,
            value: entry.value,
            docType: entry.docType,
          })
        ),

        explanation:
          'All comparable uploaded documents agree under deterministic normalization.',

        needsManualVerification: false,
        documentsContainingField,
        supportingDocumentTypes,
        contributingDocumentTypes,
        averageExtractionConfidence: avgConfidence,
      };
      comparableFieldResults.push(res);
      allComparableFieldResults.push(res);

      continue;
    }

    /*
     * Strict majority:
     *
     * 2 of 3 = majority
     * 3 of 4 = majority
     * 2 of 4 = no majority
     * 1 of 2 = no majority
     */
    if (
      largest.length >
      entries.length / 2
    ) {
      const outliers = entries.filter(
        (entry) =>
          entry.normalized !==
          largest[0].normalized
      );

      const scenario = scenarioFor(
        fieldKey,
        entries
      );

      const status: FieldStatus =
        scenario ===
          'possible_initial_or_order_variant'
          ? 'possible_variant'
          : 'outlier_detected';

      const res: IFieldResult = {
        fieldKey,
        label,
        status,

        confidence: confidence(
          status,
          largest.length,
          entries.length
        ),

        confidenceLabel:
          status === 'possible_variant'
            ? 'Review - possible name variant'
            : 'Medium - majority evidence, review recommended',

        scenario,
        consensusValue: largest[0].value,

        supportingDocs: largest.map(
          (entry) => ({
            docId: entry.docId,
            docTitle: entry.docTitle,
            value: entry.value,
            docType: entry.docType,
          })
        ),

        outliers: outliers.map(
          (entry) => ({
            docId: entry.docId,
            docTitle: entry.docTitle,
            value: entry.value,
            docType: entry.docType,
          })
        ),

        likelyOutlierDocumentIds:
          outliers.map(
            (entry) => entry.docId
          ),

        explanation:
          `${largest.length} of ${entries.length} comparable documents agree. ` +
          'The differing document appears inconsistent based on uploaded evidence; this is not a legal determination.',

        needsManualVerification: true,
        documentsContainingField,
        supportingDocumentTypes,
        contributingDocumentTypes,
        averageExtractionConfidence: avgConfidence,
      };
      comparableFieldResults.push(res);
      allComparableFieldResults.push(res);

      continue;
    }

    const res: IFieldResult = {
      fieldKey,
      label,
      status: 'conflicting_evidence',
      confidence: 'no_consensus',
      confidenceLabel:
        'No Consensus - no reliable majority',

      scenario: scenarioFor(
        fieldKey,
        entries
      ),

      groups: groups.map((group) => ({
        value: group[0].value,

        docs: group.map((entry) => ({
          docId: entry.docId,
          docTitle: entry.docTitle,
          docType: entry.docType,
        })),
      })),

      explanation:
        'Evidence is split with no reliable majority. No correction target has been selected.',

      needsManualVerification: true,
      documentsContainingField,
      supportingDocumentTypes: [],
      contributingDocumentTypes,
      averageExtractionConfidence: avgConfidence,
    };
    comparableFieldResults.push(res);
    allComparableFieldResults.push(res);
  }

  // 3. Summary generation
  const finalInvalidResults = Array.from(groupedInvalid.values());
  const allResults = [
    ...comparableFieldResults,
    ...finalInvalidResults,
  ];

  const allComparable = [
    ...allComparableFieldResults,
    ...finalInvalidResults,
  ];

  const totalComparable =
    allResults.length;

  const totalConsensus =
    allResults.filter(
      (field) =>
        field.status === 'consistent'
    ).length;

  const totalConflicts =
    allResults.filter(
      (field) =>
        field.status !== 'consistent' && field.status !== 'extraction_invalid'
    ).length;

  return {
    summary: {
      totalDocuments: documents.length,
      comparableFieldsCount:
        totalComparable,
      consensusFieldsCount:
        totalConsensus,
      conflictFieldsCount:
        totalConflicts,
    },

    fieldResults:
      allResults,

    documentSpecificFields,

    allComparableFieldResults: allComparable,
  };
}