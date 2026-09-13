# meticulous agent

Read, analysis, and run-triggering commands designed for AI coding agents. They resolve git context (commit SHA, base, diff) automatically from the local repository, and default to machine-readable output.

All commands are also exposed as tools on the hosted **MCP server** (`https://app.meticulous.ai/api/mcp`) — an MCP-enabled client can call the `get_…` tool directly instead of shelling out. Each read tool takes broadly the same arguments and returns the same data as the CLI command's `--json` output, with differences inherent to a hosted endpoint with no access to your local repo or filesystem: **`commitSha`/`baseSha`/`gitDiffOutput` are never inferred — always compute and pass them explicitly** (e.g. `git rev-parse HEAD`, `git merge-base origin/main HEAD`), there are no output-format flags, and — for `image-files` — you get signed URLs rather than files downloaded to disk. The **MCP tool** column below gives the mapping.

`upload-build`/`trigger-test-run` (the mutating commands) map to MCP tools too, but not 1:1 — the CLI's single `agent upload-build` call is split into a **request → (upload) → register** pair on MCP (`request_asset_upload`/`request_container_upload` then `register_asset_build`/`register_container_build`), and `trigger_test_run` **does not wait for the run to finish** (unlike the CLI, which blocks by default). No separate "is it done" check is needed to follow it, though: `get_test_run_diffs` already waits out an in-progress run internally (reporting `pending`/`processing` the whole time, same as it does while computing the diff summary itself), so just poll that one call. `get_test_run_diffs_counts` has no such wait — don't rely on it to detect completion, since on an in-progress run it returns whatever partial counts currently exist rather than telling you to wait. See the `meticulous-test`, `meticulous-zero-diff-task`, or `meticulous-increase-coverage` skill for the CLI workflow; use `mcp-server.ts`/the in-app MCP docs for the exact MCP tool call sequence.

## Common options

Accepted by every `agent` command (in addition to the [global options](../SKILL.md#global-options)):

| Option       | Type    | Default | Description                                                                    |
| ------------ | ------- | ------- | ------------------------------------------------------------------------------ |
| `--apiToken` | string  | —       | Meticulous API token; otherwise use the default auth chain (see `auth whoami`) |
| `--json`     | boolean | `false` | Emit JSON on stdout instead of the default TSV/plain-text format               |
| `--verbose`  | boolean | `false` | Print additional progress logs on stderr                                       |

Commands that resolve a test run from a commit (`test-run-for-commit`, `test-run-diffs`, `js-coverage`, `trigger-test-run`, `complete-base-run`) also accept `--project <id | org/name | name>` — a one-off override of your default project for that call only (it does not change the stored default; see [`auth`](auth.md)).

## Command → MCP tool overview

| Command                          | Purpose                                                                     | MCP tool                                                                                                                         |
| -------------------------------- | --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `test-run-for-commit`            | Look up the latest test run for a commit                                    | `get_test_run_for_commit`                                                                                                        |
| `test-run-diffs`                 | List the screenshot diffs of a test run                                     | `get_test_run_diffs`                                                                                                             |
| `test-run-diffs --counts`        | Aggregate diff/review totals only                                           | `get_test_run_diffs_counts`                                                                                                      |
| `diff-comments`                  | Review comments for a screenshot diff                                       | `get_diff_comments`                                                                                                              |
| `reject-diff`                    | Reject a screenshot diff (real, blocking decision) and comment why          | `reject_diff`                                                                                                                    |
| `ignore-diff`                    | Comment that a screenshot diff is unrelated to the change (decides nothing) | `ignore_diff`                                                                                                                    |
| `create-diff-comment`            | Start a review comment thread                                               | `create_diff_comment`                                                                                                            |
| `reply-to-diff-comment`          | Reply to a review comment thread                                            | `reply_to_diff_comment`                                                                                                          |
| `image-urls`                     | Signed URLs for a screenshot diff's images                                  | `get_image_urls`                                                                                                                 |
| `image-files`                    | Download a screenshot diff's images to disk                                 | _(none — use `get_image_urls`)_                                                                                                  |
| `dom-diff`                       | DOM diff for a screenshot diff                                              | `get_dom_diff`                                                                                                                   |
| `timeline-diff`                  | Timeline event diffs for a replay diff                                      | `get_timeline_diff`                                                                                                              |
| `test-run-check`                 | Get the Markdown report for a non-visual check                              | `get_test_run_check`                                                                                                             |
| `test-run-check --availableIds`  | List the check IDs available for a test run                                 | `get_test_run_check_available_ids`                                                                                               |
| `js-coverage --testRunId`        | Per-file JS coverage for a test run                                         | `get_test_run_js_coverage`                                                                                                       |
| `js-coverage --latestForProject` | Per-file JS coverage for a project's latest successful run                  | `get_project_js_coverage`                                                                                                        |
| `js-coverage --replayId`         | Per-file JS coverage for a replay                                           | `get_replay_js_coverage`                                                                                                         |
| `js-coverage-diff`               | Per-file JS coverage diff for a replay diff                                 | `get_replay_diff_js_coverage_diff`                                                                                               |
| `sessions`                       | List a project's recently recorded sessions                                 | `get_sessions`                                                                                                                   |
| `upload-build`                   | Upload a build, register a deployment                                       | `request_asset_upload` + `register_asset_build` (assets), or `request_container_upload` + `register_container_build` (container) |
| `trigger-test-run`               | Trigger a run against a deployment                                          | `trigger_test_run` (returns immediately — does not wait for completion)                                                          |
| `complete-base-run`              | Replay the sessions a base run has not run yet                              | `complete_base_run` (returns once scheduled — does not wait for completion)                                                      |
| `submit-feedback`                | Submit free-form feedback about Meticulous                                  | `submit_feedback`                                                                                                                |

For full, always-current option lists, run `meticulous schema agent <command>`.

---

## agent test-run-for-commit

```bash
# CLI
meticulous agent test-run-for-commit [--commitSha=<sha>] [--project=<project>]

# MCP
get_test_run_for_commit(commitSha="<sha>")
```

**Purpose:** Look up the latest test run for a commit (defaults to the current git HEAD) and output the `testRunId`.

A base run is one other test runs compare against rather than a run of its own — the usual outcome for a commit on your default branch. It has no diffs and no PR, so `test-run-diffs` and `test-run-check` reject it, and it replays its selected sessions on demand, so `js-coverage` works on it only once it has replayed everything it can (see [`complete-base-run`](#agent-complete-base-run)).

| Option                           | Type    | Default          | Description                                                       |
| -------------------------------- | ------- | ---------------- | ----------------------------------------------------------------- |
| `--commitSha`                    | string  | current git HEAD | Commit to look up the run for                                     |
| `--dontWaitForTestRunToComplete` | boolean | `false`          | Report an in-progress run and exit immediately instead of waiting |

## agent test-run-diffs

```bash
# CLI
meticulous agent test-run-diffs [--testRunId=<id> | --commitSha=<sha>] [options]
meticulous agent test-run-diffs --counts [--testRunId=<id> | --commitSha=<sha>]

# MCP
get_test_run_diffs(testRunId="<id>")
get_test_run_diffs_counts(testRunId="<id>")
```

**Purpose:** List the screenshot diffs for a test run — by default a selected, priority-ordered subset of representative visual differences (position in the list is the priority signal, there is no `index` column). Outputs a TSV table (`replayDiffId`, `screenshotName`, plus requested columns; `mismatchFraction` is opt-in via `--includeMismatchFraction`). See the `meticulous-review` skill for the full workflow and column semantics.

| Option                           | Type    | Default          | Description                                                                                                                  |
| -------------------------------- | ------- | ---------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| `--testRunId`                    | string  | —                | Target run explicitly (else resolved from `--commitSha`, else git HEAD)                                                      |
| `--commitSha`                    | string  | current git HEAD | Resolve the latest run for this commit                                                                                       |
| `--includeAllDiffs`              | boolean | `false`          | Return every difference, not just the selected subset; adds an `isSelected` column                                           |
| `--onlyUnreviewed`               | boolean | `false`          | Only diffs still awaiting review (implies `--includeAllDiffs`)                                                               |
| `--onlyRejected`                 | boolean | `false`          | All rejected diffs, human- or agent-rejected — the complete set of issues requiring fixes (implies `--includeAllDiffs`)      |
| `--onlyWithComments`             | boolean | `false`          | All diffs with one or more open review comments, regardless of decision (implies `--includeAllDiffs`)                        |
| `--includeReviews`               | boolean | `false`          | Add `decision` and `openComments` columns with the review metadata per diff                                                  |
| `--includeReplayIds`             | boolean | `false`          | Add `baseReplayId` / `headReplayId` columns                                                                                  |
| `--includeMismatchFraction`      | boolean | `false`          | Add a `mismatchFraction` column (fraction of pixels that differ between before/after)                                        |
| `--includeDomDiffIds`            | boolean | `false`          | Add a `domDiffIds` column (one ID per distinct structural DOM change)                                                        |
| `--orderByReplayDiffs`           | boolean | `false`          | Order by replay diff instead of global priority                                                                              |
| `--counts`                       | boolean | `false`          | Print aggregate totals only (replays, differences, review-decision breakdown); cannot be combined with the list/filter flags |
| `--dontWaitForTestRunToComplete` | boolean | `false`          | Report an in-progress run and exit immediately instead of waiting                                                            |

`--includeReviewDecisions` remains available as a deprecated alias for `--includeReviews`.

The `--only*` flags (`--onlyUnreviewed`, `--onlyRejected`, `--onlyWithComments`) are **additive (OR'd), not a narrowing combination** — passing more than one widens the output to their union (e.g. rejected diffs _plus_ diffs with comments, not the intersection), rather than narrowing to diffs matching all of them.

The `decision` values are `accepted`, `rejected`, `ignored`, and `unreviewed` — there's no separate agent bucket: an agent's `reject-diff` (see below) writes a real `rejected` decision, indistinguishable from a human's at this level, and blocks the check identically. `--counts`' `numRejected` is this same unified count. An agent can only ever write `rejected` — there's no agent-facing way to write `accepted`/`ignored`, so `--onlyUnreviewed` is unaffected by agent activity.

## agent diff-comments

```bash
# CLI
meticulous agent diff-comments --replayDiffId=<id> --screenshotName=<name> [--includeResolved]

# MCP
get_diff_comments(replayDiffId="<id>", screenshotName="<name>")
```

**Purpose:** Get open review comments for one screenshot diff, oldest first, with each comment's replies nested oldest first. The non-JSON output is a flattened TSV table (`id`, `replyToCommentId`, `author`, `isAgentAuthored`, `text`, `x`, `y`) with each comment immediately followed by its replies; `replyToCommentId` is TSV-only (blank for top-level comments, no JSON/MCP equivalent) so a reply row can be linked back to its parent, and a reply's `x`/`y` repeat the parent's since replies don't carry their own coordinates. `isAgentAuthored` says whether an agent wrote the comment: a comment written with a project token has no `author` to identify it, so this is the only thing distinguishing an agent's from a human's. Unavailable optional fields are blank in TSV and omitted from JSON/MCP output. `text` is JSON-quoted (the only column that is) so multiline/tabbed comment bodies stay on one row; `x`/`y` are formatted to 5 decimal places. `--includeResolved` also returns resolved comments and adds `isResolved`.

| Option              | Type    | Description                                                       |
| ------------------- | ------- | ----------------------------------------------------------------- |
| `--replayDiffId`    | string  | Replay diff from `test-run-diffs` (required)                      |
| `--screenshotName`  | string  | Screenshot name from `test-run-diffs` (required)                  |
| `--includeResolved` | boolean | Include resolved comments and add `isResolved` (default: `false`) |

## agent reject-diff / agent ignore-diff

```bash
# CLI
meticulous agent reject-diff --replayDiffId=<id> --screenshotName=<name> --reason="<why>" --x=<0..1> --y=<0..1>
meticulous agent ignore-diff --replayDiffId=<id> --screenshotName=<name> --reason="<why>" --x=<0..1> --y=<0..1>

# MCP
reject_diff(replayDiffId="<id>", screenshotName="<name>", reason="<why>", x=<0..1>, y=<0..1>)
ignore_diff(replayDiffId="<id>", screenshotName="<name>", reason="<why>", x=<0..1>, y=<0..1>)
```

**Purpose:** Record an agent's verdict on one screenshot difference, backed by a review comment containing a succinct reason at required approximate normalized coordinates. Returns the created comment's `id`. The two are **not symmetric**:

- **`reject-diff`** writes a real `rejected` decision — the same `decision` a human rejection would write, blocking the check identically, and replacing whatever decision (human or agent) was there before.
- **`ignore-diff` decides nothing.** It only posts a comment stating the agent's view that the diff is unrelated to the change under review — typically a flake (subpixel rendering noise, animation non-determinism); the diff stays `unreviewed` and the check stays pending. This is intentional, not a limitation to work around: only a human can write `accepted`/`ignored`, so no holder of a project write token can green their own pull request. An agent can escalate a diff (reject) but never clear one.

The test run must belong to a pull request, or be a custom-trigger run — the run you triggered yourself, where the decision is recorded against the run itself. A run that's neither (a plain push or crawler run) has nowhere to record a decision, and the call is rejected.

**Every call posts a new comment**, same as `create-diff-comment` — including a `reject-diff` repeating a verdict the diff already carries. That repeat appends no second decision (the verdict already stands), but it still records its own reason and coordinates and returns that comment's `id`, so a retry after a dropped connection is safe for the decision while leaving an extra comment on the thread. A `reject-diff` that _changes_ the standing verdict resolves the comment behind the decision it replaces.

| Option             | Type   | Description                                                            |
| ------------------ | ------ | ---------------------------------------------------------------------- |
| `--replayDiffId`   | string | Replay diff from `test-run-diffs` (required)                           |
| `--screenshotName` | string | Screenshot name from `test-run-diffs` (required)                       |
| `--reason`         | string | Why the diff is a regression, or is unrelated to the change (required) |
| `--x`              | number | Approximate normalized x of the change, 0–1 (required)                 |
| `--y`              | number | Approximate normalized y of the change, 0–1 (required)                 |

## agent create-diff-comment / agent reply-to-diff-comment

```bash
# CLI
meticulous agent create-diff-comment --replayDiffId=<id> --screenshotName=<name> --text="..." --x=<0..1> --y=<0..1>
meticulous agent reply-to-diff-comment --commentId=<id> --text="..."

# MCP
create_diff_comment(replayDiffId="<id>", screenshotName="<name>", text="...", x=<0..1>, y=<0..1>)
reply_to_diff_comment(commentId="<id>", text="...")
```

**Purpose:** Start a review comment thread on a screenshot diff at required approximate normalized coordinates, or reply to an existing root comment. Replies inherit the root thread's anchor, so they take no `--x`/`--y`. Each command outputs the created comment or reply ID (`{ commentId }` with `--json`). Keep comment text succinct, ideally 1–3 sentences.

Each call adds another comment, same as `reject-diff`/`ignore-diff` — none of them are idempotent.

## agent image-urls / agent image-files

```bash
# CLI
meticulous agent image-urls  --replayDiffId=<id> --screenshotName=<name>
meticulous agent image-files --replayDiffId=<id> --screenshotName=<name>

# MCP (no download-to-disk tool — image-files has no equivalent; fetch the URL to view the image)
get_image_urls(replayDiffId="<id>", screenshotName="<name>")
```

**Purpose:** Get the images of a screenshot diff. `image-urls` prints the outcome plus a signed URL per image (`before` / `after` / `diffImage`); `image-files` downloads them under `~/.meticulous/agent-images/` and prints the local paths instead.

| Option             | Type   | Description                                      |
| ------------------ | ------ | ------------------------------------------------ |
| `--replayDiffId`   | string | Replay diff the screenshot belongs to (required) |
| `--screenshotName` | string | Screenshot name (required)                       |

## agent dom-diff

```bash
# CLI
meticulous agent dom-diff --replayDiffId=<id> --screenshotName=<name> [--context=<N|full>]

# MCP
get_dom_diff(replayDiffId="<id>", screenshotName="<name>")
```

**Purpose:** Unified-diff-style DOM diff for a screenshot diff, one hunk per change.

| Option             | Type             | Default | Description                                                                       |
| ------------------ | ---------------- | ------- | --------------------------------------------------------------------------------- |
| `--replayDiffId`   | string           | —       | Replay diff (required)                                                            |
| `--screenshotName` | string           | —       | Screenshot name (required)                                                        |
| `--context`        | number \| `full` | `3`     | Context lines around each hunk (`0` for none, `full` for a single full-file diff) |

## agent timeline-diff

```bash
# CLI
meticulous agent timeline-diff --replayDiffId=<id>

# MCP (its `diff` field carries the raw status enum rather than the TSV symbol below)
get_timeline_diff(replayDiffId="<id>")
```

**Purpose:** Timeline event diffs for a replay diff. Outputs a TSV table (`diff`, `timeMs`, `event`, `description`). Useful for diagnosing why a screenshot diff occurred (failed requests, redirects, timing).

| Option           | Type   | Description            |
| ---------------- | ------ | ---------------------- |
| `--replayDiffId` | string | Replay diff (required) |

## agent test-run-check

```bash
# CLI
meticulous agent test-run-check --checkId=<id> [--checkType=builtin|custom] [--testRunId=<id> | --commitSha=<sha>]
meticulous agent test-run-check --availableIds [--testRunId=<id> | --commitSha=<sha>]

# MCP
get_test_run_check(testRunId="<id>", checkId="<id>")
get_test_run_check_available_ids(testRunId="<id>")
```

**Purpose:** Get the Markdown report for a builtin or customer-reported non-visual check on a test run, or — with `--availableIds` — list the check IDs that have reported results so far instead of fetching a report.

Report mode prints the report text; `--availableIds` prints a TSV table with columns `checkType` and `checkId` (MCP: a list of objects with those two attributes).

A report result is `{ status: 'processing' }` while results have not been reported yet — poll every 10s until `complete`, for at most 3 minutes; if it's still `processing` then, stop and tell the user the results have not arrived rather than polling on. Once complete it's `{ status: 'complete', text }`; a `{ status: 'failed', reason }` result is final — there is no way to retry. For `--checkType custom`, an error saying the run is not expecting custom check results can be transient shortly after the run completes, since the customer's own CI registers its checks separately: retry for a minute or so before concluding the run has no custom checks.

`--availableIds` (MCP: `get_test_run_check_available_ids`) never waits for the test run or its checks to finish, unlike fetching a report — it returns whatever check IDs have reported results so far. An empty list shortly after triggering a run can mean the checks simply haven't reported yet rather than that none exist, so retry for a minute or so (the same budget a report fetch gives itself) before concluding the run has no checks.

| Option                           | Type    | Default          | Description                                                                                                                                                                      |
| -------------------------------- | ------- | ---------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--testRunId`                    | string  | —                | Target run explicitly (else resolved from `--commitSha`, else git HEAD)                                                                                                          |
| `--commitSha`                    | string  | current git HEAD | Resolve the latest run for this commit                                                                                                                                           |
| `--project`                      | string  | default project  | One-off override (id, `org/proj`, or `proj`); cannot be combined with `--testRunId`                                                                                              |
| `--checkType`                    | string  | `builtin`        | `builtin` for a Meticulous-provided check, or `custom` for a customer-reported check                                                                                             |
| `--checkId`                      | string  | —                | The check ID; required unless `--availableIds` is set. Use `--availableIds` to discover it                                                                                       |
| `--availableIds`                 | boolean | `false`          | List the check IDs that have reported results for the run, instead of fetching a report. Cannot be combined with `--checkId`, `--checkType`, or `--dontWaitForTestRunToComplete` |
| `--dontWaitForTestRunToComplete` | boolean | `false`          | Report an in-progress run and exit immediately instead of waiting (report mode only)                                                                                             |

On MCP, `get_test_run_check` does not poll internally — poll it yourself every 10s until `status` is `complete` or `failed` (final — no retry).

## agent js-coverage

```bash
# CLI
meticulous agent js-coverage --testRunId=<id>          # or --commitSha=<sha>
meticulous agent js-coverage --latestForProject
meticulous agent js-coverage --replayId=<id>

# MCP
get_test_run_js_coverage(testRunId="<id>")
get_project_js_coverage()
get_replay_js_coverage(replayId="<id>")
```

**Purpose:** Per-file JavaScript coverage for a whole test run, a single replay, a combined set of runs, or a project's latest successful run. Outputs a TSV table keyed on `repoFilePath` plus the requested columns.

A base run (see [`test-run-for-commit`](#agent-test-run-for-commit)) replays its selected sessions on demand, so while any of them could still be replayed its coverage understates the commit and this is refused, saying how many are missing. Either replay the rest with [`complete-base-run`](#agent-complete-base-run) and ask again, or pass `--latestForProject` for the project's overall coverage. A run that has replayed everything it can answers normally — a small share of the set being permanently unreplayable (a chunk that finished without reporting some of its sessions) is tolerated rather than blocking the commit forever, and above that share the refusal says so and that completing the run cannot help.

| Option                                                                                   | Type    | Description                                                                                                                                                                    |
| ---------------------------------------------------------------------------------------- | ------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `--testRunId` / `--commitSha`                                                            | string  | Coverage for a test run (defaults to the current git HEAD)                                                                                                                     |
| `--latestForProject`                                                                     | boolean | Coverage for the project's preferred latest successful test run (the same run the webapp's project coverage view uses); mutually exclusive with the other run-selector options |
| `--replayId`                                                                             | string  | Coverage for a single replay                                                                                                                                                   |
| `--screenshotName`                                                                       | string  | Restrict to a single screenshot of the replay                                                                                                                                  |
| `--headPlusTestRunIds` / `--testRunIds`                                                  | string  | Comma-separated run IDs to union coverage across (same project + commit)                                                                                                       |
| `--globFilter`                                                                           | string  | Only include files matching the glob                                                                                                                                           |
| `--includeAllFiles`                                                                      | boolean | Include files with no coverage too                                                                                                                                             |
| `--prDiffOnly`                                                                           | boolean | Restrict to files changed in the PR (test-run queries only)                                                                                                                    |
| `--includeExecutableRanges` / `--includeUncoveredRanges` / `--includeCoveragePercentage` | boolean | Add richer per-file coverage columns                                                                                                                                           |
| `--dontWaitForTestRunToComplete`                                                         | boolean | Report an in-progress run and exit immediately instead of waiting                                                                                                              |

## agent js-coverage-diff

```bash
# CLI
meticulous agent js-coverage-diff --replayDiffId=<id> [--screenshotName=<name>] [--globFilter=<glob>]

# MCP
get_replay_diff_js_coverage_diff(replayDiffId="<id>")
```

**Purpose:** Per-file JS coverage diff for a replay diff. Outputs a TSV table (`repoFilePath`, `status`, `baseRanges`, `headRanges`).

## agent sessions

```bash
# CLI
meticulous agent sessions [options]

# MCP
get_sessions()
```

**Purpose:** List a project's most recently created sessions, newest first (default: 100). Useful for finding the ID of a session just recorded. Outputs a TSV table (`id`, `createdAt`, `recordedAt`, `recordedBy`, `status`, plus requested columns).

| Option                                                     | Type    | Default         | Description                                                                 |
| ---------------------------------------------------------- | ------- | --------------- | --------------------------------------------------------------------------- |
| `--project`                                                | string  | default project | One-off override (id, `org/proj`, or `proj`)                                |
| `--createdSince` / `--createdUntil`                        | string  | —               | ISO-8601 date/time bounds on creation time                                  |
| `--recordedSince` / `--recordedUntil`                      | string  | —               | ISO-8601 date/time bounds on recording time                                 |
| `--recordedBy`                                             | string  | —               | Filter by the user who recorded the session                                 |
| `--excludeSyntheticSessions`                               | boolean | `false`         | Drop synthetic sessions (also drops the `status` column)                    |
| `--visitedUrlFilter`                                       | string  | —               | Glob over visited URLs (only `*` is a wildcard), e.g. `*/checkout*`         |
| `--includeStartUrl` / `--includeAbandonedReason`           | boolean | `false`         | Add extra columns                                                           |
| `--includeNumberUserEvents` / `--includeNumberUrlsVisited` | boolean | `false`         | Add activity-count columns                                                  |
| `--includeDurationSeconds`                                 | boolean | `false`         | Add a `durationSeconds` column (empty when a duration couldn't be computed) |
| `--limit`                                                  | number  | `100`           | 1–1000                                                                      |
| `--offset`                                                 | number  | `0`             | —                                                                           |

---

## agent upload-build

```bash
# CLI
meticulous agent upload-build --appDirectory=<path>     # static assets
meticulous agent upload-build --localImageTag=<tag>     # container image

# MCP (not 1:1 — request an upload URL, upload the artifact yourself, then register it)
request_asset_upload(size=<zipByteSize>)      # or request_container_upload() — no required args
# ... upload the zip/image to the returned URL/registry yourself ...
register_asset_build(uploadId="<id>", commitSha="<sha>")      # or register_container_build(uploadId="<id>", commitSha="<sha>")
```

**Purpose:** Upload a build and register a reusable deployment **without** triggering a run. Outputs the `deploymentId`. The commit defaults to the local git HEAD (a dirty working tree is captured as an ephemeral commit; untracked files are rejected). See the `meticulous-test` or `meticulous-zero-diff-task` skill for the full workflow.

| Option                                                                  | Type    | Description                                         |
| ----------------------------------------------------------------------- | ------- | --------------------------------------------------- |
| `--appDirectory`                                                        | string  | Build output directory (static-assets mode)         |
| `--appZip`                                                              | string  | Zipped build, as an alternative to `--appDirectory` |
| `--localImageTag`                                                       | string  | Local Docker image tag (container mode)             |
| `--containerPort` / `--containerEnv` / `--containerHealthCheckEndpoint` | —       | Container runtime configuration                     |
| `--rewrites`                                                            | string  | Static-asset rewrite rules                          |
| `--commitSha`                                                           | string  | Override the commit the build is registered against |
| `--dryRun`                                                              | boolean | Print what would be uploaded without doing it       |

On MCP, `commitSha` is never inferred — always pass your local commit explicitly (e.g. `git stash create` for a dirty tree, since untracked files are still excluded).

## agent trigger-test-run

```bash
# CLI
meticulous agent trigger-test-run [--deploymentId=<id>] [--baseSha=<sha>] [options]

# MCP (returns immediately — doesn't wait for completion; move straight to get_test_run_diffs, which waits out the run internally)
trigger_test_run(deploymentId="<id>", baseSha="<sha>")
```

**Purpose:** Trigger a test run against a deployment from `agent upload-build`, comparing against a base. Outputs the `testRunId`. A base is required (auto-inferred from the repo, or set via `--baseSha`). Omit `--deploymentId` to reuse the most recent deployment for the local HEAD commit (requires a clean working tree). See the `meticulous-test`, `meticulous-zero-diff-task`, or `meticulous-increase-coverage` skill.

| Option                           | Type    | Default             | Description                                                  |
| -------------------------------- | ------- | ------------------- | ------------------------------------------------------------ |
| `--deploymentId`                 | string  | latest for HEAD     | Deployment to run against                                    |
| `--commitSha`                    | string  | current git HEAD    | Resolve the most recent deployment for this commit           |
| `--baseSha`                      | string  | inferred merge-base | Base commit to compare against                               |
| `--gitDiffOutput`                | string  | inferred            | Explicit git diff, paired with `--baseSha`                   |
| `--sessionIds`                   | string  | project golden set  | Comma-separated session IDs to replay for both base and head |
| `--maxDurationSeconds`           | number  | —                   | Cap the run's duration                                       |
| `--dontWaitForTestRunToComplete` | boolean | `false`             | Return as soon as the run is triggered                       |
| `--dryRun`                       | boolean | `false`             | Print what would be triggered without doing it               |

`deploymentId` on MCP comes from `register_asset_build`/`register_container_build`. `baseSha`/`gitDiffOutput` are never inferred on MCP — compute them locally (e.g. `git merge-base origin/main HEAD`) and pass them explicitly.

## agent complete-base-run

```bash
# CLI
meticulous agent complete-base-run [--testRunId=<id> | --commitSha=<sha>] [options]

# MCP (idempotent — re-call it until unexecutedSessionCount equals unobtainableSessionCount)
complete_base_run(testRunId="<id>")
```

**Purpose:** Replay the selected sessions a base run has not run yet, so its coverage describes its commit. A base run replays sessions on demand for whichever PRs compare against it, so it can sit at any fraction of the project's selected set, and [`js-coverage`](#agent-js-coverage) refuses it while sessions are still missing. Outputs `testRunId`, `status`, `unexecutedSessionCount`, `unobtainableSessionCount`, `sessionsScheduled` and `configuredSessionCount`.

There is no single "done" flag — watch `unexecutedSessionCount` against `unobtainableSessionCount` instead. The CLI waits for the two to become equal by default (up to 10 minutes, returning whatever it has if that isn't reached); MCP returns immediately, so re-call `complete_base_run` until they match, then ask for coverage again. Don't wait for `unexecutedSessionCount` to reach `0`: `unobtainableSessionCount` of those sessions can no longer be replayed at all — the chunks covering them finished without reporting a result — so for some runs the count never reaches `0`. Whether that remainder is small enough for coverage to serve anyway is [`js-coverage`](#agent-js-coverage)'s call, not this command's — it only reports the facts. `sessionsScheduled` is `0` both when everything has replayed and when the remaining sessions are already covered by earlier work, so it is not a completion signal either.

This costs a full test run's replays, so reach for it when you want this commit's own coverage; `js-coverage --latestForProject` gives a project-level picture for free. The operation is idempotent and retries sessions from chunks that concluded with `ExecutionError`. It fails for a run that is not a base run, whose whole-run status is a dead end (`ExecutionError`/`Aborted` at the whole-run level, not a single chunk), or whose deployment was an ephemeral tunnel that is no longer reachable.

| Option                           | Type    | Default          | Description                                                    |
| -------------------------------- | ------- | ---------------- | -------------------------------------------------------------- |
| `--testRunId`                    | string  | —                | The base run to complete                                       |
| `--commitSha`                    | string  | current git HEAD | Complete the latest run for this commit instead                |
| `--dontWaitForTestRunToComplete` | boolean | `false`          | Return once the replays are scheduled instead of awaiting them |

## agent submit-feedback

```bash
# CLI
meticulous agent submit-feedback --message="<one or two sentences>" [options]

# MCP
submit_feedback(message="<one or two sentences>", outcome="<helped|neutral|hindered>", testRunId="<id>", skill="<skill-name>")
```

**Purpose:** Submit free-form feedback about Meticulous to the Meticulous team — e.g. whether it helped catch or debug a problem, what was confusing, or what information would have made your task easier. Outputs the `feedbackId`.

| Option         | Type   | Description                                                                                                                                                   |
| -------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `--message`    | string | **Required.** The feedback itself: one or two sentences on whether Meticulous helped, what was missing or confusing, and what would have made the task easier |
| `--outcome`    | string | `helped`, `neutral`, or `hindered`                                                                                                                            |
| `--testRunId`  | string | The test run the feedback relates to, if any                                                                                                                  |
| `--skill`      | string | The agentic skill or workflow being followed, e.g. `meticulous-review`                                                                                        |
| `--agentName`  | string | The agent product submitting the feedback, e.g. `claude-code`                                                                                                 |
| `--agentModel` | string | The underlying model, e.g. `claude-sonnet-5`                                                                                                                  |
| `--project`    | string | One-off project override for this call                                                                                                                        |
