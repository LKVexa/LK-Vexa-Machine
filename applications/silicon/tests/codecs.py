"""Independent Pillow pixel checks. Run Node tests first to regenerate encoder fixtures.
Pillow is an optional QA dependency, not a runtime dependency of the application.
"""
import json
from pathlib import Path
import PIL
from PIL import Image
ROOT=Path(__file__).resolve().parents[1]
FIX=ROOT/'audit/codec-fixtures'
def pixels(image):
    return list(image.get_flattened_data() if hasattr(image,'get_flattened_data') else image.getdata())
def main():
    results=[]
    with Image.open(FIX/'phase.tif') as im:
        assert im.size==(64,64)
        assert pixels(im)==json.loads((FIX/'expected-phase.json').read_text())
    results.append({'test':'16-bit TIFF: all 4096 decoded samples match','status':'PASS'})
    expected=json.loads((FIX/'expected-frames.json').read_text())
    with Image.open(FIX/'spool.gif') as im:
        assert im.size==(64,64) and im.n_frames==len(expected)
        for i,frame in enumerate(expected):
            im.seek(i)
            assert pixels(im.convert('L'))==frame
    results.append({'test':'animated GIF: every pixel of both frames matches','status':'PASS'})
    with Image.open(FIX/'random.gif') as im:
        assert pixels(im.convert('L'))==json.loads((FIX/'expected-random.json').read_text())
    results.append({'test':'high-entropy GIF: all 4096 decoded samples match','status':'PASS'})
    report={'decoder':'Pillow','decoderVersion':PIL.__version__,'tests':results}
    (ROOT/'audit/CODEC_RESULTS.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps(report,indent=2))
if __name__=='__main__':main()
