import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveQueue } from './save-queue.ts';
import type { SaveStatus } from './save-queue.ts';

test('serializes writes and flushes the latest edit before closing', async () => {
  const writes: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  const statuses: SaveStatus[] = [];
  const queue = new SaveQueue<string>(async value => {
    writes.push(value);
    if (value === 'first') await gate;
  }, status => statuses.push(status));
  queue.enqueue('first');
  queue.enqueue('second');
  queue.enqueue('마지막 한글');
  assert.deepEqual(writes, ['first']);
  release();
  await queue.flush();
  assert.deepEqual(writes, ['first', '마지막 한글']);
  assert.equal(statuses.at(-1)?.kind, 'saved');
});

test('keeps the latest snapshot after failure and retries without reporting success early', async () => {
  let fail = true;
  let saved = '';
  const statuses: SaveStatus[] = [];
  const queue = new SaveQueue<string>(async value => {
    if (fail) throw new Error('disk full');
    saved = value;
  }, status => statuses.push(status));
  queue.enqueue('수정 전');
  await assert.rejects(queue.flush());
  assert.equal(statuses.at(-1)?.kind, 'error');
  queue.enqueue('최신 메모');
  await assert.rejects(queue.flush());
  fail = false;
  await queue.flush();
  assert.equal(saved, '최신 메모');
  assert.equal(statuses.at(-1)?.kind, 'saved');
});

test('flush includes an edit arriving as the previous writer finishes', async () => {
  const writes: string[] = [];
  let edited = false;
  const queue = new SaveQueue<string>(async value => { writes.push(value); }, status => {
    if (status.kind === 'saved' && !edited) {
      edited = true;
      queueMicrotask(() => queue.enqueue('마지막 순간의 입력'));
    }
  });
  queue.enqueue('first');
  await queue.flush();
  assert.deepEqual(writes, ['first', '마지막 순간의 입력']);
});
