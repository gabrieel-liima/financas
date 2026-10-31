// Armazenamento no próprio iPhone (IndexedDB). Nada sai do aparelho.

const DB_NAME = 'controle-financeiro';
const DB_VERSION = 1;
const STORES = {
  settings: 'key',
  incomes: 'id',
  fixedTemplates: 'id',
  fixedMonths: 'id',
  expenses: 'id',
  dayLimits: 'date',
};

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      for (const [name, keyPath] of Object.entries(STORES)) {
        if (!db.objectStoreNames.contains(name)) db.createObjectStore(name, { keyPath });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function getAll(db, store) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(store, 'readonly').objectStore(store).getAll();
    req.onsuccess = () => resolve(req.result || []);
    req.onerror = () => reject(req.error);
  });
}

function run(store, fn) {
  return openDB().then(db => new Promise((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    fn(tx.objectStore(store));
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  }));
}

/** Carrega todos os dados para a memória. */
export async function loadAll() {
  const db = await openDB();
  const [settings, incomes, fixedTemplates, fixedMonths, expenses, dayLimits] =
    await Promise.all(Object.keys(STORES).map(s => getAll(db, s)));
  const main = settings.find(s => s.key === 'main') ||
    { key: 'main', setupDone: false, setupDate: null, salaryDefault: 0 };
  const limits = {};
  for (const d of dayLimits) limits[d.date] = d.limit;
  return { settings: main, incomes, fixedTemplates, fixedMonths, expenses, dayLimits: limits };
}

export function put(store, obj) {
  return run(store, s => s.put(obj));
}

export function del(store, key) {
  return run(store, s => s.delete(key));
}

export async function clearAll() {
  for (const store of Object.keys(STORES)) await run(store, s => s.clear());
}
