// node tests/calc.test.js
const assert = require('assert');
const C = require('../js/calc.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('주차는 월요일 시작, 월 날짜만 포함, 빈틈·중복 없음 (2000~2040년 전체)', () => {
  for (let y = 2000; y <= 2040; y++) for (let m = 1; m <= 12; m++) {
    const weeks = C.weeksOfMonth(y, m), n = C.daysInMonth(y, m);
    assert.ok(weeks.length >= 4 && weeks.length <= 6, `${y}-${m} 주차 수 ${weeks.length}`);
    assert.strictEqual(weeks[0].startDay, 1);
    assert.strictEqual(weeks[weeks.length - 1].endDay, n);
    weeks.forEach((w, i) => {
      if (i > 0) {
        assert.strictEqual(w.startDay, weeks[i - 1].endDay + 1);
        assert.strictEqual(C.weekday(y, m, w.startDay), 0, '월요일 시작');
      }
      if (w.endDay !== n) assert.strictEqual(C.weekday(y, m, w.endDay), 6, '일요일 끝');
      assert.ok(w.days >= 1 && w.days <= 7);
    });
  }
});

test('2026년 11월: 1일(일)만 있는 1주차 ~ 30일(월)만 있는 6주차', () => {
  const w = C.weeksOfMonth(2026, 11);
  assert.deepStrictEqual(w.map(x => [x.startDay, x.endDay]), [[1, 1], [2, 8], [9, 15], [16, 22], [23, 29], [30, 30]]);
  assert.strictEqual(w[0].key, '2026-11-W1');
});

test('2027년 2월: 1일이 월요일, 정확히 4주', () => {
  assert.deepStrictEqual(C.weeksOfMonth(2027, 2).map(x => [x.startDay, x.endDay]), [[1, 7], [8, 14], [15, 21], [22, 28]]);
});

test('윤년 2월 29일', () => {
  assert.strictEqual(C.daysInMonth(2028, 2), 29);
  assert.ok(C.isValidYmd('2028-02-29'));
  assert.ok(!C.isValidYmd('2027-02-29'));
});

test('월 이동 (연도 경계)', () => {
  assert.deepStrictEqual(C.addMonths(2026, 1, -1), { y: 2025, m: 12 });
  assert.deepStrictEqual(C.addMonths(2026, 12, 1), { y: 2027, m: 1 });
  assert.deepStrictEqual(C.addMonths(2026, 3, -15), { y: 2024, m: 12 });
});

const data = {
  expenses: [
    { date: '2026-10-31', amount: 5000 },   // 전월 (10월 마지막 주와 11월 1주차가 같은 달력 주라도 분리)
    { date: '2026-10-15', amount: 15000 },
    { date: '2026-11-01', amount: 3000 },
    { date: '2026-11-02', amount: 10000 },
    { date: '2026-11-02', amount: 2500 },   // 같은 날 여러 건
    { date: '2026-11-08', amount: 7000 },
    { date: '2026-11-30', amount: 12000 },
    { date: '2026-12-01', amount: 99999 }   // 다음 달
  ],
  budgets: { 'M:2026-11': 400000, 'W:2026-11-W2': 15000, 'W:2026-11-W3': 0 }
};

test('월별·주차별 합계는 같은 원본 데이터에서 계산되고 월 경계를 넘지 않음', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.total, 34500);
  assert.strictEqual(s.days[2], 12500);
  assert.deepStrictEqual(s.weeks.map(w => w.spent), [3000, 19500, 0, 0, 0, 12000]);
  assert.strictEqual(s.weeks.reduce((a, w) => a + w.spent, 0), s.total);
  assert.strictEqual(s.count, 5);
});

test('주차 예산: 미설정 / 0원 / 초과 구분', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.weeks[0].budget, null);
  assert.strictEqual(s.weeks[0].remaining, null);
  assert.strictEqual(s.weeks[1].remaining, -4500);
  assert.strictEqual(C.formatRate(s.weeks[1].rate), '130%');
  assert.strictEqual(s.weeks[2].budget, 0);
  assert.strictEqual(s.weeks[2].rate, 0);
  assert.strictEqual(s.weekBudgetSum, 15000);
  assert.strictEqual(s.setWeekCount, 2);
});

test('월 예산과 주차 예산은 독립, 차이만 계산', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.monthBudget, 400000);
  assert.strictEqual(s.remaining, 365500);
  assert.strictEqual(s.budgetGap, 385000);
  assert.strictEqual(data.budgets['M:2026-11'], 400000);
});

test('전월 대비, 일평균', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.prevTotal, 20000);
  assert.strictEqual(s.change, 14500);
  assert.strictEqual(Math.round(s.changeRate * 1000), 725);
  assert.strictEqual(s.elapsed, 16);
  assert.strictEqual(s.dailyAvg, 34500 / 16);
  assert.strictEqual(C.monthStats(data, 2026, 10, { y: 2026, m: 11, d: 16 }).elapsed, 31);
  assert.strictEqual(C.monthStats(data, 2027, 1, { y: 2026, m: 11, d: 16 }).dailyAvg, 0);
});

test('주차별 전주 대비 증감', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.deepStrictEqual(s.weeks.map(w => w.change), [null, 16500, -19500, 0, 0, 12000]);
});

test('데이터 없는 달은 0원', () => {
  const s = C.monthStats({ expenses: [], budgets: {} }, 2026, 5, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.total, 0);
  assert.strictEqual(s.monthBudget, null);
  assert.strictEqual(s.changeRate, null);
});

test('금액 표시', () => {
  assert.strictEqual(C.formatWon(1234567), '₩1,234,567');
  assert.strictEqual(C.formatWon(-4500), '-₩4,500');
  assert.strictEqual(C.formatCompact(98000), '98,000');
  assert.strictEqual(C.formatCompact(1250000), '125만');
});

console.log(`\n${passed}개 테스트 통과`);
