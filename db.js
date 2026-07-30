const DB_NAME = 'dakkani-db';
const DB_VERSION = 1;
let db = null;

function openDB() {
  return new Promise((resolve, reject) => {
    if (db) return resolve(db);
    const request = window.indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event) => {
      const database = event.target.result;
      if (!database.objectStoreNames.contains('settings')) {
        database.createObjectStore('settings', { keyPath: 'key' });
      }
      if (!database.objectStoreNames.contains('products')) {
        database.createObjectStore('products', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('sales')) {
        database.createObjectStore('sales', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('debts')) {
        database.createObjectStore('debts', { keyPath: 'id' });
      }
      if (!database.objectStoreNames.contains('employees')) {
        database.createObjectStore('employees', { keyPath: 'id' });
      }
    };

    request.onsuccess = (event) => {
      db = event.target.result;
      resolve(db);
    };

    request.onerror = (event) => reject(event.target.error);
  });
}

function dbGet(storeName, key) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbGetAll(storeName) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const transaction = database.transaction(storeName, 'readonly');
    const store = transaction.objectStore(storeName);
    const request = store.getAll();
    request.onsuccess = () => resolve(request.result || []);
    request.onerror = () => reject(request.error);
  });
}

function dbAdd(storeName, value) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.put(value);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function dbDelete(storeName, key) {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const transaction = database.transaction(storeName, 'readwrite');
    const store = transaction.objectStore(storeName);
    const request = store.delete(key);
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
  });
}

function dbClearAll() {
  return new Promise(async (resolve, reject) => {
    const database = await openDB();
    const storeNames = ['settings', 'products', 'sales', 'debts', 'employees'];
    const transaction = database.transaction(storeNames, 'readwrite');
    storeNames.forEach(name => transaction.objectStore(name).clear());
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function exportAllData() {
  const settings = await dbGetAll('settings');
  const products = await dbGetAll('products');
  const sales = await dbGetAll('sales');
  const debts = await dbGetAll('debts');
  const employees = await dbGetAll('employees');
  return { settings, products, sales, debts, employees };
}

async function importAllData(data) {
  await dbClearAll();
  const operations = [];
  ['settings', 'products', 'sales', 'debts', 'employees'].forEach(storeName => {
    const items = data[storeName] || [];
    items.forEach(item => operations.push(dbAdd(storeName, item)));
  });
  await Promise.all(operations);
}

function uid() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}