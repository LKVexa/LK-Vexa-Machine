/** Same-origin IndexedDB virtual volume; NOT a physical NVMe/block device. */
export const DEVICE = 'nvme0n1'; // Stable legacy key: changing it would hide existing user data.
// A literal browser acceptance profile gets its own volume; ordinary console data stays in ja21-ssd.
export const VALIDATION_PROFILE=globalThis.location?.search==='?validation=semisili-v1';
const DB_NAME = VALIDATION_PROFILE?'ja21-semisili-validation-v1':'ja21-ssd', STORE = 'volumes';
async function openDb() {
  return new Promise((resolve,reject) => {
    let done = false;
    const req = indexedDB.open(DB_NAME,1);
    const timer = setTimeout(() => end(new Error('volume open timed out; existing data was not overwritten')),5000);
    function end(error, db) { if (done) { db?.close(); return; } done = true; clearTimeout(timer); error ? reject(error) : resolve(db); }
    req.onupgradeneeded = () => { if (!req.result.objectStoreNames.contains(STORE)) req.result.createObjectStore(STORE); };
    req.onerror = () => end(req.error || new Error('volume open failed'));
    req.onblocked = () => end(new Error('volume upgrade blocked by another window'));
    req.onsuccess = () => { const db = req.result; db.onversionchange = () => db.close(); end(null,db); };
  });
}
async function transaction(mode, action) {
  const db = await openDb();
  try {
    return await new Promise((resolve,reject) => {
      const tx = db.transaction(STORE,mode); let value, explicitError;
      const timer = setTimeout(() => { explicitError = new Error('volume transaction timed out'); try { tx.abort(); } catch { reject(explicitError); } },5000);
      tx.oncomplete = () => { clearTimeout(timer); resolve(value); };
      tx.onerror = tx.onabort = () => { clearTimeout(timer); reject(explicitError || tx.error || new Error('volume transaction aborted')); };
      try { action(tx.objectStore(STORE), v => { value = v; }, error => { explicitError = error; tx.abort(); }); }
      catch(error) { explicitError = error; tx.abort(); }
    });
  } finally { db.close(); }
}
export function readVolume(previous = false) {
  return transaction('readonly', (store,set) => { const req=store.get(previous ? DEVICE + ':previous' : DEVICE); req.onsuccess=() => set(req.result ?? null); });
}
export function revisionOf(record) {
  if (record === null || record === undefined) return 0;
  if (record.v === 1) return 0;
  if (record.v === 2 && Number.isSafeInteger(record.revision) && record.revision >= 1) return record.revision;
  throw new Error('unsupported volume revision; raw recovery export is available');
}
export function writeVolume(record, expectedRevision) {
  if (!record || record.v !== 2 || !Number.isSafeInteger(expectedRevision) || expectedRevision < 0 || !Number.isSafeInteger(record.revision) || record.revision !== expectedRevision+1) throw new Error('invalid volume revision');
  return transaction('readwrite', (store,set,abort) => {
    const req=store.get(DEVICE);
    req.onsuccess=() => {
      try {
        const old=req.result ?? null;
        if (revisionOf(old) !== expectedRevision) throw new Error('volume changed concurrently; refusing overwrite');
        if (old !== null) store.put(old,DEVICE + ':previous');
        store.put(record,DEVICE); set(record.revision);
      } catch(error) { abort(error); }
    };
  });
}
