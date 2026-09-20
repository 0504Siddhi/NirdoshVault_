import assert from 'assert';
import {
  isTransientGeminiError,
  executeGeminiWithRetry,
  extractBatchWithGemini,
  setGenerativeModelForTesting,
} from './extractionService';

async function runRetryTests(): Promise<void> {
  console.log('--- Running Gemini Transient Retry Unit Tests ---');

  // Test 1: isTransientGeminiError identifies transient vs non-transient status codes
  assert.strictEqual(isTransientGeminiError({ status: 503 }), true, 'status 503 should be transient');
  assert.strictEqual(isTransientGeminiError({ status: 429 }), true, 'status 429 should be transient');
  assert.strictEqual(isTransientGeminiError({ response: { status: 503 } }), true, 'response.status 503 should be transient');
  assert.strictEqual(isTransientGeminiError({ response: { status: 429 } }), true, 'response.status 429 should be transient');
  assert.strictEqual(isTransientGeminiError({ cause: { status: 503 } }), true, 'cause.status 503 should be transient');
  assert.strictEqual(isTransientGeminiError({ message: '503 Service Unavailable: High demand' }), true, '503 message should be transient');
  assert.strictEqual(isTransientGeminiError({ message: 'Resource exhausted (e.g. check quota, rate limit)' }), true, 'rate limit message should be transient');

  // Test 2: isTransientGeminiError does NOT trigger on non-transient errors (401, 403, 400, 404)
  assert.strictEqual(isTransientGeminiError({ status: 401 }), false, 'status 401 must not be transient');
  assert.strictEqual(isTransientGeminiError({ status: 403 }), false, 'status 403 must not be transient');
  assert.strictEqual(isTransientGeminiError({ status: 400 }), false, 'status 400 must not be transient');
  assert.strictEqual(isTransientGeminiError({ status: 404 }), false, 'status 404 must not be transient');
  assert.strictEqual(isTransientGeminiError({ message: 'API_KEY_INVALID: API key not valid' }), false, 'invalid api key must not be transient');
  assert.strictEqual(isTransientGeminiError({ message: '401 Unauthorized' }), false, '401 Unauthorized must not be transient');
  assert.strictEqual(isTransientGeminiError({ message: '403 Forbidden: Permission denied' }), false, '403 Forbidden must not be transient');

  console.log('  ✓ isTransientGeminiError classification tests passed');

  // Test 3: Retry on 503 twice, succeeds on third attempt (2 retries, 3 total calls)
  let calls503 = 0;
  const mockFn503 = async () => {
    calls503++;
    if (calls503 < 3) {
      const err: any = new Error('503 Service Unavailable: High demand, temporary, try again later');
      err.status = 503;
      throw err;
    }
    return { success: true, attempts: calls503 };
  };

  const result503 = await executeGeminiWithRetry(mockFn503, {
    maxRetries: 2,
    delaysMs: [5, 10], // short delays for fast test execution
  });

  assert.strictEqual(calls503, 3, 'executeGeminiWithRetry should have attempted 3 times (2 retries)');
  assert.strictEqual(result503.success, true);
  assert.strictEqual(result503.attempts, 3);
  console.log('  ✓ 503 retry twice then succeed test passed (called 3 times)');

  // Test 4: Retry on 429 rate limit error
  let calls429 = 0;
  const mockFn429 = async () => {
    calls429++;
    if (calls429 === 1) {
      const err: any = new Error('429 Too Many Requests: quota exceeded');
      err.status = 429;
      throw err;
    }
    return { rateLimited: false };
  };

  const result429 = await executeGeminiWithRetry(mockFn429, {
    maxRetries: 2,
    delaysMs: [5, 10],
  });

  assert.strictEqual(calls429, 2, 'executeGeminiWithRetry should retry 429 and succeed on 2nd attempt');
  assert.strictEqual(result429.rateLimited, false);
  console.log('  ✓ 429 rate limit retry test passed');

  // Test 5: Fast-fail on non-transient 401 error (no retries, called exactly once)
  let calls401 = 0;
  const mockFn401 = async () => {
    calls401++;
    const err: any = new Error('401 Unauthorized: Invalid API key');
    err.status = 401;
    throw err;
  };

  let caught401: any = null;
  try {
    await executeGeminiWithRetry(mockFn401, {
      maxRetries: 2,
      delaysMs: [5, 10],
    });
  } catch (err) {
    caught401 = err;
  }

  assert.notStrictEqual(caught401, null, 'executeGeminiWithRetry should throw on 401');
  assert.strictEqual(caught401.status, 401);
  assert.strictEqual(calls401, 1, 'executeGeminiWithRetry must NOT retry 401 auth errors (must fail fast on attempt 1)');
  console.log('  ✓ 401 fast-fail test passed (called exactly 1 time)');

  // Test 6: Fast-fail on non-transient 403 error (no retries, called exactly once)
  let calls403 = 0;
  const mockFn403 = async () => {
    calls403++;
    const err: any = new Error('403 Forbidden: Permission denied');
    err.status = 403;
    throw err;
  };

  let caught403: any = null;
  try {
    await executeGeminiWithRetry(mockFn403, {
      maxRetries: 2,
      delaysMs: [5, 10],
    });
  } catch (err) {
    caught403 = err;
  }

  assert.notStrictEqual(caught403, null, 'executeGeminiWithRetry should throw on 403');
  assert.strictEqual(caught403.status, 403);
  assert.strictEqual(calls403, 1, 'executeGeminiWithRetry must NOT retry 403 permission errors');
  console.log('  ✓ 403 fast-fail test passed (called exactly 1 time)');

  // Test 7: Exhausting retries on persistent 503 throws after maxRetries
  let callsPersistent503 = 0;
  const mockFnPersistent503 = async () => {
    callsPersistent503++;
    const err: any = new Error('503 Service Unavailable: Persistent overload');
    err.status = 503;
    throw err;
  };

  let caughtPersistent503: any = null;
  try {
    await executeGeminiWithRetry(mockFnPersistent503, {
      maxRetries: 2,
      delaysMs: [5, 10],
    });
  } catch (err) {
    caughtPersistent503 = err;
  }

  assert.notStrictEqual(caughtPersistent503, null, 'should throw after exhausting retries');
  assert.strictEqual(caughtPersistent503.status, 503);
  assert.strictEqual(callsPersistent503, 3, 'initial attempt + 2 retries = 3 calls total before failing');
  console.log('  ✓ Persistent 503 exhausted retries test passed (called 3 times then threw)');

  // Test 8: Integration with extractBatchWithGemini using mocked Gemini model
  let extractAttempts = 0;
  setGenerativeModelForTesting({
    generateContent: async () => {
      extractAttempts++;
      if (extractAttempts < 3) {
        const err: any = new Error('503 High demand, temporary, try again later');
        err.status = 503;
        throw err;
      }
      return {
        response: {
          text: () => JSON.stringify({
            documents: [
              {
                fileIndex: 0,
                docType: 'aadhaar',
                fields: [
                  { fieldKey: 'aadhaar_no', label: 'Aadhaar Number', value: '1234 5678 9012', confidence: 0.95, page: 1 },
                ],
              },
            ],
          }),
        },
      };
    },
  });

  const fs = await import('fs');
  const path = await import('path');
  const os = await import('os');
  const tempImgPath = path.join(os.tmpdir(), `test_retry_${Date.now()}.jpg`);
  fs.writeFileSync(tempImgPath, Buffer.from('fake-jpeg-data'));

  try {
    const dummyBatchItem = {
      fileIndex: 0,
      pageImages: [tempImgPath],
    };

    const batchResult = await extractBatchWithGemini(
      [dummyBatchItem],
      5000,
      { delaysMs: [5, 10], maxRetries: 2 }
    );

    assert.strictEqual(extractAttempts, 3, 'extractBatchWithGemini should have retried 503 twice and succeeded on 3rd attempt');
    assert.ok(batchResult.documents.length === 1);
    assert.strictEqual(batchResult.documents[0].docType, 'aadhaar');
    console.log('  ✓ extractBatchWithGemini integration retry test passed (retried 503 and succeeded)');
  } finally {
    setGenerativeModelForTesting(null);
    try { fs.unlinkSync(tempImgPath); } catch {}
  }

  console.log('✅ All Gemini retry and resilience unit tests passed.');
}

runRetryTests().catch((error) => {
  console.error('❌ Retry unit tests failed:', error);
  process.exit(1);
});
