// node tests/calc.test.js
const assert = require('assert');
const C = require('../js/calc.js');

let passed = 0;
function test(name, fn) { fn(); passed++; console.log('ok -', name); }

test('주차는 월~일 7일, 목요일이 있는 달 소속, 모든 날짜가 정확히 한 주차에 (2000~2040년 전체)', () => {
  const seen = new Map();
  let prevEnd = null;
  for (let y = 2000; y <= 2040; y++) for (let m = 1; m <= 12; m++) {
    const weeks = C.weeksOfMonth(y, m);
    assert.ok(weeks.length >= 4 && weeks.length <= 5, `${y}-${m} 주차 수 ${weeks.length}`);
    weeks.forEach((w, i) => {
      assert.strictEqual(w.index, i + 1);
      assert.strictEqual(C.weekday(w.s.y, w.s.m, w.s.d), 0, '월요일 시작');
      assert.strictEqual(C.weekday(w.e.y, w.e.m, w.e.d), 6, '일요일 끝');
      const thu = C.shiftDay(w.s.y, w.s.m, w.s.d, 3);
      assert.ok(thu.y === y && thu.m === m, '목요일이 이 달');
      assert.strictEqual(w.key, w.start);
      if (prevEnd) assert.strictEqual(w.start, C.ymd(...Object.values(C.shiftDay(prevEnd.y, prevEnd.m, prevEnd.d, 1))), '빈틈·중복 없음');
      prevEnd = w.e;
      assert.ok(!seen.has(w.key)); seen.set(w.key, `${y}-${m}`);
    });
  }
});

test('2026년 11월: 11/2~11/8부터 4주, 11/1은 10월·11/30은 12월 주차', () => {
  const w = C.weeksOfMonth(2026, 11);
  assert.deepStrictEqual(w.map(x => [x.start, x.end]), [['2026-11-02', '2026-11-08'], ['2026-11-09', '2026-11-15'], ['2026-11-16', '2026-11-22'], ['2026-11-23', '2026-11-29']]);
  assert.deepStrictEqual(C.outsideDays(2026, 11), { before: 1, after: 30, n: 30 });
  const oct = C.weeksOfMonth(2026, 10);
  assert.deepStrictEqual([oct[oct.length - 1].start, oct[oct.length - 1].end], ['2026-10-26', '2026-11-01']);
  assert.strictEqual(C.weeksOfMonth(2026, 12)[0].start, '2026-11-30');
});

test('연도 경계: 2026/12/28~2027/1/3 주는 12월 마지막 주차', () => {
  const dec = C.weeksOfMonth(2026, 12);
  assert.deepStrictEqual([dec[dec.length - 1].start, dec[dec.length - 1].end], ['2026-12-28', '2027-01-03']);
  assert.strictEqual(C.weeksOfMonth(2027, 1)[0].start, '2027-01-04');
});

test('2027년 2월: 1일이 월요일, 정확히 4주, 앞뒤 달 날짜 없음', () => {
  assert.deepStrictEqual(C.weeksOfMonth(2027, 2).map(x => [x.start, x.end]), [['2027-02-01', '2027-02-07'], ['2027-02-08', '2027-02-14'], ['2027-02-15', '2027-02-21'], ['2027-02-22', '2027-02-28']]);
  assert.deepStrictEqual(C.outsideDays(2027, 2), { before: 0, after: null, n: 28 });
});

test('예전 주차 예산을 새 주차로 옮김', () => {
  const r = C.migrateWeekBudgets({
    'M:2026-11': 400000,
    'W:2026-10-W5': 50000,  // 10/26~10/31
    'W:2026-11-W1': 1000,   // 11/1(일) → 같은 주라 합침
    'W:2026-11-W2': 70000,  // 11/2~11/8
    'W:2026-11-W6': 9000,   // 11/30(월)
    'W:2026-11-W4': 5,      // 11/16~22: 새 형식이 이미 있으면 새 형식 유지
    'W:2026-11-16': 80000,
    'W:2027-02-W5': 1       // 4주뿐인 달의 5주차 → 버림
  });
  assert.ok(r.changed);
  assert.deepStrictEqual(r.budgets, { 'M:2026-11': 400000, 'W:2026-11-16': 80000, 'W:2026-10-26': 51000, 'W:2026-11-02': 70000, 'W:2026-11-30': 9000 });
  assert.strictEqual(r.remove.length, 6);
  assert.strictEqual(C.migrateWeekBudgets(r.budgets).changed, false);
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
  budgets: { 'M:2026-11': 400000, 'W:2026-11-02': 15000, 'W:2026-11-09': 0 }
};

test('월 합계는 그 달 날짜만, 주차 합계는 월~일 7일 전체', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.total, 34500);
  assert.strictEqual(s.days[2], 12500);
  assert.deepStrictEqual(s.weeks.map(w => w.spent), [19500, 0, 0, 0]);
  const oct = C.monthStats(data, 2026, 10, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(oct.weeks[oct.weeks.length - 1].spent, 8000, '10/31 + 11/1');
  assert.strictEqual(C.monthStats(data, 2026, 12, { y: 2026, m: 11, d: 16 }).weeks[0].spent, 111999, '11/30 + 12/1');
  assert.strictEqual(s.count, 5);
});

test('주차 예산: 미설정 / 0원 / 초과 구분', () => {
  const s = C.monthStats(data, 2026, 11, { y: 2026, m: 11, d: 16 });
  assert.strictEqual(s.weeks[2].budget, null);
  assert.strictEqual(s.weeks[2].remaining, null);
  assert.strictEqual(s.weeks[0].remaining, -4500);
  assert.strictEqual(C.formatRate(s.weeks[0].rate), '130%');
  assert.strictEqual(s.weeks[1].budget, 0);
  assert.strictEqual(s.weeks[1].rate, 0);
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
  assert.deepStrictEqual(s.weeks.map(w => w.change), [null, -19500, 0, 0]);
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
