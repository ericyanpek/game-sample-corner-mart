import {compare} from './comparison.ts';
self.onmessage=()=>{
  try {const report=compare(done=>self.postMessage({done}));self.postMessage({report});}
  catch(error){self.postMessage({error:String(error)});}
};
