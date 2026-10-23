import hashlib, json, os, zipfile

d = 'frontend/dist'
u = 'deploy/backend/update'

# 1. 生成 www.zip（Python zipfile，稳定可靠）
zip_path = u + '/www.zip'
with zipfile.ZipFile(zip_path, 'w', zipfile.ZIP_DEFLATED) as z:
    for r, _, fs in os.walk(d):
        for f in fs:
            fp = os.path.join(r, f)
            rel = os.path.relpath(fp, d).replace('\\', '/')
            z.write(fp, rel)

# 2. 生成 manifest.json
vc = int(open('frontend/.versioncode').read().strip())
pkg = json.load(open('frontend/package.json'))
files = {}
for r, _, fs in os.walk(d):
    for f in fs:
        fp = os.path.join(r, f)
        rel = os.path.relpath(fp, d).replace('\\', '/')
        h = hashlib.sha256(open(fp, 'rb').read()).hexdigest()
        files[rel] = {'sha256': h, 'size': os.path.getsize(fp)}
json.dump({
    'version': pkg['version'],
    'versionCode': vc,
    'files': files,
    'needsReinstall': True,
    'apkUrl': 'update/app-debug.apk',
}, open(u + '/manifest.json', 'w'), indent=2)

z_size = os.path.getsize(zip_path)
print(f'done: {pkg["version"]}, vc={vc}, {len(files)} files, zip={z_size} bytes')
