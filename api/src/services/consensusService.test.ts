import assert from 'assert';
import { runConsensusEngine } from './consensusService';
import type { IDocument } from '../models/store';

function doc(id: string, type: string, value: string | null, confidence = 0.9): IDocument {
  return { _id: id, userId: 'user', docType: type, title: type, status: 'ready', originalFilename: `${id}.json`, storedFilename: `${id}.json`, contentType: 'application/json', size: 1, needsReview: false, createdAt: new Date(), extractedFields: value === null ? [] : [{ fieldKey: 'dob', label: 'Date of Birth', value, normalized: value, type: 'date', page: 1, confidence, evidenceText: '' }] };
}

// 1. Array index access updated to target .fieldResults
let result = runConsensusEngine([doc('a', 'aadhaar', '12/05/2005'), doc('b', 'pan', '2005-05-12')]);
assert.equal(result.fieldResults[0].status, 'consistent');

result = runConsensusEngine([doc('a', 'aadhaar', '2005'), doc('b', 'birth_certificate', '12/05/2005')]);
assert.equal(result.fieldResults[0].status, 'possible_variant');
assert.equal(result.fieldResults[0].scenario, 'year_only_same_year');

result = runConsensusEngine([doc('a', 'aadhaar', '12/05/2005'), doc('b', 'pan', '13/05/2005')]);
assert.equal(result.fieldResults[0].status, 'conflicting_evidence');

// 2. 'not_comparable' tests updated to check the existence router
result = runConsensusEngine([doc('a', 'aadhaar', '12/05/2005'), doc('b', 'pan', null)]);
assert.equal(result.fieldResults.length, 0); // No consensus matrix entry
assert.equal(result.documentSpecificFields[0].value, '12/05/2005'); // Routed to metadata

result = runConsensusEngine([doc('a', 'aadhaar', '12/05/2005'), doc('b', 'pan', '13/05/2005', 0.3)]);
assert.equal(result.fieldResults.length, 0);
assert.equal(result.documentSpecificFields[0].value, '12/05/2005');

// 3. Aadhaar Verhoeff failure produces 'extraction_invalid', not 'conflicting_evidence', even when other documents agree
function docWithField(id: string, type: string, fieldKey: string, label: string, value: string, confidence = 0.9): IDocument {
  return {
    _id: id,
    userId: 'user',
    docType: type,
    title: type,
    status: 'ready',
    originalFilename: `${id}.json`,
    storedFilename: `${id}.json`,
    contentType: 'application/json',
    size: 1,
    needsReview: false,
    createdAt: new Date(),
    extractedFields: [{ fieldKey, label, value, normalized: value, type: 'string', page: 1, confidence, evidenceText: '' }],
  };
}

const validAadhaar = '999941057058';
const invalidAadhaar = '999941057059';

result = runConsensusEngine([
  docWithField('doc1', 'aadhaar', 'aadhaar_number', 'Aadhaar Number', validAadhaar),
  docWithField('doc2', 'e_aadhaar', 'aadhaar_number', 'Aadhaar Number', validAadhaar),
  docWithField('doc3', 'voter_slip', 'aadhaar_number', 'Aadhaar Number', invalidAadhaar),
]);

const aadhaarField = result.fieldResults.find((f) => f.fieldKey === 'aadhaar_number');
assert(aadhaarField, 'Aadhaar field result should exist');
assert.equal(
  aadhaarField.status,
  'extraction_invalid',
  'Aadhaar with bad checksum must be extraction_invalid, not conflicting_evidence'
);
assert.notEqual(aadhaarField.status, 'conflicting_evidence');

console.log('Consensus specification tests passed.');