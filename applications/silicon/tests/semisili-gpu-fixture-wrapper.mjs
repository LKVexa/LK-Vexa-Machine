/** TEST DOUBLE ADAPTER: injecting GPU dependencies must never certify hardware. */
import {confirmFiniteGpu as actualConfirmation} from '../src/lib/semisili-gpu.js';
export function confirmFiniteGpu(input,options) {
  if(!globalThis.semisiGpuFixture)return actualConfirmation(input,options);
  return actualConfirmation(input,{...options,gpu:globalThis.semisiGpuFixture.gpu,secureContext:true,useOverrides:true});
}
