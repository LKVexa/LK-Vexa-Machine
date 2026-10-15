# SPDX-License-Identifier: GPL-3.0-only
"""Optional QA only. Independent tifffile writer/reader; Pillow handles u16.
No Python/numpy/tifffile is used by the console at runtime.
"""
import json, hashlib, importlib.util
from pathlib import Path
import numpy as np
import tifffile
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'tests/fixtures/independent-tiff'

def independent_inputs():
    FIX.mkdir(parents=True,exist_ok=True)
    manifest=[]
    for dtype in ['u1','u2','f4','f8']:
        base=[0,1,2,3,4,5,6,7,8,9,10,11,12,13,14]
        if dtype[0]=='f':base=[0.,-0.,1.,-1.,1/3,1e-20,-1e20,3.5,2**-10,2**10,-3.5,13.,14.,15.,16.]
        a=np.asarray(base,dtype='<'+dtype).reshape(3,5)
        binary=f'expected-{dtype}.bin';(FIX/binary).write_bytes(a.tobytes())
        for big in [False,True]:
            for endian in ['<','>']:
                name=f'{dtype}-{"big" if big else "classic"}-{"le" if endian=="<" else "be"}.tif'
                tifffile.imwrite(FIX/name,a,byteorder=endian,bigtiff=big,photometric='minisblack',rowsperstrip=2,metadata=None,resolution=(1,1),resolutionunit='NONE',software='tifffile independent QA',extratags=[(274,'H',1,1,False)] if dtype[0]=='u' else [])
                manifest.append({'file':name,'expected':binary,'dtype':{'u1':'u8','u2':'u16','f4':'f32','f8':'f64'}[dtype],'byteOrder':'II' if endian=='<' else 'MM','bigTiff':big,'strips':2,'width':5,'height':3,'sha256':hashlib.sha256((FIX/name).read_bytes()).hexdigest()})
    a=np.arange(15,dtype=np.uint16).reshape(3,5)
    tifffile.imwrite(FIX/'unaligned-bigtiff.tif',a,bigtiff=True,rowsperstrip=2,metadata=None,software='tifffile independent QA')
    tifffile.imwrite(FIX/'orientation-6.tif',a,metadata=None,extratags=[(274,'H',1,6,False)])
    (FIX/'manifest.json').write_text(json.dumps({'writer':'tifffile','version':tifffile.__version__,'files':manifest},indent=2)+'\n')
    return manifest

def check_outputs():
    out=ROOT/'examples/tiffs';qa=ROOT/'audit/russl-fixtures';results=[]
    want=(qa/'expected-field-f64le.bin').read_bytes()
    for name in ['russl-field.tif','russl-field-bigtiff.tif','russl-field-big-endian.tif']:
        with tifffile.TiffFile(out/name) as tf:
            assert len(tf.pages)==1
            page=tf.pages[0];arr=page.asarray();assert arr.shape==(128,128) and arr.dtype.kind=='f' and arr.dtype.itemsize==8
            assert arr.astype('<f8',copy=False).tobytes()==want
            meta=json.loads(page.description);assert meta['logicalShape']==[4,4,4,16,16]
            assert int(page.tags[274].value)==1 and int(page.tags[339].value)==3 and int(page.tags[296].value)==1
        results.append({'test':f'{name}: all 16,384 f64 samples bit-exact through independent decoder','status':'PASS'})
    for name in ['phase']+[f'processor-{i}' for i in range(1,8)]:
        expected=np.array(json.loads((qa/f'expected-{name}.json').read_text()),dtype=np.uint16).reshape(64,64)
        with tifffile.TiffFile(out/f'{name}.tif') as tf:
            assert np.array_equal(tf.pages[0].asarray(),expected)
            desc=json.loads(tf.pages[0].description)
            assert desc['classification']==('LOSSY' if name=='phase' else 'LOSSLESS')
        with Image.open(out/f'{name}.tif') as im:assert np.array_equal(np.array(im),expected)
        results.append({'test':f'{name}: all 4,096 u16 samples match in tifffile AND Pillow','status':'PASS'})
    # Corpus helper is a reviewed, pure, standard-library 40-line math module.
    file=ROOT/'corpus/russl-2.0.0/tooling/field_layout.py'
    spec=importlib.util.spec_from_file_location('layout',file);layout=importlib.util.module_from_spec(spec);spec.loader.exec_module(layout)
    oracle=tifffile.imread(out/'ordinal-oracle.tif').reshape(-1)
    vectors=ROOT/'corpus/russl-2.0.0/tests/vectors/field/fixed_shape_index_vectors.jsonl'
    count=0
    for line in vectors.read_text().splitlines():
        row=json.loads(line);k=row['ordinal'];assert int(oracle[k])==k==layout.ordinal(row['indices']);assert tuple(row['indices'])==layout.indices(k);count+=1
    assert count==16384
    results.append({'test':'all 16,384 ordinal TIFF samples checked against corpus fixture and independent Python helper','status':'PASS'})
    return results

def main():
    manifest=independent_inputs();results=check_outputs()
    report={'status':'PASS','decoder':'tifffile','version':tifffile.__version__,'numpy':np.__version__,'independentWriterFixtures':len(manifest),'results':results,'scope':'Bounded finite scalar subset; not general TIFF/OME-NGFF certification.'}
    (ROOT/'audit/RUSSL_INTEROP_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps(report,indent=2))
if __name__=='__main__':main()
