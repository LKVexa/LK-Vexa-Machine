/** TEST DOUBLE ONLY: emulates the small IndexedDB surface used by ssd.js.
 * It is not evidence of browser durability, quota, eviction or crash semantics.
 */
export function fakeIndexedDB(initial, onCommit, { failRead=false, failWrite=false }={}) {
  let records=new Map(initial || []),opened=false;
  const db={objectStoreNames:{contains:()=>opened},createObjectStore(){opened=true;},close(){},transaction(name,mode){
    const staged=new Map(structuredClone([...records]));let pending=0,finished=false,check;
    const tx={error:null,oncomplete:null,onerror:null,onabort:null,abort(){if(finished)return;finished=true;clearImmediate(check);setImmediate(()=>tx.onabort?.());},objectStore(){return store;}};
    const fail=message=>{if(finished)return;tx.error=new Error(message);finished=true;setImmediate(()=>tx.onerror?.());};
    function done(){if(finished || pending)return;clearImmediate(check);check=setImmediate(()=>{if(finished || pending)return;if(mode==='readwrite' && failWrite){fail('injected write failure');return;}finished=true;if(mode==='readwrite'){records=staged;onCommit(structuredClone([...records]));}tx.oncomplete?.();});}
    const store={get(key){pending++;const req={};setImmediate(()=>{if(finished)return;if(failRead){fail('injected read failure');return;}req.result=structuredClone(staged.get(key));req.onsuccess?.();pending--;done();});return req;},put(value,key){pending++;const req={};setImmediate(()=>{if(finished)return;staged.set(key,structuredClone(value));req.result=key;req.onsuccess?.();pending--;done();});return req;}};
    done();return tx;
  }};
  return {open(){const req={};setImmediate(()=>{req.result=db;if(!opened){req.onupgradeneeded?.();opened=true;}req.onsuccess?.();});return req;}};
}
