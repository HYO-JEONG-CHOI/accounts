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
  const TABS = ['calendar', 'budget', 'settings'];
  // 처음 들어오면 보기 전용. 비밀번호를 넣으면 이 기기에서는 계속 풀린 상태
  const PIN = '0325', UNLOCK_KEY = 'hyojeong-budget-unlocked';
  const readUnlocked = () => { try { return localStorage.getItem(UNLOCK_KEY) === '1'; } catch (e) { return false; } };
  const writeUnlocked = v => { try { v ? localStorage.setItem(UNLOCK_KEY, '1') : localStorage.removeItem(UNLOCK_KEY); } catch (e) { /* 저장 안 돼도 이번 접속 동안은 유지 */ } };
  const state = {
    tab: 'calendar',
    y: t0.y, m: t0.m, selected: todayStr(),
    data: { expenses: [], budgets: {}, settings: { theme: 'system', lastBackup: null } },
    unlocked: readUnlocked(), persisted: null
  };

  // ---------- 공통 조각 ----------
  function dateLabel(s) {
    const { y, m, d } = C.parseYmd(s);
    return `${m}월 ${d}일 (${WD[C.weekday(y, m, d)]})`;
  }
  function rangeLabel(w) {
    return `${w.s.m}.${w.s.d} ~ ${w.e.m}.${w.e.d}`;
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
  const chevron = '<svg class="chev" viewBox="0 0 24 24"><path d="M9 6l6 6-6 6"/></svg>';
  function expenseItem(e) {
    const body = `<span class="memo${e.memo ? '' : ' none'}">${e.memo ? esc(e.memo) : '내역 없음'}</span>
      <span class="amount num">${won(e.amount)}</span>`;
    if (!state.unlocked) return `<div class="item">${body}</div>`;
    return `<button class="item" data-action="edit-expense" data-id="${esc(e.id)}">${body}${chevron}</button>`;
  }
  const byCreated = (a, b) => (a.createdAt || 0) - (b.createdAt || 0);
  const expensesOn = date => state.data.expenses.filter(e => e.date === date).sort(byCreated);

  // ---------- 렌더 ----------
  const VIEWS = { calendar: renderCalendar, budget: renderBudget, settings: renderSettings };
  function render() {
    if (!canOpen(state.tab)) state.tab = 'calendar';
    document.querySelector('.tab[data-tab="settings"]').hidden = !state.unlocked;
    $('#brandBar').hidden = state.tab !== 'calendar';
    $('#lockBtn').textContent = state.unlocked ? '잠그기' : '효정입니다.';
    document.body.classList.toggle('locked', !state.unlocked);
    document.querySelectorAll('.tab').forEach(t => t.classList.toggle('on', t.dataset.tab === state.tab));
    Object.keys(VIEWS).forEach(v => { $('#view-' + v).hidden = v !== state.tab; });
    $('#monthBar').hidden = state.tab === 'settings';
    $('#plainBar').hidden = state.tab !== 'settings';
    $('#fab').hidden = state.tab !== 'calendar' || !state.unlocked;
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

    const list = expensesOn(state.selected);
    const dayTotal = list.reduce((a, e) => a + e.amount, 0);
    const listHtml = list.length
      ? `<div class="list">${list.map(expenseItem).join('')}</div>`
      : `<div class="empty-box">이 날은 지출 내역이 없어요</div>`;

    $('#view-calendar').innerHTML = `
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
    const w = C.currentWeek(state.data, todayP());
    const summary = `<div class="card"><div class="card-title"><span>이번 주차</span><span class="sub">${w.m}월 ${w.index}주차 · ${rangeLabel(w)}</span></div>
      <div class="compare">
        <div><span class="label">사용 금액</span><b class="num">${won(w.spent)}</b></div>
        <div><span class="label">${w.remaining < 0 ? '초과 금액' : '잔여 금액'}</span><b class="num ${w.remaining < 0 ? 'danger' : ''}">${won(Math.abs(w.remaining))}</b></div>
      </div>${bar(w.rate)}<div class="meta"><span>예산 <b class="num">${won(w.budget)}</b>${w.isDefault ? ' (기본)' : ''} · ${C.formatRate(w.rate)}</span></div>
      </div>`;

    const weeks = s.weeks.map(w => `
      <${state.unlocked ? 'button' : 'div'} class="week" data-action="edit-week-budget" data-key="${w.key}">
        <div class="row-between"><div><span class="w-name">${w.index}주차</span><span class="w-range">${rangeLabel(w)}</span>${w.isCurrent ? ' <span class="chip ok">이번 주</span>' : ''}</div>
          <span>${w.isDefault ? '<span class="chip">기본</span> ' : ''}<span class="w-budget num">${won(w.budget)}</span></span></div>
        ${bar(w.rate, true)}<div class="meta"><span>지출 <b class="num">${won(w.spent)}</b> · ${C.formatRate(w.rate)}</span><span>${w.remaining >= 0 ? `남은 <b class="num">${won(w.remaining)}</b>` : `<b class="danger num">${won(-w.remaining)} 초과</b>`}</span></div>
      </${state.unlocked ? 'button' : 'div'}>`).join('');

    $('#view-budget').innerHTML = summary +
      `<div class="card"><div class="card-title"><span>주차별 예산</span><span class="sub">월~일 7일 · ${s.weeks.length}주</span></div>${weeks}</div>`;
  }

  // ③ 설정
  function renderSettings() {
    const { expenses, budgets, settings } = state.data;
    const last = settings.lastBackup ? new Date(settings.lastBackup) : null;
    const days = last ? Math.floor((Date.now() - last) / 86400000) : null;
    const needBackup = expenses.length > 0 && (last == null || days >= 14);
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
      <div class="card"><div class="card-title"><span>저장 상태</span></div>
        <div class="setting-row"><span>지출 내역</span><span class="muted num">${C.formatNum(expenses.length)}건</span></div>
        <div class="setting-row"><span>설정된 예산</span><span class="muted num">${Object.keys(budgets).length}개</span></div>
        <p class="notice">${persistText}</p>
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
    const custom = state.data.budgets[key] ?? null;
    const current = custom ?? C.DEFAULT_WEEK_BUDGET;
    openSheet(`<h2>${esc(title)}</h2><p class="desc">${esc(desc)}</p>
      <form id="bForm" novalidate>
        <div class="field"><div class="money"><input class="input num" id="bAmount" inputmode="numeric" enterkeyhint="done" placeholder="0" value="${C.formatNum(current)}" aria-label="예산 금액"></div>
          <div class="quick">${[10000, 50000, 100000, 500000].map(v => `<button type="button" data-add="${v}">+${C.formatNum(v)}</button>`).join('')}</div></div>
        <div class="err" id="bErr"></div>
        <div class="btn-row">${custom != null ? `<button type="button" class="btn" data-act="unset">기본값(${C.formatCompact(C.DEFAULT_WEEK_BUDGET)})으로</button>` : ''}<button type="submit" class="btn primary" style="flex:2">저장</button></div>
      </form>`, sheet => {
      const input = sheet.querySelector('#bAmount'), err = sheet.querySelector('#bErr');
      bindMoney(input);
      input.focus();
      sheet.querySelectorAll('[data-add]').forEach(b => b.onclick = () => { input.value = C.formatNum(Math.min((readMoney(input) || 0) + Number(b.dataset.add), S.MAX_AMOUNT)); });
      sheet.querySelector('#bForm').onsubmit = async e => {
        e.preventDefault();
        const v = readMoney(input);
        if (v == null) { err.textContent = '금액을 입력해 주세요.'; return; }
        // 기본값과 같으면 따로 저장하지 않음 (기본값 표시 유지)
        const isDefault = v === C.DEFAULT_WEEK_BUDGET;
        await S.setBudget(key, isDefault ? null : v);
        if (isDefault) delete state.data.budgets[key]; else state.data.budgets[key] = v;
        closeSheet(); toast('예산을 저장했어요'); render();
      };
      const unset = sheet.querySelector('[data-act="unset"]');
      if (unset) unset.onclick = async () => {
        await S.setBudget(key, null);
        delete state.data.budgets[key];
        closeSheet(); toast('기본 예산으로 바꿨어요'); render();
      };
    });
  }

  function openPinSheet() {
    openSheet(`<h2>비밀번호</h2>
      <form id="pinForm" autocomplete="off" novalidate>
        <div class="field"><input class="input num pin" id="pinInput" type="password" inputmode="numeric" maxlength="4" enterkeyhint="done" aria-label="비밀번호"></div>
        <div class="err" id="pinErr"></div>
      </form>`, sheet => {
      const input = sheet.querySelector('#pinInput'), err = sheet.querySelector('#pinErr');
      input.focus();
      const check = () => {
        if (input.value !== PIN) { err.textContent = '비밀번호가 맞지 않아요.'; input.value = ''; input.focus(); return; }
        state.unlocked = true; writeUnlocked(true);
        closeSheet(); toast('반가워요, 효정님'); render();
      };
      input.addEventListener('input', () => { input.value = input.value.replace(/\D/g, ''); err.textContent = ''; if (input.value.length === 4) check(); });
      sheet.querySelector('#pinForm').onsubmit = e => { e.preventDefault(); check(); };
    });
  }
  function lockToggle() {
    if (!state.unlocked) { openPinSheet(); return; }
    state.unlocked = false; writeUnlocked(false);
    state.tab = 'calendar'; toast('잠갔어요'); render();
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
    delete document.documentElement.dataset.theme;  // 항상 휴대폰 설정(라이트/다크)을 따름
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
    'edit-week-budget': el => {
      const w = C.weeksOfMonth(state.y, state.m).find(x => x.key === el.dataset.key);
      openBudgetSheet({ title: `${state.m}월 ${w.index}주차 예산`, desc: `${rangeLabel(w)} · 월~일 7일 · 기본 ${won(C.DEFAULT_WEEK_BUDGET)}`, key: C.weekBudgetKey(w.key) });
    },
    'export': exportBackup,
    'restore': () => $('#restoreInput').click(),
    'clear-all': clearAll,
    'lock-toggle': lockToggle
  };
  // 잠금 상태에서 할 수 있는 것: 달 이동·날짜 선택(보기)과 잠금 풀기뿐
  // 잠금 상태에서는 캘린더·예산 화면 보기만, 설정은 막음
  const canOpen = tab => state.unlocked || tab !== 'settings';
  const VIEW_ONLY = new Set(['prev-month', 'next-month', 'pick-month', 'go-today', 'select-day', 'lock-toggle']);

  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab && tab.classList.contains('tab')) { if (!canOpen(tab.dataset.tab)) return; state.tab = tab.dataset.tab; render(); scrollTo(0, 0); return; }
    const el = e.target.closest('[data-action]');
    if (!el || el.closest('#sheet') || !ACTIONS[el.dataset.action]) return;
    if (!state.unlocked && !VIEW_ONLY.has(el.dataset.action)) return;
    ACTIONS[el.dataset.action](el);
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
    if (TABS.includes(tab) && canOpen(tab) && tab !== state.tab) { state.tab = tab; render(); }
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

  // 오프라인 저장은 실제 배포 주소(https)에서만. 로컬 미리보기에서는 수정이 바로 보이도록 끄고 예전 저장분도 지움
  const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
  if ('serviceWorker' in navigator) {
    if (isLocal) {
      navigator.serviceWorker.getRegistrations().then(rs => rs.forEach(r => r.unregister())).catch(() => {});
      if (window.caches) caches.keys().then(ks => ks.forEach(k => caches.delete(k))).catch(() => {});
    } else if (location.protocol === 'https:') {
      window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
      // 새 버전이 설치되면 앱을 한 번 다시 불러와 바로 반영 (처음 설치 때는 제외)
      const hadController = !!navigator.serviceWorker.controller;
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded || sheetOpen) return;
        reloaded = true; location.reload();
      });
    }
  }
})();
