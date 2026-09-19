import { spawn, ChildProcessWithoutNullStreams } from 'child_process';
import path from 'path';
import sharp from 'sharp';
import fs from 'fs';
import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { GoogleGenerativeAI, HarmCategory, HarmBlockThreshold } from '@google/generative-ai';
import { z } from 'zod';
import { IDocumentField } from '../models/store';
import logger from './logger';
import { config } from '../config';

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY || '');

// ─── Tolerant schema + canonical field normalization ─────────────────────────

const toNumber = (value: unknown, fallback: number): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed)) return parsed;
  }
  return fallback;
};

const normalizeConfidence = (value: unknown): number => {
  const numeric = toNumber(value, 0.8);
  const ratio = numeric > 1 && numeric <= 100 ? numeric / 100 : numeric;
  return Math.max(0, Math.min(1, ratio));
};

const DOC_TYPE_ALIASES: Record<string, string> = {
  aadhar: 'aadhaar',
  aadhaar_card: 'aadhaar',
  pan_card: 'pan',
  voter: 'voter_id',
  voter_card: 'voter_id',
  driving_license: 'driving_licence',
  dl: 'driving_licence',
  birth_cert: 'birth_certificate',
  birthcertificate: 'birth_certificate',
  school_marksheet: 'marksheet',
  mark_sheet: 'marksheet',

  ration: 'ration_card',
  rationcard: 'ration_card',
  ration_card_document: 'ration_card',
  food_security_card: 'ration_card',
  national_food_security_card: 'ration_card',
  nfsa_card: 'ration_card',
  pds_card: 'ration_card',
  public_distribution_system_card: 'ration_card',
};

const SUPPORTED_DOC_TYPES = new Set([
  'aadhaar',
  'pan',
  'voter_id',
  'driving_licence',
  'birth_certificate',
  'passport',
  'marksheet',
  'ration_card',
  'unknown',
]);

const FIELD_KEY_ALIASES: Record<string, string> = {
  name: 'full_name',
  holder_name: 'full_name',
  applicant_name: 'full_name',
  candidate_name: 'full_name',
  person_name: 'full_name',

  aadhaar: 'aadhaar_no',
  aadhaar_number: 'aadhaar_no',
  aadhar_no: 'aadhaar_no',
  aadhar_number: 'aadhaar_no',
  uid: 'aadhaar_no',
  uid_number: 'aadhaar_no',

  pan: 'pan_no',
  pan_number: 'pan_no',

  voter_number: 'voter_id',
  epic_no: 'voter_id',
  epic_number: 'voter_id',

  dl_number: 'dl_no',
  driving_licence_number: 'dl_no',
  driving_license_number: 'dl_no',

  passport_number: 'passport_no',

  ration_number: 'ration_card_number',
  ration_card_no: 'ration_card_number',
  rc_number: 'ration_card_number',
  family_card_number: 'ration_card_number',

  registration_number: 'reg_no',
  registration_no: 'reg_no',
  certificate_number: 'reg_no',

  date_of_birth: 'dob',
  birth_date: 'dob',
  year_of_birth: 'dob',
  sex: 'gender',

  school_name: 'institution',
  institution_name: 'institution',
  roll_number: 'roll_no',
};

function canonicalizeFieldKey(input: unknown): string {
  const key = String(input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');

  return FIELD_KEY_ALIASES[key] ?? key;
}

export const ExtractedFieldSchema = z.object({
  fieldKey: z.preprocess(canonicalizeFieldKey, z.string().min(1)),
  label: z.preprocess(v => String(v ?? '').trim(), z.string()),
  value: z.preprocess(v => String(v ?? '').trim(), z.string()),
  normalized: z.preprocess(v => String(v ?? '').trim(), z.string()).optional().default(''),
  type: z.preprocess(v => String(v ?? 'string').trim().toLowerCase(), z.string()).optional().default('string'),
  page: z.preprocess(v => Math.max(1, Math.trunc(toNumber(v, 1))), z.number()).optional().default(1),
  confidence: z.preprocess(normalizeConfidence, z.number().min(0).max(1)).optional().default(0.8),
  evidenceText: z.preprocess(v => String(v ?? '').trim(), z.string()).optional().default(''),
  incomplete: z.preprocess(v => Boolean(v), z.boolean()).optional(),
  invalidReason: z.preprocess(
    v => (v === null || v === undefined || v === '' ? null : String(v)),
    z.string().nullable()
  ).optional(),
});

export const ExtractedDocSchema = z.object({
  fileIndex: z.preprocess(v => Math.max(0, Math.trunc(toNumber(v, 0))), z.number()).optional().default(0),
  docType: z.preprocess((value) => {
    const raw = String(value ?? 'unknown')
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    const mapped = DOC_TYPE_ALIASES[raw] ?? raw;
    return SUPPORTED_DOC_TYPES.has(mapped) ? mapped : 'unknown';
  }, z.enum([
    'aadhaar',
    'pan',
    'voter_id',
    'driving_licence',
    'birth_certificate',
    'passport',
    'marksheet',
    'ration_card',
    'unknown',
  ])),
  fields: z.preprocess(v => (Array.isArray(v) ? v : []), z.array(ExtractedFieldSchema)),
  needsReview: z.preprocess(v => Boolean(v), z.boolean()).optional().default(false),
});

export const BatchExtractedDocSchema = z.object({
  documents: z.preprocess(v => (Array.isArray(v) ? v : []), z.array(z.unknown())),
});

export type ExtractedDocResult = z.infer<typeof ExtractedDocSchema>;
export type BatchExtractedResult = { documents: ExtractedDocResult[] };

function parseGeminiBatch(raw: unknown): {
  documents: ExtractedDocResult[];
  rejected: Array<{ position: number; reason: string }>;
} {
  const envelope = BatchExtractedDocSchema.safeParse(raw);
  if (!envelope.success) {
    throw new Error(`Gemini response envelope is invalid: ${envelope.error.message}`);
  }

  const documents: ExtractedDocResult[] = [];
  const rejected: Array<{ position: number; reason: string }> = [];

  envelope.data.documents.forEach((candidate, position) => {
    const parsed = ExtractedDocSchema.safeParse(candidate);
    if (parsed.success) {
      documents.push(parsed.data);
    } else {
      rejected.push({ position, reason: parsed.error.message });
    }
  });

  return { documents, rejected };
}

/** Validates meaningful content after aliases have already been canonicalized. */
export function validateExtractionQuality(doc: ExtractedDocResult): { valid: boolean; reason?: string } {
  if (doc.docType === 'unknown') return { valid: true };

  const validFields = doc.fields.filter(field => field.value.trim().length > 0);
  if (validFields.length === 0) return { valid: false, reason: 'empty_field_values' };

  const keys = new Set(validFields.map(field => canonicalizeFieldKey(field.fieldKey)));

  switch (doc.docType) {
    case 'aadhaar':
      if (!keys.has('aadhaar_no') && !keys.has('full_name')) {
        return { valid: false, reason: 'missing_aadhaar_key_fields' };
      }
      break;
    case 'pan':
      if (!keys.has('pan_no') && !keys.has('full_name')) {
        return { valid: false, reason: 'missing_pan_key_fields' };
      }
      break;
    case 'voter_id':
      if (!keys.has('voter_id') && !keys.has('full_name')) {
        return { valid: false, reason: 'missing_voter_id_key_fields' };
      }
      break;
    case 'driving_licence':
      if (!keys.has('dl_no') && !keys.has('full_name')) {
        return { valid: false, reason: 'missing_dl_key_fields' };
      }
      break;
    case 'passport':
      if (!keys.has('passport_no') && !keys.has('full_name')) {
        return { valid: false, reason: 'missing_passport_key_fields' };
      }
      break;
    case 'birth_certificate':
      if (!keys.has('reg_no') && !keys.has('child_name') && !keys.has('father_name')) {
        return { valid: false, reason: 'missing_birth_cert_key_fields' };
      }
      break;
    case 'marksheet':
      if (!keys.has('full_name') && !keys.has('roll_no') && !keys.has('institution')) {
        return { valid: false, reason: 'missing_marksheet_key_fields' };
      }
      break;
    case 'ration_card':
      if (
        !keys.has('ration_card_number') &&
        !keys.has('head_of_family_name') &&
        ![...keys].some(key => /^member_name(?:_\d+)?$/.test(key))
      ) {
        return { valid: false, reason: 'missing_ration_card_key_fields' };
      }
      break;
  }

  return { valid: true };
}

// ─── Persistent PaddleOCR Process Singleton ──────────────────────────────────

type PendingRequest = { resolve: (val: string) => void; reject: (err: Error) => void };

class PaddleOCRProcess {
  private proc: ChildProcessWithoutNullStreams | null = null;
  private queue: PendingRequest[] = [];
  private buffer = '';
  private ready = false;
  private available = false;
  private emitter = new EventEmitter();
  private warmupPromise: Promise<void> | null = null;

  warmUp(timeoutMs = 25_000): Promise<void> {
    if (this.isReady()) return Promise.resolve();
    if (this.warmupPromise) return this.warmupPromise;

    this.warmupPromise = new Promise<void>((resolve) => {
      const scriptPath = path.join(__dirname, 'paddle_server.py');

      if (!fs.existsSync(scriptPath)) {
        logger.warn('[PaddleOCR] paddle_server.py not found — OCR fallback unavailable.');
        resolve();
        return;
      }

      let settled = false;
      const settle = () => { if (!settled) { settled = true; resolve(); } };

      try {
        this.proc = spawn('python', [scriptPath], { stdio: ['pipe', 'pipe', 'pipe'] });
      } catch {
        logger.warn('[PaddleOCR] Python not found — OCR fallback unavailable.');
        settle();
        return;
      }

      const timeout = setTimeout(() => {
        logger.warn(`[PaddleOCR] Warm-up timed out after ${timeoutMs}ms.`);
        this.available = false;
        settle();
      }, timeoutMs);

      this.proc.stdout.on('data', (chunk: Buffer) => {
        this.buffer += chunk.toString();
        const lines = this.buffer.split('\n');
        this.buffer = lines.pop() ?? '';

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const msg = JSON.parse(line);

            if (msg.status === 'ready') {
              this.ready = true;
              this.available = true;
              clearTimeout(timeout);
              logger.info('[PaddleOCR] ✅ Warm-up complete — OCR engine ready.');
              this.emitter.emit('ready');
              settle();
              continue;
            }
            if (msg.status === 'unavailable') {
              this.available = false;
              clearTimeout(timeout);
              logger.warn('[PaddleOCR] Engine unavailable:', msg.error);
              settle();
              continue;
            }

            const pending = this.queue.shift();
            if (pending) {
              if (msg.error) pending.reject(new Error(msg.error));
              else pending.resolve(JSON.stringify(msg));
            }
          } catch {
            // Ignore non-JSON output
          }
        }
      });

      this.proc.stderr.on('data', (d: Buffer) => {
        const txt = d.toString();
        if (txt.includes('Error') || txt.includes('error')) {
          logger.error('[PaddleOCR stderr]', txt.trim());
        }
      });

      this.proc.on('exit', (code) => {
        logger.warn(`[PaddleOCR] Process exited (code ${code}). Auto-restarting in 3 s...`);
        this.ready = false;
        for (const p of this.queue) p.reject(new Error('PaddleOCR process exited'));
        this.queue = [];
        setTimeout(() => { if (this.available) this.warmUp(); }, 3_000);
        settle();
      });

      this.proc.on('error', (err) => {
        logger.warn('[PaddleOCR] Failed to spawn:', err.message);
        this.available = false;
        clearTimeout(timeout);
        settle();
      });
    }).finally(() => {
      this.warmupPromise = null;
    });

    return this.warmupPromise;
  }

  isReady(): boolean {
    return this.ready && this.available;
  }

  async waitForReady(timeoutMs = 5000): Promise<boolean> {
    if (this.isReady()) return true;
    if (!this.proc) return false;
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(this.isReady()), timeoutMs);
      this.emitter.once('ready', () => {
        clearTimeout(timer);
        resolve(true);
      });
    });
  }

  query(
    imagePath: string,
    timeoutMs = 20_000
  ): Promise<{ confidence: number; text: string }> {
    return new Promise((resolve, reject) => {
      if (!this.proc || !this.available || !this.ready) {
        reject(new Error('PaddleOCR process is not ready'));
        return;
      }

      let settled = false;

      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        reject(new Error(`PaddleOCR query timed out after ${timeoutMs}ms`));
      }, timeoutMs);

      const pending: PendingRequest = {
        resolve: (raw) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);

          try {
            const parsed = JSON.parse(raw);
            resolve({
              confidence: Number(parsed.confidence) || 0,
              text: String(parsed.text || ''),
            });
          } catch {
            reject(new Error('Invalid JSON response from PaddleOCR'));
          }
        },
        reject: (error) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          reject(error);
        },
      };

      this.queue.push(pending);

      try {
        this.proc.stdin.write(JSON.stringify({ path: imagePath }) + '\n');
      } catch (error: any) {
        pending.reject(
          new Error(
            `Failed to send request to PaddleOCR: ${error?.message || String(error)}`
          )
        );
      }
    });
  }
}

export const paddleOCR = new PaddleOCRProcess();

// ─── Single & Batch Extraction Results Interfaces ─────────────────────────────

export interface DocumentExtractionResult {
  fileIndex: number;
  docType: string;
  fields: IDocumentField[];
  needsReview: boolean;
  usedFallback: boolean;
  fallbackReason?: string | null;
  geminiMs?: number;
  paddleMs?: number;
  validationMs?: number;
}

export interface FileBatchItem {
  fileIndex: number;
  pageImages: string[];
}


type CachedExtraction = {
  expiresAt: number;
  result: ExtractedDocResult;
};

const extractionCache = new Map<string, CachedExtraction>();

function hashPageImages(pageImages: string[]): string {
  const hash = createHash('sha256');
  for (const imagePath of pageImages) hash.update(fs.readFileSync(imagePath));
  return hash.digest('hex');
}

function readCachedExtraction(key: string): ExtractedDocResult | null {
  const cached = extractionCache.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    extractionCache.delete(key);
    return null;
  }
  return cached.result;
}

function writeCachedExtraction(key: string, result: ExtractedDocResult): void {
  while (extractionCache.size >= config.extraction.cacheMaxItems) {
    const oldest = extractionCache.keys().next().value as string | undefined;
    if (!oldest) break;
    extractionCache.delete(oldest);
  }
  extractionCache.set(key, {
    expiresAt: Date.now() + config.extraction.cacheTtlMinutes * 60_000,
    result,
  });
}

/**
 * Extracts data for ALL uploaded documents in a single batched Gemini API call.
 * Falls back to PaddleOCR for individual documents if Gemini fails or returns unreadable output.
 */
export async function extractBatchDocumentFields(
  fileBatch: FileBatchItem[]
): Promise<Map<number, DocumentExtractionResult>> {
  const resultMap = new Map<number, DocumentExtractionResult>();
  const cacheKeys = new Map<number, string>();
  const uncachedItems: FileBatchItem[] = [];
  const batchGeminiResult = new Map<number, ExtractedDocResult>();

  let geminiMs = 0;
  let validationMs = 0;
  let geminiFailed = false;
  let geminiFailureReason: string | null = null;

  for (const item of fileBatch) {
    const key = hashPageImages(item.pageImages);
    cacheKeys.set(item.fileIndex, key);

    const cached = readCachedExtraction(key);
    if (cached) {
      batchGeminiResult.set(item.fileIndex, { ...cached, fileIndex: item.fileIndex });
      logger.info('[Extraction] Cache hit', { fileIndex: item.fileIndex });
    } else {
      uncachedItems.push(item);
    }
  }

  if (uncachedItems.length > 0) {
    try {
      const geminiStart = Date.now();
      const rawBatchResult = await extractBatchWithGemini(
        uncachedItems,
        config.extraction.geminiTimeoutMs
      );
      geminiMs = Date.now() - geminiStart;

      const validationStart = Date.now();
      const parsedBatch = parseGeminiBatch(rawBatchResult);
      validationMs = Date.now() - validationStart;

      if (parsedBatch.rejected.length > 0) {
        logger.warn('[Extraction] Some Gemini documents were rejected, but valid documents were preserved', {
          rejected: parsedBatch.rejected,
        });
      }

      for (const docResult of parsedBatch.documents) {
        const expected = uncachedItems.some(item => item.fileIndex === docResult.fileIndex);
        if (!expected) {
          logger.warn('[Extraction] Ignoring Gemini result with an unexpected fileIndex', {
            fileIndex: docResult.fileIndex,
          });
          continue;
        }

        batchGeminiResult.set(docResult.fileIndex, docResult);
        const cacheKey = cacheKeys.get(docResult.fileIndex);
        if (cacheKey) writeCachedExtraction(cacheKey, docResult);
      }
    } catch (error: any) {
      geminiFailed = true;

      const message =
        error?.message ||
        error?.response?.data?.error?.message ||
        String(error);

      const status =
        error?.status ||
        error?.response?.status ||
        error?.cause?.status ||
        null;

      geminiFailureReason = message;

      logger.error('[Gemini] Batch extraction failed', {
        message,
        status,
        model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
        hasApiKey: Boolean(process.env.GEMINI_API_KEY),
      });
    }
  }

  const fallbackItems: FileBatchItem[] = [];

  for (const item of fileBatch) {
    const geminiDoc = batchGeminiResult.get(item.fileIndex);

    if (geminiDoc) {
      const qualityCheck = validateExtractionQuality(geminiDoc);
      if (qualityCheck.valid) {
        resultMap.set(item.fileIndex, {
          fileIndex: item.fileIndex,
          docType: geminiDoc.docType,
          fields: geminiDoc.fields as IDocumentField[],
          needsReview: geminiDoc.needsReview ?? false,
          usedFallback: false,
          geminiMs,
          validationMs,
        });
        continue;
      }

      logger.warn('[Extraction] Gemini result failed quality validation', {
        fileIndex: item.fileIndex,
        reason: qualityCheck.reason,
        returnedKeys: geminiDoc.fields.map(field => field.fieldKey),
      });
    }

    fallbackItems.push(item);
  }

  // Run at most two PaddleOCR jobs at once. This avoids fully sequential fallback
  // while preventing several Python OCR jobs from exhausting RAM/CPU.
  const fallbackResults = await mapWithConcurrency(fallbackItems, 2, async (item) => {
    const paddleStart = Date.now();
    const paddleResult = await extractWithPaddleOCR(item.pageImages);
    const paddleMs = Date.now() - paddleStart;

    return {
      item,
      paddleResult,
      paddleMs,
    };
  });

  for (const { item, paddleResult, paddleMs } of fallbackResults) {
    resultMap.set(item.fileIndex, {
      fileIndex: item.fileIndex,
      docType: paddleResult.docType,
      fields: paddleResult.fields,
      needsReview: true,
      usedFallback: true,
      fallbackReason: geminiFailed
        ? `batch_gemini_failed:${geminiFailureReason ?? 'unknown'}`
        : 'gemini_missing_or_quality_failed',
      geminiMs,
      validationMs,
      paddleMs,
    });
  }

  logger.info('[Extraction] Batch metrics', {
    files: fileBatch.length,
    geminiMs,
    validationMs,
    fallbackCount: fallbackItems.length,
    totalReturned: resultMap.size,
  });

  return resultMap;
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];

  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runners = Array.from(
    { length: Math.min(Math.max(1, concurrency), items.length) },
    async () => {
      while (true) {
        const current = nextIndex++;
        if (current >= items.length) return;
        results[current] = await worker(items[current]);
      }
    }
  );

  await Promise.all(runners);
  return results;
}

// ─── Gemini Batch API Implementation ──────────────────────────────────────────

async function extractBatchWithGemini(
  fileBatch: FileBatchItem[],
  timeoutMs = config.extraction.geminiTimeoutMs
): Promise<BatchExtractedResult> {
  if (!process.env.GEMINI_API_KEY) {
    throw new Error('GEMINI_API_KEY is not set');
  }

  const model = genAI.getGenerativeModel({
    model: process.env.GEMINI_MODEL || 'gemini-3.6-flash',
    generationConfig: {
      responseMimeType: 'application/json',
      temperature: 0,
    },
    // Identity documents contain PII (names, numbers, dates) that Gemini's
    // default safety filters can flag as sensitive content, causing a SAFETY
    // error before any extraction occurs. We disable the two categories that
    // fire on structured PII. HARM_CATEGORY_SEXUALLY_EXPLICIT and
    // HARM_CATEGORY_HATE_SPEECH intentionally keep their default thresholds.
    safetySettings: [
      {
        category: HarmCategory.HARM_CATEGORY_DANGEROUS_CONTENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
      {
        category: HarmCategory.HARM_CATEGORY_HARASSMENT,
        threshold: HarmBlockThreshold.BLOCK_NONE,
      },
    ],
  });

  const prompt = `
You are a high-speed, multi-document OCR extraction engine for Indian identity documents.
You will be provided with images corresponding to multiple separate documents.
Examine each document carefully and extract all printed text into structured JSON.

Supported docType values: aadhaar, pan, voter_id, driving_licence, birth_certificate, passport, marksheet, ration_card, unknown.

JSON Response Format:
{
  "documents": [
    {
      "fileIndex": 0,
      "docType": "<supported docType>",
      "fields": [
        {
          "fieldKey": "<fieldKey>",
          "label": "<Human Readable Label>",
          "value": "<exact printed value>",
          "type": "string or date or number",
          "page": 1,
          "confidence": 0.95,
          "evidenceText": "<snippet>"
        }
      ],
      "needsReview": false
    }
  ]
}

Rules:
- Extract data for EACH document present in the input array.
- "fileIndex" MUST match the index specified for each document (0, 1, 2, ...).
- Only extract VISIBLE printed text. Do not guess, infer, calculate, complete, or hallucinate.
- Set confidence below 0.6 if text is unclear.
- Never calculate date_of_birth from age.
- If only age is visible, use fieldKey "age" or "member_age_N"; never use "dob".
- Use "dob" only when an explicit date, month-year, or year of birth is visibly printed.
- If only a year of birth is visible, set incomplete=true.
- For ration cards, use docType "ration_card".
- For ration cards, use "ration_card_number", "head_of_family_name", "member_name_N", "member_age_N", and "member_relation_N".
- Never map a household head or ration-card member automatically to "full_name".
- For signature, thumb impression, fingerprint, and photograph, return presence only: "Detected" or "Not detected".
- Never transcribe handwriting from a signature as a person's name.
- Do not output duplicate entries for the same field on the same document.
  `;

  // Build multimodal contents payload with document index headers
  const contentParts: any[] = [prompt];

  for (const item of fileBatch) {
    contentParts.push(`\n--- DOCUMENT FILE INDEX: ${item.fileIndex} ---`);
    for (const imgPath of item.pageImages) {
      const fileData = fs.readFileSync(imgPath);
      contentParts.push({
        inlineData: {
          data: fileData.toString('base64'),
          mimeType: 'image/jpeg',
        },
      });
    }
  }

  let timeoutHandle: NodeJS.Timeout | undefined;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(
      () => reject(new Error(`GEMINI_TIMEOUT: Batch request timed out after ${timeoutMs}ms`)),
      timeoutMs
    );
  });

  try {
    const requestStartedAt = Date.now();

    logger.info('[Gemini] Starting extraction', {
      model: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
      documents: fileBatch.length,
      pages: fileBatch.reduce((sum, item) => sum + item.pageImages.length, 0),
    });

    const result = await Promise.race([
      model.generateContent(contentParts),
      timeoutPromise,
    ]);

    const responseText = result.response.text().trim();

    logger.info('[Gemini] Extraction completed', {
      elapsedMs: Date.now() - requestStartedAt,
      responseLength: responseText.length,
    });
    if (!responseText) throw new Error('Gemini returned an empty response');

    try {
      return JSON.parse(responseText);
    } catch {
      const jsonStart = responseText.indexOf('{');
      const jsonEnd = responseText.lastIndexOf('}');
      if (jsonStart === -1 || jsonEnd <= jsonStart) {
        throw new Error(`Gemini returned non-JSON output: ${responseText.slice(0, 200)}`);
      }
      return JSON.parse(responseText.slice(jsonStart, jsonEnd + 1));
    }
  } finally {
    if (timeoutHandle) clearTimeout(timeoutHandle);
  }
}

// ─── Single File Fallback Implementation for PaddleOCR ───────────────────────

async function extractWithPaddleOCR(
  pageImages: string[]
): Promise<{
  docType: string;
  fields: IDocumentField[];
  needsReview: boolean;
}> {
  try {
    if (!paddleOCR.isReady()) {
      await paddleOCR.warmUp(25_000);
    }

    if (!paddleOCR.isReady()) {
      throw new Error('PaddleOCR did not become ready within 25 seconds');
    }

    let combinedText = '';
    let totalConf = 0;
    let pageCount = 0;

    for (const imgPath of pageImages) {
      let queryPath = imgPath;
      let tempPng: string | null = null;

      if (!imgPath.endsWith('.jpg') && !imgPath.endsWith('.png') && !imgPath.endsWith('.jpeg')) {
        tempPng = imgPath + '.png';
        await sharp(imgPath).png().toFile(tempPng);
        queryPath = tempPng;
      }

      try {
        const pageStartedAt = Date.now();

        logger.info('[PaddleOCR] Starting page extraction', {
          image: path.basename(queryPath),
        });

        const ocrResult = await paddleOCR.query(queryPath, 20_000);

        logger.info('[PaddleOCR] Page extraction completed', {
          image: path.basename(queryPath),
          elapsedMs: Date.now() - pageStartedAt,
          textLength: ocrResult.text.length,
          confidence: ocrResult.confidence,
        });

        combinedText += ' ' + ocrResult.text;
        totalConf += ocrResult.confidence;
        pageCount++;
      } finally {
        if (tempPng) {
          try { fs.unlinkSync(tempPng); } catch { /* ignore */ }
        }
      }
    }

    const normalizedText = combinedText.replace(/\n/g, ' ').replace(/\s+/g, ' ').toUpperCase();
    const overallConfidence = pageCount > 0 ? Math.max(0, Math.min(1, totalConf / pageCount)) : 0;
    const needsReview = overallConfidence < 0.6;

    let docType = 'unknown';
    if (
      normalizedText.includes('INCOME TAX DEPARTMENT') ||
      normalizedText.includes('GOVT. OF INDIA') ||
      /[A-Z]{5}[0-9]{4}[A-Z]{1}/.test(normalizedText)
    ) {
      docType = 'pan';
    } else if (
      normalizedText.includes('GOVERNMENT OF INDIA') ||
      /UNIQUE IDENTIFICATION AUTHORITY/.test(normalizedText) ||
      /\d{4}\s\d{4}\s\d{4}/.test(normalizedText) ||
      (normalizedText.includes('DOB') && (normalizedText.includes('MALE') || normalizedText.includes('FEMALE')))
    ) {
      docType = 'aadhaar';
    } else if (
      normalizedText.includes('RATION CARD') ||
      normalizedText.includes('PUBLIC DISTRIBUTION SYSTEM') ||
      normalizedText.includes('NATIONAL FOOD SECURITY') ||
      normalizedText.includes('NFSA')
    ) {
      docType = 'ration_card';
    } else if (
      normalizedText.includes('DRIVING LICENSE') ||
      normalizedText.includes('DRIVING LICENCE') ||
      normalizedText.includes('MOTOR VEHICLES ACT') ||
      /\b[A-Z]{2}\d{2}\s*\d{6,}\b/.test(normalizedText)
    ) {
      docType = 'driving_licence';
    }

    const fields: IDocumentField[] = [];

    let idMatch = null;
    let idKey = '';
    let idLabel = '';

    if (docType === 'aadhaar') {
      idMatch = normalizedText.match(/\b\d{4}\s\d{4}\s\d{4}\b/);
      if (idMatch) {
        idKey = 'aadhaar_no';
        idLabel = 'Aadhaar Number';
      }
    } else if (docType === 'pan') {
      idMatch = normalizedText.match(/\b[A-Z]{5}[0-9]{4}[A-Z]{1}\b/);
      if (idMatch) {
        idKey = 'pan_no';
        idLabel = 'PAN Number';
      }
    } else if (docType === 'driving_licence') {
      // Standard Indian DL number: two-letter state code + 2-digit RTO + up to 11 digits
      // e.g. MH12 20190045678 or KA05 20150012345
      idMatch = normalizedText.match(/\b[A-Z]{2}\d{2}\s*\d+\b/);
      if (idMatch) {
        idKey = 'dl_no';
        idLabel = 'License No';
      }
    }

    if (idMatch && idKey) {
      fields.push({
        fieldKey: idKey,
        label: idLabel,
        value: idMatch[0],
        normalized: '',
        type: 'string',
        page: 1,
        confidence: overallConfidence,
        evidenceText: idMatch[0],
      });
    }

    const dobMatch = normalizedText.match(
      /(?:DOB|DATE OF BIRTH|YEAR OF BIRTH)\s*[:\-]?\s*(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{4}|\d{4})/
    );

    if (dobMatch) {
      fields.push({
        fieldKey: 'dob',
        label: dobMatch[1].length === 4 ? 'Year of Birth' : 'Date of Birth',
        value: dobMatch[1],
        normalized: '',
        type: 'date',
        page: 1,
        confidence: overallConfidence,
        evidenceText: dobMatch[0],
        incomplete: dobMatch[1].length === 4,
      });
    }

    const genderMatch = normalizedText.match(/\b(MALE|FEMALE|TRANSGENDER)\b/);
    if (genderMatch) {
      fields.push({
        fieldKey: 'gender',
        label: 'Gender',
        value: genderMatch[0],
        normalized: '',
        type: 'string',
        page: 1,
        confidence: overallConfidence,
        evidenceText: genderMatch[0],
      });
    }

    let nameValue = '';
    if (docType === 'pan') {
      const match = normalizedText.match(/INCOME TAX DEPARTMENT\s+(.*?)\s+(FATHER|DATE|\d{2}\/\d{2})/);
      if (match && match[1]) nameValue = match[1];
    } else if (docType === 'aadhaar') {
      // Attempt 1: Explicit "NAME:" label (handles crops and newer card layouts)
      let match = normalizedText.match(/NAME\s*[:\-]?\s*([A-Z][A-Z\s]{2,})(?=\s+(?:MALE|FEMALE|DOB|YEAR|\d{2}\/|\n))/);

      // Attempt 2: Classic header boundary (full-card layouts)
      if (!match) {
        match = normalizedText.match(/GOVERNMENT OF INDIA\s+(.*?)\s+(DOB|YEAR OF BIRTH|\d{2}\/\d{2})/);
      }

      if (match && match[1]) nameValue = match[1].trim();
    } else if (docType === 'driving_licence') {
      // DL cards typically print the name after a NAME label and before DOB or the date fields
      const match = normalizedText.match(/NAME\s*[:\-]?\s*([A-Z][A-Z\s]{2,})(?=\s+(?:DATE|DOB|S\/O|D\/O|W\/O|\d{2}[\-\/]))/);
      if (match && match[1]) nameValue = match[1].trim();
    }

    if (nameValue) {
      nameValue = nameValue
        .replace(/GOVERNMENT OF INDIA|GOVT\. OF INDIA|INCOME TAX DEPARTMENT/gi, '')
        .replace(/[^a-zA-Z\s]/g, '')
        .trim();

      if (nameValue.length > 3) {
        fields.push({
          fieldKey: 'full_name',
          label: 'Name',
          value: nameValue,
          normalized: '',
          type: 'string',
          page: 1,
          confidence: overallConfidence,
          evidenceText: nameValue,
        });
      }
    }

    return {
      docType,
      fields,
      needsReview,
    };
  } catch (error) {
    logger.error('[Extraction] PaddleOCR Error:', error);
    return {
      docType: 'unknown',
      fields: [],
      needsReview: true,
    };
  }
}

// Single-file helper for unit tests or standalone document extraction
export async function extractDocumentFields(pageImages: string[], mimeType: string) {
  const batchRes = await extractBatchDocumentFields([{ fileIndex: 0, pageImages }]);
  const res = batchRes.get(0)!;
  return {
    docType: res.docType,
    fields: res.fields,
    needsReview: res.needsReview,
    usedFallback: res.usedFallback,
    fallbackReason: res.fallbackReason,
    geminiMs: res.geminiMs,
    paddleMs: res.paddleMs,
    validationMs: res.validationMs,
  };
}