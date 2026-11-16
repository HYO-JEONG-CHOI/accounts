// 효정 가계부 — 화면
(function () {
  'use strict';
  const C = window.Calc, S = window.Store;
  const $ = sel => document.querySelector(sel);
  const WD = ['월', '화', '수', '목', '금', '토', '일'];
  const won = C.formatWon;
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const todayP = () => C.todayParts();
  const todayStr = () => { const t = todayP(); return C.ymd(t.y, t.m, t.d); };

  const t0 = todayP();
  const TABS = ['calendar', 'budget', 'stats', 'settings'];
  const state = {
    tab: TABS.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'calendar',
    y: t0.y, m: t0.m, selected: todayStr(),
    data: { expenses: [], budgets: {}, settings: { theme: 'system', lastBackup: null } },
    statsDay: null, openWeek: null, persisted: null
  };

  // ---------- 공통 조각 ----------
  function dateLabel(s) {
    const { y, m, d } = C.parseYmd(s);
    return `${m}월 ${d}일 (${WD[C.weekday(y, m, d)]})`;
  }
  function rangeLabel(w) {
    return `${w.s.m}.${w.s.d} ~ ${w.e.m}.${w.e.d}`;
  }
  // 이 달 날짜 중 앞뒤 달 주차에 들어가는 날짜 안내
  function outsideNote() {
    const { y, m } = state, o = C.outsideDays(y, m), parts = [];
    const span = (a, b) => a === b ? `${m}월 ${a}일` : `${m}월 ${a}~${b}일`;
    if (o.before) { const p = C.addMonths(y, m, -1); parts.push(`${span(1, o.before)}은 ${p.m}월 마지막 주차`); }
    if (o.after) { const nx = C.addMonths(y, m, 1); parts.push(`${span(o.after, o.n)}은 ${nx.m}월 1주차`); }
    return parts.length ? `<p class="notice">${parts.join(', ')}에 들어가요.</p>` : '';
  }
  // 데이터 불러오기 + 예전 주차 예산을 새 주차로 옮기기
  async function loadData() {
    const d = await S.loadAll();
    const mig = C.migrateWeekBudgets(d.budgets);
    if (mig.changed) { await S.applyBudgetChanges(mig.remove, mig.set); d.budgets = mig.budgets; }
    return d;
  }
  function bar(rate, thin) {
    const over = rate != null && rate > 1;
    const width = rate == null ? 0 : Math.min(isFinite(rate) ? rate : 1, 1) * 100;
    return `<div class="bar${thin ? ' thin' : ''}${over ? ' over' : ''}"><i style="width:${width.toFixed(1)}%"></i></div>`;
  }
  function remainText(remaining) {
    if (remaining == null) return '-';
    return remaining >= 0 ? won(remaining) : `<span class="danger">${won(-remaining)} 초과</span>`;
  }
  function trend(change, prefix = '') {
    if (change == null) return '';
    if (change === 0) return `<span class="trend muted">${prefix}변동 없음</span>`;
    return `<span class="trend ${change > 0 ? 'up' : 'down'}">${prefix}${change > 0 ? '▲' : '▼'} ${won(Math.abs(change))}</span>`;
  }
  const chevron = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  function expenseItem(e) {
    return `<button class="item" data-action="edit-expense" data-id="${esc(e.id)}">
      <span class="memo${e.memo ? '' : ' none'}">${e.memo ? esc(e.memo) : '내역 없음'}</span>
      <span class="amount num">${won(e.amount)}</span>${chevron}</button>`;
  }
  const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  const expensesOn = date => state.data.expenses.filter(e => e.date === date).sort(byCreated);

  // ---------- 렌더 ----------
  const VIEWS = { calendar: renderCalendar, budget: renderBudget, stats: renderStats, settings: renderSettings };
  function render() {
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === state.tab));
    Object.keys(VIEWS).forEach(v => { $('#view-' + v).hidden = v !== state.tab; });
    $('#monthBar').hidden = state.tab === 'settings';
    $('#plainBar').hidden = state.tab !== 'settings';
    $('#fab').hidden = state.tab !== 'calendar';
    $('#monthTitle').textContent = `${state.y}년 ${state.m}월`;
    const t = todayP();
    $('#todayBtn').hidden = state.y === t.y && state.m === t.m && (state.tab !== 'calendar' || state.selected === todayStr());
    VIEWS[state.tab](C.monthStats(state.data, state.y, state.m, t));
  }

  // ① 캘린더
  function renderCalendar(s) {
    const { y, m } = state, n = C.daysInMonth(y, m), lead = C.weekday(y, m, 1), today = todayStr();
    let cells = '<div class="day empty"></div>'.repeat(lead);
    for (let d = 1; d <= n; d++) {
      const date = C.ymd(y, m, d), amt = s.days[d], wd = C.weekday(y, m, d);
      const cls = ['day', wd === 5 && 'sat', wd === 6 && 'sun', amt > 0 && 'has', date === today && 'today', date === state.selected && 'selected'].filter(Boolean).join(' ');
      cells += `<button class="${cls}" data-action="select-day" data-date="${date}" aria-label="${m}월 ${d}일${amt ? ' ' + won(amt) : ''}">
        <span class="d">${d}</span>${amt ? `<span class="amt num">${C.formatCompact(amt)}</span>` : ''}</button>`;
    }

    let budgetBlock;
    if (s.monthBudget == null) {
      budgetBlock = `<div class="row-between" style="margin-top:10px"><span class="label">월 예산을 정하면 남은 금액이 보여요</span><button class="link" data-action="edit-month-budget">예산 설정</button></div>`;
    } else {
      budgetBlock = bar(s.rate) + `<div class="meta"><span>예산 <b class="num">${won(s.monthBudget)}</b> · ${C.formatRate(s.rate)}</span><span>${s.remaining >= 0 ? `남은 <b class="num">${won(s.remaining)}</b>` : `<b class="danger num">${won(-s.remaining)} 초과</b>`}</span></div>`;
    }

    const list = expensesOn(state.selected);
    const dayTotal = list.reduce((a, e) => a + e.amount, 0);
    const listHtml = list.length
      ? `<div class="list">${list.map(expenseItem).join('')}</div>`
      : `<div class="empty-box">이 날은 지출 내역이 없어요<br><button class="btn small primary" data-action="add-expense">지출 추가</button></div>`;

    $('#view-calendar').innerHTML = `
      <div class="card"><div class="label">${m}월 지출</div><div class="big num">${won(s.total)}</div>${budgetBlock}</div>
      <div class="card" id="calCard">
        <div class="cal-head">${WD.map((w, i) => `<span class="${i === 5 ? 'sat' : i === 6 ? 'sun' : ''}">${w}</span>`).join('')}</div>
        <div class="cal-grid">${cells}</div>
      </div>
      <div class="card">
        <div class="card-title"><span>${dateLabel(state.selected)}</span><span class="num">${list.length ? won(dayTotal) : ''}</span></div>
        ${listHtml}
      </div>`;
  }

  // ② 예산
  function renderBudget(s) {
    const { m } = state;
    const monthCard = s.monthBudget == null
      ? `<div class="card"><div class="card-title"><span>${m}월 총예산</span></div>
          <div class="label">아직 설정하지 않았어요</div>
          <button class="btn primary" style="width:100%;margin-top:14px" data-action="edit-month-budget">월 예산 설정</button></div>`
      : `<div class="card"><div class="card-title"><span>${m}월 총예산</span><button class="link" data-action="edit-month-budget">수정</button></div>
          <div class="big num">${won(s.monthBudget)}</div>${bar(s.rate)}
          <div class="meta"><span>지출 <b class="num">${won(s.total)}</b> · ${C.formatRate(s.rate)}</span><span>${s.remaining >= 0 ? `남은 <b class="num">${won(s.remaining)}</b>` : `<b class="danger num">${won(-s.remaining)} 초과</b>`}</span></div></div>`;

    let gapText = '주차 예산을 설정하면 월 예산과 비교해 드려요.';
    if (s.weekBudgetSum != null && s.monthBudget != null) {
      gapText = s.budgetGap === 0 ? '주차 예산 합계와 월 예산이 같아요.'
        : s.budgetGap > 0 ? `주차 예산 합계가 월 예산보다 <b>${won(s.budgetGap)}</b> 적어요.`
        : `주차 예산 합계가 월 예산보다 <b class="danger">${won(-s.budgetGap)}</b> 많아요.`;
    } else if (s.weekBudgetSum != null) gapText = '월 예산을 설정하면 주차 예산 합계와 비교해 드려요.';
    const compare = `<div class="card"><div class="card-title"><span>월 예산 · 주차 예산 비교</span></div>
      <div class="compare">
        <div><span class="label">월 예산</span><b class="num">${s.monthBudget == null ? '미설정' : won(s.monthBudget)}</b></div>
        <div><span class="label">주차 예산 합계 (${s.setWeekCount}/${s.weeks.length}주)</span><b class="num">${s.weekBudgetSum == null ? '미설정' : won(s.weekBudgetSum)}</b></div>
      </div>
      <p class="notice">${gapText} 두 예산은 따로 관리되며, 한쪽을 바꿔도 다른 쪽은 그대로예요.</p></div>`;

    const weeks = s.weeks.map(w => `
      <button class="week" data-action="edit-week-budget" data-key="${w.key}">
        <div class="row-between"><div><span class="w-name">${w.index}주차</span><span class="w-range">${rangeLabel(w)}</span></div>
          ${w.budget == null ? '<span class="chip">미설정</span>' : `<span class="w-budget num">${won(w.budget)}</span>`}</div>
        ${w.budget == null
          ? `<div class="meta" style="margin-top:8px"><span>지출 <b class="num">${won(w.spent)}</b></span><span>눌러서 예산 설정</span></div>`
          : `${bar(w.rate, true)}<div class="meta"><span>지출 <b class="num">${won(w.spent)}</b> · ${C.formatRate(w.rate)}</span><span>${w.remaining >= 0 ? `남은 <b class="num">${won(w.remaining)}</b>` : `<b class="danger num">${won(-w.remaining)} 초과</b>`}</span></div>`}
      </button>`).join('');

    $('#view-budget').innerHTML = monthCard + compare +
      `<div class="card"><div class="card-title"><span>주차별 예산</span><span class="sub">월~일 7일 · ${s.weeks.length}주</span></div>${weeks}${outsideNote()}</div>`;
  }

  // ③ 통계
  function niceMax(v) {
    if (!(v > 0)) return 10000;
    const p = Math.pow(10, Math.floor(Math.log10(v))), f = v / p;
    return (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 ? 2.5 : f <= 5 ? 5 : 10) * p;
  }
  function axis(nv) {
    if (nv >= 10000) return `${Math.round(nv / 1000) / 10}만`.replace('.0만', '만');
    return C.formatNum(nv);
  }
  const f1 = v => v.toFixed(1);

  function dailyChart(s) {
    const W = 340, H = 168, pl = 2, pr = 34, pt = 10, pb = 22, n = s.days.length - 1;
    const cw = (W - pl - pr) / n, max = niceMax(Math.max(...s.days.slice(1), s.dailyAvg));
    const y = v => pt + (H - pt - pb) * (1 - v / max);
    let g = '';
    [0.5, 1].forEach(fr => { const yy = f1(y(max * fr)); g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${W - pr + 5}" y="${+yy + 3}">${axis(max * fr)}</text>`; });
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>`;
    let bars = '', hits = '';
    for (let d = 1; d <= n; d++) {
      const v = s.days[d], x = pl + (d - 1) * cw;
      if (v > 0) {
        const top = Math.min(y(v), y(0) - 2);
        bars += `<rect class="bar-day${state.statsDay === d ? ' sel' : ''}" x="${f1(x + cw * 0.18)}" y="${f1(top)}" width="${f1(cw * 0.64)}" height="${f1(y(0) - top)}" rx="${f1(Math.min(2.5, cw * 0.3))}"/>`;
      }
      hits += `<rect class="hit" data-action="stats-day" data-day="${d}" x="${f1(x)}" y="${pt}" width="${f1(cw)}" height="${H - pt}"/>`;
    }
    if (s.dailyAvg > 0) g += `<line class="avg" x1="${pl}" x2="${W - pr}" y1="${f1(y(s.dailyAvg))}" y2="${f1(y(s.dailyAvg))}"/>`;
    const labels = [...new Set([1, 5, 10, 15, 20, 25, n])].filter(d => d <= n && !(d !== n && n - d < 3))
      .map(d => `<text x="${f1(pl + (d - 0.5) * cw)}" y="${H - 6}" text-anchor="middle">${d}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="날짜별 지출 그래프">${g}${bars}${labels}${hits}</svg>`;
  }

  function cumulativeChart(s) {
    const W = 340, H = 150, pl = 2, pr = 34, pt = 12, pb = 22, n = s.days.length - 1, last = s.elapsed;
    const cum = [0];
    for (let d = 1; d <= last; d++) cum.push(cum[d - 1] + s.days[d]);
    const top = Math.max(s.monthBudget || 0, cum[last] || 0);
    const max = niceMax(top * 1.08);
    const x = d => pl + (W - pl - pr) * (d / n), y = v => pt + (H - pt - pb) * (1 - v / max);
    let g = '';
    [0.5, 1].forEach(fr => { const yy = f1(y(max * fr)); g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${W - pr + 5}" y="${+yy + 3}">${axis(max * fr)}</text>`; });
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>`;
    if (s.monthBudget) {
      g += `<line class="pace" x1="${x(0)}" y1="${f1(y(0))}" x2="${f1(x(n))}" y2="${f1(y(s.monthBudget))}"/>`;
      g += `<line class="budget-line" x1="${pl}" x2="${W - pr}" y1="${f1(y(s.monthBudget))}" y2="${f1(y(s.monthBudget))}"/>`;
    }
    if (last > 0) {
      const pts = cum.map((v, d) => `${f1(x(d))},${f1(y(v))}`).join(' ');
      g += `<polygon class="cum-area" points="${f1(x(0))},${f1(y(0))} ${pts} ${f1(x(last))},${f1(y(0))}"/><polyline class="cum" points="${pts}"/>`;
      g += `<circle cx="${f1(x(last))}" cy="${f1(y(cum[last]))}" r="4" fill="var(--primary)" stroke="var(--card)" stroke-width="2"/>`;
    } else {
      g += `<text x="${(W - pr) / 2}" y="${H / 2}" text-anchor="middle">아직 지나지 않은 달이에요</text>`;
    }
    g += [1, Math.ceil(n / 2), n].map(d => `<text x="${f1(x(d - 0.5))}" y="${H - 6}" text-anchor="middle">${d}일</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="예산 대비 누적 지출 그래프">${g}</svg>`;
  }

  function weeklyChart(s) {
    const W = 340, H = 168, pl = 2, pr = 34, pt = 18, pb = 22, k = s.weeks.length;
    const max = niceMax(Math.max(...s.weeks.map(w => Math.max(w.spent, w.budget || 0))));
    const y = v => pt + (H - pt - pb) * (1 - v / max), gw = (W - pl - pr) / k, bw = Math.min(18, gw * 0.3);
    let g = '';
    [0.5, 1].forEach(fr => { const yy = f1(y(max * fr)); g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${yy}" y2="${yy}"/><text x="${W - pr + 5}" y="${+yy + 3}">${axis(max * fr)}</text>`; });
    g += `<line class="grid" x1="${pl}" x2="${W - pr}" y1="${f1(y(0))}" y2="${f1(y(0))}"/>`;
    s.weeks.forEach((w, i) => {
      const cx = pl + gw * (i + 0.5), base = y(0);
      if (w.budget == null) g += `<rect class="w-none" x="${f1(cx - bw - 1.5)}" y="${f1(base - 3)}" width="${f1(bw)}" height="3" rx="1.5"/>`;
      else { const t = Math.min(y(w.budget), base - (w.budget > 0 ? 2 : 0)); g += `<rect class="w-budget" x="${f1(cx - bw - 1.5)}" y="${f1(t)}" width="${f1(bw)}" height="${f1(base - t)}" rx="3"/>`; }
      if (w.spent > 0) {
        const t = Math.min(y(w.spent), base - 2);
        g += `<rect class="w-spent${w.budget != null && w.spent > w.budget ? ' over' : ''}" x="${f1(cx + 1.5)}" y="${f1(t)}" width="${f1(bw)}" height="${f1(base - t)}" rx="3"/>`;
        g += `<text class="val" x="${f1(cx + 1.5 + bw / 2)}" y="${f1(t - 4)}" text-anchor="middle">${axis(w.spent)}</text>`;
      }
      g += `<text x="${f1(cx)}" y="${H - 6}" text-anchor="middle">${w.index}주</text>`;
      g += `<rect class="hit" data-action="toggle-week" data-key="${w.key}" x="${f1(pl + gw * i)}" y="0" width="${f1(gw)}" height="${H}"/>`;
    });
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="주차별 예산과 지출 그래프">${g}</svg>`;
  }

  function weekDetail(w) {
    const list = state.data.expenses.filter(e => e.date >= w.start && e.date <= w.end).sort((a, b) => a.date.localeCompare(b.date) || byCreated(a, b));
    if (!list.length) return '<div class="wdetail"><div class="empty-box" style="padding:12px 0">이 주에는 지출이 없어요</div></div>';
    let html = '', curDate = null;
    list.forEach(e => {
      if (e.date !== curDate) {
        curDate = e.date;
        const dt = list.filter(x => x.date === curDate).reduce((a, x) => a + x.amount, 0);
        html += `<div class="date-head"><span>${dateLabel(curDate)}</span><span class="num">${won(dt)}</span></div>`;
      }
      html += expenseItem(e);
    });
    return `<div class="wdetail">${html}</div>`;
  }

  function renderStats(s) {
    const { m } = state, isCurrent = s.y === todayP().y && s.m === todayP().m;
    let changeHtml;
    if (s.prevTotal === 0) changeHtml = `<b class="num">-</b><small>전월 지출 없음</small>`;
    else changeHtml = `<b class="num ${s.change > 0 ? 'danger' : s.change < 0 ? 'ok' : ''}">${s.change > 0 ? '+' : s.change < 0 ? '-' : ''}${won(Math.abs(s.change))}</b><small>${s.change > 0 ? '▲' : s.change < 0 ? '▼' : ''} ${Math.abs(Math.round(s.changeRate * 1000) / 10)}% · 전월 ${won(s.prevTotal)}</small>`;

    const summary = `<div class="grid2">
      <div class="stat"><span class="label">총지출</span><b class="num">${won(s.total)}</b><small>${s.count}건</small></div>
      <div class="stat"><span class="label">월 예산</span><b class="num">${s.monthBudget == null ? '미설정' : won(s.monthBudget)}</b><small>사용률 ${C.formatRate(s.rate)}</small></div>
      <div class="stat"><span class="label">${s.remaining != null && s.remaining < 0 ? '예산 초과' : '남은 예산'}</span><b class="num ${s.remaining != null && s.remaining < 0 ? 'danger' : ''}">${s.remaining == null ? '-' : won(Math.abs(s.remaining))}</b><small>${s.monthBudget == null ? '예산 미설정' : `예산 ${won(s.monthBudget)}`}</small></div>
      <div class="stat"><span class="label">일평균 지출</span><b class="num">${won(s.dailyAvg)}</b><small>${s.elapsed ? `${s.elapsed}일 기준` : '아직 지나지 않은 달'}</small></div>
      <div class="stat" style="grid-column:1/-1"><span class="label">전월 대비</span>${changeHtml}</div>
    </div>`;

    let caption = '<span>막대를 누르면 날짜별 금액을 볼 수 있어요</span>';
    if (state.statsDay && state.statsDay < s.days.length) {
      const date = C.ymd(s.y, s.m, state.statsDay), cnt = expensesOn(date).length;
      caption = `<span>${dateLabel(date)} · <b class="num">${won(s.days[state.statsDay])}</b>${cnt ? ` · ${cnt}건` : ''}</span><button class="link" data-action="open-day" data-date="${date}">내역 보기</button>`;
    }

    let paceText = '';
    if (s.monthBudget && isCurrent) {
      const pace = Math.round(s.monthBudget * s.elapsed / (s.days.length - 1));
      const diff = pace - s.total;
      paceText = `<p class="notice">오늘까지 예산 페이스(${won(pace)})보다 ${diff >= 0 ? `<b class="ok">${won(diff)} 덜</b>` : `<b class="danger">${won(-diff)} 더</b>`} 썼어요.</p>`;
    } else if (!s.monthBudget) paceText = '<p class="notice">월 예산을 설정하면 예산선과 함께 볼 수 있어요.</p>';

    const rows = s.weeks.map(w => {
      const open = state.openWeek === w.key;
      return `<button class="wrow" data-action="toggle-week" data-key="${w.key}" aria-expanded="${open}">
        <div class="row-between"><div><span class="w-name">${w.index}주차</span><span class="w-range">${rangeLabel(w)}</span></div>${trend(w.change, '전주 ')}</div>
        <div class="cols"><div>지출<b class="num">${won(w.spent)}</b></div><div>예산<b class="num">${w.budget == null ? '미설정' : won(w.budget)}</b></div><div>남은 예산<b class="num">${remainText(w.remaining)}</b></div></div>
        ${w.budget != null ? `${bar(w.rate, true)}<div class="meta"><span>사용률 ${C.formatRate(w.rate)}</span><span>${w.budget != null && w.spent > w.budget ? '<span class="chip danger">초과</span>' : '<span class="chip ok">예산 이내</span>'}</span></div>` : ''}
      </button>${open ? weekDetail(w) : ''}`;
    }).join('');

    $('#view-stats').innerHTML = summary +
      `<div class="card"><div class="card-title"><span>날짜별 지출</span><span class="sub">${m}월</span></div>${dailyChart(s)}
        <div class="legend"><span><i style="background:var(--primary)"></i>지출</span>${s.dailyAvg > 0 ? `<span><i style="background:none;border-top:1.5px dashed var(--sub);border-radius:0;height:0;width:14px"></i>일평균 ${won(s.dailyAvg)}</span>` : ''}</div>
        <div class="caption">${caption}</div></div>` +
      `<div class="card"><div class="card-title"><span>예산 대비 누적 지출</span><span class="sub">${s.monthBudget ? `예산 ${won(s.monthBudget)}` : '예산 미설정'}</span></div>${cumulativeChart(s)}
        <div class="legend"><span><i style="background:var(--primary)"></i>누적 지출</span>${s.monthBudget ? '<span><i style="background:var(--danger)"></i>월 예산</span><span><i style="background:var(--faint)"></i>예산 페이스</span>' : ''}</div>${paceText}</div>` +
      `<div class="card"><div class="card-title"><span>주차별 예산 vs 지출</span><span class="sub">주차를 누르면 상세</span></div>${weeklyChart(s)}
        <div class="legend"><span><i style="background:var(--primary-weak)"></i>예산</span><span><i style="background:var(--primary)"></i>지출</span><span><i style="background:var(--danger)"></i>예산 초과</span></div>
        <div style="margin-top:6px">${rows}</div></div>`;
  }

  // ④ 설정
  function renderSettings() {
    const { expenses, budgets, settings } = state.data;
    const last = settings.lastBackup ? new Date(settings.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const needBackup = expenses.length > 0 && (last == null || days >= 14);
    const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
    const persistText = state.persisted === true ? '브라우저가 데이터를 임의로 지우지 않도록 보호되고 있어요.'
      : state.persisted === false ? '저장 공간 보호가 허용되지 않았어요. 홈 화면에 설치하고 백업을 자주 해 주세요.'
      : '이 브라우저는 저장 공간 보호 상태를 알려주지 않아요. 백업을 자주 해 주세요.';

    $('#view-settings').innerHTML = `
      <div class="card"><div class="card-title"><span>데이터 백업</span></div>
        ${needBackup ? `<div class="warn-box">${last ? `마지막 백업 후 ${days}일이 지났어요.` : '아직 백업한 적이 없어요.'} 휴대폰을 바꾸거나 앱을 지우면 데이터가 사라지니 백업 파일을 저장해 두세요.</div>` : ''}
        <div class="setting-row"><span>마지막 백업</span><span class="muted num">${last ? `${last.getFullYear()}.${last.getMonth() + 1}.${last.getDate()}` : '없음'}</span></div>
        <div class="btn-row" style="margin-top:6px"><button class="btn primary" data-action="export">백업 파일 저장</button><button class="btn" data-action="restore">백업에서 복원</button></div>
        <p class="notice">데이터는 이 휴대폰에만 저장되고 다른 곳으로 전송되지 않아요. 백업 파일을 클라우드나 메신저 '나에게 보내기'에 보관하면 휴대폰을 바꿔도 복원할 수 있어요.</p>
      </div>
      <div class="card"><div class="card-title"><span>화면 테마</span></div>
        <div class="seg">${[['system', '시스템'], ['light', '라이트'], ['dark', '다크']].map(([v, l]) => `<button data-action="theme" data-theme="${v}" class="${settings.theme === v ? 'on' : ''}">${l}</button>`).join('')}</div>
      </div>
      <div class="card"><div class="card-title"><span>저장 상태</span></div>
        <div class="setting-row"><span>지출 내역</span><span class="muted num">${C.formatNum(expenses.length)}건</span></div>
        <div class="setting-row"><span>설정된 예산</span><span class="muted num">${Object.keys(budgets).length}개</span></div>
        <p class="notice">${persistText}</p>
      </div>
      <div class="card"><div class="card-title"><span>홈 화면에 설치</span>${standalone ? '<span class="chip ok">설치됨</span>' : ''}</div>
        <div class="steps">
          <b>아이폰</b> · Safari로 열기 → 아래 공유 버튼 → <b>홈 화면에 추가</b><br>
          <b>안드로이드</b> · Chrome으로 열기 → 오른쪽 위 메뉴 → <b>앱 설치</b> 또는 <b>홈 화면에 추가</b>
        </div>
        <p class="notice">설치하면 인터넷 연결 없이도 사용할 수 있어요.</p>
      </div>
      <div class="card"><button class="btn danger" style="width:100%" data-action="clear-all">전체 데이터 삭제</button></div>
      <div class="foot">효정 가계부 v1.0</div>`;
  }

  // ---------- 시트 (하단 창) ----------
  let sheetOpen = false;
  function openSheet(html, mount) {
    const sheet = $('#sheet');
    sheet.innerHTML = html;
    sheet.hidden = false;
    $('#backdrop').hidden = false;
    if (!sheetOpen) { history.pushState({ sheet: true }, ''); sheetOpen = true; }
    if (mount) mount(sheet);
  }
  function hideSheet() {
    $('#sheet').hidden = true;
    $('#backdrop').hidden = true;
    $('#sheet').innerHTML = '';
    sheetOpen = false;
  }
  function closeSheet() {
    if (!sheetOpen) return;
    hideSheet();
    if (history.state && history.state.sheet) history.back();
  }
  window.addEventListener('popstate', () => { if (sheetOpen) hideSheet(); });
  $('#backdrop').addEventListener('click', closeSheet);

  function bindMoney(input) {
    input.addEventListener('input', () => {
      const digits = input.value.replace(/\D/g, '').replace(/^0+(?=\d)/, '').slice(0, 12);
      input.value = digits ? C.formatNum(Number(digits)) : '';
    });
  }
  const readMoney = input => { const d = input.value.replace(/\D/g, ''); return d === '' ? null : Number(d); };

  function confirmSheet({ title, message, ok = '확인', danger = false }) {
    return new Promise(resolve => {
      let answered = false;
      const done = v => { if (answered) return; answered = true; resolve(v); };
      openSheet(`<h2>${esc(title)}</h2><p class="desc">${esc(message)}</p>
        <div class="btn-row"><button class="btn" data-act="no">취소</button><button class="btn ${danger ? 'danger' : 'primary'}" data-act="yes">${esc(ok)}</button></div>`, sheet => {
        sheet.querySelector('[data-act="no"]').onclick = () => { done(false); closeSheet(); };
        sheet.querySelector('[data-act="yes"]').onclick = () => { done(true); closeSheet(); };
        const watch = setInterval(() => { if (!sheetOpen) { clearInterval(watch); done(false); } }, 200);
      });
    });
  }

  function recentMemos() {
    const seen = new Set(), out = [];
    [...state.data.expenses].sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0)).forEach(e => {
      if (e.memo && !seen.has(e.memo) && out.length < 30) { seen.add(e.memo); out.push(e.memo); }
    });
    return out;
  }

  function openExpenseSheet(exp) {
    const edit = !!exp;
    openSheet(`<h2>${edit ? '지출 수정' : '지출 추가'}</h2>
      <form id="expForm" autocomplete="off" novalidate>
        <div class="field"><span>금액</span>
          <div class="money"><input class="input num" id="fAmount" inputmode="numeric" enterkeyhint="next" placeholder="0" value="${edit ? C.formatNum(exp.amount) : ''}" aria-label="금액"></div>
          <div class="quick">${[1000, 5000, 10000, 50000].map(v => `<button type="button" data-add="${v}">+${C.formatNum(v)}</button>`).join('')}</div>
        </div>
        <label class="field"><span>지출 내역</span>
          <input class="input" id="fMemo" maxlength="100" enterkeyhint="done" placeholder="예: 점심 김밥" list="memoList" value="${edit ? esc(exp.memo) : ''}">
          <datalist id="memoList">${recentMemos().map(mm => `<option value="${esc(mm)}">`).join('')}</datalist>
        </label>
        <label class="field"><span>날짜</span><input class="input" type="date" id="fDate" value="${edit ? exp.date : state.selected}"></label>
        <div class="err" id="fErr"></div>
        <div class="btn-row">${edit ? '<button type="button" class="btn danger" data-act="delete">삭제</button>' : ''}<button type="submit" class="btn primary" style="flex:2">저장</button></div>
      </form>`, sheet => {
      const amount = sheet.querySelector('#fAmount'), memo = sheet.querySelector('#fMemo'), date = sheet.querySelector('#fDate'), err = sheet.querySelector('#fErr');
      bindMoney(amount);
      if (!edit) amount.focus();
      sheet.querySelectorAll('[data-add]').forEach(b => b.onclick = () => {
        const next = Math.min((readMoney(amount) || 0) + Number(b.dataset.add), S.MAX_AMOUNT);
        amount.value = C.formatNum(next);
      });
      amount.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); memo.focus(); } });
      sheet.querySelector('#expForm').onsubmit = async e => {
        e.preventDefault();
        const value = readMoney(amount);
        if (!value) { err.textContent = '금액을 입력해 주세요.'; amount.focus(); return; }
        if (!C.isValidYmd(date.value)) { err.textContent = '날짜를 선택해 주세요.'; return; }
        try {
          const saved = await S.saveExpense({ ...(exp || {}), date: date.value, amount: value, memo: memo.value.trim() });
          const list = state.data.expenses, i = list.findIndex(x => x.id === saved.id);
          if (i >= 0) list[i] = saved; else list.push(saved);
          const p = C.parseYmd(saved.date);
          state.y = p.y; state.m = p.m; state.selected = saved.date;
          closeSheet();
          toast(edit ? '수정했어요' : `${won(value)} 저장했어요`);
          render();
        } catch (ex) { err.textContent = '저장하지 못했어요. 다시 시도해 주세요.'; }
      };
      const del = sheet.querySelector('[data-act="delete"]');
      if (del) {
        let armed = false;
        del.onclick = async () => {
          if (!armed) { armed = true; del.textContent = '한 번 더 누르면 삭제'; return; }
          await S.deleteExpense(exp.id);
          state.data.expenses = state.data.expenses.filter(x => x.id !== exp.id);
          closeSheet(); toast('삭제했어요'); render();
        };
      }
    });
  }

  function openBudgetSheet({ title, desc, key }) {
    const current = state.data.budgets[key] ?? null;
    openSheet(`<h2>${esc(title)}</h2><p class="desc">${esc(desc)}</p>
      <form id="bForm" novalidate>
        <div class="field"><div class="money"><input class="input num" id="bAmount" inputmode="numeric" enterkeyhint="done" placeholder="0" value="${current == null ? '' : C.formatNum(current)}" aria-label="예산 금액"></div>
          <div class="quick">${[10000, 50000, 100000, 500000].map(v => `<button type="button" data-add="${v}">+${C.formatNum(v)}</button>`).join('')}</div></div>
        <div class="err" id="bErr"></div>
        <div class="btn-row">${current != null ? '<button type="button" class="btn" data-act="unset">미설정으로</button>' : ''}<button type="submit" class="btn primary" style="flex:2">저장</button></div>
      </form>`, sheet => {
      const input = sheet.querySelector('#bAmount'), err = sheet.querySelector('#bErr');
      bindMoney(input);
      input.focus();
      sheet.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { input.value = C.formatNum(Math.min((readMoney(input) || 0) + Number(b.dataset.add), S.MAX_AMOUNT)); });
      sheet.querySelector('#bForm').onsubmit = async e => {
        e.preventDefault();
        const v = readMoney(input);
        if (v == null) { err.textContent = '금액을 입력해 주세요. 예산을 없애려면 "미설정으로"를 눌러 주세요.'; return; }
        await S.setBudget(key, v);
        state.data.budgets[key] = v;
        closeSheet(); toast('예산을 저장했어요'); render();
      };
      const unset = sheet.querySelector('[data-act="unset"]');
      if (unset) unset.onclick = async () => {
        await S.setBudget(key, null);
        delete state.data.budgets[key];
        closeSheet(); toast('미설정으로 바꿨어요'); render();
      };
    });
  }

  function openMonthPicker() {
    let year = state.y;
    const t = todayP();
    const draw = sheet => {
      sheet.querySelector('#pyLabel').textContent = `${year}년`;
      sheet.querySelector('.picker-months').innerHTML = Array.from({ length: 12 }, (_, i) => i + 1).map(mm =>
        `<button data-month="${mm}" class="${year === state.y && mm === state.m ? 'on' : ''} ${year === t.y && mm === t.m ? 'now' : ''}">${mm}월</button>`).join('');
    };
    openSheet(`<h2>연도와 월 선택</h2>
      <div class="picker-year"><button class="icon-btn" data-py="-1" aria-label="이전 해"><svg viewBox="0 0 24 24"><path d="M15 5l-7 7 7 7"/></svg></button><b id="pyLabel"></b>
        <button class="icon-btn" data-py="1" aria-label="다음 해"><svg viewBox="0 0 24 24"><path d="M9 5l7 7-7 7"/></svg></button></div>
      <div class="picker-months"></div>
      <button class="btn" style="width:100%" data-act="now">이번 달로 이동</button>`, sheet => {
      draw(sheet);
      sheet.querySelectorAll('[data-py]').forEach(b => b.onclick = () => { year += Number(b.dataset.py); draw(sheet); });
      sheet.querySelector('.picker-months').onclick = e => {
        const b = e.target.closest('[data-month]');
        if (!b) return;
        setMonth(year, Number(b.dataset.month));
        closeSheet(); render();
      };
      sheet.querySelector('[data-act="now"]').onclick = () => { goToday(); closeSheet(); render(); };
    });
  }

  // ---------- 동작 ----------
  function setMonth(y, m) {
    state.y = y; state.m = m;
    const t = todayP();
    state.selected = t.y === y && t.m === m ? todayStr() : C.ymd(y, m, 1);
    state.statsDay = null; state.openWeek = null;
  }
  function shiftMonth(k) { const p = C.addMonths(state.y, state.m, k); setMonth(p.y, p.m); }
  function goToday() { const t = todayP(); setMonth(t.y, t.m); }

  let toastTimer = null;
  function toast(msg) {
    const el = $('#toast');
    el.textContent = msg; el.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.hidden = true; }, 2000);
  }

  function applyTheme() {
    const theme = state.data.settings.theme;
    if (theme === 'light' || theme === 'dark') document.documentElement.dataset.theme = theme;
    else delete document.documentElement.dataset.theme;
    requestAnimationFrame(() => {
      document.querySelector('meta[name="theme-color"]').setAttribute('content', getComputedStyle(document.body).backgroundColor);
    });
  }

  async function exportBackup() {
    const backup = S.buildBackup(state.data.expenses, state.data.budgets, state.data.settings);
    const t = todayP(), name = `효정가계부-백업-${t.y}${C.pad(t.m)}${C.pad(t.d)}.json`;
    const blob = new Blob([JSON.stringify(backup, null, 1)], { type: 'application/json' });
    let shared = false;
    if (matchMedia('(pointer: coarse)').matches && navigator.canShare) {
      try {
        const file = new File([blob], name, { type: 'application/json' });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], title: '효정 가계부 백업' }); shared = true; }
      } catch (e) {
        if (e && e.name === 'AbortError') return;
      }
    }
    if (!shared) {
      const url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 5000);
    }
    state.data.settings.lastBackup = Date.now();
    await S.setSetting('lastBackup', state.data.settings.lastBackup);
    toast('백업 파일을 저장했어요');
    render();
  }

  $('#restoreInput').addEventListener('change', async e => {
    const file = e.target.files[0];
    e.target.value = '';
    if (!file) return;
    let parsed;
    try { parsed = S.parseBackup(await file.text()); }
    catch (ex) { toast(ex.message); return; }
    const when = parsed.exportedAt ? new Date(parsed.exportedAt) : null;
    const ok = await confirmSheet({
      title: '백업에서 복원할까요?',
      message: `${when ? `${when.getFullYear()}.${when.getMonth() + 1}.${when.getDate()}에 만든 백업\n` : ''}지출 ${C.formatNum(parsed.expenses.length)}건 · 예산 ${parsed.budgets.length}개\n\n지금 있는 데이터(지출 ${C.formatNum(state.data.expenses.length)}건)는 백업 내용으로 바뀌어요.`,
      ok: '복원하기'
    });
    if (!ok) return;
    try {
      await S.replaceAll(parsed);
      state.data = await loadData();
      applyTheme(); goToday(); render();
      toast('복원했어요');
    } catch (ex) { toast('복원하지 못했어요. 기존 데이터는 그대로예요.'); }
  });

  async function clearAll() {
    const ok = await confirmSheet({ title: '전체 데이터를 삭제할까요?', message: `지출 ${C.formatNum(state.data.expenses.length)}건과 모든 예산이 삭제되고 되돌릴 수 없어요.\n삭제 전에 백업 파일을 저장해 두는 걸 권해요.`, ok: '전체 삭제', danger: true });
    if (!ok) return;
    await S.clearAll();
    state.data = { expenses: [], budgets: {}, settings: { theme: 'system', lastBackup: null } };
    applyTheme(); render(); toast('전체 데이터를 삭제했어요');
  }

  const ACTIONS = {
    'prev-month': () => { shiftMonth(-1); render(); },
    'next-month': () => { shiftMonth(1); render(); },
    'pick-month': openMonthPicker,
    'go-today': () => { goToday(); render(); },
    'select-day': el => { state.selected = el.dataset.date; render(); },
    'add-expense': () => openExpenseSheet(null),
    'edit-expense': el => { const e = state.data.expenses.find(x => x.id === el.dataset.id); if (e) openExpenseSheet(e); },
    'edit-month-budget': () => openBudgetSheet({ title: `${state.y}년 ${state.m}월 총예산`, desc: '주차별 예산과 별도로 관리돼요.', key: C.monthBudgetKey(state.y, state.m) }),
    'edit-week-budget': el => {
      const w = C.weeksOfMonth(state.y, state.m).find(x => x.key === el.dataset.key);
      openBudgetSheet({ title: `${state.m}월 ${w.index}주차 예산`, desc: `${rangeLabel(w)} · 월~일 7일`, key: C.weekBudgetKey(w.key) });
    },
    'stats-day': el => { state.statsDay = Number(el.dataset.day); render(); },
    'open-day': el => { state.selected = el.dataset.date; state.tab = 'calendar'; render(); scrollTo(0, 0); },
    'toggle-week': el => { state.openWeek = state.openWeek === el.dataset.key ? null : el.dataset.key; render(); },
    'export': exportBackup,
    'restore': () => $('#restoreInput').click(),
    'theme': async el => { state.data.settings.theme = el.dataset.theme; await S.setSetting('theme', el.dataset.theme); applyTheme(); render(); },
    'clear-all': clearAll
  };

  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.classList.contains('tab')) { state.tab = tab.dataset.tab; render(); scrollTo(0, 0); return; }
    const el = e.target.closest('[data-action]');
    if (el && !el.closest('#sheet') && ACTIONS[el.dataset.action]) ACTIONS[el.dataset.action](el);
  });

  // 캘린더 좌우 스와이프로 월 이동
  let touch = null;
  $('#view-calendar').addEventListener('touchstart', e => { if (e.target.closest('#calCard')) touch = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  $('#view-calendar').addEventListener('touchend', e => {
    if (!touch) return;
    const dx = e.changedTouches[0].clientX - touch.x, dy = e.changedTouches[0].clientY - touch.y;
    touch = null;
    if (Math.abs(dx) > 60 && Math.abs(dy) < 45) { shiftMonth(dx < 0 ? 1 : -1); render(); }
  }, { passive: true });

  // 키보드가 올라와도 하단 창이 가려지지 않게
  if (window.visualViewport) {
    const vv = window.visualViewport;
    const fit = () => { $('#sheet').style.bottom = Math.max(0, window.innerHeight - vv.height - vv.offsetTop) + 'px'; };
    vv.addEventListener('resize', fit); vv.addEventListener('scroll', fit);
  }

  window.addEventListener('hashchange', () => {
    const tab = location.hash.slice(1);
    if (TABS.includes(tab) && tab !== state.tab) { state.tab = tab; render(); }
  });

  // 자정이 지나 다시 열었을 때 '오늘' 갱신
  document.addEventListener('visibilitychange', () => { if (!document.hidden && !sheetOpen) render(); });

  // ---------- 시작 ----------
  (async function start() {
    render();
    try {
      state.data = await loadData();
    } catch (e) {
      toast('저장소를 열 수 없어요. 사생활 보호 모드에서는 저장되지 않을 수 있어요.');
    }
    applyTheme();
    render();
    state.persisted = await S.requestPersist();
    if (state.tab === 'settings') render();
  })();

  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
    window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
  }
})();
