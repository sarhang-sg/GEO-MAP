#!/usr/bin/env python3
"""Create a deterministic, secret-safe NAV KURD production source archive."""
from __future__ import annotations
import argparse, hashlib, json, re, stat, zipfile
from pathlib import Path

ROOT=Path(__file__).resolve().parents[2]
EXCLUDED_DIRS={'.git','.vercel','node_modules','dist','.data-inputs','.build-cache','__pycache__','.pytest_cache','.mypy_cache','.idea','.vscode'}
EXCLUDED_NAMES={'.DS_Store'}
REQUIRED_HIDDEN_SOURCE_FILES={'.env.example','.gitignore'}
SOURCE_DATA_MANIFEST=json.loads((ROOT/'data-src/source-data-manifest.json').read_text(encoding='utf-8'))
TRANSIENT_STAGE_PATHS={entry['stage'] for entry in SOURCE_DATA_MANIFEST['entries']}
ATOMIC_TEMP_PATTERN=re.compile(r'(?:^|/)\.[^/]+\.[A-Za-z0-9]{6}$')


def sha256(path:Path)->str:
    h=hashlib.sha256()
    with path.open('rb') as f:
        for chunk in iter(lambda:f.read(1024*1024),b''): h.update(chunk)
    return h.hexdigest()


def digest_bytes(body:bytes)->str:
    return hashlib.sha256(body).hexdigest()


def private_env(path:Path)->bool:
    return path.name=='.env' or (path.name.startswith('.env.') and path.name!='.env.example')


def included():
    for path in sorted(ROOT.rglob('*')):
        rel=path.relative_to(ROOT)
        if any(part in EXCLUDED_DIRS for part in rel.parts): continue
        if rel.as_posix() in TRANSIENT_STAGE_PATHS: continue
        if ATOMIC_TEMP_PATTERN.search(rel.as_posix()): continue
        if not path.is_file() or path.name in EXCLUDED_NAMES or private_env(path): continue
        if path.suffix.lower() in {'.pyc','.pyo','.log','.tmp','.zip','.sha256'}: continue
        yield path


def validate_source_manifest(manifest:dict, files:list[Path])->None:
    packaged={path.relative_to(ROOT).as_posix() for path in files}
    missing_hidden=sorted(REQUIRED_HIDDEN_SOURCE_FILES-packaged)
    if missing_hidden:
        raise SystemExit('Required deployment metadata is missing from the source archive:\n- '+'\n- '.join(missing_hidden))

    packaged_transient=[
        path.relative_to(ROOT).as_posix()
        for path in files
        if path.relative_to(ROOT).as_posix() in TRANSIENT_STAGE_PATHS
    ]
    if packaged_transient:
        raise SystemExit('Source-only staged data entered the package:\n- '+'\n- '.join(packaged_transient))

    expected=manifest.get('files') or {}
    actual={}
    for path in files:
        relative=path.relative_to(ROOT).as_posix()
        if relative=='RELEASE_MANIFEST.json':
            continue
        body=path.read_bytes()
        actual[relative]={'bytes':len(body),'sha256':digest_bytes(body)}
    missing=sorted(set(expected)-set(actual))
    extra=sorted(set(actual)-set(expected))
    changed=sorted(path for path in set(expected)&set(actual) if expected[path]!=actual[path])
    if missing or extra or changed:
        details=[]
        if missing: details.append('Missing files:\n- '+'\n- '.join(missing[:30]))
        if extra: details.append('Unmanifested files:\n- '+'\n- '.join(extra[:30]))
        if changed: details.append('Changed files:\n- '+'\n- '.join(changed[:30]))
        raise SystemExit('Release source changed after manifest verification. Regenerate and verify RELEASE_MANIFEST.json.\n'+'\n'.join(details))


def info(name:str,path:Path,date:tuple[int,int,int,int,int,int]):
    value=zipfile.ZipInfo(name,date)
    value.external_attr=((0o755 if path.stat().st_mode & stat.S_IXUSR else 0o644)&0xffff)<<16
    value.compress_type=zipfile.ZIP_DEFLATED
    value.create_system=3
    return value


def main():
    release=json.loads((ROOT/'release.config.json').read_text(encoding='utf-8'))
    manifest=json.loads((ROOT/'RELEASE_MANIFEST.json').read_text(encoding='utf-8'))
    if manifest.get('version')!=release['appVersion'] or manifest.get('release')!=release['releaseId']:
        raise SystemExit('Regenerate and verify RELEASE_MANIFEST.json before packaging.')
    parser=argparse.ArgumentParser()
    parser.add_argument('--output-dir',type=Path,default=Path('/mnt/data'))
    parser.add_argument('--name',default=f"NAV-KURD-{release['appVersion']}-PRODUCTION-SOURCE.zip")
    parser.add_argument('--root-name',default=f"GEO-MAP-WEB-{release['appVersion']}")
    args=parser.parse_args()
    if '/' in args.name or not args.name.endswith('.zip'): raise SystemExit('--name must be a plain ZIP filename')
    if not args.root_name or args.root_name in {'.','..'} or '/' in args.root_name or '\\' in args.root_name:
        raise SystemExit('--root-name must be a plain directory name')
    args.output_dir.mkdir(parents=True,exist_ok=True)
    target=args.output_dir/args.name
    target.unlink(missing_ok=True)
    top=args.root_name
    date_parts=tuple(map(int,release['releaseDate'].split('-')))+(0,0,0)
    files=list(included())
    validate_source_manifest(manifest,files)
    with zipfile.ZipFile(target,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=9,allowZip64=True) as archive:
        for path in files:
            rel=path.relative_to(ROOT).as_posix()
            archive.writestr(info(f'{top}/{rel}',path,date_parts),path.read_bytes())
    digest=sha256(target)
    sidecar=target.with_suffix('.zip.sha256')
    sidecar.write_text(f'{digest}  {target.name}\n',encoding='utf-8')
    report=target.with_suffix('.zip.manifest.json')
    report.write_text(json.dumps({
        'schema':'NAV KURD packaged source evidence v1','release':release['releaseId'],'version':release['appVersion'],
        'zip':target.name,'bytes':target.stat().st_size,'sha256':digest,'fileCount':len(files),
        'uncompressedBytes':sum(p.stat().st_size for p in files),'secretSafe':True,
        'requiredHiddenSourceFiles':sorted(REQUIRED_HIDDEN_SOURCE_FILES),
        'releaseManifestFileCount':manifest['fileCount'],'releaseManifestTotalBytes':manifest['totalBytes']
    },indent=2)+'\n',encoding='utf-8')
    print(json.dumps({'zip':str(target),'sha256':str(sidecar),'manifest':str(report),'bytes':target.stat().st_size,'files':len(files)},indent=2))
if __name__=='__main__': main()
