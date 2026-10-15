import assert from 'node:assert/strict';

const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};

// This fixture verifies API/buffer orchestration. It does not compile or run WGSL.
// Its independent BigInt oracle is deliberately different from the uint32 shader.
export function gpuFixture(configuration={}) {
  const lost=deferred(), mapStarted=deferred(), mapGate=deferred(), deviceRequested=deferred(), deviceGate=deferred();
  const records={adapterCalls:0,deviceCalls:0,deviceDestroyed:0,buffers:[],shaderCode:null,submissions:0};
  const listeners=new Map();
  const device={
    lost:lost.promise,
    addEventListener(name,fn){listeners.set(name,fn);},
    removeEventListener(name,fn){if(listeners.get(name)===fn)listeners.delete(name);},
    pushErrorScope(){},
    async popErrorScope(){return configuration.scopedErrors?.shift() ?? null;},
    createBuffer(descriptor) {
      if(configuration.failBufferAt===records.buffers.length+1)throw configuration.allocationError || {name:'GPUOutOfMemoryError',message:'fixture allocation failed'};
      const buffer={descriptor,data:new ArrayBuffer(descriptor.size),destroyCount:0,unmapCount:0,mapped:false,
        async mapAsync(mode,offset,length) {
          assert.equal(mode,1);assert.equal(offset,0);assert.equal(length,descriptor.size);
          mapStarted.resolve();
          if(configuration.loseDuringMap){lost.resolve({reason:'unknown',message:'fixture device loss'});await new Promise(()=>{});}
          if(configuration.mapError)throw configuration.mapError;
          if(configuration.mapGate)await mapGate.promise;
          this.mapped=true;
        },
        getMappedRange(offset,length) {
          assert.equal(this.mapped,true);assert.equal(offset,0);assert.equal(length,descriptor.size);
          return configuration.badMappedRange?new ArrayBuffer(2):this.data;
        },
        unmap(){this.unmapCount++;this.mapped=false;},
        destroy(){this.destroyCount++;this.mapped=false;if(configuration.destroyBufferThrows && records.buffers[0]===this)throw new Error('fixture destruction failed');},
      };
      records.buffers.push(buffer);return buffer;
    },
    createShaderModule({code}) {
      records.shaderCode=code;
      return {async getCompilationInfo(){return {messages:configuration.shaderErrors || []};}};
    },
    async createComputePipelineAsync(descriptor) {
      assert.equal(descriptor.layout,'auto');assert.equal(descriptor.compute.entryPoint,'main');
      if(configuration.pipelineError)throw configuration.pipelineError;
      return {getBindGroupLayout(index){assert.equal(index,0);return {};}};
    },
    createBindGroup({entries}) {
      assert.deepEqual(entries.map(x=>x.binding),[0,1,2,3]);return {entries};
    },
    createCommandEncoder() {
      const commands={runs:[],copies:[]};
      return {
        beginComputePass(){const run={};commands.runs.push(run);return {
          setPipeline(pipeline){run.pipeline=pipeline;},setBindGroup(index,group){assert.equal(index,0);run.group=group;},
          dispatchWorkgroups(count){run.workgroups=count;},end(){run.ended=true;},
        };},
        copyBufferToBuffer(from,fromOffset,to,toOffset,length){commands.copies.push({from,fromOffset,to,toOffset,length});},
        finish(){return commands;},
      };
    },
    queue:{
      writeBuffer(buffer,offset,array){
        assert.equal(offset,0);
        const bytes=ArrayBuffer.isView(array)?new Uint8Array(array.buffer,array.byteOffset,array.byteLength):new Uint8Array(array);
        new Uint8Array(buffer.data).set(bytes);
      },
      submit(submissions){
        if(configuration.submitError)throw configuration.submitError;
        records.submissions++;
        if(configuration.uncapturedError)listeners.get('uncapturederror')?.({error:configuration.uncapturedError});
        for(const commands of submissions) {
          for(const run of commands.runs) {
            assert.equal(run.ended,true);
            const buffers=run.group.entries.map(e=>e.resource.buffer);
            const a=new Uint32Array(buffers[0].data), b=new Uint32Array(buffers[1].data), out=new Uint32Array(buffers[2].data);
            const [modulus,operation,count,padding]=new Uint32Array(buffers[3].data);
            assert.equal(padding,0);assert.equal(count,a.length);assert.equal(run.workgroups,Math.ceil(count/64));
            const m=BigInt(modulus);
            for(let i=0;i<count;i++) {
              const left=BigInt(a[i]),right=BigInt(b[i]);let value;
              if(operation===0)value=left+right;
              else if(operation===1)value=left-right;
              else if(operation===2)value=left*right;
              else if(operation===3)value=-left;
              else if(operation===4)value=m-1n-left;
              else throw new Error('fixture saw an invalid opcode');
              out[i]=Number((value%m+m)%m);
            }
            if(configuration.corruptIndex!==undefined)out[configuration.corruptIndex]=(out[configuration.corruptIndex]+1)%modulus;
          }
          for(const copy of commands.copies) {
            assert.equal(copy.fromOffset,0);assert.equal(copy.toOffset,0);
            new Uint8Array(copy.to.data).set(new Uint8Array(copy.from.data,0,copy.length));
          }
        }
      },
    },
    destroy(){records.deviceDestroyed++;lost.resolve({reason:'destroyed',message:'fixture disposed'});configuration.abortOnDestroy?.();},
  };
  const adapter={
    info:{vendor:'fixture vendor',architecture:'fixture architecture',device:'fixture device',description:'TEST DOUBLE',isFallbackAdapter:false},
    limits:{maxBufferSize:134217728,maxStorageBufferBindingSize:134217728,maxComputeWorkgroupSizeX:256,
      maxComputeInvocationsPerWorkgroup:256,maxComputeWorkgroupsPerDimension:65535,maxStorageBuffersPerShaderStage:8,maxUniformBuffersPerShaderStage:12},
    features:new Set(),
    async requestDevice(){records.deviceCalls++;deviceRequested.resolve();if(configuration.deviceError)throw configuration.deviceError;
      if(configuration.deviceGate)await deviceGate.promise;return device;},
  };
  if(configuration.fallback!==undefined)adapter.info.isFallbackAdapter=configuration.fallback;
  if(configuration.unknownFallback)delete adapter.info.isFallbackAdapter;
  if(configuration.legacyFallback!==undefined){delete adapter.info.isFallbackAdapter;adapter.isFallbackAdapter=configuration.legacyFallback;}
  if(configuration.infoThrows)Object.defineProperty(adapter,'info',{get(){throw new Error('fixture metadata withheld');}});
  if(configuration.limits)Object.assign(adapter.limits,configuration.limits);
  const gpu={async requestAdapter(options){records.adapterCalls++;assert.equal(options.forceFallbackAdapter,false);
    if(configuration.adapterError)throw configuration.adapterError;
    if(configuration.neverAdapter)await new Promise(()=>{});
    return configuration.noAdapter?null:adapter;}};
  return {gpu,adapter,device,records,mapStarted:mapStarted.promise,deviceRequested:deviceRequested.promise,
    releaseMap:()=>mapGate.resolve(),releaseDevice:()=>deviceGate.resolve(),lose:info=>lost.resolve(info)};
}
