import { test } from 'node:test';
import assert from 'node:assert/strict';
import { folderSegment, buildFolderPath } from '../../src/folders';

test('folderSegment: "Name - (id)", slashes flattened', () => {
  assert.equal(folderSegment('Main', 'EJH'), 'Main - (EJH)');
  assert.equal(folderSegment('A/B', 'id1'), 'A-B - (id1)');
  assert.equal(folderSegment('Data Pipelines & Reporting', 'p'), 'Data Pipelines & Reporting - (p)');
});

test('buildFolderPath: nested, root, null, unknown', () => {
  const names = new Map([['root', 'Main'], ['child', 'Trigger']]);
  const parents = new Map<string, string | null>([['root', null], ['child', 'root']]);
  assert.equal(buildFolderPath('child', names, parents), 'Main - (root)/Trigger - (child)');
  assert.equal(buildFolderPath('root', names, parents), 'Main - (root)');
  assert.equal(buildFolderPath(null, names, parents), '');
  assert.equal(buildFolderPath('unknown', names, parents), '');
});

test('buildFolderPath: terminates on a parentFolderId cycle (no infinite loop)', () => {
  const names = new Map([['a', 'A'], ['b', 'B']]);
  const parents = new Map<string, string | null>([['a', 'b'], ['b', 'a']]);
  const p = buildFolderPath('a', names, parents);
  assert.ok(p.includes('A - (a)') && p.includes('B - (b)'));
  assert.equal(p.split('/').length, 2, 'each folder appears once');
});
