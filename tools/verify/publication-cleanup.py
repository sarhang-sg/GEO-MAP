"""Check which workflow artifacts the owner command may delete."""
import importlib.util
import unittest
from pathlib import Path
from unittest.mock import patch

path = Path(__file__).resolve().parents[1] / 'release/finalize-publication.py'
spec = importlib.util.spec_from_file_location('finalize', path)
finalize = importlib.util.module_from_spec(spec)
spec.loader.exec_module(finalize)


class ArtifactCleanup(unittest.TestCase):
    def test_only_recognized_older_artifacts_from_the_owning_repository(self):
        repo_id = 17
        old, current, future, protected, open_pr, unknown = (c * 40 for c in 'abcdef')
        name = 'NAV-KURD-10.4.6-signed-release'

        def artifact(identifier, commit, label=name, owner=repo_id, expired=False):
            return {'id': identifier, 'name': label, 'expired': expired,
                    'workflow_run': {'head_sha': commit, 'repository_id': repo_id, 'head_repository_id': owner}}

        first = [artifact(i, old, 'unrelated') for i in range(100)]
        last = [artifact(110, old), artifact(111, current), artifact(112, future),
                artifact(113, protected), artifact(114, open_pr), artifact(115, unknown),
                artifact(116, old, owner=99), artifact(117, old, expired=True),
                artifact(118, old, 'NAV-KURD-10.4.4-signed-release'),
                artifact(119, old, 'nav-kurd-launcher-check')]
        inventory = {
            'repos/sarhang-sg/GEO-ANDROID': {'id': repo_id},
            'repos/sarhang-sg/GEO-ANDROID/pulls?state=open&per_page=100&page=1': [{'head': {'sha': open_pr}}],
            'repos/sarhang-sg/GEO-ANDROID/actions/artifacts?per_page=100&page=1': {'artifacts': first},
            'repos/sarhang-sg/GEO-ANDROID/actions/artifacts?per_page=100&page=2': {'artifacts': last},
        }
        versions = {old: '10.4.6', current: '11.0.0', future: '12.0.0', unknown: None}
        with patch.object(finalize, 'gh', side_effect=inventory.__getitem__), \
             patch.object(finalize, 'artifact_source_version', side_effect=lambda repo, sha: versions[sha]) as resolve:
            result = finalize.old_workflow_artifacts('GEO-ANDROID', {protected})
        self.assertEqual(result, [(110, name, '10.4.6'), (119, 'nav-kurd-launcher-check', '10.4.6')])
        self.assertEqual(resolve.call_count, len(versions))


if __name__ == '__main__':
    unittest.main()
