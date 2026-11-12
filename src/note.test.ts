import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addsTask, emptyPage, localDate } from './note.ts';

test('uses the local day around UTC midnight', () => {
  const date = new Date(2026, 10, 12, 0, 5);
  assert.equal(localDate(date), '2026-11-12');
  const page = emptyPage(localDate(date));
  assert.equal(page.left.title, '회사 일');
  assert.equal(page.right.title, '나의 일');
  assert.notEqual(page.left.tasks[0].id, page.right.tasks[0].id);
});

test('Enter adds a task only after Korean composition ends; Shift+Enter stays a newline', () => {
  const event = { key: 'Enter', shiftKey: false, isComposing: false, keyCode: 13 };
  assert.equal(addsTask(event), true);
  assert.equal(addsTask({ ...event, isComposing: true }), false);
  assert.equal(addsTask({ ...event, keyCode: 229 }), false);
  assert.equal(addsTask({ ...event, shiftKey: true }), false);
});
