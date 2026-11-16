// 날짜·주차·통계 계산 (화면과 무관한 순수 함수)
(function (root) {
  'use strict';

  const pad = n => String(n).padStart(2, '0');
  const ymd = (y, m, d) => `${y}-${pad(m)}-${pad(d)}`;
  const ym = (y, m) => `${y}-${pad(m)}`;
  const daysInMonth = (y, m) => new Date(y, m, 0).getDate();
  // 월요일 = 0 ... 일요일 = 6
  const weekday = (y, m, d) => (new Date(y, m - 1, d).getDay() + 6) % 7;

  function parseYmd(s) {
    const [y, m, d] = s.split('-').map(Number);
    return { y, m, d };
  }
  function todayParts(now = new Date()) {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate() };
  }
  function addMonths(y, m, k) {
    const t = y * 12 + (m - 1) + k;
    return { y: Math.floor(t / 12), m: (t % 12 + 12) % 12 + 1 };
  }
  function isValidYmd(s) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
    const { y, m, d } = parseYmd(s);
    return m >= 1 && m <= 12 && d >= 1 && d <= daysInMonth(y, m);
  }

  // y년 m월 d일에서 k일 뒤의 날짜 (d가 0 이하이거나 말일을 넘어도 됨)
  function shiftDay(y, m, d, k = 0) {
    const t = new Date(y, m - 1, d + k);
    return { y: t.getFullYear(), m: t.getMonth() + 1, d: t.getDate() };
  }
  const partsYmd = p => ymd(p.y, p.m, p.d);

  // 주차: 월요일~일요일 7일. 두 달에 걸친 주는 4일 이상 속한 달(= 목요일이 있는 달)의 주차
  // key는 그 주 월요일 날짜 (예: 2026-11-02) → 어느 달 화면에서 봐도 같은 주는 같은 예산
  function weeksOfMonth(y, m) {
    const n = daysInMonth(y, m), weeks = [];
    let mon = 1 - weekday(y, m, 1);          // 1일이 든 주의 월요일 (0 이하면 전월)
    if (mon + 3 < 1) mon += 7;                // 그 주의 목요일이 전월이면 전월 주차
    for (; mon + 3 <= n; mon += 7) {
      const s = shiftDay(y, m, mon), e = shiftDay(y, m, mon, 6);
      weeks.push({ index: weeks.length + 1, s, e, days: 7, start: partsYmd(s), end: partsYmd(e), key: partsYmd(s) });
    }
    return weeks;
  }

  // 이 달 날짜 중 다른 달 주차에 들어가는 날짜 (화면 안내용)
  function outsideDays(y, m) {
    const weeks = weeksOfMonth(y, m), n = daysInMonth(y, m);
    const first = weeks[0].s, last = weeks[weeks.length - 1].e;
    const before = first.m === m ? first.d - 1 : 0;            // 1일 ~ before일 → 전월 마지막 주차
    const after = last.m === m ? last.d + 1 : n + 1;            // after일 ~ 말일 → 다음 달 1주차
    return { before, after: after <= n ? after : null, n };
  }

  const monthBudgetKey = (y, m) => `M:${ym(y, m)}`;
  const weekBudgetKey = weekKey => `W:${weekKey}`;

  // 예전 방식(월 날짜만 자른 주차, 키 W:2026-11-W1)의 주차 예산을 새 주차 키로 옮김
  const LEGACY_WEEK = /^W:(\d{4})-(\d{2})-W([1-6])$/;
  function legacyWeekStartDay(y, m, i) {
    const wd1 = weekday(y, m, 1);
    if (wd1 === 0) return 1 + 7 * (i - 1);
    return i === 1 ? 1 : 1 + (7 - wd1) + 7 * (i - 2);
  }
  function migrateWeekBudgets(budgets) {
    const out = { ...budgets }, add = {}, remove = [];
    for (const key of Object.keys(budgets)) {
      const mt = LEGACY_WEEK.exec(key);
      if (!mt) continue;
      remove.push(key);
      delete out[key];
      const y = +mt[1], m = +mt[2], start = legacyWeekStartDay(y, m, +mt[3]);
      if (m < 1 || m > 12 || start > daysInMonth(y, m)) continue;  // 존재하지 않던 주차
      const newKey = weekBudgetKey(partsYmd(shiftDay(y, m, start, -weekday(y, m, start))));
      if (newKey in budgets) continue;                              // 새 방식으로 이미 설정됨
      add[newKey] = (add[newKey] || 0) + budgets[key];              // 한 주가 두 조각이었으면 합침
    }
    Object.assign(out, add);
    return { budgets: out, changed: remove.length > 0, remove, set: add };
  }

  function dailyTotals(expenses, y, m) {
    const prefix = ym(y, m) + '-';
    const days = new Array(daysInMonth(y, m) + 1).fill(0);
    for (const e of expenses) if (e.date.startsWith(prefix)) days[Number(e.date.slice(8, 10))] += e.amount;
    return days; // days[1..n]
  }
  const sum = arr => arr.reduce((a, b) => a + b, 0);

  function monthTotal(expenses, y, m) {
    const prefix = ym(y, m) + '-';
    let t = 0;
    for (const e of expenses) if (e.date.startsWith(prefix)) t += e.amount;
    return t;
  }

  // 일평균 기준 일수: 지난 달 = 전체, 이번 달 = 오늘까지, 미래 달 = 0
  function elapsedDays(y, m, today) {
    const n = daysInMonth(y, m);
    const cur = today.y * 12 + today.m, sel = y * 12 + m;
    if (sel < cur) return n;
    if (sel > cur) return 0;
    return Math.min(today.d, n);
  }

  function monthStats(data, y, m, today = todayParts()) {
    const days = dailyTotals(data.expenses, y, m);
    const total = sum(days);
    const monthBudget = data.budgets[monthBudgetKey(y, m)] ?? null;

    // 주차는 앞뒤 달 날짜도 포함하므로 날짜 범위로 직접 합산
    const wk = weeksOfMonth(y, m), from = wk[0].start, to = wk[wk.length - 1].end;
    const byDate = {};
    for (const e of data.expenses) if (e.date >= from && e.date <= to) byDate[e.date] = (byDate[e.date] || 0) + e.amount;

    let prevSpent = null;
    const weeks = wk.map(w => {
      let spent = 0;
      for (let k = 0; k < 7; k++) spent += byDate[partsYmd(shiftDay(w.s.y, w.s.m, w.s.d, k))] || 0;
      const budget = data.budgets[weekBudgetKey(w.key)] ?? null;
      const change = prevSpent == null ? null : spent - prevSpent;
      prevSpent = spent;
      return {
        ...w, spent, budget, change,
        remaining: budget == null ? null : budget - spent,
        rate: budget ? spent / budget : (budget === 0 ? (spent > 0 ? Infinity : 0) : null)
      };
    });

    const setWeeks = weeks.filter(w => w.budget != null);
    const weekBudgetSum = setWeeks.length ? sum(setWeeks.map(w => w.budget)) : null;

    const prev = addMonths(y, m, -1);
    const prevTotal = monthTotal(data.expenses, prev.y, prev.m);
    const elapsed = elapsedDays(y, m, today);

    return {
      y, m, days, total, monthBudget, weeks, weekBudgetSum,
      setWeekCount: setWeeks.length,
      remaining: monthBudget == null ? null : monthBudget - total,
      rate: monthBudget ? total / monthBudget : (monthBudget === 0 ? (total > 0 ? Infinity : 0) : null),
      budgetGap: monthBudget == null || weekBudgetSum == null ? null : monthBudget - weekBudgetSum,
      elapsed,
      dailyAvg: elapsed ? total / elapsed : 0,
      prevTotal,
      change: total - prevTotal,
      changeRate: prevTotal > 0 ? (total - prevTotal) / prevTotal : null,
      count: data.expenses.filter(e => e.date.startsWith(ym(y, m) + '-')).length
    };
  }

  // ---------- 표시 형식 ----------
  const formatNum = n => Math.round(n).toLocaleString('ko-KR');
  const formatWon = n => (n < 0 ? '-₩' : '₩') + formatNum(Math.abs(n));
  function formatCompact(n) {
    if (n >= 100000000) return `${(n / 100000000).toFixed(n >= 1e9 ? 0 : 1).replace(/\.0$/, '')}억`;
    if (n >= 1000000) return `${Math.round(n / 10000).toLocaleString('ko-KR')}만`;
    return formatNum(n);
  }
  function formatRate(r) {
    if (r == null) return '-';
    if (!isFinite(r)) return '초과';
    return `${Math.round(r * 100)}%`;
  }

  const api = {
    pad, ymd, ym, daysInMonth, weekday, parseYmd, todayParts, addMonths, isValidYmd, shiftDay,
    weeksOfMonth, outsideDays, monthBudgetKey, weekBudgetKey, migrateWeekBudgets, dailyTotals, monthTotal, elapsedDays, monthStats,
    formatNum, formatWon, formatCompact, formatRate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
