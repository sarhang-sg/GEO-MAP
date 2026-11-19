#!/usr/bin/env python3
"""Finalize owner-visible repository details and remove superseded deployments."""
import argparse
import getpass
import json
import os
import re
import subprocess
from urllib.error import HTTPError
from urllib.parse import urlencode, quote
from urllib.request import Request, urlopen

SITE = 'https://geo-map-kappa.vercel.app'
OWNER = 'sarhang-sg'
TEAM = 'team_9pU9Kx8em9A8yRONSyyB9VGV'
VERSION = '11.0.0'
VERSION_CODE = 110001
RELEASE_TAG = f'v{VERSION}-build.{VERSION_CODE}'


def request(url, method='GET', payload=None, token=None):
    headers = {'Accept': 'application/json', 'User-Agent': 'NAV-KURD-release'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    data = None
    if payload is not None:
        data = json.dumps(payload).encode()
        headers['Content-Type'] = 'application/json'
    try:
        with urlopen(Request(url, headers=headers, data=data, method=method), timeout=40) as response:
            raw = response.read()
            return json.loads(raw) if raw else None
    except HTTPError as error:
        raise RuntimeError(f'{method} {url.split("?")[0]} returned HTTP {error.code}') from None


def gh(path, method='GET', payload=None):
    command = ['gh', 'api', path, '--method', method]
    if payload is not None:
        command += ['--input', '-']
    result = subprocess.run(command, input=json.dumps(payload) if payload else None,
                            text=True, capture_output=True, check=False)
    if result.returncode:
        raise RuntimeError(f'GitHub {method} {path} failed. Check gh auth status and repository access.')
    return json.loads(result.stdout) if result.stdout.strip() else None


def pages(path):
    page = 1
    while True:
        rows = gh(path + ('&' if '?' in path else '?') + f'per_page=100&page={page}')
        yield from rows
        if len(rows) < 100:
            return
        page += 1


def published():
    identity = request(SITE + '/release-identity.json')
    download = request(SITE + '/releases/latest.json')
    receipt = request(f'https://github.com/{OWNER}/GEO-ANDROID/releases/download/{RELEASE_TAG}/DOWNLOAD-RECEIPT.json')
    if (identity.get('appVersion') != VERSION or download.get('version') != VERSION
            or receipt.get('versionName') != VERSION or receipt.get('versionCode') != VERSION_CODE
            or download.get('apkSha256') != receipt.get('files', {}).get('apk', {}).get('sha256')
            or download.get('artifact', {}).get('gitCommit') != receipt.get('gitCommit')
            or not re.fullmatch('[0-9a-f]{40}', identity.get('gitCommit', ''))):
        raise RuntimeError('The public web application and signed Android release must both be 11.0.0 before retirement.')
    return identity['gitCommit']


def github_deployments(commit):
    repo = f'repos/{OWNER}/GEO-MAP'
    rows = list(pages(repo + '/deployments'))
    current = [row for row in rows if row['sha'] == commit]
    if not current:
        print('Current deployment metadata has not reached GitHub yet.')
        return
    cutoff = min(row['created_at'] for row in current)
    protected = {commit} | {row['head']['sha'] for row in pages(repo + '/pulls?state=open')}
    for row in rows:
        if row['sha'] in protected or row['created_at'] >= cutoff:
            continue
        statuses = gh(repo + f'/deployments/{row["id"]}/statuses?per_page=1')
        if statuses and statuses[0]['state'] in ('queued', 'in_progress', 'pending'):
            continue
        if request(SITE + '/release-identity.json')['gitCommit'] != commit:
            raise RuntimeError('Production changed during cleanup. Run the command again for the new release.')
        endpoint = repo + f'/deployments/{row["id"]}'
        gh(endpoint + '/statuses', 'POST', {'state': 'inactive', 'auto_inactive': False,
                                          'description': 'Superseded by NAV KURD 11.0.0 production'})
        gh(endpoint, 'DELETE')
        print('Removed superseded GitHub deployment', row['id'])


def vercel_deployments(commit):
    token = os.environ.get('VERCEL_TOKEN') or getpass.getpass('Vercel token for the sarhang team (hidden input): ')
    if not token.strip():
        raise RuntimeError('A Vercel token with access to the sarhang team is required for deployment cleanup.')

    def api(path, method='GET', **query):
        query['teamId'] = TEAM
        return request('https://api.vercel.com' + path + '?' + urlencode(query), method, token=token.strip())

    active = api('/v13/deployments/geo-map-kappa.vercel.app')
    active_sha = (active.get('gitSource') or {}).get('sha') or (active.get('meta') or {}).get('githubCommitSha')
    if active.get('readyState') != 'READY' or active_sha != commit:
        raise RuntimeError('Vercel production does not match the published source.')
    project = active['projectId']
    settings = api('/v9/projects/' + quote(project, safe=''))
    link = settings.get('link') or {}
    if settings.get('name') != 'geo-map' or link.get('repo') != 'GEO-MAP' or link.get('org') != OWNER:
        raise RuntimeError('Vercel project is not linked to the expected GEO-MAP repository.')
    cutoff = active.get('createdAt') or active['created']
    rows = []
    query = {'projectId': project, 'limit': 100}
    while True:
        batch = api('/v7/deployments', **query)
        rows.extend(batch['deployments'])
        cursor = batch.get('pagination', {}).get('next')
        if cursor is None:
            break
        query['until'] = cursor
    for row in rows:
        deployment_id = row.get('uid') or row['id']
        if (deployment_id == active['id'] or (row.get('createdAt') or row['created']) >= cutoff
                or row.get('state') in ('QUEUED', 'BUILDING', 'INITIALIZING')):
            continue
        aliases = api('/v2/deployments/' + quote(deployment_id, safe='') + '/aliases')['aliases']
        if any(not alias['alias'].endswith('.vercel.app') for alias in aliases):
            print('Retained deployment serving an additional custom domain', deployment_id)
            continue
        if api('/v13/deployments/geo-map-kappa.vercel.app')['id'] != active['id']:
            raise RuntimeError('The production alias changed during cleanup. Run the command again.')
        api('/v13/deployments/' + quote(deployment_id, safe=''), 'DELETE')
        print('Removed superseded Vercel deployment', deployment_id)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--github-deployments', action='store_true', help='Clean GitHub deployment history using the workflow token')
    args = parser.parse_args()
    commit = published()
    if args.github_deployments:
        expected = os.environ.get('GITHUB_SHA')
        if expected and expected != commit:
            raise RuntimeError('A newer web commit is in production. Its workflow owns cleanup.')
        github_deployments(commit)
        return
    subprocess.run(['gh', 'auth', 'status'], check=True)
    for repo, description in [('GEO-MAP', 'NAV KURD 11.0.0 Web GIS'),
                              ('GEO-ANDROID', 'NAV KURD 11.0.0 Flutter Android')]:
        gh(f'repos/{OWNER}/{repo}', 'PATCH', {'description': description})
        print('Updated repository description', repo)
    vercel_deployments(commit)
    github_deployments(commit)
    print('NAV KURD 11.0.0 repository descriptions and deployment cleanup completed.')


if __name__ == '__main__':
    try:
        main()
    except (RuntimeError, OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        raise SystemExit(str(error)) from None
