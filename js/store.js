// 데이터 저장소: Firebase(Firestore) 온라인 저장 + 백업 파일 검증
// - 지출·예산은 온라인에 저장 → 링크를 연 사람 누구나 최신 내역을 봄 (수정은 효정 기기만)
// - 수정 권한: 익명 로그인한 기기가 비밀번호를 서버 규칙으로 확인받으면 owners/{uid}에 등록됨
// - 인터넷이 끊겨도 휴대폰에 저장된 사본으로 보고, 입력은 연결되면 올라감
(function (root) {
  'use strict';

  const FIREBASE_CONFIG = {
    apiKey: 'AIzaSyCu97o1SGQAhkQ4BsGuu0S5LZDMGWvDPZU',
    authDomain: 'budget-29603.firebaseapp.com',
    projectId: 'budget-29603',
    storageBucket: 'budget-29603.firebasestorage.app',
    messagingSenderId: '388041091385',
    appId: '1:388041091385:web:d4a8c170048e963266e0e8'
  };
  const APP_ID = 'hyojeong-budget';
  const BACKUP_VERSION = 1;
  const MAX_AMOUNT = 999999999999;
  // W:2026-11-02 = 그 주 월요일. M:/W:2026-11-W1 은 예전 형식(백업 호환용)
  const BUDGET_KEY = /^(M:\d{4}-\d{2}|W:\d{4}-\d{2}-\d{2}|W:\d{4}-\d{2}-W[1-6])$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const OWNER_HINT = 'hyojeong-budget-owner';      // 오프라인일 때도 잠금 해제 상태를 기억
  const SETTINGS_KEY = 'hyojeong-budget-settings';  // 기기별 설정(마지막 백업 날짜)
  const LEGACY_DONE = 'hyojeong-budget-legacy-uploaded';

  // ---------- 백업 파일 검증 (순수 함수) ----------
  function parseBackup(textValue) {
    let obj;
    try { obj = JSON.parse(textValue); } catch (e) { throw new Error('백업 파일 형식이 올바르지 않아요.'); }
    if (!obj || obj.app !== APP_ID) throw new Error('효정 가계부 백업 파일이 아니에요.');
    if (!Array.isArray(obj.expenses) || !Array.isArray(obj.budgets)) throw new Error('백업 파일에 필요한 데이터가 없어요.');
    if (obj.version > BACKUP_VERSION) throw new Error('더 새로운 버전의 앱에서 만든 백업이에요. 앱을 업데이트해 주세요.');

    const ids = new Set();
    const expenses = obj.expenses.map((e, i) => {
      const amount = Number(e.amount);
      if (!e || typeof e.date !== 'string' || !DATE.test(e.date) || !Number.isInteger(amount) || amount <= 0 || amount > MAX_AMOUNT) {
        throw new Error(`${i + 1}번째 지출 데이터가 올바르지 않아요.`);
      }
      let id = typeof e.id === 'string' && e.id && !e.id.includes('/') ? e.id : newId();
      while (ids.has(id)) id = newId();
      ids.add(id);
      return {
        id, date: e.date, amount,
        memo: typeof e.memo === 'string' ? e.memo.slice(0, 100) : '',
        createdAt: Number(e.createdAt) || Date.now(),
        updatedAt: Number(e.updatedAt) || Date.now()
      };
    });
    const budgets = obj.budgets.map((b, i) => {
      const amount = Number(b.amount);
      if (!b || typeof b.key !== 'string' || !BUDGET_KEY.test(b.key) || !Number.isInteger(amount) || amount < 0 || amount > MAX_AMOUNT) {
        throw new Error(`${i + 1}번째 예산 데이터가 올바르지 않아요.`);
      }
      return { key: b.key, amount };
    });
    const settings = obj.settings && typeof obj.settings === 'object' ? obj.settings : {};
    return { expenses, budgets, settings: { theme: ['system', 'light', 'dark'].includes(settings.theme) ? settings.theme : 'system' }, exportedAt: obj.exportedAt || null };
  }

  function buildBackup(expenses, budgetMap, settings) {
    return {
      app: APP_ID,
      version: BACKUP_VERSION,
      exportedAt: new Date().toISOString(),
      expenses: expenses.map(({ id, date, amount, memo, createdAt, updatedAt }) => ({ id, date, amount, memo, createdAt, updatedAt })),
      budgets: Object.entries(budgetMap).map(([key, amount]) => ({ key, amount })),
      settings: { theme: settings.theme || 'system' }
    };
  }

  function newId() {
    if (root.crypto && root.crypto.randomUUID) return root.crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
  }

  // ---------- 기기별 설정 (localStorage) ----------
  function lsGet(key) { try { return localStorage.getItem(key); } catch (e) { return null; } }
  function lsSet(key, v) { try { v == null ? localStorage.removeItem(key) : localStorage.setItem(key, v); } catch (e) { /* 저장 안 돼도 동작 */ } }
  function loadSettings() {
    let s = {};
    try { s = JSON.parse(lsGet(SETTINGS_KEY) || '{}') || {}; } catch (e) { s = {}; }
    return { theme: 'system', lastBackup: s.lastBackup || null };
  }
  function setSetting(key, value) {
    const s = loadSettings(); s[key] = value;
    lsSet(SETTINGS_KEY, JSON.stringify({ lastBackup: s.lastBackup }));
    return Promise.resolve();
  }

  // ---------- Firebase ----------
  let db = null, auth = null, authReady = null;
  function init() {
    if (db) return;
    const fb = root.firebase;
    if (!fb) throw new Error('온라인 저장소를 불러오지 못했어요. 인터넷 연결을 확인해 주세요.');
    fb.initializeApp(FIREBASE_CONFIG);
    db = fb.firestore();
    db.enablePersistence({ synchronizeTabs: true }).catch(() => { /* 사생활 보호 모드 등: 온라인으로만 동작 */ });
    auth = fb.auth();
    authReady = new Promise(resolve => { const off = auth.onAuthStateChanged(u => { off(); resolve(u); }); });
  }
  const expensesCol = () => db.collection('expenses');
  const budgetsCol = () => db.collection('budgets');

  // 쓰기는 기다리지 않음(오프라인이면 연결될 때 올라감). 서버가 거부하면 알려줌
  let writeErrorHandler = () => {};
  const onWriteError = fn => { writeErrorHandler = fn; };
  const watch = p => { p.catch(e => writeErrorHandler(e)); };

  // 지출·예산이 바뀔 때마다 (다른 기기에서 바꿔도) 호출
  function subscribe(onData, onError) {
    init();
    let ex = null, bu = null;
    const emit = () => { if (ex && bu) onData({ expenses: ex, budgets: bu }); };
    expensesCol().onSnapshot(s => { ex = s.docs.map(d => ({ id: d.id, ...d.data() })); emit(); }, onError);
    budgetsCol().onSnapshot(s => { bu = {}; s.docs.forEach(d => { bu[d.id] = d.data().amount; }); emit(); }, onError);
  }

  function saveExpense(e) {
    init();
    const now = Date.now();
    const row = { ...e, id: e.id || newId(), createdAt: e.createdAt || now, updatedAt: now };
    const { id, ...data } = row;
    watch(expensesCol().doc(id).set({ date: data.date, amount: data.amount, memo: data.memo || '', createdAt: data.createdAt, updatedAt: data.updatedAt }));
    return Promise.resolve(row);
  }
  function deleteExpense(id) { init(); watch(expensesCol().doc(id).delete()); return Promise.resolve(); }
  function setBudget(key, amount) {
    init();
    const ref = budgetsCol().doc(key);
    watch(amount == null ? ref.delete() : ref.set({ amount }));
    return Promise.resolve();
  }
  function applyBudgetChanges(removeKeys, setMap) {
    init();
    const b = db.batch();
    removeKeys.forEach(k => b.delete(budgetsCol().doc(k)));
    Object.entries(setMap).forEach(([key, amount]) => b.set(budgetsCol().doc(key), { amount }));
    watch(b.commit());
    return Promise.resolve();
  }

  // 여러 건을 400개씩 나눠 한 번에 처리 (복원·전체 삭제·옛 데이터 올리기). 인터넷 연결 필요
  function requireOnline() { if (root.navigator && navigator.onLine === false) throw new Error('인터넷에 연결된 상태에서 다시 시도해 주세요.'); }
  async function commitAll(ops) {
    for (let i = 0; i < ops.length; i += 400) {
      const b = db.batch();
      ops.slice(i, i + 400).forEach(op => op(b));
      await b.commit();
    }
  }
  async function deleteAllOps() {
    const [es, bs] = await Promise.all([expensesCol().get(), budgetsCol().get()]);
    return [...es.docs, ...bs.docs].map(d => b => b.delete(d.ref));
  }
  const putOps = (expenses, budgets) => [
    ...expenses.map(e => b => b.set(expensesCol().doc(e.id), { date: e.date, amount: e.amount, memo: e.memo || '', createdAt: e.createdAt || Date.now(), updatedAt: e.updatedAt || Date.now() })),
    ...budgets.map(x => b => b.set(budgetsCol().doc(x.key), { amount: x.amount }))
  ];
  async function replaceAll(parsed) {
    init(); requireOnline();
    await commitAll([...await deleteAllOps(), ...putOps(parsed.expenses, parsed.budgets)]);
  }
  async function clearAll() {
    init(); requireOnline();
    await commitAll(await deleteAllOps());
  }

  // ---------- 수정 권한 (효정 기기 등록) ----------
  async function isOwner() {
    init();
    const user = await authReady;
    if (!user) return false;
    try {
      const doc = await db.collection('owners').doc(user.uid).get();
      if (doc.exists) lsSet(OWNER_HINT, user.uid); else lsSet(OWNER_HINT, null);
      return doc.exists;
    } catch (e) {
      return lsGet(OWNER_HINT) === user.uid;   // 오프라인: 지난번 확인 결과 사용
    }
  }
  // 비밀번호는 앱에 없고 서버 규칙에만 있음 → 틀리면 서버가 거부
  async function unlock(pin) {
    init(); requireOnline();
    await authReady;
    const user = auth.currentUser || (await auth.signInAnonymously()).user;
    const write = db.collection('owners').doc(user.uid).set({ pin, at: Date.now() });
    const timeout = new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), 10000));
    try {
      await Promise.race([write, timeout]);
    } catch (e) {
      if (e && e.code === 'permission-denied') return false;
      throw new Error('확인하지 못했어요. 인터넷 연결을 확인해 주세요.');
    }
    lsSet(OWNER_HINT, user.uid);
    return true;
  }
  async function lock() {
    init();
    lsSet(OWNER_HINT, null);
    await auth.signOut();   // 다음에 풀 때는 새 기기 번호로 다시 확인
  }

  // ---------- 예전 버전(휴대폰 안 저장) 데이터 ----------
  function legacyRead() {
    return new Promise(resolve => {
      if (!root.indexedDB || lsGet(LEGACY_DONE)) return resolve(null);
      const req = indexedDB.open('hyojeong-budget', 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('expenses')) d.createObjectStore('expenses', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('budgets')) d.createObjectStore('budgets', { keyPath: 'key' });
      };
      req.onerror = () => resolve(null);
      req.onsuccess = () => {
        const d = req.result;
        try {
          const t = d.transaction(['expenses', 'budgets']);
          const er = t.objectStore('expenses').getAll(), br = t.objectStore('budgets').getAll();
          t.oncomplete = () => { d.close(); resolve(er.result.length || br.result.length ? { expenses: er.result, budgets: br.result } : null); };
          t.onerror = () => { d.close(); resolve(null); };
        } catch (e) { d.close(); resolve(null); }
      };
    });
  }
  async function uploadLegacy(legacy) {
    init(); requireOnline();
    const budgets = legacy.budgets.filter(b => /^W:\d{4}-\d{2}-\d{2}$/.test(b.key));
    await commitAll(putOps(legacy.expenses, budgets));
    lsSet(LEGACY_DONE, '1');
  }
  const markLegacyDone = () => lsSet(LEGACY_DONE, '1');

  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* 지원 안 함 */ }
    return null;
  }

  const api = {
    parseBackup, buildBackup, newId, loadSettings, setSetting, subscribe, onWriteError,
    saveExpense, deleteExpense, setBudget, applyBudgetChanges, replaceAll, clearAll,
    isOwner, unlock, lock, legacyRead, uploadLegacy, markLegacyDone, requestPersist, MAX_AMOUNT
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this);
