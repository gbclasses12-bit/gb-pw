import zipfile
import shutil
import os

os.makedirs('public', exist_ok=True)
os.makedirs('dist', exist_ok=True)

# Clean up any static assets copied from public/ that should NOT ship in Cloudflare Pages Direct Upload
stale_dist_zip = os.path.join('dist', 'cloudflare-pages.zip')
if os.path.exists(stale_dist_zip):
    os.remove(stale_dist_zip)

stale_aistudio_dir = os.path.join('dist', 'assets', 'aistudio')
if os.path.isdir(stale_aistudio_dir):
    shutil.rmtree(stale_aistudio_dir)

worker_src = os.path.join('dist', '_worker.js')
if not os.path.exists(worker_src) or os.path.getsize(worker_src) < 40000:
    raise RuntimeError(f"Expected bundled dist/_worker.js (>40KB), got {worker_src}")

# Build public/cloudflare-pages.zip with clean Cloudflare Pages Direct Upload files at archive root:
# - _worker.js (Advanced Mode Worker)
# - index.html, logo.png, assets/*
# Strictly exclude _routes.json, duplicate worker.js, source files, and internal aistudio assets.
zip_path = 'public/cloudflare-pages.zip'
tmp_zip_path = 'public/cloudflare-pages.zip.tmp'
with zipfile.ZipFile(tmp_zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for root, dirs, files in os.walk('dist'):
        dirs[:] = sorted([d for d in dirs if d != 'aistudio'])
        for file in sorted(files):
            if (
                file in ('cloudflare-pages.zip', '_routes.json', 'worker.js')
                or file.endswith(('.ts', '.tsx', '.map'))
            ):
                continue
            full_path = os.path.join(root, file)
            rel_path = os.path.relpath(full_path, 'dist').replace(os.sep, '/')
            if rel_path.startswith('assets/aistudio/'):
                continue
            z.write(full_path, rel_path)

with zipfile.ZipFile(tmp_zip_path, 'r') as z_check:
    bad_file = z_check.testzip()
    if bad_file is not None:
        raise RuntimeError(f"Corrupted file in zip: {bad_file}")
    names = z_check.namelist()
    if '_worker.js' not in names:
        raise RuntimeError("Missing _worker.js at root of cloudflare-pages.zip")
    if '_routes.json' in names or any('aistudio' in n for n in names):
        raise RuntimeError(f"Unexpected disallowed entries in zip: {names}")

os.replace(tmp_zip_path, zip_path)
print(f"Created and verified {zip_path} ({os.path.getsize(zip_path)} bytes) with entries: {names}")
