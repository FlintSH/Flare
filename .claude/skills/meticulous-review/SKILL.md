---
name: meticulous-review
description: Analyze a completed Meticulous test run — compare the diffs against the PR description to see what's expected, then focus on finding and flagging potential regressions. Resolves the test run from the local repo's current commit (the default), or from an explicit test-run ID or commit SHA. Use when asked to review Meticulous test results, when babysitting a pull/merge request's Meticulous Tests CI check, or right after implementing a frontend change yourself.
user-invocable: true
---

To review a Meticulous test run, follow the workflow below step by step, using the CLI or MCP commands as described.

> Before starting, run the `meticulous-cli-update` skill to ensure the Meticulous CLI and skills are up to date — unless it has already run earlier in this conversation, in which case skip it.

This skill treats you as a **reviewer, not the implementer** — even if you did write the change earlier in this conversation. Its job is to catch regressions, not to iterate on the implementation (if you're mid-implementation and want to loop against Meticulous until things look right, see the `meticulous-iterative-dev` skill for feature work with intended visual changes, or the `meticulous-zero-diff-task` skill when the UI must not change; if diffs have already been reviewed and rejected and you're just here to fix what's flagged, see the `meticulous-fix` skill).

## Step 0 -- Establish what's expected

Before looking at any diff, work out what visual change this PR is _supposed_ to produce:

- **If you already have full context** (same conversation that implemented the change, or the user just described the task), use that.
- **Otherwise** — fetch the PR description (e.g. `gh pr view <number> --json title,body` for GitHub, `glab mr view <id> --output json --jq '{title,description}'` for GitLab, or `GET /2.0/repositories/{workspace}/{repo_slug}/pullrequests/{id}?fields=title,description` for Bitbucket) and pull out a brief bullet-point summary of any visual changes it calls out as expected.
- If it doesn't mention any, note that explicitly — every diff below then gets extra scrutiny, since there's nothing on record it could be a known, accepted consequence of.

## Step 1 -- Get the replay diff summary

Run from the local checkout to resolve the test run from the current commit's git HEAD — make sure HEAD matches the remote head CI ran on first (e.g. `git pull`), or you may review a stale or missing run:

```bash
# CLI (infers the run from local git HEAD)
meticulous agent test-run-diffs

# MCP (git context is never inferred — resolve the testRunId from a commit first)
get_test_run_for_commit(commitSha="<sha>")
get_test_run_diffs(testRunId="<id>")
```

Returns a TSV of `replayDiffId`/`screenshotName` rows — a representative, priority-ordered subset of real visual differences; work through them top to bottom. To target a run explicitly instead of resolving from HEAD, pass `--testRunId <id>` or `--commitSha <sha>`. The CLI blocks until the run finishes by default (pass `--dontWaitForTestRunToComplete` to instead report an in-progress run and exit immediately); MCP never blocks, so keep polling until `status` is `complete`/`failed`.

Every returned row must be matched against Step 0 or flagged (see the Decision guide) before concluding the PR is good.

## Step 2 -- Get screenshot images

For each representative screenshot:

```bash
# CLI (downloads images to ~/.meticulous/agent-images/ and prints local paths)
meticulous agent image-files --replayDiffId <replayDiffId> --screenshotName <screenshotName>

# MCP (no download-to-disk tool — returns signed URLs instead; fetch them to view the images)
get_image_urls(replayDiffId="<replayDiffId>", screenshotName="<screenshotName>")
```

Open (or fetch) `before`, `after`, and `diffImage` to inspect the change — `diffImage` is usually the most informative, highlighting exactly which pixels changed. Always inspect the images, even when the DOM diff looks clear.

## Step 3 -- Inspect the DOM diff (for structural detail)

```bash
# CLI
meticulous agent dom-diff --replayDiffId <replayDiffId> --screenshotName <screenshotName>

# MCP
get_dom_diff(replayDiffId="<replayDiffId>", screenshotName="<screenshotName>")
```

Optional: `--context <N|full>` (CLI) controls how many context lines surround each hunk (default 3).

Output is a unified diff (`+`/`-`, indentation stripped), one `[diff N]`-headed block per independent change — for example (illustrative, not real output):

```
[diff 0]
 <div class="item">
-  <span class="label">old label</span>
+  <span class="label" data-flag="true">new label</span>
 </div>
[diff 1]
 <ul class="list">
+  <li>new item</li>
 </ul>
```

## Step 4 -- Get the replay timeline (optional, for diagnosing unexpected diffs)

If a diff is unexpected and the images/DOM don't make it obvious why:

```bash
# CLI
meticulous agent timeline-diff --replayDiffId <replayDiffId>

# MCP
get_timeline_diff(replayDiffId="<replayDiffId>")
```

TSV columns: `diff` (` ` identical, `-` removed, `+` added, `!` changed), `timeMs`, `event` (`user`/`screenshot`/`network`/`console`/etc.), `description`. Look for failed network requests, unexpected redirects, or timing anomalies that could explain a visual change.

## Step 5 -- Decision guide

For each representative screenshot, compare the diff image and DOM diff against Step 0's expectations:

- **Expected** — matches one of Step 0's expected changes (or, with full implementation context, is clearly a desired outcome). Check the diff actually looks like _that_ change and nothing more — a diff can be expected in kind but still carry an extra, unrelated regression bundled into the same screenshot. Nothing to flag.
- **Unintended** — not accounted for by Step 0. Use the timeline to rule out failed requests, redirects, or other anomalies, then flag it:
  - **Potential regression** (a real side effect, or otherwise clearly wrong) → **reject**.
  - **Unrelated to the change under review** — typically a flake, e.g. subpixel rendering noise or animation non-determinism → **ignore**.

Either way it's flagged, not silently dropped — a human still needs to see it.

**This skill reviews and flags — it does not fix.** Hand a rejected diff off to the `meticulous-fix` skill (or the person/skill implementing the change) — don't attempt code changes here.

## Step 6 -- Flag the diff

```bash
# CLI
meticulous agent reject-diff --replayDiffId=<id> --screenshotName=<name> --reason="<why>" --x=<0..1> --y=<0..1>
meticulous agent ignore-diff --replayDiffId=<id> --screenshotName=<name> --reason="<why>" --x=<0..1> --y=<0..1>
meticulous agent create-diff-comment --replayDiffId=<id> --screenshotName=<name> --text="<note>" --x=<0..1> --y=<0..1>

# MCP
reject_diff(replayDiffId="<id>", screenshotName="<name>", reason="<why>", x=<0..1>, y=<0..1>)
ignore_diff(replayDiffId="<id>", screenshotName="<name>", reason="<why>", x=<0..1>, y=<0..1>)
create_diff_comment(replayDiffId="<id>", screenshotName="<name>", text="<note>", x=<0..1>, y=<0..1>)
```

Call `reject-diff` or `ignore-diff` for **every** diff classified as unintended, in addition to including it in the final report. `--reason` is the succinct explanation from your classification above; `--x`/`--y` are the approximate normalized coordinates of the changed region, estimated from the diff image. `create-diff-comment` is the neutral option for anything you want on the record without a verdict.

**Not symmetric:** `reject-diff` writes a real, blocking decision, same as a human rejection. `ignore-diff` decides nothing — it's a comment only, so the diff stays `unreviewed` and the check stays pending either way. Only a human can clear a diff, so don't oversell an `ignore-diff` call in your final report as having resolved anything.

## Step 7 -- Final report

Cover **all significant visual changes**.

1. **Expected changes** — brief, a line or two each: what changed and which Step 0 expectation it matches.
2. **Flagged diffs** (if any) — the main point of the review, so give these the most detail: `replayDiffId`/`screenshotName` (linked: `https://app.meticulous.ai/test-runs/<testRunId>/replay-diff/<replayDiffId>?screenshot=<screenshotName>`), whether you rejected or ignored it, the reason you gave when flagging it (Step 6), what the change looks like, and your best assessment of the cause.

The PR is only good when every diff has been matched or flagged. If any diff is flagged, the PR is not yet good: surface it clearly to the user in addition to the flag itself.

## Step 8 -- Report feedback to Meticulous

**Always do this as the last step — it's part of the review itself, not something the user has to ask for.** Submit one brief note: did Meticulous catch a real problem, was anything confusing, what would have made the review easier. Positive feedback counts too — this isn't just for reporting friction.

```bash
# CLI
meticulous agent submit-feedback --message="<one or two sentences>" --outcome=<helped|neutral|hindered> --testRunId=<id> --skill=meticulous-review

# MCP
submit_feedback(message="<one or two sentences>", outcome="<helped|neutral|hindered>", testRunId="<id>", skill="meticulous-review")
```
