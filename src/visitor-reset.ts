import {guidedStorageKey} from './guided-tour-state.ts';
type Store=Pick<Storage,'getItem'|'setItem'|'removeItem'>;
export const PREVIOUS_VISITOR_KEY='corner-mart-guided-previous-player';
/** Only the three guided slots are reset. Keep one recoverable backup first. */
export function resetVisitorSaves(store:Store,breakfast:string,active:{key:string;value:string}){
  const keys=['breakfast','hot','rush'].map(guidedStorageKey);
  const before=Object.fromEntries(keys.map(k=>[k,store.getItem(k)]));
  store.setItem(PREVIOUS_VISITOR_KEY,JSON.stringify({...before,[active.key]:active.value}));
  try{
    store.setItem(keys[0],breakfast);
    for(const key of keys.slice(1))store.removeItem(key);
  }catch(error){
    for(const key of keys){
      try{if(before[key]===null)store.removeItem(key);else store.setItem(key,before[key]!);}catch{/* Backup remains available if storage itself fails. */}
    }
    throw error;
  }
}
