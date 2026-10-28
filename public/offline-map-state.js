/* One PWA MapState journal. Confirmed OPFS bytes, never CacheStorage size. */
(() => {
  'use strict';
  let opening;
  let changes;
  const listeners = new Set();
  function channel() {
    if (!changes && typeof BroadcastChannel === 'function') {
      changes = new BroadcastChannel('nav-kurd-map-state');
      changes.onmessage = event => listeners.forEach(listener => listener(event.data));
    }
    return changes;
  }
  function open() {
    return opening ??= new Promise((resolve, reject) => {
      const request = indexedDB.open('nav-kurd-map-state', 1);
      request.onupgradeneeded = () => request.result.createObjectStore('packs');
      request.onsuccess = () => { request.result.onversionchange = () => { request.result.close(); opening = undefined; }; resolve(request.result); };
      request.onerror = () => { opening = undefined; reject(request.error); };
      request.onblocked = () => { opening = undefined; reject(new Error('offline-pack-state-blocked')); };
    });
  }
  async function read(key) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readonly');
      const request = tx.objectStore('packs').get(key);
      tx.oncomplete = () => resolve(request.result ?? null);
      tx.onabort = tx.onerror = () => reject(tx.error ?? request.error);
    });
  }
  function confirmed(state) {
    return Object.values(state.files).reduce((sum, file) => {
      if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !Array.isArray(file.chunks)
        || file.chunks.some(chunk => !Number.isSafeInteger(chunk.bytes) || chunk.bytes < 1 || !/^[0-9a-f]{64}$/.test(chunk.sha256))
        || file.chunks.reduce((n, chunk) => n + chunk.bytes, 0) !== file.bytes) throw new Error('offline-pack-state-ranges');
      return sum + file.bytes;
    }, 0) + Object.entries(state.runtime.confirmed).reduce((sum, [path, receipt]) => {
      const planned = state.runtime.entries.find(entry => entry.path === path);
      if (!planned || receipt.bytes !== planned.bytes || receipt.sha256 !== planned.sha256) throw new Error('offline-pack-state-resource');
      return sum + receipt.bytes;
    }, 0);
  }
  async function commit(key, expectedRevision, next) {
    const db = await open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction('packs', 'readwrite', { durability: 'strict' });
      const store = tx.objectStore('packs');
      const request = store.get(key);
      let failure, result;
      request.onsuccess = () => {
        const current = request.result;
        if ((current?.revision ?? 0) !== expectedRevision) { failure = new Error('offline-pack-state-conflict'); tx.abort(); return; }
        try {
          if (next.schema !== 2 || `${next.packVersion}:${next.mapDataVersion}` !== key || !Number.isSafeInteger(next.epoch)) throw new Error('offline-pack-state-identity');
          const bytes = confirmed(next);
          if (current) {
            if (next.epoch === current.epoch) {
              if (bytes < confirmed(current)) throw new Error('offline-pack-state-regression');
              if (current.runtime.entries.length && JSON.stringify(next.runtime.entries) !== JSON.stringify(current.runtime.entries)) throw new Error('offline-pack-state-plan-changed');
            } else if (next.epoch !== current.epoch + 1 || next.reconciliation !== 'explicit-delete' || bytes !== 0) throw new Error('offline-pack-state-reset-not-authorized');
          }
          result = structuredClone(next); result.revision = expectedRevision + 1; result.updatedAt = Date.now();
          store.put(result, key);
        } catch (error) { failure = error; tx.abort(); }
      };
      tx.oncomplete = () => { channel()?.postMessage(key); listeners.forEach(listener => listener(key)); resolve(result); };
      tx.onabort = tx.onerror = () => reject(failure ?? tx.error ?? request.error);
    });
  }
  Object.defineProperty(globalThis, 'NavKurdMapStateStore', { value: Object.freeze({ read, commit, subscribe: listener => { channel(); listeners.add(listener); return () => listeners.delete(listener); } }) });
})();
