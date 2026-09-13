#!/usr/bin/env python3
"""Trusted PR-preview reconciler. Never import or execute anything from a PR.

The image archive is hostile data. Only skopeo parses it, and the image runs only
on Railway. Registry/deployment credentials never enter the image or its runtime.
"""

from __future__ import annotations

import base64
import hashlib
import json
import os
from pathlib import Path
import re
import stat
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from urllib import error, parse, request
import zipfile


TTL_SECONDS = 24 * 60 * 60
MAX_ACTIVE = 5
MAX_ARTIFACT_BYTES = 4 * 1024**3
DOWNLOAD_TIMEOUT_SECONDS = 5 * 60
RECONCILE_BUDGET_SECONDS = 30 * 60
# Reserve archive download + registry copy + Railway readiness time. The workflow
# has another 15 minutes for provider configuration, cleanup and comment writes.
PROVISION_RESERVE_SECONDS = 25 * 60
WORKFLOW_PATH = "pr-preview-build.yml"
MARKER = "<!-- flare-pr-preview:v1 "
SHA = re.compile(r"[0-9a-f]{40}\Z")
DIGEST = re.compile(r"sha256:[0-9a-f]{64}\Z")
IMAGE_TAG = re.compile(r"pr-([1-9][0-9]*)-([1-9][0-9]*)-([1-9][0-9]*)\Z")
REPOSITORY = re.compile(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+\Z")


class PreviewError(RuntimeError):
    """A deliberately sanitized, operator-readable error."""


def timestamp(value: str) -> int:
    return int(datetime.fromisoformat(value.replace("Z", "+00:00")).timestamp())


def generation(run: dict | None) -> tuple[int, int] | None:
    return (int(run["id"]), int(run["run_attempt"])) if run else None


def expires_at(run: dict) -> int:
    return timestamp(run.get("run_started_at") or run["created_at"]) + TTL_SECONDS


def matches_run(run: dict, pr: dict, repo_id: int, workflow_id: int) -> bool:
    """Use GitHub's metadata, never a PR-supplied manifest or event artifact."""
    head_repo = pr.get("head", {}).get("repo") or {}
    associations = run.get("pull_requests") or []
    return bool(
        head_repo.get("id")
        and run.get("repository", {}).get("id") == repo_id
        and run.get("workflow_id") == workflow_id
        and run.get("event") == "pull_request"
        and run.get("head_sha") == pr["head"]["sha"]
        and (run.get("head_repository") or {}).get("id") == head_repo["id"]
        and run.get("head_branch") == pr["head"]["ref"]
        and (
            any(link.get("number") == pr["number"] for link in associations)
            # Fork workflow_run payloads may omit PR associations. An exact
            # repository ID + branch + SHA match against the PR API is required.
            or not associations
        )
        and isinstance(run.get("id"), int)
        and run["id"] > 0
        and isinstance(run.get("run_attempt"), int)
        and run["run_attempt"] > 0
    )


class NoRedirect(request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


class GitHub:
    def __init__(self, repository: str, token: str):
        if not REPOSITORY.fullmatch(repository):
            raise PreviewError("Invalid GITHUB_REPOSITORY")
        self.repository = repository
        self.token = token
        self.root = f"/repos/{repository}"
        self.repo = self.api(self.root)
        self.workflow = self.api(f"{self.root}/actions/workflows/{WORKFLOW_PATH}")

    def headers(self) -> dict:
        return {
            "Authorization": f"Bearer {self.token}",
            "Accept": "application/vnd.github+json",
            "X-GitHub-Api-Version": "2022-11-28",
            "User-Agent": "Flare-PR-Preview",
        }

    def api(self, path: str, method: str = "GET", body=None):
        if not path.startswith("/") or path.startswith("//"):
            raise PreviewError("Invalid GitHub API path")
        req = request.Request(
            "https://api.github.com" + path,
            data=json.dumps(body).encode() if body is not None else None,
            headers=self.headers(),
            method=method,
        )
        # No authenticated redirects: a redirect must never forward the token.
        opener = request.build_opener(NoRedirect)
        try:
            with opener.open(req, timeout=60) as response:
                data = response.read(16 * 1024**2 + 1)
                if len(data) > 16 * 1024**2:
                    raise PreviewError("GitHub API response exceeded the size limit")
                return json.loads(data) if data else None
        except error.HTTPError as exc:
            raise PreviewError(f"GitHub API {method} failed (HTTP {exc.code})") from None

    def pages(self, path: str, key: str | None = None):
        separator = "&" if "?" in path else "?"
        for page in range(1, 101):
            result = self.api(f"{path}{separator}per_page=100&page={page}")
            items = result[key] if key else result
            yield from items
            if len(items) < 100:
                return
        raise PreviewError("GitHub pagination exceeded its safety limit")

    def pulls(self) -> list[dict]:
        return list(self.pages(f"{self.root}/pulls?state=open"))

    def recently_closed(self, now: int):
        for pr in self.pages(
            f"{self.root}/pulls?state=closed&sort=updated&direction=desc"
        ):
            if timestamp(pr["updated_at"]) < now - 2 * TTL_SECONDS:
                break
            yield pr

    def pull(self, number: int) -> dict:
        return self.api(f"{self.root}/pulls/{int(number)}")

    def latest_run(self, pr: dict) -> dict | None:
        sha = pr["head"]["sha"]
        if not SHA.fullmatch(sha):
            raise PreviewError("Invalid PR commit SHA")
        runs = self.pages(
            f"{self.root}/actions/workflows/{self.workflow['id']}/runs"
            f"?event=pull_request&head_sha={sha}",
            "workflow_runs",
        )
        matching = [
            run for run in runs
            if matches_run(run, pr, self.repo["id"], self.workflow["id"])
        ]
        return max(matching, key=lambda run: generation(run), default=None)

    def current(self, pr: dict, run: dict) -> bool:
        fresh = self.pull(pr["number"])
        if fresh["state"] != "open" or fresh["head"]["sha"] != pr["head"]["sha"]:
            return False
        latest = self.latest_run(fresh)
        return bool(
            latest
            and generation(latest) == generation(run)
            and latest["status"] == "completed"
            and latest["conclusion"] == "success"
        )

    def comment(self, number: int) -> dict | None:
        comments = self.pages(f"{self.root}/issues/{int(number)}/comments")
        return next((comment for comment in comments if (
            comment.get("user", {}).get("type") == "Bot"
            and comment["user"].get("login") == "github-actions[bot]"
            and comment.get("body", "").startswith(MARKER)
        )), None)

    def write_comment(self, number: int, body: str, previous: dict | None):
        if previous:
            if previous["body"] != body:
                self.api(f"{self.root}/issues/comments/{previous['id']}", "PATCH", {"body": body})
        else:
            self.api(f"{self.root}/issues/{int(number)}/comments", "POST", {"body": body})

    def artifact(self, run: dict) -> dict:
        expected = f"flare-pr-image-{run['id']}-{run['run_attempt']}"
        matches = [a for a in self.pages(
            f"{self.root}/actions/runs/{run['id']}/artifacts", "artifacts"
        ) if a["name"] == expected and not a["expired"]]
        if len(matches) != 1:
            raise PreviewError("Expected one non-expired image artifact for this run attempt")
        artifact = matches[0]
        if not 0 < artifact["size_in_bytes"] <= MAX_ARTIFACT_BYTES:
            raise PreviewError("Image artifact exceeds the 4 GiB limit")
        if not DIGEST.fullmatch(artifact.get("digest") or ""):
            raise PreviewError("Image artifact is missing GitHub's SHA-256 digest")
        return artifact

    def download(self, artifact: dict, destination: Path):
        deadline = time.monotonic() + DOWNLOAD_TIMEOUT_SECONDS
        req = request.Request(
            f"https://api.github.com{self.root}/actions/artifacts/{int(artifact['id'])}/zip",
            headers=self.headers(),
        )
        try:
            request.build_opener(NoRedirect).open(req, timeout=60)
        except error.HTTPError as exc:
            if exc.code not in (301, 302, 303, 307, 308):
                raise PreviewError(f"Artifact download failed (HTTP {exc.code})") from None
            location = exc.headers.get("Location", "")
        else:
            raise PreviewError("Expected GitHub's signed artifact redirect")
        target = parse.urlsplit(location)
        if target.scheme != "https" or not target.hostname or target.username:
            raise PreviewError("Invalid artifact download redirect")
        # Fresh request without Authorization. The signed location comes from the
        # GitHub API, never an artifact field or PR-provided URL.
        digest = hashlib.sha256()
        total = 0
        with request.urlopen(location, timeout=60) as response, destination.open("xb") as output:
            while block := response.read(1024**2):
                if time.monotonic() >= deadline:
                    raise PreviewError("Image artifact download exceeded its five-minute deadline")
                total += len(block)
                if total > MAX_ARTIFACT_BYTES:
                    raise PreviewError("Downloaded artifact exceeds the 4 GiB limit")
                digest.update(block)
                output.write(block)
        if "sha256:" + digest.hexdigest() != artifact["digest"]:
            raise PreviewError("Downloaded artifact failed SHA-256 verification")


def unpack_image(archive: Path, destination: Path):
    """Copy one bounded regular file; never extract attacker-chosen paths."""
    with zipfile.ZipFile(archive) as bundle:
        files = bundle.infolist()
        if len(files) != 1 or files[0].filename != "image.tar":
            raise PreviewError("Artifact must contain only image.tar")
        info = files[0]
        kind = stat.S_IFMT(info.external_attr >> 16)
        if kind not in (0, stat.S_IFREG) or info.is_dir() or info.flag_bits & 1:
            raise PreviewError("image.tar must be an unencrypted regular file")
        if not 0 < info.file_size <= MAX_ARTIFACT_BYTES:
            raise PreviewError("Unpacked image exceeds the 4 GiB limit")
        total = 0
        with bundle.open(info) as source, destination.open("xb") as target:
            while block := source.read(1024**2):
                total += len(block)
                if total > MAX_ARTIFACT_BYTES:
                    raise PreviewError("Unpacked image exceeds the 4 GiB limit")
                target.write(block)


def publish_image(gh: GitHub, pr: dict, run: dict, artifact: dict) -> str:
    package = gh.repository.lower() + "-pr-previews"
    tag = f"pr-{pr['number']}-{run['id']}-{run['run_attempt']}"
    with tempfile.TemporaryDirectory(prefix="flare-preview-") as directory:
        directory = Path(directory)
        archive, image = directory / "artifact.zip", directory / "image.tar"
        gh.download(artifact, archive)
        unpack_image(archive, image)
        auth = directory / "auth.json"
        encoded = base64.b64encode(
            (os.environ.get("GITHUB_ACTOR", gh.repository.split("/")[0]) + ":" + gh.token).encode()
        ).decode()
        auth.write_text(json.dumps({"auths": {"ghcr.io": {"auth": encoded}}}))
        auth.chmod(0o600)
        digest_file = directory / "digest"
        result = subprocess.run([
            "skopeo", "copy", "--authfile", str(auth), "--remove-signatures",
            "--format", "v2s2", "--digestfile", str(digest_file),
            f"oci-archive:{image}", f"docker://ghcr.io/{package}:{tag}",
        ], capture_output=True, timeout=600)
        if result.returncode:
            raise PreviewError("Image publication failed; verify preview GHCR package permissions")
        digest = digest_file.read_text().strip()
        if not DIGEST.fullmatch(digest):
            raise PreviewError("Registry returned an invalid image digest")
        return f"ghcr.io/{package}@{digest}"


def comment_state(comment: dict | None) -> dict:
    if not comment:
        return {}
    try:
        return json.loads(comment["body"].split(" -->", 1)[0][len(MARKER):])
    except (ValueError, KeyError):
        return {}


def render_comment(repository: str, pr: dict, status: str, detail: str,
                   run: dict | None = None, entry: dict | None = None,
                   artifact: dict | None = None) -> str:
    state = {"sha": pr["head"]["sha"], "status": status}
    if run:
        state.update(run_id=run["id"], attempt=run["run_attempt"])
    if artifact:
        state["artifact_id"] = int(artifact["id"])
    lines = [MARKER + json.dumps(state, sort_keys=True) + " -->",
             f"**Flare PR preview: {status}**", "", detail, "",
             f"Commit: [`{pr['head']['sha'][:12]}`](https://github.com/{repository}/commit/{pr['head']['sha']})"]
    if run:
        lines.append(f"[Image build and logs](https://github.com/{repository}/actions/runs/{run['id']}/attempts/{run['run_attempt']})")
    if artifact:
        lines.append(f"[Download OCI image artifact](https://github.com/{repository}/actions/runs/{run['id']}/artifacts/{artifact['id']}) (retained for one day)")
    if entry:
        url = parse.urlsplit(entry["url"])
        if url.scheme != "https" or not (url.hostname or "").endswith(".up.railway.app") or url.username:
            raise PreviewError("Runtime returned an invalid preview URL")
        if not re.fullmatch(re.escape("ghcr.io/" + repository.lower() + "-pr-previews@") + r"sha256:[0-9a-f]{64}", entry["image"]):
            raise PreviewError("Runtime returned an invalid preview image reference")
        expiry = datetime.fromtimestamp(entry["expires_at"], timezone.utc).strftime("%Y-%m-%d %H:%M UTC")
        lines.extend(["", f"[Open preview]({entry['url']})", "", f"Image: `{entry['image']}`", "",
                      f"Expires: **{expiry}**; also removed on PR closure or replacement.", "",
                      "Starts at Flare's normal first-run setup with no pre-created account. "
                      "This is a shared instance: the first visitor can complete setup."])
    lines.extend(["", "> Public, disposable test instance running untrusted PR code. Anyone can view or change its test data. Do not enter passwords you use elsewhere, credentials, or private files."])
    return "\n".join(lines)


def cleanup_registry(gh: GitHub, keep: set[tuple[int, int, int]]):
    owner, repo = gh.repository.split("/")
    kind = "orgs" if gh.repo["owner"]["type"] == "Organization" else "users"
    path = f"/{kind}/{owner}/packages/container/{parse.quote(repo.lower() + '-pr-previews', safe='')}"
    try:
        versions = list(gh.pages(path + "/versions"))
    except PreviewError as exc:
        if str(exc).endswith("(HTTP 404)"):
            return
        raise
    stale = []
    for version in versions:
        tags = version.get("metadata", {}).get("container", {}).get("tags", [])
        parsed = [IMAGE_TAG.fullmatch(tag) for tag in tags]
        # Do not delete foreign/untagged versions or a shared digest still in use.
        if tags and all(parsed) and not any(tuple(map(int, match.groups())) in keep for match in parsed):
            stale.append(version)
    if stale and len(stale) == len(versions):
        # GHCR rejects deleting a package's last version. Retain its newest
        # image so package visibility and Actions permissions survive inactivity.
        # A later publication makes this version eligible for ordinary cleanup.
        newest = max(stale, key=lambda version: (timestamp(version["created_at"]), int(version["id"])))
        stale = [version for version in stale if version["id"] != newest["id"]]
    for version in stale:
        gh.api(path + f"/versions/{int(version['id'])}", "DELETE")


class Controller:
    def __init__(self, github: GitHub, runtime, enabled: bool, configured: bool,
                 now: int | None = None):
        self.gh = github
        self.runtime = runtime
        self.enabled = enabled
        self.configured = configured
        self.now = int(time.time()) if now is None else now
        self.deadline = time.monotonic() + RECONCILE_BUDGET_SECONDS
        self.errors: list[str] = []

    def post(self, pr, status, detail, run=None, entry=None, artifact=None):
        previous = self.gh.comment(pr["number"])
        previous_state = comment_state(previous)
        if (artifact is None and run and status == "ready"
                and (previous_state.get("run_id"), previous_state.get("attempt")) == generation(run)
                and type(previous_state.get("artifact_id")) is int):
            artifact = {"id": previous_state["artifact_id"]}
        body = render_comment(self.gh.repository, pr, status, detail, run, entry, artifact)
        self.gh.write_comment(pr["number"], body, previous)

    def reconcile(self):
        prs = {pr["number"]: pr for pr in self.gh.pulls()}
        # Also repairs stale comments after an independent janitor removed a PR
        # whose close event was dropped while another controller run was queued.
        prs.update({pr["number"]: pr for pr in self.gh.recently_closed(self.now)})
        entries = self.runtime.inventory() if self.configured else []
        for entry in entries:
            if entry["pr"] not in prs:
                prs[entry["pr"]] = self.gh.pull(entry["pr"])
        runs = {number: self.gh.latest_run(pr) for number, pr in prs.items() if pr["state"] == "open"}
        budget_pause = None
        if self.enabled and self.configured:
            try:
                budget = self.runtime.budget_status()
                if budget["over"]:
                    budget_pause = (
                        f"The preview project's reported billing-period usage is ${budget['spent']:.2f} "
                        f"against its ${budget['budget']:.2f} monthly budget. Preview deployments are paused "
                        "and existing previews are being removed until reported usage is below budget. "
                        "This periodic usage check is not a hard spending cap."
                    )
            except Exception:
                # A missing or failed budget check must not leave known previews
                # running or allow publishing. Finish cleanup/comments before
                # reporting failure, without exposing provider error bodies.
                budget_pause = (
                    "Preview budget usage is unavailable. Deployments are paused and existing previews "
                    "are being removed until budget checks recover. Maintainers should check the "
                    "project budget configuration and provider availability."
                )
                self.errors.append("Preview budget status unavailable; deployments paused and cleanup requested")
        live = []
        failed_generations = set()
        for entry in entries:
            pr = prs[entry["pr"]]
            run = runs.get(entry["pr"])
            valid = bool(
                self.enabled and budget_pause is None and pr["state"] == "open" and run
                and pr["head"]["sha"] == entry["sha"]
                and generation(run) == (entry["run_id"], entry["attempt"])
                and min(entry["expires_at"], expires_at(run)) > self.now
            )
            if valid and entry["ready"]:
                live.append(entry)
                continue
            try:
                self.runtime.remove(entry["namespace"])
                if valid:
                    failed_generations.add((entry["pr"], entry["run_id"], entry["attempt"]))
            except Exception:
                # Retain capacity accounting if deletion fails. Never create a
                # replacement while an old generation may still be running.
                live.append(entry)
                self.errors.append(f"PR #{entry['pr']}: preview cleanup failed")
        for number, pr in sorted(prs.items()):
            run = runs.get(number)
            own = [entry for entry in live if entry["pr"] == number]
            provisioning = False
            try:
                if pr["state"] != "open":
                    self.post(pr, "closed" if not own else "cleanup pending",
                              "Preview and disposable data removed." if not own else "Infrastructure deletion failed; cleanup will retry.")
                    continue
                if not self.configured or not self.enabled:
                    self.post(pr, "setup required", "Preview deployment is disabled or not configured. Maintainers: follow `docs/pr-previews.md` to configure the Railway preview project and enable previews.")
                    continue
                if budget_pause is not None:
                    detail = budget_pause
                    if own:
                        detail += " Infrastructure deletion failed; cleanup will retry, and no replacement will start."
                    self.post(pr, "cleanup pending" if own else "budget paused", detail, run)
                    continue
                if not run:
                    self.post(pr, "queued", "Waiting for the preview image workflow. GitHub may require maintainer approval for a first-time fork contributor.")
                    continue
                if own:
                    entry = own[0]
                    if entry["ready"] and generation(run) == (entry["run_id"], entry["attempt"]) and entry["expires_at"] > self.now and entry["sha"] == pr["head"]["sha"]:
                        if self.gh.current(pr, run):
                            self.post(pr, "ready", "Deployment is running and passed its startup health check.", run, entry)
                        continue
                    self.post(pr, "cleanup pending", "The previous deployment could not be removed; a replacement will wait for cleanup.", run)
                    continue
                if expires_at(run) <= self.now:
                    self.post(pr, "expired", "The 24-hour preview lifetime ended. A new commit or a re-run of the image workflow creates a fresh preview.", run)
                    continue
                if run["status"] != "completed":
                    self.post(pr, "building" if run["status"] == "in_progress" else "queued", "Building the Docker image; deployment follows a successful build. First-time fork builds may be awaiting GitHub approval.", run)
                    continue
                if run["conclusion"] != "success":
                    self.post(pr, "failed", "The image build did not succeed. See the build logs; re-run the image workflow or push a fix to try again.", run)
                    continue
                previous = comment_state(self.gh.comment(number))
                attempted = previous.get("sha") == pr["head"]["sha"] and (previous.get("run_id"), previous.get("attempt")) == generation(run)
                if (number, *generation(run)) in failed_generations or (attempted and previous.get("status") in ("failed", "deploying", "ready")):
                    self.post(pr, "failed", "This deployment attempt stopped or failed. Re-run the image workflow to request a fresh attempt.", run)
                    continue
                if len(live) >= MAX_ACTIVE:
                    self.post(pr, "queued", "Waiting for preview capacity (at most five active deployments). Cleanup and capacity are reconciled hourly.", run)
                    continue
                if time.monotonic() + PROVISION_RESERVE_SECONDS >= self.deadline:
                    self.post(pr, "queued", "Waiting for the next reconciliation so this controller can finish within its time budget. Reconciliation runs on preview events and hourly.", run)
                    continue
                if not self.gh.current(pr, run):
                    continue
                artifact = self.gh.artifact(run)
                self.post(pr, "deploying", "Publishing the image and waiting for Railway startup health checks.", run, artifact=artifact)
                image = publish_image(self.gh, pr, run, artifact)
                # Publishing can take several minutes: recheck immediately before
                # provisioning and after it, including re-runs of the same SHA.
                if not self.gh.current(pr, run) or expires_at(run) <= int(time.time()):
                    continue
                provisioning = True
                entry = self.runtime.deploy(
                    pr=number, sha=pr["head"]["sha"], run_id=run["id"],
                    attempt=run["run_attempt"], image=image, domain="",
                    expires_at=expires_at(run),
                )
                if not self.gh.current(pr, run) or expires_at(run) <= int(time.time()):
                    self.runtime.remove(entry["namespace"])
                    provisioning = False
                    continue
                live.append(entry)
                if not entry["ready"]:
                    raise PreviewError("Runtime did not become ready")
                provisioning = False
                self.post(pr, "ready", "Deployment is running and passed its startup health check.", run, entry, artifact)
            except Exception as exc:
                if provisioning:
                    # A provider request can succeed even when its response is
                    # lost. Recover from inventory; do not trust a local return
                    # value to tell us whether capacity was consumed.
                    try:
                        observed = self.runtime.inventory()
                    except Exception:
                        raise PreviewError("Cannot verify preview inventory after failed provisioning; stopping to preserve the capacity limit") from None
                    for orphan in observed:
                        if orphan["pr"] == number and (orphan["run_id"], orphan["attempt"]) == generation(run):
                            try:
                                self.runtime.remove(orphan["namespace"])
                                live = [e for e in live if e["namespace"] != orphan["namespace"]]
                            except Exception:
                                if not any(e["namespace"] == orphan["namespace"] for e in live):
                                    live.append(orphan)
                                self.errors.append(f"PR #{number}: partial deployment cleanup failed")
                # Never print raw provider errors, subprocess output, or PR data:
                # they can contain credentials, signed URLs or workflow commands.
                reason = str(exc) if isinstance(exc, PreviewError) else "Preview operation failed; check infrastructure configuration."
                self.errors.append(f"PR #{number}: {reason}")
                self.post(pr, "failed", reason + " Re-run the image workflow after fixing the issue.", run)
        keep = {(number, *generation(run)) for number, run in runs.items()
                if self.enabled and self.configured and run and expires_at(run) > self.now}
        # Preserve any image whose runtime could not be deleted, regardless of PR
        # state. A future pass retries deletion before collecting its image.
        keep.update((entry["pr"], entry["run_id"], entry["attempt"]) for entry in live)
        cleanup_registry(self.gh, keep)
        if self.errors:
            raise PreviewError("; ".join(self.errors))


def main():
    import runtime
    required = ("PREVIEW_RAILWAY_PROJECT_ID", "PREVIEW_RAILWAY_APP_SERVICE_ID",
                "PREVIEW_RAILWAY_GATEWAY_SERVICE_ID", "PREVIEW_GATEWAY_IMAGE", "RAILWAY_API_TOKEN")
    gh = GitHub(os.environ["GITHUB_REPOSITORY"], os.environ["GH_TOKEN"])
    Controller(gh, runtime, os.environ.get("PREVIEW_ENABLED") == "true",
               all(os.environ.get(key) for key in required)).reconcile()


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(str(exc) if isinstance(exc, PreviewError) else "Preview reconciliation failed; inspect configuration and provider availability.", file=sys.stderr)
        sys.exit(1)
