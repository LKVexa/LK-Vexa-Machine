"""Run both draft gates from one fully verified immutable baseline byte snapshot."""
import argparse,importlib.util
from pathlib import Path
file=Path(__file__).resolve().parent/'package-hermit-release.py'
spec=importlib.util.spec_from_file_location('hermit_draft_package',file)
module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
# load_base verifies the pin, full ZIP CRC and all baseline manifests before caching.
parser=argparse.ArgumentParser();parser.add_argument('--native-revalidation',action='store_true');args=parser.parse_args()
baseline=module.load_base()
module.load_base=lambda:baseline
module.check(args.native_revalidation)
module.draft_native_runtime(args.native_revalidation)
