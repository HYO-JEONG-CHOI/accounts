// node tests/store.test.js — 백업 파일 검증
const assert = require('assert');
const S = require('../js/store.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

const sample = S.buildBackup(
  [{ id: 'a', date: '2026-11-02', amount: 10000, memo: '점심', createdAt: 1, updatedAt: 2 }],
  { 'M:2026-11': 400000, 'W:2026-11-W2': 0 },
  { theme: 'dark' }
);

test('내보낸 백업을 그대로 복원할 수 있음', () => {
  const p = S.parseBackup(JSON.stringify(sample));
  assert.strictEqual(p.expenses.length, 1);
  assert.strictEqual(p.expenses[0].memo, '점심');
  assert.deepStrictEqual(p.budgets, [{ key: 'M:2026-11', amount: 400000 }, { key: 'W:2026-11-W2', amount: 0 }]);
  assert.strictEqual(p.settings.theme, 'dark');
});

test('다른 파일·깨진 파일은 거부', () => {
  assert.throws(() => S.parseBackup('not json'), /형식/);
  assert.throws(() => S.parseBackup(JSON.stringify({ app: 'other', expenses: [], budgets: [] })), /아니에요/);
});

test('잘못된 금액·날짜·예산 키는 거부', () => {
  const bad = (patch) => JSON.stringify({ ...sample, ...patch });
  assert.throws(() => S.parseBackup(bad({ expenses: [{ date: '2026-11-02', amount: -5 }] })), /지출/);
  assert.throws(() => S.parseBackup(bad({ expenses: [{ date: '11/02', amount: 5 }] })), /지출/);
  assert.throws(() => S.parseBackup(bad({ expenses: [{ date: '2026-11-02', amount: 1.5 }] })), /지출/);
  assert.throws(() => S.parseBackup(bad({ budgets: [{ key: 'X:1', amount: 5 }] })), /예산/);
});

test('중복 id는 새 id로 바꿔서 모두 보존', () => {
  const p = S.parseBackup(JSON.stringify({ ...sample, expenses: [
    { id: 'x', date: '2026-11-01', amount: 1 }, { id: 'x', date: '2026-11-01', amount: 2 }
  ] }));
  assert.strictEqual(p.expenses.length, 2);
  assert.notStrictEqual(p.expenses[0].id, p.expenses[1].id);
});

console.log(`\n${passed}개 테스트 통과`);
