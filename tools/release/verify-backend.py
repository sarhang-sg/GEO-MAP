#!/usr/bin/env python3
"""Verify the exact app backend, record its source, and prune owned obsolete functions."""
import argparse
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import urllib.error
import urllib.parse
import urllib.request

PROJECT = 'kaydgjhwnspnuqabaiqw'
ORIGIN = 'https://geo-map-kappa.vercel.app'
FUNCTIONS = ('delete-atlas-account', 'delete-atlas-place', 'review-atlas-submission')
VERSION = '10.4.4'
CODE = 100404


def request_json(path, method='GET', body=None):
    token = os.environ.get('SUPABASE_ACCESS_TOKEN')
    if not token:
        raise RuntimeError('SUPABASE_ACCESS_TOKEN is missing from the protected workflow.')
    request = urllib.request.Request('https://api.supabase.com' + path,
        data=None if body is None else json.dumps(body).encode(), method=method,
        headers={'Authorization':'Bearer '+token, 'Content-Type':'application/json'})
    try:
        with urllib.request.urlopen(request, timeout=60) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except urllib.error.HTTPError as error:
        # Do not publish response bodies, credentials, or SQL connection strings.
        raise RuntimeError(f'Supabase management request failed: HTTP {error.code}') from None


def query(sql):
    result = request_json(f'/v1/projects/{PROJECT}/database/query', 'POST', {'query':sql})
    if isinstance(result, dict):
        result = result.get('result', result.get('data'))
    if not isinstance(result, list):
        raise RuntimeError('Unexpected database response.')
    return result


def probe_functions():
    records = request_json(f'/v1/projects/{PROJECT}/functions')
    if isinstance(records, dict):
        records = records.get('functions', records.get('data'))
    if not isinstance(records, list):
        raise RuntimeError('Unexpected function inventory.')
    by_slug = {f['slug']:f for f in records}
    for slug in FUNCTIONS:
        if slug not in by_slug or by_slug[slug].get('verify_jwt') is not False:
            raise RuntimeError('Function auth configuration does not match the reviewed source: '+slug)
        url = f'https://{PROJECT}.supabase.co/functions/v1/{slug}'
        for method, status in (('OPTIONS', 204), ('POST', 401)):
            request = urllib.request.Request(url, method=method,
                data=b'{}' if method=='POST' else None,
                headers={'Origin':ORIGIN, 'Content-Type':'application/json'})
            try:
                response = urllib.request.urlopen(request, timeout=30)
            except urllib.error.HTTPError as error:
                response = error
            with response:
                if response.status != status or response.headers.get('X-Nav-Kurd-Version') != VERSION:
                    raise RuntimeError(f'{slug}: expected app {VERSION} / HTTP {status}, received HTTP {response.status}')
                if response.headers.get('Access-Control-Allow-Origin') != ORIGIN:
                    raise RuntimeError('Function CORS origin mismatch: '+slug)
    return records


def verify_identity(web_commit, android_commit):
    rows = query('select app_version, android_version_code, release_id, web_source_commit, android_source_commit '
                 'from public.nav_kurd_app_release where singleton=true')
    if len(rows)!=1 or rows[0] != {
        'app_version':VERSION, 'android_version_code':CODE,
        'release_id':'2026-10-13-nav-kurd-v10.4.4',
        'web_source_commit':web_commit, 'android_source_commit':android_commit}:
        raise RuntimeError('Backend version/source does not match the exact release.')
    return rows[0]


def verify_database_policies():
    rows = query("""
        select
          not exists (
            select 1 from pg_policies p
            cross join lateral unnest(p.roles) role_name
            cross join (values ('SELECT'),('INSERT'),('UPDATE'),('DELETE')) commands(command)
            where p.schemaname='public' and p.tablename like 'atlas_%'
              and p.permissive='PERMISSIVE' and p.cmd in (commands.command,'ALL')
            group by p.tablename,role_name,commands.command having count(*)>1
          ) as no_overlapping_policies,
          (select count(*)=7 from pg_indexes where schemaname='public' and indexname in (
            'atlas_activity_audit_actor_id_idx','atlas_feedback_reviewed_by_idx',
            'atlas_notifications_place_id_idx','atlas_notifications_revision_id_idx',
            'atlas_place_revisions_reviewed_by_idx','atlas_places_category_idx',
            'atlas_places_reviewed_by_idx')) as foreign_key_indexes_present,
          to_regclass('public.atlas_user_profiles_public_directory_idx') is not null
            and to_regclass('public.atlas_user_profiles_public_directory_online_idx') is null
            as one_public_directory_index,
          not exists (select 1 from pg_class c join pg_namespace n on n.oid=c.relnamespace
            where n.nspname='public' and c.relname like 'atlas_%'
              and c.relkind='r' and not c.relrowsecurity) as app_tables_protected
    """)
    if len(rows) != 1 or len(rows[0]) != 4 or any(value is not True for value in rows[0].values()):
        raise RuntimeError('Database policies/indexes do not match the reviewed cleanup migration.')
    return rows[0]


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--record', action='store_true')
    parser.add_argument('--cleanup', action='store_true')
    parser.add_argument('--expected-commit', required=True)
    parser.add_argument('--older-than')
    args=parser.parse_args()
    if os.environ.get('SUPABASE_PROJECT_ID') != PROJECT:
        raise RuntimeError('Unexpected Supabase project.')
    web_commit=args.expected_commit
    metadata=json.loads(Path('public/releases/latest.json').read_text())
    android_commit=metadata.get('artifact',{}).get('gitCommit','')
    if not re.fullmatch('[0-9a-f]{40}',web_commit) or not re.fullmatch('[0-9a-f]{40}',android_commit):
        raise RuntimeError('Verified source identities are required.')
    if os.environ.get('GITHUB_SHA') != web_commit or os.environ.get('GITHUB_REF') != 'refs/heads/main':
        raise RuntimeError('Backend operation requires the exact protected main source.')
    if args.record:
        query("update public.nav_kurd_app_release set web_source_commit='"+web_commit+
              "', android_source_commit='"+android_commit+"', updated_at=now() where singleton=true "
              "and app_version='10.4.4' and android_version_code=100404 returning singleton")
    identity=verify_identity(web_commit,android_commit)
    database=verify_database_policies()
    inventory=probe_functions()
    deleted=[]
    if args.cleanup:
        if not args.older_than:
            raise RuntimeError('Cleanup requires the original release cutoff.')
        cutoff=datetime.fromisoformat(args.older_than.replace('Z','+00:00')).timestamp()*1000
        obsolete=[]
        for function in inventory:
            slug=function['slug']
            if slug in FUNCTIONS:
                continue
            created=function.get('created_at')
            if isinstance(created,str):
                created=datetime.fromisoformat(created.replace('Z','+00:00')).timestamp()*1000
            if (not re.fullmatch(r'(?:nav-kurd-|atlas-|(?:delete|review|submit|update|notify|touch)-atlas-)[a-z0-9-]+',slug)
                    or not isinstance(created,(int,float)) or created>=cutoff):
                raise RuntimeError('A function outside the reviewed old app inventory was retained: '+slug)
            obsolete.append(function)
        for function in obsolete:
            verify_identity(web_commit,android_commit)
            current=request_json(f'/v1/projects/{PROJECT}/functions/'+urllib.parse.quote(function['slug'],safe=''))
            if current.get('id') != function['id'] or current.get('version') != function.get('version'):
                raise RuntimeError('An obsolete function changed during cleanup; it was retained.')
            request_json(f'/v1/projects/{PROJECT}/functions/'+urllib.parse.quote(function['slug'],safe=''),'DELETE')
            deleted.append(function['slug'])
        probe_functions()
    report={'appVersion':VERSION,'androidVersionCode':CODE,'identity':identity,'database':database,
            'protectedFunctionChecks':6,'obsoleteFunctionsDeleted':deleted,
            'providerRetainedRecords':['Supabase internal function versions and audit/platform logs; no selective purge endpoint.']}
    destination=Path(os.environ.get('RUNNER_TEMP','.'))/'NAV-KURD-BACKEND-REPORT.json'
    destination.write_text(json.dumps(report,indent=2)+'\n')
    print('PASS exact backend identity, CORS and unauthenticated-write protection. Obsolete app functions deleted:',len(deleted))


if __name__=='__main__':
    main()
