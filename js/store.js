// 휴대폰 내 저장소(IndexedDB) + 백업·복원
(function (root) {
  'use strict';

  const DB_NAME = 'hyojeong-budget';
  const DB_VERSION = 1;
  const APP_ID = 'hyojeong-budget';
  const BACKUP_VERSION = 1;
  const MAX_AMOUNT = 999999999999;
  // W:2026-11-02 = 그 주 월요일. W:2026-11-W1 은 예전 백업 형식(불러온 뒤 새 형식으로 옮김)
  const BUDGET_KEY = /^(M:\d{4}-\d{2}|W:\d{4}-\d{2}-\d{2}|W:\d{4}-\d{2}-W[1-6])$/;
  const DATE = /^\d{4}-\d{2}-\d{2}$/;

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
      let id = typeof e.id === 'string' && e.id ? e.id : newId();
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

  // ---------- IndexedDB ----------
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('expenses')) db.createObjectStore('expenses', { keyPath: 'id' }).createIndex('date', 'date');
        if (!db.objectStoreNames.contains('budgets')) db.createObjectStore('budgets', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings', { keyPath: 'key' });
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbp;
  }
  function tx(stores, mode, fn) {
    return open().then(db => new Promise((resolve, reject) => {
      const t = db.transaction(stores, mode, { durability: 'strict' });
      const result = fn(t);
      t.oncomplete = () => resolve(result);
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error || new Error('저장에 실패했어요.'));
    }));
  }
  function getAll(store) {
    return open().then(db => new Promise((resolve, reject) => {
      const req = db.transaction(store).objectStore(store).getAll();
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));
  }

  async function loadAll() {
    const [expenses, budgetRows, settingRows] = await Promise.all([getAll('expenses'), getAll('budgets'), getAll('settings')]);
    const budgets = {};
    budgetRows.forEach(b => { budgets[b.key] = b.amount; });
    const settings = { theme: 'system', lastBackup: null };
    settingRows.forEach(s => { settings[s.key] = s.value; });
    return { expenses, budgets, settings };
  }

  function saveExpense(e) {
    const now = Date.now();
    const row = { ...e, id: e.id || newId(), createdAt: e.createdAt || now, updatedAt: now };
    return tx(['expenses'], 'readwrite', t => { t.objectStore('expenses').put(row); return row; });
  }
  const deleteExpense = id => tx(['expenses'], 'readwrite', t => { t.objectStore('expenses').delete(id); });
  function setBudget(key, amount) {
    return tx(['budgets'], 'readwrite', t => {
      if (amount == null) t.objectStore('budgets').delete(key);
      else t.objectStore('budgets').put({ key, amount });
    });
  }
  // 예산 여러 개를 한 번에 바꿈 (주차 형식 변환용, 실패하면 아무것도 안 바뀜)
  function applyBudgetChanges(removeKeys, setMap) {
    return tx(['budgets'], 'readwrite', t => {
      const bs = t.objectStore('budgets');
      removeKeys.forEach(k => bs.delete(k));
      Object.entries(setMap).forEach(([key, amount]) => bs.put({ key, amount }));
    });
  }
  const setSetting = (key, value) => tx(['settings'], 'readwrite', t => { t.objectStore('settings').put({ key, value }); });

  // 복원: 한 트랜잭션으로 전체 교체 (실패하면 기존 데이터 유지)
  function replaceAll(parsed) {
    return tx(['expenses', 'budgets', 'settings'], 'readwrite', t => {
      const es = t.objectStore('expenses'), bs = t.objectStore('budgets'), ss = t.objectStore('settings');
      es.clear(); bs.clear();
      parsed.expenses.forEach(e => es.put(e));
      parsed.budgets.forEach(b => bs.put(b));
      ss.put({ key: 'theme', value: parsed.settings.theme });
    });
  }
  function clearAll() {
    return tx(['expenses', 'budgets', 'settings'], 'readwrite', t => {
      t.objectStore('expenses').clear(); t.objectStore('budgets').clear(); t.objectStore('settings').clear();
    });
  }

  async function requestPersist() {
    try {
      if (navigator.storage && navigator.storage.persist) {
        if (await navigator.storage.persisted()) return true;
        return await navigator.storage.persist();
      }
    } catch (e) { /* 지원 안 함 */ }
    return null;
  }

  const api = { parseBackup, buildBackup, newId, loadAll, saveExpense, deleteExpense, setBudget, applyBudgetChanges, setSetting, replaceAll, clearAll, requestPersist, MAX_AMOUNT };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Store = api;
})(typeof self !== 'undefined' ? self : this);
