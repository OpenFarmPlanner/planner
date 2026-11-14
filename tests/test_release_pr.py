"""Release metadata is reviewed in a PR; publication cannot rewrite main or tags."""

from __future__ import annotations

import copy
import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from scripts.ci import release_pr as release


class ReleaseValidationTests(unittest.TestCase):
    def test_versions_and_release_plan_reject_ambiguous_metadata(self):
        self.assertEqual(release.versions(b'VERSION = "1.2.3"\n', b'[project]\nversion="1.2.3"'), '1.2.3')
        with self.assertRaises(ValueError):
            release.versions(b'VERSION = "1.2.3"\n', b'[project]\nversion="1.2.4"')
        valid = {'source': 'a' * 40, 'version': '1.2.3',
                 'files': {path: 'b' * 64 for path in release.FILES}}
        body = f'<!-- ofp-release-plan:v1 {json.dumps(valid)} -->'
        self.assertEqual(release.parse_plan(body), valid)
        for plan in [dict(valid, version='1.2.3; echo injected'), dict(valid, source='main'),
                     dict(valid, files={**valid['files'], 'malicious.py': 'c' * 64})]:
            with self.assertRaises(ValueError):
                release.parse_plan(f'<!-- ofp-release-plan:v1 {json.dumps(plan)} -->')
        with self.assertRaises(ValueError):
            release.parse_plan(body + '\n' + body)

    def test_publication_requires_latest_successful_checks_from_the_required_app(self):
        rules = {'strict': True, 'checks': [{'context': 'quality', 'app_id': 10}]}
        success = {'id': 1, 'name': 'quality', 'app': {'id': 10},
                   'status': 'completed', 'conclusion': 'success'}
        for checks in [[success], [], [dict(success, app={'id': 11})],
                       [success, dict(success, id=2, status='in_progress')],
                       [success, dict(success, id=2, conclusion='failure')]]:
            with patch.object(release, 'api', return_value=rules), \
                 patch.object(release, 'run', return_value='\n'.join(map(json.dumps, checks))):
                if checks == [success]:
                    release.require_checks({'head': {'sha': 'a' * 40}})
                else:
                    with self.assertRaises(ValueError):
                        release.require_checks({'head': {'sha': 'a' * 40}})
        with patch.object(release, 'api', return_value={**rules, 'strict': False}), \
             self.assertRaises(ValueError):
            release.require_checks({'head': {'sha': 'a' * 40}})


@unittest.skipUnless(shutil.which('semantic-release'), 'Install pinned python-semantic-release for integration tests.')
class ReleaseFlowTests(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        previous = Path.cwd()
        os.chdir(directory.name)
        self.addCleanup(os.chdir, previous)
        self.real_run = release.run
        self.real_run('git', 'init', '-q', '-b', 'main')
        self.real_run('git', 'config', 'user.name', 'Release test')
        self.real_run('git', 'config', 'user.email', 'release-test@example.invalid')
        self.real_run('git', 'remote', 'add', 'origin', 'https://github.com/OpenFarmPlanner/planner.git')
        Path('backend/config').mkdir(parents=True)
        Path('backend/config/version.py').write_text('VERSION = "1.0.0"\n')
        Path('backend/pyproject.toml').write_text('[project]\nname="fixture"\nversion="1.0.0"\n')
        Path('pyproject.toml').write_text('''[tool.semantic_release]
tag_format = "v{version}"
version_variables = ["backend/config/version.py:VERSION"]
version_toml = ["backend/pyproject.toml:project.version"]
[tool.semantic_release.branches.main]
match = "^main$"
''')
        self.real_run('git', 'add', '.')
        self.real_run('git', 'commit', '-qm', 'chore: initialize fixture')
        self.real_run('git', 'tag', 'v1.0.0')
        self.real_run('git', 'commit', '--allow-empty', '-qm', 'fix: actual product change')
        self.source = release.git('rev-parse', 'HEAD')
        self.pr = None
        self.reference = None
        self.tag = None
        self.published = None
        self.calls = []
        self.checks_pass = True

        def api(endpoint, payload=None, *, missing=False):
            self.calls.append(('api', endpoint, payload))
            if endpoint == 'git/ref/heads/main':
                return {'object': {'sha': self.source}}
            if endpoint == f'git/ref/heads/{release.BRANCH}':
                return self.reference
            if endpoint.startswith('pulls?state=open'):
                return [self.pr] if self.pr and self.pr['state'] == 'open' else []
            if endpoint.startswith('pulls?state=closed'):
                return [self.pr] if self.pr and self.pr['state'] == 'closed' else []
            if endpoint == 'pulls/17':
                return copy.deepcopy(self.pr)
            if endpoint == 'pulls':
                self.pr = {**payload, 'number': 17, 'state': 'open', 'merged_at': None,
                           'base': {'ref': 'main'}, 'head': {'ref': release.BRANCH,
                           'repo': {'full_name': release.REPO}, 'sha': self.reference['object']['sha']}}
                return copy.deepcopy(self.pr)
            if endpoint.startswith('git/ref/tags/'):
                return self.tag
            if endpoint == 'git/refs':
                self.tag = {'object': {'type': 'commit', 'sha': payload['sha']}}
                return self.tag
            if endpoint.startswith('releases/tags/'):
                return self.published
            if endpoint.endswith('required_status_checks'):
                return {'strict': True, 'checks': [{'context': 'quality', 'app_id': 10}]}
            self.fail(f'Unexpected API: {endpoint}')

        def run(*args, input_text=None):
            self.calls.append(('run', args))
            if args[0] == 'gh':
                if args[1:] == ('api', 'user'):
                    return json.dumps({'id': 159707412, 'login': 'stipsitzm'})
                if args[1:3] == ('api', '--paginate'):
                    return json.dumps({'id': 1, 'name': 'quality', 'app': {'id': 10},
                                       'status': 'completed', 'conclusion': 'success' if self.checks_pass else 'failure'})
                if args[1:3] == ('api', '--method'):
                    self.pr.update(json.loads(input_text))
                return ''
            if args[0] == 'node':
                return json.dumps({'title': self.pr['title'], 'body': self.pr['body']})
            if args[0] == 'git' and 'push' in args:
                self.reference = {'object': {'sha': self.real_run('git', 'rev-parse', 'HEAD')}}
                if self.pr:
                    self.pr['head']['sha'] = self.reference['object']['sha']
                return ''
            if args[0] == 'git' and 'fetch' in args:
                self.real_run('git', 'tag', 'v1.0.1', self.pr['merge_commit_sha'])
                return ''
            if args[:2] == ('semantic-release', 'changelog'):
                self.assertEqual(self.real_run('git', 'branch', '--show-current'), 'main')
                self.published = {'tag_name': 'v1.0.1', 'draft': False}
                return ''
            return self.real_run(*args, input_text=input_text)

        self.addCleanup(patch.stopall)
        patch.object(release, 'api', side_effect=api).start()
        patch.object(release, 'run', side_effect=run).start()

    def merge_release(self):
        release.prepare()
        release.git('switch', 'main')
        release.git('merge', '--squash', release.BRANCH)
        release.git('commit', '-m', 'chore(release): v1.0.1 (#17)')
        self.pr.update(state='closed', merged=True, merged_at='2026-11-14T12:00:00Z',
                       merge_commit_sha=release.git('rev-parse', 'HEAD'))
        self.source = self.pr['merge_commit_sha']
        release.git('switch', '--detach', 'HEAD')

    def publish(self):
        candidate = release.verify_release()
        if candidate:
            release.publish(candidate)

    def test_prepare_real_semantic_release_is_repeat_safe_and_never_pushes_main_or_tags(self):
        release.prepare()
        plan = release.parse_plan(self.pr['body'])
        self.assertEqual(plan['version'], '1.0.1')
        first_head = self.pr['head']['sha']
        release.validate_commit(first_head, plan)
        release.git('switch', 'main')
        release.prepare()
        self.assertEqual(self.pr['head']['sha'], first_head)
        pushes = [call[1] for call in self.calls if call[0] == 'run' and 'push' in call[1]]
        self.assertEqual(len(pushes), 1)
        self.assertEqual(pushes[0][-1], 'HEAD:refs/heads/automation/release')
        self.assertIn('--force-with-lease=refs/heads/automation/release:', pushes[0])
        self.assertEqual(release.git('tag'), 'v1.0.0')
        self.assertEqual(release.git('rev-parse', 'main'), self.source)

    def test_advanced_main_regenerates_the_release_branch_and_invalidates_old_head(self):
        release.prepare()
        old_head = self.pr['head']['sha']
        release.git('switch', 'main')
        release.git('commit', '--allow-empty', '-m', 'feat: another actual change')
        self.source = release.git('rev-parse', 'HEAD')
        release.prepare()
        self.assertNotEqual(self.pr['head']['sha'], old_head)
        plan = release.parse_plan(self.pr['body'])
        self.assertEqual(plan['version'], '1.1.0')
        self.assertEqual(plan['source'], self.source)
        release.validate_commit(self.pr['head']['sha'], plan)

    def test_no_semantic_change_never_creates_a_release_pr(self):
        release.git('reset', '--hard', 'HEAD^')
        self.source = release.git('rev-parse', 'HEAD')
        release.prepare()
        self.assertIsNone(self.pr)
        self.assertIsNone(self.reference)
        self.assertIsNone(self.tag)

    def test_publishes_exact_checked_merge_and_recovers_tag_created_before_release_failure(self):
        self.merge_release()
        self.publish()
        self.assertEqual(self.tag['object']['sha'], self.pr['merge_commit_sha'])
        self.assertEqual(self.published['tag_name'], 'v1.0.1')
        mutations = [call for call in self.calls if call[:2] == ('api', 'git/refs')]
        self.assertEqual(len(mutations), 1)
        self.publish()
        self.assertEqual(len([call for call in self.calls if call[:2] == ('api', 'git/refs')]), 1)
        self.checks_pass = False
        self.publish()  # A historical rerun cannot block an already-published release.
        self.checks_pass = True
        self.published = None
        # Simulate another runner recovering the already-created remote tag.
        release.git('tag', '-d', 'v1.0.1')
        self.publish()
        self.assertEqual(self.published['tag_name'], 'v1.0.1')

    def test_failed_checks_and_conflicting_tags_cannot_publish(self):
        self.merge_release()
        self.checks_pass = False
        with self.assertRaisesRegex(ValueError, 'check has not passed'):
            self.publish()
        self.assertIsNone(self.tag)
        self.checks_pass = True
        self.tag = {'object': {'type': 'commit', 'sha': 'a' * 40}}
        with self.assertRaisesRegex(ValueError, 'points elsewhere'):
            self.publish()
        self.assertIsNone(self.published)

    def test_publisher_rechecks_ci_without_needing_admin_protection_access(self):
        self.merge_release()
        candidate = release.verify_release()
        reads = len([call for call in self.calls if call[0] == 'api' and
                     call[1].endswith('required_status_checks')])
        self.checks_pass = False
        with self.assertRaisesRegex(ValueError, 'check has not passed'):
            release.publish(candidate)
        self.assertIsNone(self.tag)
        self.checks_pass = True
        release.publish(candidate)
        self.assertEqual(len([call for call in self.calls if call[0] == 'api' and
                              call[1].endswith('required_status_checks')]), reads)

    def test_candidate_changes_after_verification_are_rejected_before_publication(self):
        self.merge_release()
        candidate = release.verify_release()
        candidate['sha'] = 'a' * 40
        with self.assertRaisesRegex(ValueError, 'changed after verification'):
            release.publish(candidate)
        self.assertIsNone(self.tag)

    def test_tampered_files_stale_source_and_non_squash_merges_are_rejected(self):
        self.merge_release()
        plan = release.parse_plan(self.pr['body'])
        sha = self.pr['merge_commit_sha']
        for mutation in [dict(plan, source='a' * 40),
                         dict(plan, files={**plan['files'], 'malicious.py': 'c' * 64}),
                         dict(plan, files={**plan['files'], 'backend/config/version.py': 'd' * 64})]:
            with self.assertRaises(ValueError):
                release.validate_commit(sha, mutation)
        altered = dict(plan, version='9.9.9')
        with self.assertRaises(ValueError):
            release.validate_commit(sha, altered)
        with patch.object(release, 'git', return_value=f'{sha} {plan["source"]} {"a" * 40}'), \
             self.assertRaises(ValueError):
            release.validate_commit(sha, plan)


if __name__ == '__main__':
    unittest.main()
