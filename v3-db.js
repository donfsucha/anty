"use strict";

window.DLogisDB = (() => {
  const DB_NAME = "dlogis-control-v3";
  const DB_VERSION = 1;
  const STORES = [
    "telemetryLogs",
    "commandLogs",
    "checklistLogs",
    "batteryLogs",
    "alerts",
    "proofs",
    "auditLogs"
  ];
  let connectionPromise = null;

  function open() {
    if (connectionPromise) return connectionPromise;
    connectionPromise = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, DB_VERSION);
      request.onupgradeneeded = event => {
        const database = event.target.result;
        STORES.forEach(storeName => {
          if (!database.objectStoreNames.contains(storeName)) {
            const store = database.createObjectStore(storeName, { keyPath: "id" });
            store.createIndex("createdAt", "createdAt", { unique: false });
            store.createIndex("missionId", "missionId", { unique: false });
            store.createIndex("droneId", "droneId", { unique: false });
          }
        });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error || new Error("IndexedDB 연결 실패"));
    });
    return connectionPromise;
  }

  async function transaction(storeName, mode, handler) {
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, mode);
      const store = tx.objectStore(storeName);
      let request;
      try {
        request = handler(store);
      } catch (error) {
        reject(error);
        return;
      }
      tx.oncomplete = () => resolve(request?.result);
      tx.onerror = () => reject(tx.error || request?.error || new Error("IndexedDB 작업 실패"));
      tx.onabort = () => reject(tx.error || new Error("IndexedDB 작업 중단"));
    });
  }

  async function put(storeName, item) {
    if (!STORES.includes(storeName) || !item?.id) return;
    return transaction(storeName, "readwrite", store => store.put(item));
  }

  async function bulkPut(storeName, items = []) {
    if (!STORES.includes(storeName) || !items.length) return;
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readwrite");
      const store = tx.objectStore(storeName);
      items.forEach(item => item?.id && store.put(item));
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB 일괄 저장 실패"));
    });
  }

  async function getAll(storeName) {
    if (!STORES.includes(storeName)) return [];
    const database = await open();
    return new Promise((resolve, reject) => {
      const tx = database.transaction(storeName, "readonly");
      const request = tx.objectStore(storeName).getAll();
      request.onsuccess = () => resolve(request.result || []);
      request.onerror = () => reject(request.error || new Error("IndexedDB 조회 실패"));
    });
  }

  async function clearAll() {
    const database = await open();
    return Promise.all(
      STORES.map(
        storeName =>
          new Promise((resolve, reject) => {
            const tx = database.transaction(storeName, "readwrite");
            tx.objectStore(storeName).clear();
            tx.oncomplete = resolve;
            tx.onerror = () => reject(tx.error || new Error(`${storeName} 초기화 실패`));
          })
      )
    );
  }

  function mergeUnique(primary = [], secondary = []) {
    const map = new Map();
    [...primary, ...secondary].forEach(item => item?.id && map.set(item.id, item));
    return [...map.values()];
  }

  async function initialize(appState) {
    try {
      for (const storeName of STORES) {
        const stored = await getAll(storeName);
        if (stored.length) {
          appState[storeName] = mergeUnique(stored, appState[storeName] || []);
          appState[storeName].sort((a, b) => {
            const aTime = a.receivedAt || a.recordedAt || a.createdAt || a.occurredAt || a.deliveredAt || 0;
            const bTime = b.receivedAt || b.recordedAt || b.createdAt || b.occurredAt || b.deliveredAt || 0;
            return new Date(aTime) - new Date(bTime);
          });
        } else if (appState[storeName]?.length) {
          await bulkPut(storeName, appState[storeName]);
        }
      }
      persist();
      return true;
    } catch (error) {
      console.warn("IndexedDB 초기화 실패, 브라우저 상태 저장으로 계속합니다.", error);
      return false;
    }
  }

  async function getOperationalLogs() {
    const result = {};
    for (const storeName of STORES) result[storeName] = await getAll(storeName);
    return result;
  }

  return { open, put, bulkPut, getAll, clearAll, initialize, getOperationalLogs, stores: STORES };
})();
