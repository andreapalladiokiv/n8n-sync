import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDebouncedRunner } from '../../src/incontainer/scheduler';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

test('scheduler: a burst coalesces into ONE run, serialized; a later trigger re-fires', async () => {
  const log: string[] = [];
  const run = async (): Promise<void> => { log.push('start'); await delay(200); log.push('end'); };
  const runner = makeDebouncedRunner(run, 200);

  for (let i = 0; i < 6; i++) runner.schedule(); // burst of 6 rapid triggers
  await delay(80);
  runner.schedule(); runner.schedule();           // more triggers inside the debounce window
  await delay(700);                               // let the single coalesced run finish
  assert.equal(log.filter((l) => l === 'start').length, 1, `burst must coalesce into 1 run; got ${log}`);

  runner.schedule();                              // a trigger AFTER the first run finished
  await delay(700);
  assert.equal(log.filter((l) => l === 'start').length, 2, `later trigger must re-fire; got ${log}`);
  // serialized: starts and ends strictly alternate (no overlap)
  assert.deepEqual(log, ['start', 'end', 'start', 'end'], `runs must not overlap; got ${log}`);
});

test('scheduler: a trigger arriving DURING a run schedules exactly one follow-up', async () => {
  const log: string[] = [];
  const run = async (): Promise<void> => { log.push('s'); await delay(150); log.push('e'); };
  const runner = makeDebouncedRunner(run, 50);
  runner.schedule();
  await delay(80);          // run #1 is now in flight (s logged, mid-delay)
  runner.schedule();        // arrives during the run → must re-fire once after it settles
  runner.schedule();        // coalesced into the same follow-up
  await delay(400);
  assert.deepEqual(log, ['s', 'e', 's', 'e'], `exactly one follow-up run; got ${log}`);
});
