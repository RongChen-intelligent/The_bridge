from pathlib import Path
import argparse, hashlib, json, re, zipfile

root=Path(__file__).resolve().parents[1]
version=json.loads((root/'package.json').read_text(encoding='utf-8'))['version']
assert re.fullmatch(r'\d+\.\d+\.\d+',version)
parser=argparse.ArgumentParser()
parser.add_argument('--out',required=True)
out=Path(parser.parse_args().out).resolve();out.mkdir(parents=True,exist_ok=True)
patterns=[rb'scrypt:16384:8:5:[a-f0-9]{64}:[a-f0-9]{64}',rb'eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}',rb'-----BEGIN [A-Z ]*PRIVATE KEY-----']
def archive(name,entries):
    data=[]
    for p,arc in entries:
        payload=p.read_bytes()
        if p.suffix not in ['.png','.woff2'] and any(re.search(pattern,payload) for pattern in patterns):
            raise RuntimeError('Credential-like material detected in '+arc)
        data.append((payload,arc))
    target=out/name
    with zipfile.ZipFile(target,'w',zipfile.ZIP_DEFLATED,compresslevel=9) as z:
        for payload,arc in data:z.writestr(arc,payload)
    with zipfile.ZipFile(target) as z:
        assert z.testzip() is None
        names=z.namelist()
        assert len(names)==len(set(names))
        assert not any(n.startswith('/') or '..' in Path(n).parts or 'private' in Path(n).parts or 'node_modules' in Path(n).parts for n in names)
    return {'file':name,'bytes':target.stat().st_size,'sha256':hashlib.sha256(target.read_bytes()).hexdigest(),'entries':names}

frontend=[(p,p.relative_to(root/'dist/frontend').as_posix()) for p in (root/'dist/frontend').rglob('*') if p.is_file()]
assert {'index.html','thebridge.idhs.html','bridge-config.js','assets/cormorant.woff2','assets/manrope.woff2'} <= {n for _,n in frontend}
records=[archive(f'01-THE-BRIDGE-前端-{version}.zip',frontend)]
backend=['index.js','core.js','attachments.js','retention.js','store.js','http-store.js','http-client.js','package.json','package-lock.json']
records.append(archive(f'02-THE-BRIDGE-云函数-{version}.zip',[(root/'backend'/f,f) for f in backend]))
source=[]
for folder in ['frontend','backend','database','tests','scripts','docs']:
    for p in (root/folder).rglob('*'):
        if (p.is_file() and not any(part in ['node_modules','__pycache__','private','.local-pgdata'] for part in p.parts)
            and not p.name.startswith(('.env','.dev.vars')) and p.suffix not in ['.pem','.key','.sqlite','.sqlite3']
            and p.relative_to(root).as_posix() not in ['frontend/bridge.css','scripts/package.py','scripts/package-http.py']):
            source.append((p,p.relative_to(root).as_posix()))
for name in ['package.json','package-lock.json','.gitignore','README.md','HTTP-DEPLOY.md','PRODUCT.md','DESIGN.md']:
    source.append((root/name,name))
records.append(archive(f'03-THE-BRIDGE-源码备份-{version}.zip',source))
(out/'文件校验.json').write_text(json.dumps(records,ensure_ascii=False,indent=2),encoding='utf-8')
print(json.dumps([{k:v for k,v in r.items() if k!='entries'} for r in records],ensure_ascii=False,indent=2))
