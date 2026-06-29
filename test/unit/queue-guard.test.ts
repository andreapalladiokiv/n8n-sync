import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertQueueMode } from '../../src/incontainer/engine';

test('queue-guard: passes only in queue mode', () => {
  assert.doesNotThrow(() => assertQueueMode('queue'), 'queue mode must pass');
});

test('queue-guard: rejects every non-queue mode (incl. unset)', () => {
  for (const mode of ['regular', 'REGULAR', 'main', '', undefined] as Array<string | undefined>) {
    assert.throws(() => assertQueueMode(mode), /queue mode/i, `mode '${mode}' must be rejected`);
  }
});

test('queue-guard: error names the actual mode (regular for unset)', () => {
  assert.throws(() => assertQueueMode(undefined), /'regular'/, "unset mode reported as 'regular'");
  assert.throws(() => assertQueueMode('main'), /'main'/, 'reports the offending mode verbatim');
});
