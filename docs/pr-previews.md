# Pull request previews

Once enabled, the preview workflows build a disposable Docker image for each PR,
deploy it on Railway, and keep one bot comment updated with progress, the current
commit, a public HTTPS URL, the image digest, and expiry. Fork and draft PRs use
the same flow. GitHub's workflow approval for outside contributors still applies;
no extra deployment label is required.

The repository contains the automation. A maintainer must provision the preview
project in a Railway workspace and enable it using the steps below before previews
can run. An existing paid workspace can be used without another subscription.

## Trying a PR

Sign in with `demo@example.test` / `Flare-preview-only!2026`. These credentials
are deliberately public and belong to a regular user. All visitors to one preview
share its account, database, and uploads, so someone else can change or delete
the data. Use made-up test data only. Never upload personal files, enter real
credentials, reuse a password, or connect production integrations. A preview runs
the PR author's unreviewed code, including JavaScript in your browser.

Each deployment starts with a new local PostgreSQL database and disposable
uploads. Registration and outbound integrations are disabled in the seeded
configuration. The public gateway also blocks setup, registration, email,
integration and short-link endpoints, plus mutations to settings, users, and
profiles. The app's read-only setup-status endpoint remains available.
Administrator, account, and integration changes need local testing.
The demo upload limit is 5 MiB per file and 50 MiB per account; the gateway caps
the entire request at 6 MiB, allowing for multipart overhead.

Previews expire after 24 hours even when the PR remains open. Closing or merging
the PR tears down its environment, and pushing a new commit replaces it. At most
five previews run at once; extra PRs wait for capacity. A new commit or rerun of
the **PR Preview Image** workflow requests a fresh preview after expiry or failure.
All data resets on replacement or redeployment.

Previews can also stop when the preview project's monthly budget threshold is
reached. This affects the disposable previews rather than changing the workspace's
billing limits. See the budget behavior below.

See [GitHub's fork workflow approval documentation](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/approve-runs-from-forks)
if a new contributor's build is waiting to start.

## Architecture and public access

The PR build uses an ephemeral GitHub-hosted runner, a read-only repository token,
and no deployment secrets. The app is built from the exact PR head; the disposable
database wrapper and fixtures come from a separate default-branch checkout, so
older feature branches do not need to carry the preview tooling. Changes to that
tooling take effect in deployed previews after they merge. It exports an OCI
image artifact. A separate controller
runs trusted default-branch code, validates the workflow run and current PR
revision, publishes to a preview-only GHCR package, and creates an **empty**
Railway environment. It never executes the PR image on the credentialed controller
runner or imports deployment commands from the artifact. Railway runs the images
by immutable digest.

| Service | Source                                           | Public access                                       | Credentials                        |
| ------- | ------------------------------------------------ | --------------------------------------------------- | ---------------------------------- |
| App     | PR image with disposable PostgreSQL and fixtures | Private network only; no public domain or TCP proxy | Disposable demo configuration only |
| Gateway | Separately built, trusted gateway image          | Railway-generated HTTPS domain                      | No Railway or GitHub token         |

The gateway shows a public-preview notice before entering the app, discourages
indexing, limits bodies and request rates, blocks sensitive routes, and refuses
requests at the fixed expiry. Its limits apply independently of the PR code.
Keep gateway and controller updates on the trusted branch until reviewed.
Credentialed `workflow_run` jobs must never execute artifact contents; see
[GitHub's security guidance](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#workflow_run).

Railway's private network is scoped to a project **and environment**. The cleanup
service runs in a separate control environment within a dedicated preview project.
Production projects may share its paid workspace, but production services and
credentials must stay outside the preview project. Never duplicate production
into a preview, add real database credentials or persistent volumes, or attach a
domain under the production site's registrable domain. The generated Railway
domains keep previews off your production domain.
See [Railway private-network scope](https://docs.railway.com/networking/domains/working-with-domains).

**This is not an outbound-network sandbox.** PR code can make outbound connections,
send data to external hosts, or create its own outbound tunnel. Seeded settings
and application quotas can be bypassed by modified code. The gateway controls
traffic through the published URL; it does not constrain every action of the app
process. Keep the preview project separate, keep real credentials out of the app,
and monitor its resource use and spend. A workspace token can also access other
projects in that workspace, so only the trusted controller and cleanup service
receive one. Never put it in a preview image or an inherited variable. See
[Railway outbound networking](https://docs.railway.com/networking/outbound-networking).

The controller requests one replica per service and checks that Railway accepted
the resource settings before attaching the source images:

| Service                | CPU      | Memory  | Ephemeral disk |
| ---------------------- | -------- | ------- | -------------- |
| App and local database | 1 vCPU   | 2 GiB   | 4 GiB          |
| Gateway                | 0.5 vCPU | 256 MiB | 256 MiB        |

Verify actual enforcement during provisioning; configuration acceptance alone
does not prove runtime isolation. No persistent volume is created. Files are
discarded on redeployment; see [Railway ephemeral storage](https://docs.railway.com/deployments/reference#ephemeral-storage).

## Maintainer setup

### Create the preview project

Use an existing paid Railway workspace and create a separate project named
**`flare-pr-previews`**. Other projects can remain in that workspace. The selected
plan must support the required resources and cron job. A separate workspace is
optional; creating another subscription is not required.

Leave existing workspace spending limits unchanged. Railway's native compute
hard limit applies to every project in its workspace, so changing it for previews
could stop production services. The preview automation instead monitors the
preview project's usage and removes its managed preview environments at the
configured threshold. This periodic monitor is not a native per-project billing
cap. See [Railway cost controls](https://docs.railway.com/pricing/cost-control).

Use the [Railway CLI](https://docs.railway.com/cli) to create the project and two
empty service definitions. Keep the app's exact name `preview-app`, since the
gateway uses `preview-app.railway.internal`.

```sh
npm install --global @railway/cli@5.54.0
railway login
railway init --name flare-pr-previews --workspace YOUR_EXISTING_WORKSPACE_ID
railway environment new preview-control
railway environment preview-control
railway add --service preview-app
railway add --service preview-gateway
railway status --json
```

Record the project ID and both service IDs. Leave these definitions empty in
`preview-control`: do not connect a GitHub source or start a permanent demo there.
The controller configures instances of these IDs in each new preview environment.
The initially created `production` environment is merely Railway's default name;
keep it empty, with no production workload or secrets. If the preview project
already exists, use `railway link --project YOUR_PREVIEW_PROJECT_ID` and select
`preview-control` instead of creating another project.

Keep Railway's built-in PR environments disabled for this project. These workflows
own the lifecycle and create empty environments instead of copying variables from
a base environment. Railway's built-in PR deployments also restrict outside
contributors; the separate CI build/controller flow handles public forks. See
[Railway environments](https://docs.railway.com/environments).

### Publish trusted gateway and cleanup images

Use the **PR Preview Support Images** workflow after it reaches the default branch.
It publishes both images to GHCR using the repository's `GITHUB_TOKEN`, without
requiring local Docker or a separate registry credential. It runs automatically
when the support sources change on `main`, or can be started from Actions →
PR Preview Support Images → Run workflow. Select the default branch; other refs
are rejected before the publishing job starts.

Copy both immutable `image@sha256:...` references from the run's summary. The
workflow builds `linux/amd64` images and labels them with their source repository
so newly created GHCR packages are linked to Flare's Actions access. After reviewed
support changes, use the new digests when updating the gateway variable and cleanup
service. Package names use the lowercase repository owner/name, so forks publish
to their own namespace.

For a manual fallback, authenticate Docker to GHCR with your normal maintainer
publishing credentials from a reviewed default-branch checkout, then run the
following commands. Replace the example registry namespace for forks. Never build
these trusted images from a PR checkout in a credentialed workflow.

```sh
docker build --platform linux/amd64 -f Dockerfile.preview-gateway -t ghcr.io/flintsh/flare-preview-gateway:bootstrap .
docker push ghcr.io/flintsh/flare-preview-gateway:bootstrap
docker build --platform linux/amd64 -f Dockerfile.preview-reaper -t ghcr.io/flintsh/flare-preview-reaper:bootstrap .
docker push ghcr.io/flintsh/flare-preview-reaper:bootstrap
```

For manual builds, record the digests reported by `docker push`. Configure
`image@sha256:...`, not mutable tags. Make both GHCR packages public and verify
anonymous pulls. If either package already exists, link it to Flare and grant the
repository's Actions workflow package access. No registry publishing credential
belongs in a preview service.

The automatically published PR package is
`ghcr.io/flintsh/flare-pr-previews`: the lowercase repository name with
`-pr-previews` appended. GHCR creates packages private by default. After the first
PR publish, make this third package public, verify an anonymous pull, and rerun
**PR Preview Image**. If the package already exists, link it to Flare and grant
the repository's Actions workflow package access. Railway cannot pull the image
until this bootstrap is complete. See
[GitHub's container registry documentation](https://docs.github.com/en/packages/working-with-a-github-packages-registry/working-with-the-container-registry).

### Configure credentials and GitHub

Create a **workspace token** in Railway's account token settings, selecting the
workspace containing `flare-pr-previews`. Do not select "No workspace", which
creates a broader account token. A project token only covers one environment
and cannot manage newly created PR environments. The workspace token also grants
access to other projects in a shared workspace; the dedicated preview project
does not narrow its permissions. Keep this token exclusively in the trusted
controller and control environment, and keep all PR code away from it. See
[Railway token scopes](https://docs.railway.com/integrations/api).

Set these in repository **Settings → Secrets and variables → Actions**:

| Name                                 | Kind     | Value                                                              |
| ------------------------------------ | -------- | ------------------------------------------------------------------ |
| `PREVIEW_ENABLED`                    | Variable | `true` after provisioning; leave `false` during setup.             |
| `PREVIEW_RAILWAY_PROJECT_ID`         | Variable | Dedicated preview project UUID.                                    |
| `PREVIEW_RAILWAY_APP_SERVICE_ID`     | Variable | Empty `preview-app` service UUID.                                  |
| `PREVIEW_RAILWAY_GATEWAY_SERVICE_ID` | Variable | Empty gateway service UUID.                                        |
| `PREVIEW_GATEWAY_IMAGE`              | Variable | Public trusted gateway image pinned by `@sha256:...`.              |
| `PREVIEW_MONTHLY_BUDGET_USD`         | Variable | `20` for a $20 preview-project usage threshold per billing period. |
| `PREVIEW_RAILWAY_API_TOKEN`          | Secret   | Token scoped to the workspace containing the preview project.      |

The trusted workflow passes the last secret to the Railway CLI/API as
`RAILWAY_API_TOKEN`. It also needs its declared PR-comment and package permissions.
Never add secrets or those write permissions to the PR build job. Keep fork builds
on disposable GitHub-hosted runners. Keep credentials out of shell history, logs,
app variables, and shared Railway variables.

### Install independent cleanup

In `preview-control`, add a service named `preview-reaper` using the trusted
reaper image digest. Set its service-specific `RAILWAY_API_TOKEN` and
`PREVIEW_RAILWAY_PROJECT_ID`, plus `PREVIEW_MONTHLY_BUDGET_USD=20` to match the
GitHub variable. Issue a separate workspace token so it can be rotated
independently of CI. Give this service no public domain, TCP proxy, persistent
volume, or GitHub token. Neither app nor gateway environments may inherit its token.

Set **Cron Schedule** to `*/15 * * * *` and restart policy to Never, then deploy.
It checks the preview project's budget, deletes expired or over-budget managed
environments, and exits. Run it manually once and verify successful completion.
Alert on failures and stuck runs, which prevent subsequent cron executions. See
[Railway cron behavior](https://docs.railway.com/cron-jobs).

GitHub reconciles hourly and handles PR closure and new revisions. The Railway
cron removes expired environments even if GitHub is down or scheduled workflows
are disabled. The gateway denies public traffic at expiry before cleanup completes.
App-side expiry is an additional convenience that hostile PR code could ignore.
A gateway denial or exited app does not delete the Railway environment; monitor
actual deletion and cleanup failures.

Merge the trusted workflows and scripts onto the default branch before activation;
`workflow_run` and scheduled workflows depend on it. Once resources, budget,
images, credentials, and cron are ready, set `PREVIEW_ENABLED=true` and test a
disposable PR. The first publish may require the GHCR visibility step above.
Adding these files does not itself provision or activate external infrastructure.

### Preview-project budget behavior

Set `PREVIEW_MONTHLY_BUDGET_USD` consistently in GitHub and the reaper service.
For example, `20` requests shutdown of managed preview environments once the
preview project's reported usage reaches $20 in its owner's current billing
period. Accounting includes deleted environments, so closing a PR does not reset
its recorded cost. The preview project's control service also contributes usage.
The monitor uses resource usage converted to dollar estimates; see
[Railway project usage](https://docs.railway.com/projects/project-usage).

The controller checks on preview events and its hourly schedule. The Railway
reaper checks every 15 minutes. API reporting delays, schedule delays, traffic
between checks, and ongoing cleanup-service usage mean spending can exceed the
threshold. This is an automatic shutdown threshold, not a guaranteed $20 bill.
Neither job changes the workspace's soft or hard spending limits or shuts down
other projects. Preview costs still contribute to the workspace's existing hard
limit, which Railway may enforce across all its projects.

## Acceptance checks

Record the commit, digest, workflow run, Railway environment, and results. Inspect
the effective Railway configuration as well as controller logs.

| Check                     | Expected result                                                                                                                                              |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Fork/draft PR             | One comment follows building and deployment; GitHub fork approval still applies.                                                                             |
| Successful deployment     | Valid HTTPS; ready status identifies the current commit and deployed digest; the real demo login passes.                                                     |
| Public fixtures           | Demo login works; data is disposable; no real integration or administrator credentials are present.                                                          |
| Environment configuration | Only app and gateway instances exist; no persistent storage, copied secret, GitHub source, or app public domain/TCP proxy exists.                            |
| Gateway restrictions      | Oversized requests and sensitive mutations are blocked, bursts throttled, and responses discourage indexing.                                                 |
| Private isolation         | App cannot reach another environment's private services; control-service credentials are absent from the app.                                                |
| Resources                 | Test effective CPU/memory/disk caps, one replica, and restart policy Never.                                                                                  |
| Preview budget            | Set a small test threshold and verify only managed preview environments stop; deleted-environment usage remains counted and unrelated projects stay running. |
| Existing billing settings | Record the workspace's soft/hard limits before setup and confirm neither controller nor reaper changes them.                                                 |
| Stale revisions           | Push during build and startup; old runs cannot replace the current preview or publish its ready link.                                                        |
| Close during startup      | Close during build and deployment; the environment disappears and late completion cannot recreate it.                                                        |
| Failure                   | Broken build/startup yields a failure comment without an old ready link; rerunning the image workflow recovers.                                              |
| Capacity                  | Six PRs produce at most five active previews; queued work progresses when a slot opens.                                                                      |
| Expiry                    | Shorten a test expiry and leave the PR open: gateway refuses traffic and the environment is deleted.                                                         |
| Independent cleanup       | Temporarily disable GitHub cleanup; Railway cron deletes an expired environment. Restore GitHub cleanup afterward.                                           |
| Interrupted controller    | Cancel during creation/startup; reconciliation removes orphaned or superseded environments.                                                                  |

Do not claim outbound isolation after these checks: app code retains outbound
connectivity. Test other environments by private address, since public endpoints
are intentionally reachable from the internet.

## Operations

Watch failed workflows, stuck cron runs, expired environments, resource use,
traffic, image storage, preview-project spend, and overall workspace spend.
The PR comment records controller
observations; it is not continuous uptime monitoring. Assign an owner to alerts.

To suspend new previews, set `PREVIEW_ENABLED=false`. Verify that the controller
removes existing preview environments, or manually remove only its managed
`flare-pr-...` environments in Railway. Keep `preview-control` and its reaper
until teardown is complete. Rotate/revoke credentials after cleanup; revoking
first prevents environment deletion. Hitting the spending limit can also stop
the reaper if it is the workspace's native hard limit, so verify cleanup when
resolving a workspace budget shutdown. The preview project's monitored threshold
keeps the reaper available and does not alter other projects or billing settings.

If previews stop because the project threshold was reached, check the project's
billing-period usage. Rerunning a build does not reset accumulated spending.
Leave previews paused until the next billing period, or intentionally update
`PREVIEW_MONTHLY_BUDGET_USD` in both GitHub and the reaper service. Do not raise
the shared workspace's existing hard limit as part of preview troubleshooting.

Preview count and expiry do not cap GitHub CI or registry usage. The controller
prunes its unused preview image versions; image build artifacts expire after one
day. Monitor failed deletions and registry storage separately. Removing a preview
does not retract images or files already downloaded by visitors. These images
are test artifacts, not supported releases.

Implementation is in [`scripts/preview`](../scripts/preview),
[`Dockerfile.preview`](../Dockerfile.preview),
[`Dockerfile.preview-gateway`](../Dockerfile.preview-gateway),
[`Dockerfile.preview-reaper`](../Dockerfile.preview-reaper), and the `pr-preview`
workflows in [`.github/workflows`](../.github/workflows).
