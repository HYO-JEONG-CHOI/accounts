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

  // 월요일 시작 주차. 월 경계에 걸친 주는 해당 월 날짜만 포함
  function weeksOfMonth(y, m) {
    const n = daysInMonth(y, m), weeks = [];
    let cur = null;
    for (let d = 1; d <= n; d++) {
      if (!cur || weekday(y, m, d) === 0) {
        cur = { index: weeks.length + 1, startDay: d, endDay: d };
        weeks.push(cur);
      } else cur.endDay = d;
    }
    return weeks.map(w => ({
      ...w,
      days: w.endDay - w.startDay + 1,
      start: ymd(y, m, w.startDay),
      end: ymd(y, m, w.endDay),
      key: `${ym(y, m)}-W${w.index}`
    }));
  }

  const monthBudgetKey = (y, m) => `M:${ym(y, m)}`;
  const weekBudgetKey = weekKey => `W:${weekKey}`;

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

    let prevSpent = null;
    const weeks = weeksOfMonth(y, m).map(w => {
      const spent = sum(days.slice(w.startDay, w.endDay + 1));
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
    pad, ymd, ym, daysInMonth, weekday, parseYmd, todayParts, addMonths, isValidYmd,
    weeksOfMonth, monthBudgetKey, weekBudgetKey, dailyTotals, monthTotal, elapsedDays, monthStats,
    formatNum, formatWon, formatCompact, formatRate
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Calc = api;
})(typeof self !== 'undefined' ? self : this);
