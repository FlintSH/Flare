import io
from pathlib import Path
import stat
import tempfile
import unittest
from unittest.mock import patch
import warnings
import zipfile

import controller as c


NOW = 2_000_000_000
IMAGE = "ghcr.io/flintsh/flare-pr-previews@sha256:" + "a" * 64


def iso(epoch):
    return c.datetime.fromtimestamp(epoch, c.timezone.utc).isoformat()


def pr(number=1, sha="a" * 40, state="open"):
    return {"number": number, "state": state, "updated_at": iso(NOW),
            "head": {"sha": sha, "ref": "fork-branch", "repo": {"id": 99}}}


def run(number=1, run_id=101, attempt=1, sha="a" * 40):
    return {"id": run_id, "run_attempt": attempt, "workflow_id": 12,
            "repository": {"id": 5}, "head_repository": {"id": 99},
            "head_branch": "fork-branch", "head_sha": sha,
            "event": "pull_request", "pull_requests": [{"number": number}],
            "status": "completed", "conclusion": "success",
            "created_at": iso(NOW - 100), "run_started_at": iso(NOW - 100)}


def entry(number=1, run_id=101, attempt=1, sha="a" * 40):
    return {"namespace": f"flare-pr-{number}-{run_id}-{attempt}", "pr": number,
            "sha": sha, "run_id": run_id, "attempt": attempt,
            "expires_at": NOW + 1000, "url": "https://preview.up.railway.app",
            "image": IMAGE, "ready": True}


class FakeGitHub:
    repository = "FlintSH/Flare"

    def __init__(self, prs=None, runs=None):
        self.prs = {p["number"]: p for p in (prs if prs is not None else [pr()])}
        self.runs = runs if runs is not None else {1: run()}
        self.comments = {}
        self.states = []
        self.current_results = []

    def pulls(self):
        return [p for p in self.prs.values() if p["state"] == "open"]

    def recently_closed(self, now):
        return [p for p in self.prs.values() if p["state"] == "closed"]

    def pull(self, number):
        return self.prs[number]

    def latest_run(self, p):
        return self.runs.get(p["number"])

    def current(self, p, r):
        return self.current_results.pop(0) if self.current_results else True

    def comment(self, number):
        return self.comments.get(number)

    def write_comment(self, number, body, previous):
        self.comments[number] = {"id": number, "body": body}
        self.states.append((number, c.comment_state(self.comments[number])["status"]))

    def artifact(self, r):
        return {"id": 555}


class FakeRuntime:
    def __init__(self, entries=None):
        self.entries = list(entries or [])
        self.removed = []
        self.deployed = []
        self.remove_error = False
        self.deploy_error = False
        self.budget = {"spent": 0.0, "budget": 20.0, "over": False}
        self.budget_error = False
        self.budget_calls = 0

    def inventory(self):
        return list(self.entries)

    def budget_status(self):
        self.budget_calls += 1
        if self.budget_error:
            raise RuntimeError("provider budget failure containing a secret")
        return dict(self.budget)

    def remove(self, name):
        if self.remove_error:
            raise RuntimeError("provider failure containing a secret")
        self.removed.append(name)
        self.entries = [e for e in self.entries if e["namespace"] != name]

    def deploy(self, **kwargs):
        self.deployed.append(kwargs)
        if self.deploy_error:
            raise RuntimeError("provider failure containing a secret")
        result = entry(kwargs["pr"], kwargs["run_id"], kwargs["attempt"], kwargs["sha"])
        result["expires_at"] = kwargs["expires_at"]
        self.entries.append(result)
        return result


class ProvenanceTests(unittest.TestCase):
    def test_accepts_github_association_and_empty_fork_association(self):
        self.assertTrue(c.matches_run(run(), pr(), 5, 12))
        r = run()
        r["pull_requests"] = []
        self.assertTrue(c.matches_run(r, pr(), 5, 12))

    def test_rejects_mismatched_workflow_repository_sha_branch_or_pr(self):
        mutations = [
            {"workflow_id": 13}, {"repository": {"id": 6}},
            {"head_repository": {"id": 100}}, {"head_branch": "other"},
            {"head_sha": "b" * 40}, {"pull_requests": [{"number": 2}]},
            {"event": "push"}, {"run_attempt": 0},
        ]
        for mutation in mutations:
            with self.subTest(mutation=mutation):
                self.assertFalse(c.matches_run({**run(), **mutation}, pr(), 5, 12))

    def test_latest_run_prefers_new_attempt_and_ignores_spoofed_repository(self):
        gh = object.__new__(c.GitHub)
        gh.root = "/repos/FlintSH/Flare"
        gh.workflow = {"id": 12}
        gh.repo = {"id": 5}
        gh.pages = lambda *args: [run(), run(attempt=2), {**run(run_id=999), "repository": {"id": 999}}]
        self.assertEqual(gh.latest_run(pr())["run_attempt"], 2)

    def test_user_cannot_spoof_sticky_bot_comment(self):
        gh = object.__new__(c.GitHub)
        gh.root = "/repos/FlintSH/Flare"
        comments = [
            {"id": 1, "user": {"type": "User", "login": "attacker"}, "body": c.MARKER + "{} -->"},
            {"id": 2, "user": {"type": "Bot", "login": "other[bot]"}, "body": c.MARKER + "{} -->"},
            {"id": 3, "user": {"type": "Bot", "login": "github-actions[bot]"}, "body": c.MARKER + "{} -->"},
        ]
        gh.pages = lambda *args: comments
        self.assertEqual(gh.comment(1)["id"], 3)


class ArchiveTests(unittest.TestCase):
    def check_archive(self, entries, succeeds=False):
        with tempfile.TemporaryDirectory() as directory:
            archive, dest = Path(directory) / "artifact.zip", Path(directory) / "image.tar"
            with warnings.catch_warnings(), zipfile.ZipFile(archive, "w") as bundle:
                warnings.simplefilter("ignore", UserWarning)
                for name, data in entries:
                    bundle.writestr(name, data)
            if succeeds:
                c.unpack_image(archive, dest)
                self.assertEqual(dest.read_bytes(), b"image-bytes")
            else:
                with self.assertRaises(c.PreviewError):
                    c.unpack_image(archive, dest)

    def test_accepts_only_expected_single_regular_file(self):
        self.check_archive([("image.tar", b"image-bytes")], succeeds=True)

    def test_rejects_paths_extra_files_and_duplicate_members(self):
        for entries in [
            [("../image.tar", b"bad")], [("/tmp/image.tar", b"bad")],
            [("image.tar", b"ok"), ("command.sh", b"bad")],
            [("image.tar", b"ok"), ("image.tar", b"bad")],
        ]:
            with self.subTest(entries=entries):
                self.check_archive(entries)

    def test_rejects_symlink_and_expansion_bomb(self):
        info = zipfile.ZipInfo("image.tar")
        info.create_system = 3
        info.external_attr = (stat.S_IFLNK | 0o777) << 16
        self.check_archive([(info, b"/tmp/elsewhere")])
        with patch.object(c, "MAX_ARTIFACT_BYTES", 3):
            self.check_archive([("image.tar", b"too-large")])

    def test_registry_copy_never_executes_container_or_uses_shell(self):
        gh = FakeGitHub()
        gh.token = "registry-token"
        def download(artifact, destination):
            with zipfile.ZipFile(destination, "w") as bundle:
                bundle.writestr("image.tar", b"opaque-image")
        gh.download = download
        commands = []
        def process(args, **kwargs):
            commands.append(args)
            self.assertNotIn("shell", kwargs)
            self.assertNotIn(gh.token, " ".join(args))
            Path(args[args.index("--digestfile") + 1]).write_text("sha256:" + "a" * 64)
            return type("Result", (), {"returncode": 0})()
        with patch.object(c.subprocess, "run", side_effect=process):
            self.assertEqual(c.publish_image(gh, pr(), run(), {}), IMAGE)
        self.assertEqual(commands[0][:2], ["skopeo", "copy"])

    def test_download_does_not_forward_github_token_to_signed_url(self):
        gh = object.__new__(c.GitHub)
        gh.root = "/repos/FlintSH/Flare"
        gh.token = "must-not-forward"
        data = b"archive-bytes"
        artifact = {"id": 555, "digest": "sha256:" + c.hashlib.sha256(data).hexdigest()}
        signed = "https://artifact.blob.core.windows.net/example?signature=secret"
        response = c.error.HTTPError("https://api.github.com/example", 302, "Found", {"Location": signed}, None)
        class Opener:
            def open(self, req, timeout):
                self.request = req
                raise response
        calls = []
        def download(url, **kwargs):
            calls.append((url, kwargs))
            return io.BytesIO(data)
        with tempfile.TemporaryDirectory() as directory, patch.object(c.request, "build_opener", return_value=Opener()), patch.object(c.request, "urlopen", side_effect=download):
            target = Path(directory) / "download.zip"
            gh.download(artifact, target)
            self.assertEqual(target.read_bytes(), data)
        self.assertEqual(calls, [(signed, {"timeout": 60})])


class ReconcileTests(unittest.TestCase):
    def setUp(self):
        self.pub = patch.object(c, "publish_image", return_value=IMAGE).start()
        self.gc = patch.object(c, "cleanup_registry").start()
        patch.object(c.time, "time", return_value=NOW).start()
        self.addCleanup(patch.stopall)

    def reconcile(self, gh, runtime, enabled=True, configured=True):
        return c.Controller(gh, runtime, enabled, configured, now=NOW).reconcile()

    def test_success_posts_deploying_then_ready_and_never_redeploys(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        runtime.budget = {"spent": 19.50, "budget": 20.0, "over": False}
        self.reconcile(gh, runtime)
        self.assertEqual(runtime.budget_calls, 1)
        self.assertEqual(gh.states, [(1, "deploying"), (1, "ready")])
        self.assertEqual(runtime.deployed[0]["image"], IMAGE)
        self.assertEqual(runtime.deployed[0]["expires_at"], NOW - 100 + c.TTL_SECONDS)
        self.reconcile(gh, runtime)
        self.assertEqual(runtime.budget_calls, 2)
        self.assertEqual(len(runtime.deployed), 1)
        self.assertIn("Do not enter", gh.comments[1]["body"])
        self.assertIn("artifacts/555", gh.comments[1]["body"])
        self.assertIn("first-run setup with no pre-created account", gh.comments[1]["body"])
        self.assertNotIn("demo@example.test", gh.comments[1]["body"])

    def test_disabled_setup_does_not_deploy(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        self.reconcile(gh, runtime, enabled=False, configured=False)
        self.assertEqual(gh.states, [(1, "setup required")])
        self.assertFalse(runtime.deployed)
        self.assertEqual(runtime.budget_calls, 0)

    def test_disabled_but_configured_removes_existing_deployments(self):
        gh, runtime = FakeGitHub(), FakeRuntime([entry()])
        runtime.budget_error = True
        self.reconcile(gh, runtime, enabled=False)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertEqual(runtime.budget_calls, 0)

    def test_over_budget_removes_running_preview_and_pauses_building_pr_without_publishing(self):
        building = {**run(2, 102), "status": "in_progress", "conclusion": None}
        gh = FakeGitHub([pr(), pr(2)], {1: run(), 2: building})
        runtime = FakeRuntime([entry()])
        runtime.budget = {"spent": 20.0, "budget": 20.0, "over": True}
        gh.comments[1] = {"id": 1, "body": c.render_comment(gh.repository, pr(), "ready", "", run(), entry())}
        with patch.object(gh, "artifact", wraps=gh.artifact) as artifact:
            self.reconcile(gh, runtime)
            artifact.assert_not_called()
        self.pub.assert_not_called()
        self.assertFalse(runtime.deployed)
        self.assertEqual(runtime.budget_calls, 1)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertEqual(gh.states, [(1, "budget paused"), (2, "budget paused")])
        for comment in gh.comments.values():
            self.assertNotIn("[Open preview]", comment["body"])
            self.assertIn("$20.00", comment["body"])
            self.assertIn("not a hard spending cap", comment["body"])

    def test_budget_unavailable_fails_closed_after_cleanup_and_sanitized_comments(self):
        gh, runtime = FakeGitHub(), FakeRuntime([entry()])
        runtime.budget_error = True
        with patch.object(gh, "artifact", wraps=gh.artifact) as artifact:
            with self.assertRaises(c.PreviewError) as raised:
                self.reconcile(gh, runtime)
            artifact.assert_not_called()
        self.assertNotIn("secret", str(raised.exception))
        self.assertNotIn("secret", gh.comments[1]["body"])
        self.assertIn("budget usage is unavailable", gh.comments[1]["body"])
        self.assertEqual(gh.states, [(1, "budget paused")])
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertEqual(runtime.budget_calls, 1)
        self.assertFalse(runtime.deployed)
        self.pub.assert_not_called()

    def test_budget_pause_preserves_failed_cleanup_capacity_and_image(self):
        gh = FakeGitHub([pr(), pr(2)], {1: run(), 2: run(2, 102)})
        runtime = FakeRuntime([entry()])
        runtime.budget["over"] = True
        runtime.remove_error = True
        with self.assertRaises(c.PreviewError):
            self.reconcile(gh, runtime)
        self.assertEqual(gh.states, [(1, "cleanup pending"), (2, "budget paused")])
        self.assertIn("Infrastructure deletion failed", gh.comments[1]["body"])
        self.assertNotIn("[Open preview]", gh.comments[1]["body"])
        self.assertEqual(runtime.entries, [entry()])
        self.assertIn((1, 101, 1), self.gc.call_args.args[1])
        self.assertFalse(runtime.deployed)
        self.pub.assert_not_called()

    def test_budget_pause_does_not_fail_generation_and_same_build_can_resume(self):
        gh, runtime = FakeGitHub(), FakeRuntime([{**entry(), "ready": False}])
        runtime.budget["over"] = True
        self.reconcile(gh, runtime)
        self.assertEqual(gh.states, [(1, "budget paused")])
        runtime.budget["over"] = False
        self.reconcile(gh, runtime)
        self.assertEqual(gh.states, [(1, "budget paused"), (1, "deploying"), (1, "ready")])
        self.assertEqual(len(runtime.deployed), 1)
        self.assertEqual(runtime.deployed[0]["run_id"], 101)
        self.assertEqual(runtime.deployed[0]["attempt"], 1)

    def test_budget_failure_does_not_prevent_closed_pr_cleanup(self):
        gh = FakeGitHub([pr(state="closed"), pr(2)], {2: run(2, 102)})
        runtime = FakeRuntime([entry(), entry(2, 102)])
        runtime.budget_error = True
        with self.assertRaises(c.PreviewError):
            self.reconcile(gh, runtime)
        self.assertEqual(runtime.removed, [entry()["namespace"], entry(2, 102)["namespace"]])
        self.assertEqual(gh.states, [(1, "closed"), (2, "budget paused")])
        self.assertFalse(runtime.deployed)
        self.pub.assert_not_called()

    def test_old_commit_is_removed_and_replacement_uses_new_run(self):
        gh = FakeGitHub([pr(sha="b" * 40)], {1: run(run_id=102, sha="b" * 40)})
        runtime = FakeRuntime([entry()])
        self.reconcile(gh, runtime)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertEqual(runtime.deployed[0]["sha"], "b" * 40)

    def test_close_removes_runtime_and_updates_comment(self):
        gh, runtime = FakeGitHub([pr(state="closed")]), FakeRuntime([entry()])
        self.reconcile(gh, runtime)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertEqual(gh.states, [(1, "closed")])
        self.assertFalse(runtime.deployed)

    def test_expired_same_run_is_not_redeployed(self):
        expired_run = {**run(), "run_started_at": iso(NOW - c.TTL_SECONDS - 1)}
        gh, runtime = FakeGitHub(runs={1: expired_run}), FakeRuntime([entry()])
        self.reconcile(gh, runtime)
        self.assertEqual(gh.states, [(1, "expired")])
        self.assertFalse(runtime.deployed)

    def test_capacity_limit_queues_sixth_pr(self):
        gh = FakeGitHub([pr(n) for n in range(1, 7)], {n: run(n, 100 + n) for n in range(1, 7)})
        runtime = FakeRuntime([entry(n, 100 + n) for n in range(1, 6)])
        self.reconcile(gh, runtime)
        self.assertIn((6, "queued"), gh.states)
        self.assertFalse(runtime.deployed)

    def test_time_budget_leaves_work_queued_for_next_reconciliation(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        with patch.object(c.time, "monotonic", side_effect=[0, 301]):
            self.reconcile(gh, runtime)
        self.assertFalse(runtime.deployed)
        self.assertEqual(gh.states, [(1, "queued")])
        self.assertIn("time budget", gh.comments[1]["body"])

    def test_new_attempt_replaces_old_attempt_same_sha(self):
        gh, runtime = FakeGitHub(runs={1: run(attempt=2)}), FakeRuntime([entry()])
        self.reconcile(gh, runtime)
        self.assertTrue(runtime.removed)
        self.assertEqual(runtime.deployed[0]["attempt"], 2)

    def test_failed_cleanup_blocks_replacement_and_preserves_registry(self):
        gh, runtime = FakeGitHub(runs={1: run(attempt=2)}), FakeRuntime([entry()])
        runtime.remove_error = True
        with self.assertRaises(c.PreviewError):
            self.reconcile(gh, runtime)
        self.assertFalse(runtime.deployed)
        self.assertIn((1, 101, 1), self.gc.call_args.args[1])
        self.assertEqual(gh.states[-1], (1, "cleanup pending"))

    def test_stale_after_publication_never_provisions(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        gh.current_results = [True, False]
        self.reconcile(gh, runtime)
        self.pub.assert_called_once()
        self.assertFalse(runtime.deployed)

    def test_closed_during_provisioning_is_immediately_removed(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        gh.current_results = [True, True, False]
        self.reconcile(gh, runtime)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertNotIn((1, "ready"), gh.states)

    def test_failed_attempt_does_not_retry_on_schedule_or_leak_error(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        runtime.deploy_error = True
        with self.assertRaises(c.PreviewError):
            self.reconcile(gh, runtime)
        self.assertNotIn("secret", gh.comments[1]["body"])
        self.reconcile(gh, runtime)
        self.assertEqual(len(runtime.deployed), 1)

    def test_lost_controller_with_deploying_comment_does_not_duplicate(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        gh.comments[1] = {"id": 1, "body": c.render_comment(gh.repository, pr(), "deploying", "", run())}
        self.reconcile(gh, runtime)
        self.assertFalse(runtime.deployed)
        self.assertEqual(gh.states[-1], (1, "failed"))

    def test_partial_creation_is_found_and_removed_after_lost_response(self):
        gh, runtime = FakeGitHub(), FakeRuntime()
        def partial(**kwargs):
            runtime.entries.append(entry())
            raise RuntimeError("network response lost")
        runtime.deploy = partial
        with self.assertRaises(c.PreviewError):
            self.reconcile(gh, runtime)
        self.assertEqual(runtime.removed, [entry()["namespace"]])
        self.assertFalse(runtime.entries)


class RegistryCleanupTests(unittest.TestCase):
    @staticmethod
    def version(identifier, created_at, tags):
        return {"id": identifier, "created_at": created_at, "metadata": {"container": {"tags": tags}}}

    def cleanup(self, versions, keep=()):
        gh = object.__new__(c.GitHub)
        gh.repository = "FlintSH/Flare"
        gh.repo = {"owner": {"type": "Organization"}}
        remaining = {version["id"]: version for version in versions}
        gh.pages = lambda *args: list(remaining.values())
        deleted = []
        def delete(path, method):
            self.assertEqual(method, "DELETE")
            self.assertRegex(path, r"^/orgs/FlintSH/packages/container/flare-pr-previews/versions/[0-9]+$")
            if len(remaining) <= 1:
                raise c.PreviewError("GitHub API DELETE failed (HTTP 400)")
            identifier = int(path.rsplit("/", 1)[1])
            del remaining[identifier]
            deleted.append(identifier)
        gh.api = delete
        c.cleanup_registry(gh, set(keep))
        return deleted, list(remaining.values())

    def test_keeps_last_stale_version_without_deleting_package(self):
        version = self.version(1, "2026-09-13T00:00:00Z", ["pr-1-101-1"])
        deleted, remaining = self.cleanup([version])
        self.assertEqual(deleted, [])
        self.assertEqual(remaining, [version])

    def test_all_stale_keeps_newest_by_creation_time_independent_of_api_order(self):
        oldest = self.version(30, "2026-09-11T00:00:00Z", ["pr-1-101-1"])
        newest = self.version(20, "2026-09-13T00:00:00Z", ["pr-2-102-1"])
        middle = self.version(10, "2026-09-12T00:00:00Z", ["pr-3-103-1"])
        for versions in ([oldest, newest, middle], [middle, oldest, newest]):
            deleted, remaining = self.cleanup(versions)
            self.assertCountEqual(deleted, [30, 10])
            self.assertEqual(remaining, [newest])

    def test_current_version_allows_every_other_stale_version_to_be_deleted(self):
        current = self.version(1, "2026-09-11T00:00:00Z", ["pr-1-101-1"])
        stale = self.version(2, "2026-09-13T00:00:00Z", ["pr-2-102-1"])
        deleted, remaining = self.cleanup([stale, current], {(1, 101, 1)})
        self.assertEqual(deleted, [2])
        self.assertEqual(remaining, [current])

    def test_later_publication_collects_the_previously_retained_version(self):
        old = self.version(1, "2026-09-11T00:00:00Z", ["pr-1-101-1"])
        _, remaining = self.cleanup([old])
        new = self.version(2, "2026-09-13T00:00:00Z", ["pr-1-102-1"])
        deleted, remaining = self.cleanup(remaining + [new], {(1, 102, 1)})
        self.assertEqual(deleted, [1])
        self.assertEqual(remaining, [new])

    def test_foreign_or_untagged_version_preserves_package_without_retaining_stale_preview(self):
        stale = self.version(1, "2026-09-13T00:00:00Z", ["pr-1-101-1"])
        for tags in (["production"], [], ["pr-1-100-1", "production"]):
            foreign = self.version(2, "2026-09-11T00:00:00Z", tags)
            deleted, remaining = self.cleanup([stale, foreign])
            self.assertEqual(deleted, [1])
            self.assertEqual(remaining, [foreign])

    def test_preserves_foreign_untagged_and_in_use_shared_digest(self):
        gh = object.__new__(c.GitHub)
        gh.repository = "FlintSH/Flare"
        gh.repo = {"owner": {"type": "Organization"}}
        versions = [
            {"id": 1, "metadata": {"container": {"tags": ["pr-1-101-1"]}}},
            {"id": 2, "metadata": {"container": {"tags": ["production"]}}},
            {"id": 3, "metadata": {"container": {"tags": []}}},
            {"id": 4, "metadata": {"container": {"tags": ["pr-1-100-1", "pr-2-102-1"]}}},
        ]
        gh.pages = lambda *args: versions
        deleted = []
        gh.api = lambda path, method: deleted.append((path, method))
        c.cleanup_registry(gh, {(2, 102, 1)})
        self.assertEqual(deleted, [("/orgs/FlintSH/packages/container/flare-pr-previews/versions/1", "DELETE")])


if __name__ == "__main__":
    unittest.main()
