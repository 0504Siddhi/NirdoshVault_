/**
 * Deterministic normalization utilities.
 *
 * Core rules:
 * - Case differences are ignored.
 * - Extra spaces and harmless punctuation are ignored.
 * - Initials are never expanded.
 * - Different names remain different evidence.
 * - Dates are normalized to YYYY-MM-DD where possible.
 * - Year-only and month-year dates remain incomplete evidence.
 * - Age is never converted into date of birth.
 * - No fuzzy matching is used to declare two different values equal.
 */

/* -------------------------------------------------------------------------- */
/* Shared helpers                                                              */
/* -------------------------------------------------------------------------- */

function normalizeKey(value: string): string {
  return String(value ?? '')
    .normalize('NFC')
    .trim()
    .toLowerCase()
    .replace(/[\s./-]+/g, '_')
    .replace(/[^a-z0-9_]/g, '')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function collapseSpaces(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

function isValidYear(year: number): boolean {
  const currentYear = new Date().getUTCFullYear();

  /*
   * Government identity documents should not contain implausibly old
   * or far-future birth/validity years.
   *
   * The upper limit allows future document-expiry dates.
   */
  return year >= 1900 && year <= currentYear + 100;
}

function isValidCalendarDate(
  year: number,
  month: number,
  day: number
): boolean {
  if (!isValidYear(year)) return false;
  if (month < 1 || month > 12) return false;
  if (day < 1 || day > 31) return false;

  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function formatDate(
  year: number,
  month: number,
  day: number
): string {
  return [
    String(year).padStart(4, '0'),
    String(month).padStart(2, '0'),
    String(day).padStart(2, '0'),
  ].join('-');
}

/* -------------------------------------------------------------------------- */
/* Name normalization                                                         */
/* -------------------------------------------------------------------------- */

/**
 * Examples:
 *
 * "Sanjay  Prakash Patil" -> "sanjay prakash patil"
 * "S. P. Patil"           -> "s p patil"
 * "S.P. Patil"            -> "sp patil"
 *
 * Important:
 * Initials are not expanded. Therefore:
 *
 * "S. P. Patil" !== "Sanjay Prakash Patil"
 */
export function normalizeName(value: string): string {
  return collapseSpaces(
    String(value ?? '')
      .normalize('NFC')
      .toLowerCase()
      /*
       * Keep separation where a period appears between initials.
       * "S.P." becomes "s p", not "sp".
       */
      .replace(/\./g, ' ')
      .replace(/[,;:()[\]{}"'`]/g, ' ')
      .replace(/\s+/g, ' ')
  );
}

/* -------------------------------------------------------------------------- */
/* Date normalization                                                         */
/* -------------------------------------------------------------------------- */

export interface NormalizedDate {
  normalized: string;
  isIncomplete: boolean;
}

/**
 * Supported examples:
 *
 * "14/06/1995"   -> "1995-06-14"
 * "14-06-1995"   -> "1995-06-14"
 * "1995-06-14"   -> "1995-06-14"
 * "14-Jun-1995"  -> "1995-06-14"
 * "06-1995"      -> "1995-06" and incomplete
 * "1995"         -> "1995" and incomplete
 *
 * Age values such as "26" are not interpreted as DOB.
 */
export function normalizeDob(value: string): NormalizedDate {
  if (!value || !String(value).trim()) {
    return {
      normalized: '',
      isIncomplete: false,
    };
  }

  const raw = collapseSpaces(String(value).normalize('NFC'));

  /*
   * Remove an explicit DOB label only.
   * Do not remove labels such as "Age", because age must never become DOB.
   */
  const cleaned = raw
    .replace(
      /^(?:date\s+of\s+birth|birth\s+date|dob|d\.o\.b)\s*[:\-]?\s*/i,
      ''
    )
    .trim();

  /*
   * Explicitly reject age-like values.
   *
   * Examples:
   * "Age: 26"
   * "26 years"
   * "26 yrs"
   */
  if (
    /^(?:age\s*[:\-]?\s*)?\d{1,3}\s*(?:years?|yrs?)?$/i.test(cleaned) &&
    !/^\d{4}\.?$/.test(cleaned)
  ) {
    return {
      normalized: '',
      isIncomplete: false,
    };
  }

  /*
   * Year only.
   */
  const yearOnly = cleaned.match(/^(\d{4})\.?$/);

  if (yearOnly) {
    const year = Number(yearOnly[1]);

    if (!isValidYear(year)) {
      return {
        normalized: '',
        isIncomplete: false,
      };
    }

    return {
      normalized: String(year),
      isIncomplete: true,
    };
  }

  /*
   * ISO: YYYY-MM-DD
   */
  const iso = cleaned.match(
    /^(\d{4})[\/\-.](\d{1,2})[\/\-.](\d{1,2})$/
  );

  if (iso) {
    const year = Number(iso[1]);
    const month = Number(iso[2]);
    const day = Number(iso[3]);

    if (!isValidCalendarDate(year, month, day)) {
      return {
        normalized: '',
        isIncomplete: false,
      };
    }

    return {
      normalized: formatDate(year, month, day),
      isIncomplete: false,
    };
  }

  /*
   * Indian/common document format: DD/MM/YYYY or DD-MM-YYYY.
   *
   * Nirdosh Vault should not silently reinterpret ambiguous Indian
   * government-document dates as US MM/DD/YYYY.
   */
  const dayMonthYear = cleaned.match(
    /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/
  );

  if (dayMonthYear) {
    const day = Number(dayMonthYear[1]);
    const month = Number(dayMonthYear[2]);
    const year = Number(dayMonthYear[3]);

    if (!isValidCalendarDate(year, month, day)) {
      return {
        normalized: '',
        isIncomplete: false,
      };
    }

    return {
      normalized: formatDate(year, month, day),
      isIncomplete: false,
    };
  }

  const monthMap: Record<string, number> = {
    jan: 1,
    january: 1,
    feb: 2,
    february: 2,
    mar: 3,
    march: 3,
    apr: 4,
    april: 4,
    may: 5,
    jun: 6,
    june: 6,
    jul: 7,
    july: 7,
    aug: 8,
    august: 8,
    sep: 9,
    sept: 9,
    september: 9,
    oct: 10,
    october: 10,
    nov: 11,
    november: 11,
    dec: 12,
    december: 12,
  };

  /*
   * DD-Mon-YYYY or DD Month YYYY.
   */
  const dayNamedMonthYear = cleaned.match(
    /^(\d{1,2})[\s\-/]+([a-z]+)[\s\-/]+(\d{4})$/i
  );

  if (dayNamedMonthYear) {
    const day = Number(dayNamedMonthYear[1]);
    const month =
      monthMap[dayNamedMonthYear[2].toLowerCase()];
    const year = Number(dayNamedMonthYear[3]);

    if (
      !month ||
      !isValidCalendarDate(year, month, day)
    ) {
      return {
        normalized: '',
        isIncomplete: false,
      };
    }

    return {
      normalized: formatDate(year, month, day),
      isIncomplete: false,
    };
  }

  /*
   * Month-year only.
   */
  const monthYear = cleaned.match(
    /^(\d{1,2})[\/\-.](\d{4})$/
  );

  if (monthYear) {
    const month = Number(monthYear[1]);
    const year = Number(monthYear[2]);

    if (
      month < 1 ||
      month > 12 ||
      !isValidYear(year)
    ) {
      return {
        normalized: '',
        isIncomplete: false,
      };
    }

    return {
      normalized:
        `${String(year).padStart(4, '0')}-` +
        String(month).padStart(2, '0'),
      isIncomplete: true,
    };
  }

  /*
   * Unknown date formats must not be converted into apparently valid
   * canonical dates. Keep them deterministic but incomplete.
   */
  return {
    normalized: cleaned.toLowerCase(),
    isIncomplete: true,
  };
}

/* -------------------------------------------------------------------------- */
/* Gender normalization                                                       */
/* -------------------------------------------------------------------------- */

export function normalizeGender(value: string): string {
  const normalized = collapseSpaces(
    String(value ?? '')
      .normalize('NFC')
      .toLowerCase()
      .replace(/\./g, '')
  );

  if (
    [
      'male',
      'm',
      'man',
      'पुरुष',
      'पु',
    ].includes(normalized)
  ) {
    return 'male';
  }

  if (
    [
      'female',
      'f',
      'woman',
      'महिला',
      'स्त्री',
    ].includes(normalized)
  ) {
    return 'female';
  }

  if (
    [
      'other',
      'others',
      'transgender',
      'third gender',
      'o',
      'x',
    ].includes(normalized)
  ) {
    return 'other';
  }

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Identifier normalization                                                   */
/* -------------------------------------------------------------------------- */

/**
 * Identifier values are normalized internally for deterministic handling.
 *
 * They must still be masked or excluded in API responses and consensus logic.
 */
export function normalizeIdNumber(value: string): string {
  return String(value ?? '')
    .normalize('NFC')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .trim();
}

/* -------------------------------------------------------------------------- */
/* Address normalization                                                      */
/* -------------------------------------------------------------------------- */

/**
 * Known Indian state and union-territory names.
 *
 * State names are removed from the comparison signature only when a six-digit
 * PIN code is present. This lets:
 *
 * "Pune, Maharashtra - 411052"
 *
 * match:
 *
 * "Pune - 411052"
 *
 * while avoiding unconditional removal from addresses without a PIN code.
 */
const INDIAN_STATE_NAMES = [
  'andhra pradesh',
  'arunachal pradesh',
  'assam',
  'bihar',
  'chhattisgarh',
  'goa',
  'gujarat',
  'haryana',
  'himachal pradesh',
  'jharkhand',
  'karnataka',
  'kerala',
  'madhya pradesh',
  'maharashtra',
  'manipur',
  'meghalaya',
  'mizoram',
  'nagaland',
  'odisha',
  'orissa',
  'punjab',
  'rajasthan',
  'sikkim',
  'tamil nadu',
  'telangana',
  'tripura',
  'uttar pradesh',
  'uttarakhand',
  'west bengal',
  'andaman and nicobar islands',
  'chandigarh',
  'dadra and nagar haveli and daman and diu',
  'delhi',
  'national capital territory of delhi',
  'jammu and kashmir',
  'ladakh',
  'lakshadweep',
  'puducherry',
  'pondicherry',
];

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * This is intentionally conservative.
 *
 * It normalizes harmless presentation differences but does not use fuzzy
 * similarity to accept substantially different addresses.
 */
export function normalizeAddress(value: string): string {
  let normalized = String(value ?? '')
    .normalize('NFC')
    .toLowerCase();

  const hasIndianPinCode = /\b[1-9]\d{5}\b/.test(
    normalized
  );

  /*
   * Standardize common labels.
   */
  normalized = normalized
    .replace(/\bflat\s*(?:number|no)\.?\s*/g, 'flat ')
    .replace(/\bhouse\s*(?:number|no)\.?\s*/g, 'house ')
    .replace(/\bplot\s*(?:number|no)\.?\s*/g, 'plot ')
    .replace(/\broom\s*(?:number|no)\.?\s*/g, 'room ')
    .replace(/\bbuilding\s*(?:number|no)\.?\s*/g, 'building ')
    .replace(/\bpin\s*(?:code|no|number)?\s*[:\-]?\s*/g, '')
    .replace(/\bpincode\s*[:\-]?\s*/g, '')
    .replace(/\bpostal\s+code\s*[:\-]?\s*/g, '');

  /*
   * Standardize common address abbreviations.
   *
   * Both the abbreviated and expanded forms become the same token.
   */
  normalized = normalized
    .replace(/\brd\.?\b/g, 'road')
    .replace(/\bst\.?\b/g, 'street')
    .replace(/\bln\.?\b/g, 'lane')
    .replace(/\bapt\.?\b/g, 'apartment')
    .replace(/\bopp\.?\b/g, 'opposite')
    .replace(/\bnr\.?\b/g, 'near')
    .replace(/\bsoc\.?\b/g, 'society');

  /*
   * With a PIN code present, a missing state token should not by itself
   * create a conflict when the remaining address is identical.
   */
  if (hasIndianPinCode) {
    for (const state of INDIAN_STATE_NAMES) {
      normalized = normalized.replace(
        new RegExp(
          `\\b${escapeRegExp(state)}\\b`,
          'g'
        ),
        ' '
      );
    }
  }

  /*
   * Remove presentation punctuation while preserving letters and numbers.
   */
  normalized = normalized
    .replace(/[,\-–—/:;()[\]{}"'`]/g, ' ')
    .replace(/\./g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return normalized;
}

/* -------------------------------------------------------------------------- */
/* Generic text normalization                                                 */
/* -------------------------------------------------------------------------- */

function normalizeGenericText(value: string): string {
  return collapseSpaces(
    String(value ?? '')
      .normalize('NFC')
      .toLowerCase()
  );
}

/* -------------------------------------------------------------------------- */
/* Canonical field aliases                                                    */
/* -------------------------------------------------------------------------- */

/**
 * Only fields with the same meaning should share a canonical key.
 *
 * Important safeguards:
 *
 * - age is not date_of_birth
 * - member_name is not full_name
 * - head_of_family_name is not full_name
 * - signature is not full_name
 */
const canonicalAliases: Record<string, string> = {
  /* Applicant/person name */
  name: 'full_name',
  full_name: 'full_name',
  applicant_name: 'full_name',
  candidate_name: 'full_name',
  student_name: 'full_name',
  beneficiary_name: 'full_name',
  holder_name: 'full_name',
  cardholder_name: 'full_name',
  card_holder_name: 'full_name',
  child_name: 'full_name',

  /* Date of birth */
  dob: 'date_of_birth',
  date_of_birth: 'date_of_birth',
  birth_date: 'date_of_birth',
  birthdate: 'date_of_birth',
  year_of_birth: 'date_of_birth',
  yob: 'date_of_birth',

  /* Gender */
  sex: 'gender',
  gender: 'gender',

  /* Address */
  address: 'address',
  full_address: 'address',
  residential_address: 'address',
  permanent_address: 'address',
  correspondence_address: 'address',
  present_address: 'address',
  communication_address: 'address',

  /* Aadhaar */
  aadhaar: 'aadhaar_number',
  aadhar: 'aadhaar_number',
  aadhaar_no: 'aadhaar_number',
  aadhar_no: 'aadhaar_number',
  aadhaar_number: 'aadhaar_number',
  aadhar_number: 'aadhaar_number',
  uid: 'aadhaar_number',
  uid_number: 'aadhaar_number',

  /* PAN */
  pan: 'pan_number',
  pan_no: 'pan_number',
  pan_number: 'pan_number',
  pan_card_number: 'pan_number',

  /* Driving licence */
  license_no: 'license_number',
  licence_no: 'license_number',
  license_number: 'license_number',
  licence_number: 'license_number',
  driving_license_number: 'license_number',
  driving_licence_number: 'license_number',
  dl_no: 'license_number',
  dl_number: 'license_number',

  /* Ration card */
  ration_card_no: 'ration_card_number',
  ration_card_number: 'ration_card_number',
  rc_number: 'ration_card_number',

  /* Passport */
  passport_no: 'passport_number',
  passport_number: 'passport_number',

  /* Voter ID */
  voter_id_no: 'voter_id',
  voter_id_number: 'voter_id',
  epic_no: 'voter_id',
  epic_number: 'voter_id',

  /* Registration and academic identifiers */
  reg_no: 'registration_number',
  registration_no: 'registration_number',
  roll_no: 'seat_number',
  roll_number: 'seat_number',
  seat_no: 'seat_number',

  /* Institution */
  institution: 'school_name',
  institution_name: 'school_name',
  school: 'school_name',

  /* Dates */
  issue_date: 'date_of_issue',
  date_of_issue: 'date_of_issue',
  issued_on: 'date_of_issue',
  expiry_date: 'date_of_expiry',
  date_of_expiry: 'date_of_expiry',
  valid_upto: 'date_of_expiry',
  valid_until: 'date_of_expiry',

  /* Miscellaneous */
  exam_year: 'examination_year',
};

/**
 * Fields that must remain document-specific unless a separate identity-
 * resolution step explicitly associates them with the current applicant.
 */
const DOCUMENT_SPECIFIC_NAME_FIELDS = new Set([
  'head_of_family_name',
  'head_of_household_name',
  'family_head_name',
  'member_name',
  'member_name_1',
  'member_name_2',
  'member_name_3',
  'member_name_4',
  'member_name_5',
]);

export function canonicalFieldKey(
  fieldKey: string
): string {
  const normalizedKey = normalizeKey(fieldKey);

  if (!normalizedKey) {
    return '';
  }

  /*
   * Never reinterpret family-member fields as the applicant's full name.
   */
  if (
    DOCUMENT_SPECIFIC_NAME_FIELDS.has(
      normalizedKey
    ) ||
    /^member_name_\d+$/.test(normalizedKey)
  ) {
    return normalizedKey;
  }

  /*
   * Age fields remain age fields.
   * They are never canonicalized to DOB.
   */
  if (
    normalizedKey === 'age' ||
    normalizedKey === 'member_age' ||
    /^member_age_\d+$/.test(normalizedKey)
  ) {
    return normalizedKey;
  }

  return canonicalAliases[normalizedKey] ?? normalizedKey;
}

/* -------------------------------------------------------------------------- */
/* Field normalization router                                                 */
/* -------------------------------------------------------------------------- */

export interface NormalizedFieldResult {
  normalized: string;
  incomplete?: boolean;
}

export function normalizeField(
  fieldKey: string,
  value: string
): NormalizedFieldResult {
  if (!value || !String(value).trim()) {
    return {
      normalized: '',
    };
  }

  const canonicalKey =
    canonicalFieldKey(fieldKey);

  if (!canonicalKey) {
    return {
      normalized: '',
    };
  }

  if (
    [
      'full_name',
      'father_name',
      'mother_name',
      'parent_name',
      'guardian_name',
      'spouse_name',
      'head_of_family_name',
      'head_of_household_name',
      'family_head_name',
    ].includes(canonicalKey) ||
    /^member_name_\d+$/.test(canonicalKey)
  ) {
    return {
      normalized: normalizeName(value),
    };
  }

  if (canonicalKey === 'date_of_birth') {
    const result = normalizeDob(value);

    return {
      normalized: result.normalized,
      incomplete: result.isIncomplete,
    };
  }

  if (
    [
      'date_of_issue',
      'issue_date',
      'date_of_expiry',
      'expiry_date',
      'validity_date',
    ].includes(canonicalKey)
  ) {
    const result = normalizeDob(value);

    return {
      normalized: result.normalized,
      incomplete: result.isIncomplete,
    };
  }

  if (canonicalKey === 'gender') {
    return {
      normalized: normalizeGender(value),
    };
  }

  if (
    [
      'aadhaar_number',
      'pan_number',
      'license_number',
      'ration_card_number',
      'passport_number',
      'voter_id',
      'registration_number',
      'seat_number',
      'application_number',
      'certificate_number',
      'uan_number',
      'abha_number',
    ].includes(canonicalKey)
  ) {
    return {
      normalized: normalizeIdNumber(value),
    };
  }

  if (
    [
      'address',
      'permanent_address',
      'residential_address',
      'correspondence_address',
      'present_address',
      'communication_address',
    ].includes(canonicalKey)
  ) {
    return {
      normalized: normalizeAddress(value),
    };
  }

  /*
   * Age remains metadata.
   * It is normalized only as age and is never converted into DOB.
   */
  if (
    canonicalKey === 'age' ||
    canonicalKey === 'member_age' ||
    /^member_age_\d+$/.test(canonicalKey)
  ) {
    const ageMatch = String(value)
      .trim()
      .match(/^(\d{1,3})(?:\s*(?:years?|yrs?))?$/i);

    return {
      normalized: ageMatch
        ? ageMatch[1]
        : normalizeGenericText(value),
    };
  }

  if (
    [
      'school_name',
      'place_of_birth',
      'place_of_issue',
      'nationality',
      'issuing_authority',
      'blood_group',
      'class_of_vehicles',
      'vehicle_class',
      'member_relation',
    ].includes(canonicalKey)
  ) {
    return {
      normalized: normalizeGenericText(value),
    };
  }

  /*
   * Signature OCR text is not reliable identity evidence.
   *
   * Keep only presence metadata. It should not become a person's name.
   */
  if (
    [
      'signature',
      'holder_signature',
      'applicant_signature',
      'thumb_impression',
      'fingerprint',
      'photo',
      'photograph',
    ].includes(canonicalKey)
  ) {
    const lowered = normalizeGenericText(value);

    const absentValues = new Set([
      '',
      'no',
      'absent',
      'not detected',
      'not present',
      'none',
    ]);

    return {
      normalized: absentValues.has(lowered)
        ? 'not_detected'
        : 'detected',
    };
  }

  return {
    normalized: normalizeGenericText(value),
  };
}

/* -------------------------------------------------------------------------- */
/* Aadhaar & PAN Checksum / Format Validators                                 */
/* -------------------------------------------------------------------------- */

const VERHOEFF_D: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
  [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
  [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
  [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
  [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
  [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
  [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
  [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
  [9, 8, 7, 6, 5, 4, 3, 2, 1, 0],
];

const VERHOEFF_P: number[][] = [
  [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
  [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
  [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
  [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
  [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
  [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
  [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
  [7, 0, 4, 6, 9, 1, 3, 2, 5, 8],
];

/**
 * Validates a 12-digit Aadhaar number using the Verhoeff checksum algorithm.
 * Evaluates right-to-left over the digit string.
 */
export function validateAadhaarVerhoeff(value: string): boolean {
  const digits = String(value ?? '').replace(/[\s-]+/g, '');
  if (!/^\d{12}$/.test(digits)) {
    return false;
  }

  let c = 0;
  const reversed = digits.split('').reverse().map(Number);
  for (let i = 0; i < reversed.length; i++) {
    c = VERHOEFF_D[c][VERHOEFF_P[i % 8][reversed[i]]];
  }
  return c === 0;
}

/**
 * Validates a PAN format using ^[A-Z]{5}[0-9]{4}[A-Z]$ against the compacted
 * (uppercased, whitespace-stripped) value.
 */
export function validatePanFormat(value: string): boolean {
  const compacted = String(value ?? '').replace(/\s+/g, '').toUpperCase();
  return /^[A-Z]{5}[0-9]{4}[A-Z]$/.test(compacted);
}