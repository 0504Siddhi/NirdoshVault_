import { Router, Response } from 'express';
import path from 'path';
import fs from 'fs';
import { v4 as uuidv4 } from 'uuid';
import { authenticate, AuthRequest } from '../middleware/auth';
import { DocumentStore, AnalysisStore } from '../models/store';
import { normalizeField } from '../services/normalizationService';
import { runConsensusEngine } from '../services/consensusService';
import { calculateIdentityResolutionConfidence } from '../scoring/identityResolutionConfidenceService';
import { buildIdentityTrustGraph } from '../services/identityTrustGraphService';
import { generateGuidance } from '../services/guidanceService';
import { generateChecklist } from '../services/checklistService';
import { AuditService } from '../services/auditService';
import logger from '../services/logger';

const router = Router();

const samplesDir = path.join(__dirname, '../samples');

interface SampleSetMeta {
  id: string;
  name: string;
  description: string;
  scenario: string;
  documents: { filename: string; label: string; docType: string }[];
}

/**
 * GET /api/v1/samples — list available sample document sets
 */
router.get('/', (_req, res: Response): void => {
  try {
    const setsPath = path.join(samplesDir, 'sets.json');
    const data = JSON.parse(fs.readFileSync(setsPath, 'utf-8'));
    res.json(data);
  } catch (err) {
    console.error('Failed to load sample sets:', err);
    res.status(500).json({ error: 'Failed to load sample sets' });
  }
});

/**
 * POST /api/v1/samples/load — load a sample set for the current user
 * Body: { setId: string }
 *
 * This creates document records with pre-extracted fields (no Gemini needed),
 * then immediately runs the consensus engine and returns the analysis.
 */
router.post('/load', authenticate, async (req: AuthRequest, res: Response): Promise<void> => {
  if (!req.user) { res.status(401).json({ error: 'Unauthorized' }); return; }

  const { setId } = req.body;
  if (!setId) { res.status(400).json({ error: 'setId is required' }); return; }

  try {
    // 1. Load set metadata
    const setsPath = path.join(samplesDir, 'sets.json');
    const { sets } = JSON.parse(fs.readFileSync(setsPath, 'utf-8'));
    const set: SampleSetMeta | undefined = sets.find((s: SampleSetMeta) => s.id === setId);

    if (!set) {
      res.status(404).json({ error: `Sample set "${setId}" not found` });
      return;
    }

    // 2. Clear existing documents for this user (fresh demo)
    const existingDocs = DocumentStore.findByUser(req.user.id);
    for (const doc of existingDocs) {
      DocumentStore.delete(doc._id);
    }

    AuditService.log(req.user.id, 'sample.load_started', { setId, setName: set.name });

    // 3. Create document records with pre-extracted fields
    const createdDocs = [];
    for (const docMeta of set.documents) {
      const fieldDataPath = path.join(samplesDir, set.id, docMeta.filename.replace(/\.\w+$/, '.json'));
      
      let extraction;
      try {
        extraction = JSON.parse(fs.readFileSync(fieldDataPath, 'utf-8'));
      } catch {
        console.error(`Missing field data for ${docMeta.filename}`);
        continue;
      }

      // Normalize fields
      const normalizedFields = extraction.fields.map((f: any) => {
        const { normalized, incomplete } = normalizeField(f.fieldKey, f.value);
        return { ...f, normalized, incomplete };
      });

      const doc = DocumentStore.create({
        userId: req.user.id,
        docType: extraction.docType || docMeta.docType,
        title: docMeta.label,
        status: 'ready',
        originalFilename: docMeta.filename,
        storedFilename: `sample-${uuidv4()}.jpg`,
        contentType: 'image/jpeg',
        size: 0,
        needsReview: extraction.needsReview || false,
        extractedFields: normalizedFields,
      });

      createdDocs.push(doc);
    }

    if (createdDocs.length < 2) {
      res.status(500).json({ error: 'Not enough sample documents could be loaded' });
      return;
    }

    // 4. Run Consensus Engine
    const engineData = runConsensusEngine(createdDocs);

    const identityResolutionConfidence =
      calculateIdentityResolutionConfidence({
        fieldResults: engineData.fieldResults,
        allComparableFieldResults:
          engineData.allComparableFieldResults ??
          engineData.fieldResults,
        documentTypes: createdDocs.map(
          (document) => document.docType
        ),
        totalUploadedDocuments: createdDocs.length,
      });

    const identityTrustGraph =
      buildIdentityTrustGraph({
        documents: createdDocs,
        fieldResults: engineData.fieldResults,
        identityResolutionConfidence,
      });

    // 5. Generate Guidance
    const guidance = await generateGuidance(engineData.fieldResults);

    // 6. Compute Summary
    const summary = engineData.summary;

    // 7. Generate checklist
    const uploadedDocTypes = createdDocs.map(d => d.docType);
    const checklist = generateChecklist(uploadedDocTypes, engineData.documentSpecificFields);

    // 8. Store Analysis
    const analysis = AnalysisStore.create({
      userId: req.user.id,
      documentIds: createdDocs.map(d => d._id),
      status: 'complete',
      fieldResults: engineData.fieldResults,
      summary: engineData.summary,
      documentSpecificFields: engineData.documentSpecificFields,
      guidance,
      checklist,
      identityResolutionConfidence,
      identityTrustGraph: identityTrustGraph ?? undefined,
    });

    AuditService.log(req.user.id, 'sample.load_completed', {
      setId,
      analysisId: analysis._id,
      documentCount: createdDocs.length,
      summary,
    });

    res.status(201).json({
      analysis,
      documents: createdDocs,
    });
  } catch (err) {
    logger.error('Failed to load sample set:', { err });
    res.status(500).json({ error: 'Failed to load sample documents' });
  }
});

export default router;







