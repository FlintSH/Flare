"""Railway lifecycle operations. Run only from trusted controller/reaper code.

The CLI creates/deletes empty environments. The public GraphQL API applies the
complete, trusted service configuration (including limits) before either image
starts. Nothing from a pull request is executed in this process.
"""

import argparse
from decimal import Decimal
import http.cookiejar
import json
import os
import re
import subprocess
import tempfile
import time
import urllib.error
import urllib.parse
import urllib.request

API = "https://backboard.railway.com/graphql/v2"
TTL = 24 * 60 * 60
MAX_ACTIVE = 5
NAME = re.compile(r"flpr-([1-9a-z][0-9a-z]*)-([1-9a-z][0-9a-z]*)-([1-9a-z][0-9a-z]*)-([1-9a-z][0-9a-z]*)")
IMAGE = re.compile(r"ghcr\.io/[a-z0-9_.-]+/[a-z0-9_.-]+@sha256:[0-9a-f]{64}")
DOMAIN = re.compile(r"[a-z0-9][a-z0-9-]*\.up\.railway\.app")
UUID = re.compile(r"[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}")
# Railway CLI v5.54.0 commands/usage.rs, in USD per reported unit. Usage is
# GB-minutes/vCPU-minutes except network egress, which is measured in GB.
# This periodically enforced project budget is not a provider hard billing cap.
USAGE_RATES = {
    "MEMORY_USAGE_GB": (Decimal(10), Decimal(43200)),
    "CPU_USAGE": (Decimal(20), Decimal(43200)),
    "NETWORK_TX_GB": (Decimal("0.05"), Decimal(1)),
    "DISK_USAGE_GB": (Decimal("0.15"), Decimal(43200)),
    "BACKUP_USAGE_GB": (Decimal("0.15"), Decimal(43200)),
}


def required_id(name):
    value = os.environ.get(name, "")
    if not UUID.fullmatch(value):
        raise ValueError(f"Set {name} to a Railway resource UUID")
    return value


def gql(query, variables, *, timeout=60):
    token = os.environ.get("RAILWAY_API_TOKEN", "")
    if not token:
        raise ValueError("RAILWAY_API_TOKEN is required")
    request = urllib.request.Request(
        API,
        data=json.dumps({"query": query, "variables": variables}).encode(),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "application/json",
                 "User-Agent": "flare-pr-previews/1.0"},
    )
    try:
        with urllib.request.build_opener(NoRedirect()).open(request, timeout=timeout) as response:
            body = response.read(4 * 1024**2 + 1)
            if len(body) > 4 * 1024**2:
                raise ValueError("Oversized Railway API response")
            result = json.loads(body)
    except (urllib.error.URLError, ValueError):
        # Service config/API error bodies can include variables; never echo them.
        raise RuntimeError("Railway API request failed") from None
    if result.get("errors") or not result.get("data"):
        raise RuntimeError("Railway rejected the request; check the preview workspace configuration")
    return result["data"]


def project():
    return gql("""query PreviewProject($id: String!) {
      project(id: $id) {
        id name primaryEnvironmentId workspaceId
        services { edges { node { id name } } }
        volumes { edges { node { id } } }
      }
    }""", {"id": required_id("PREVIEW_RAILWAY_PROJECT_ID")})["project"]


def preflight():
    data = project()
    if data["id"] != required_id("PREVIEW_RAILWAY_PROJECT_ID") or data["name"] != "flare-pr-previews":
        raise RuntimeError("Use a separate flare-pr-previews project for disposable previews")
    if data["volumes"]["edges"]:
        raise RuntimeError("The preview project must not contain persistent volumes")
    services = {edge["node"]["id"]: edge["node"]["name"] for edge in data["services"]["edges"]}
    app = required_id("PREVIEW_RAILWAY_APP_SERVICE_ID")
    gateway = required_id("PREVIEW_RAILWAY_GATEWAY_SERVICE_ID")
    if app == gateway or not {app, gateway}.issubset(services):
        raise RuntimeError("Configure separate app and gateway services in the preview project")
    if services[app] != "preview-app":
        raise RuntimeError("The preview app service must be named preview-app for private routing")
    extra = [name for identifier, name in services.items() if identifier not in {app, gateway}]
    if extra not in ([], ["preview-reaper"]):
        raise RuntimeError("The preview project may only contain the app, gateway and optional preview-reaper")
    if not IMAGE.fullmatch(os.environ.get("PREVIEW_GATEWAY_IMAGE", "")):
        raise ValueError("PREVIEW_GATEWAY_IMAGE must be a trusted public GHCR image pinned by digest")
    if budget_status()["over"]:
        raise RuntimeError("The preview project has reached its monthly usage budget")
    return data


def budget_status():
    configured = os.environ.get("PREVIEW_MONTHLY_BUDGET_USD", "")
    if (len(configured) > 32 or not re.fullmatch(r"(?:0|[1-9][0-9]*)(?:\.[0-9]{1,2})?", configured)
            or Decimal(configured) <= 0):
        raise ValueError("PREVIEW_MONTHLY_BUDGET_USD must be a positive dollar amount")
    budget = Decimal(configured)
    # Omitted dates select the project owner's current billing period. Count
    # deleted environments too: tearing down a preview does not erase its bill.
    response = gql("""query PreviewProjectUsage($id: String!, $measurements: [MetricMeasurement!]!) {
      usage(projectId: $id, includeDeleted: true, measurements: $measurements) {
        measurement value
      }
    }""", {"id": required_id("PREVIEW_RAILWAY_PROJECT_ID"), "measurements": list(USAGE_RATES)})
    rows = response.get("usage")
    if not isinstance(rows, list):
        raise RuntimeError("Preview project usage is unavailable")
    spent = Decimal(0)
    for row in rows:
        if (not isinstance(row, dict) or not isinstance(row.get("measurement"), str)
                or row["measurement"] not in USAGE_RATES
                or type(row.get("value")) not in (int, float)):
            raise RuntimeError("Preview project usage contains unknown pricing data")
        value = Decimal(str(row["value"]))
        if not value.is_finite() or value < 0:
            raise RuntimeError("Preview project usage contains invalid values")
        dollars, units = USAGE_RATES[row["measurement"]]
        spent += value * dollars / units
    return {"spent": float(spent), "budget": float(budget), "over": spent >= budget}


def cli(data, environment, *args):
    # Do not use railway run/up: that would inject or build with service variables.
    env = {key: value for key, value in os.environ.items()
           if key not in {"RAILWAY_TOKEN", "RAILWAY_SERVICE_ID"}}
    env["CI"] = "true"
    env["RAILWAY_NO_TELEMETRY"] = "1"
    # v5.54 reads these IDs directly in get_linked_project(), including for
    # environment new/delete. Avoid `railway link`: it lists user workspaces
    # through `me`, which is unnecessary for a workspace-scoped API token.
    # Override the control environment's own Railway-injected targeting values.
    env["RAILWAY_PROJECT_ID"] = data["id"]
    env["RAILWAY_ENVIRONMENT_ID"] = environment
    with tempfile.TemporaryDirectory(prefix="flare-preview-cli-") as directory:
        result = subprocess.run(["railway", *args, "--json"], cwd=directory, env=env,
                                capture_output=True, text=True, timeout=180,
                                stdin=subprocess.DEVNULL)
        if result.returncode:
            raise RuntimeError("Railway CLI operation failed; inspect the preview project")
        try:
            return json.loads(result.stdout)
        except ValueError:
            raise RuntimeError("Railway CLI returned unexpected output") from None


def environments():
    cursor = None
    while True:
        page = gql("""query PreviewEnvironments($project: String!, $after: String) {
          environments(projectId: $project, first: 100, after: $after) {
            pageInfo { hasNextPage endCursor }
            edges { node { id name deletedAt } }
          }
        }""", {"project": required_id("PREVIEW_RAILWAY_PROJECT_ID"), "after": cursor})["environments"]
        for edge in page["edges"]:
            if not edge["node"].get("deletedAt"):
                yield edge["node"]
        if not page["pageInfo"]["hasNextPage"]:
            return
        cursor = page["pageInfo"]["endCursor"]


def make_name(pr, run_id, attempt, expires_at):
    # Railway limits environment names to 32 characters. Base36 retains the
    # generation and expiry from the instant of creation, even before config.
    def encode(value, maximum):
        if type(value) is not int or not 0 < value <= maximum:
            raise ValueError("Preview generation is outside supported integer bounds")
        result = ""
        while value:
            value, digit = divmod(value, 36)
            result = "0123456789abcdefghijklmnopqrstuvwxyz"[digit] + result
        return result

    name = "flpr-" + "-".join(encode(value, maximum) for value, maximum in (
        (pr, 2**63 - 1), (run_id, 2**63 - 1), (attempt, 2**63 - 1), (expires_at, 2**32 - 1)))
    if len(name) > 32:
        raise ValueError("Preview generation exceeds Railway's 32-character environment name limit")
    return name


def parse_name(name):
    if not isinstance(name, str) or len(name) > 32:
        return None
    match = NAME.fullmatch(name)
    if not match:
        return None
    pr, run, attempt, expiry = (int(value, 36) for value in match.groups())
    try:
        if make_name(pr, run, attempt, expiry) != name:
            return None
    except ValueError:
        return None
    return {"namespace": name, "pr": pr, "run_id": run, "attempt": attempt,
            "expires_at": expiry, "sha": ""}


def details(environment_id):
    return gql("""query PreviewDetails($id: String!) {
      environment(id: $id) { id name
        serviceInstances { edges { node {
          serviceId source { image }
          latestDeployment { id status }
          domains { serviceDomains { domain } customDomains { domain } }
        } } }
      }
    }""", {"id": environment_id})["environment"]


def entry(env):
    result = parse_name(env["name"])
    data = details(env["id"])
    instances = {edge["node"]["serviceId"]: edge["node"]
                 for edge in data["serviceInstances"]["edges"]}
    app = instances.get(required_id("PREVIEW_RAILWAY_APP_SERVICE_ID"), {})
    gateway = instances.get(required_id("PREVIEW_RAILWAY_GATEWAY_SERVICE_ID"), {})
    if gateway:
        # Read metadata from the trusted gateway's platform configuration, never
        # from the PR application. An interrupted create may have no SHA yet.
        variables = gql("""query PreviewMetadata($project: String!, $environment: String!, $service: String!) {
          variables(projectId: $project, environmentId: $environment, serviceId: $service)
        }""", {"project": required_id("PREVIEW_RAILWAY_PROJECT_ID"), "environment": env["id"],
                 "service": required_id("PREVIEW_RAILWAY_GATEWAY_SERVICE_ID")})["variables"]
        sha = variables.get("PREVIEW_HEAD_SHA") if isinstance(variables, dict) else None
        if isinstance(sha, str) and re.fullmatch(r"[0-9a-f]{40}", sha):
            result["sha"] = sha
    domains = gateway.get("domains", {}).get("serviceDomains", [])
    host = domains[0]["domain"] if domains else ""
    if host and not DOMAIN.fullmatch(host):
        raise ValueError("Unexpected preview domain")
    states = [(item.get("latestDeployment") or {}).get("status") for item in [app, gateway]]
    result.update({"id": env["id"], "image": (app.get("source") or {}).get("image", ""),
                   "url": f"https://{host}" if host else "",
                   "failed": any(state in {"FAILED", "CRASHED", "REMOVED"} for state in states),
                   "ready": bool(host and result["sha"]) and all(state == "SUCCESS" for state in states)})
    return result


def inventory():
    return [entry(env) for env in environments() if parse_name(env["name"])]


def remove(namespace):
    if not parse_name(namespace):
        raise ValueError("Refusing to delete an environment not owned by PR previews")
    data = project()
    env = next((env for env in environments() if env["name"] == namespace), None)
    if not env:
        return
    if env["id"] == data["primaryEnvironmentId"]:
        raise ValueError("Refusing to delete the primary environment")
    cli(data, env["id"], "environment", "delete", env["id"], "--yes")
    deadline = time.monotonic() + 120
    while any(item["id"] == env["id"] for item in environments()):
        if time.monotonic() >= deadline:
            raise RuntimeError("Preview deletion has not completed; cleanup will retry")
        time.sleep(5)


def patch(environment_id, services):
    result = gql("""mutation PreviewConfigure($id: String!, $patch: EnvironmentConfig!) {
      environmentPatchCommit(environmentId: $id, patch: $patch,
                             commitMessage: "Configure disposable Flare PR preview")
    }""", {"id": environment_id, "patch": {"services": services}})
    workflow_id = result.get("environmentPatchCommit")
    if not isinstance(workflow_id, str) or not workflow_id or len(workflow_id) > 1024:
        raise RuntimeError("Railway returned an invalid configuration workflow")
    # Commit starts an asynchronous workflow. Its response does not mean service
    # instances exist yet, so readback/domain creation must wait for completion.
    # See Railway CLI v5.54 controllers/template_apply.rs and workflow.rs.
    deadline = time.monotonic() + 120
    for _ in range(60):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            break
        state = gql("""query PreviewConfigurationStatus($workflow: String!) {
          workflowStatus(workflowId: $workflow) { status }
        }""", {"workflow": workflow_id}, timeout=min(15, remaining))["workflowStatus"].get("status")
        if state == "Complete":
            return result
        if state == "Error":
            # Provider error details can contain variables; do not request/log them.
            raise RuntimeError("Railway configuration workflow failed")
        # NotFound is expected briefly after creation; Running/unknown states
        # are also bounded by this same deadline and attempt count.
        time.sleep(min(2, max(0, deadline - time.monotonic())))
    raise RuntimeError("Railway configuration workflow did not complete before its deadline")


def service_config(cpu, memory, disk, health, command):
    return {
        "isCreated": True,
        "deploy": {
            "numReplicas": 1, "restartPolicyType": "NEVER",
            "sleepApplication": False, "startCommand": command,
            "healthcheckPath": health, "healthcheckTimeout": 300,
            "overlapSeconds": 0, "drainingSeconds": 0,
            "limitOverride": {"containers": {"cpu": cpu, "memoryBytes": memory, "diskBytes": disk}},
        },
    }


def variable_config(values):
    return {key: {"value": str(value)} for key, value in values.items()}


def verify_config(environment_id, expected):
    config = gql("""query PreviewConfiguration($id: String!) {
      environment(id: $id) { config(decryptVariables: false) }
    }""", {"id": environment_id})["environment"]["config"]
    if config.get("sharedVariables") or config.get("volumes") or config.get("buckets"):
        raise RuntimeError("Preview environment contains unexpected shared variables or storage")
    if set(config.get("services", {})) != set(expected):
        raise RuntimeError("Preview environment contains unexpected services")
    for service_id, desired in expected.items():
        actual = config["services"][service_id]
        deploy = actual.get("deploy", {})
        regions = deploy.get("multiRegionConfig")
        if regions is not None:
            # Railway normalizes numReplicas into per-region configuration.
            replica_count = 0
            if not isinstance(regions, dict):
                raise RuntimeError("Railway returned invalid preview replica limits")
            for region in regions.values():
                replicas = region.get("numReplicas") if isinstance(region, dict) else None
                if type(replicas) is not int or replicas < 0:
                    raise RuntimeError("Railway returned invalid preview replica limits")
                replica_count += replicas
            if "numReplicas" in deploy and (type(deploy["numReplicas"]) is not int or deploy["numReplicas"] != 1):
                raise RuntimeError("Railway returned conflicting preview replica limits")
        else:
            replica_count = deploy.get("numReplicas")
        if type(replica_count) is not int or replica_count != 1 or deploy.get("restartPolicyType") != "NEVER":
            raise RuntimeError("Railway did not apply the preview replica/restart limits")
        if deploy.get("limitOverride") != desired["deploy"]["limitOverride"]:
            raise RuntimeError("Railway did not apply the preview CPU, memory and disk limits")
        source = actual.get("source") or {}
        networking = actual.get("networking") or {}
        if (actual.get("volumeMounts") or actual.get("variables")
                or any(source.get(key) for key in ("repo", "image", "upstreamUrl"))
                or any(networking.get(key) for key in ("serviceDomains", "customDomains", "tcpProxies"))):
            raise RuntimeError("Unexpected preview source or persistent storage")


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def smoke(url):
    """Acknowledge the public notice, then exercise real database-backed login."""
    origin = urllib.parse.urlsplit(url)
    if (origin.scheme != "https" or not DOMAIN.fullmatch(origin.netloc)
            or origin.path or origin.query or origin.fragment):
        raise ValueError("Unexpected health check origin")
    jar = http.cookiejar.CookieJar()
    opener = urllib.request.build_opener(NoRedirect(), urllib.request.HTTPCookieProcessor(jar))

    def fetch(path, form=None, expected_status=200):
        headers = {}
        body = urllib.parse.urlencode(form).encode() if form is not None else None
        if body is not None:
            headers["Content-Type"] = "application/x-www-form-urlencoded"
            headers["Origin"] = url
        try:
            response = opener.open(urllib.request.Request(url + path, data=body, headers=headers), timeout=15)
        except urllib.error.HTTPError as error:
            # Accept the acknowledgment's expected redirect without following
            # it. CookieJar has already processed its Set-Cookie response.
            if error.code != expected_status:
                raise
            response = error
        with response:
            if response.getcode() != expected_status:
                raise RuntimeError("Unexpected preview smoke response status")
            data = response.read(65537)
            if len(data) > 65536:
                raise RuntimeError("Preview health response exceeds limit")
            return response.headers, data

    def request(path, form=None):
        return json.loads(fetch(path, form)[1])

    notice, _ = fetch("/_preview")
    if notice.get("Referrer-Policy", "").lower() != "same-origin":
        raise RuntimeError("Preview notice does not preserve same-origin form submissions")
    entered, _ = fetch("/_preview/enter", {}, expected_status=303)
    if entered.get("Location") != "/" or not any(
            cookie.name == "flare_preview_ack" and cookie.value == "1" and cookie.secure for cookie in jar):
        raise RuntimeError("Preview notice acknowledgment failed")
    request("/_preview/health")
    csrf = request("/api/auth/csrf")["csrfToken"]
    if not isinstance(csrf, str) or len(csrf) > 256:
        raise RuntimeError("Invalid CSRF response")
    # CookieJar preserves the gateway acknowledgment and Secure NextAuth cookies.
    request("/api/auth/callback/credentials", {"csrfToken": csrf, "email": "demo@example.test",
            "password": "Flare-preview-only!2026", "json": "true", "callbackUrl": url + "/dashboard"})
    session = request("/api/auth/session")
    if session.get("user", {}).get("email") != "demo@example.test" or session["user"].get("role") != "USER":
        raise RuntimeError("Preview login smoke check failed")


def deploy(pr, sha, run_id, attempt, image, domain, expires_at):
    del domain  # Railway allocates isolated HTTPS domains; no production domain is accepted.
    if any(type(value) is not int or value <= 0 for value in (pr, run_id, attempt, expires_at)):
        raise ValueError("Invalid preview generation")
    if not re.fullmatch(r"[0-9a-f]{40}", sha) or not IMAGE.fullmatch(image):
        raise ValueError("Invalid immutable image or commit")
    now = int(time.time())
    if not now < expires_at <= now + TTL:
        raise ValueError("Invalid preview expiry")
    name = make_name(pr, run_id, attempt, expires_at)
    data = preflight()
    if len([env for env in environments() if parse_name(env["name"])]) >= MAX_ACTIVE:
        raise RuntimeError("Preview capacity reached")
    app = required_id("PREVIEW_RAILWAY_APP_SERVICE_ID")
    gateway = required_id("PREVIEW_RAILWAY_GATEWAY_SERVICE_ID")
    if any(env["name"] == name for env in environments()):
        raise RuntimeError("Preview generation already exists; reconcile it before retrying")
    # Expiry is in the name from creation, so interrupted provisioning is reaped.
    try:
        env = cli(data, data["primaryEnvironmentId"], "environment", "new", name)
        environment_id = env["id"]
        app_config = service_config(1, 2 * 1024**3, 4 * 1024**3, "/api/health", "/preview/boot.sh")
        app_config["networking"] = {"privateNetworkEndpoint": "preview-app"}
        gateway_config = service_config(0.5, 256 * 1024**2, 256 * 1024**2, "/_preview/health", "node /gateway/gateway.cjs")
        # Create empty service instances first. No code runs until limits and
        # the gateway's domain are in place. Never duplicate a source environment.
        patch(environment_id, {app: app_config, gateway: gateway_config})
        verify_config(environment_id, {app: app_config, gateway: gateway_config})
        host = gql("""mutation PreviewDomain($input: ServiceDomainCreateInput!) {
          serviceDomainCreate(input: $input) { domain }
        }""", {"input": {"environmentId": environment_id, "serviceId": gateway, "targetPort": 8080}})["serviceDomainCreate"]["domain"]
        if not DOMAIN.fullmatch(host):
            raise RuntimeError("Unexpected Railway domain")
        url = "https://" + host
        patch(environment_id, {
            app: {"source": {"image": image, "autoUpdates": {"type": "disabled"}},
                  "variables": variable_config({"PORT": 3000, "HOSTNAME": "::", "NEXTAUTH_URL": url,
                     "PREVIEW_EXPIRES_AT": expires_at, "FLARE_PR_PREVIEW": "true",
                     "FLARE_EMAIL_ENABLED": "false", "FLARE_EMAIL_RECOVERY_ENABLED": "false",
                     "FLARE_EMAIL_VERIFICATION_MODE": "off", "NEXT_PUBLIC_METICULOUS_RECORDING_TOKEN": ""})},
            gateway: {"source": {"image": os.environ["PREVIEW_GATEWAY_IMAGE"], "autoUpdates": {"type": "disabled"}},
                      "variables": variable_config({"PORT": 8080, "PREVIEW_PUBLIC_URL": url,
                         "PREVIEW_UPSTREAM": "http://preview-app.railway.internal:3000",
                         "PREVIEW_EXPIRES_AT": expires_at, "PREVIEW_HEAD_SHA": sha})},
        })
        deadline = time.monotonic() + 600
        while time.monotonic() < deadline and time.time() < expires_at:
            result = entry(env)
            if result["ready"]:
                try:
                    smoke(url)
                    return result
                except (urllib.error.URLError, ValueError, KeyError, RuntimeError):
                    # Edge routing/TLS can lag deployment success. Give the real
                    # login check the same bounded readiness window.
                    pass
            if result["failed"]:
                raise RuntimeError("Preview deployment failed")
            time.sleep(10)
        raise RuntimeError("Preview did not become ready before the deployment deadline")
    except BaseException:
        remove(name)
        raise


def reap_expired():
    # No GitHub token, registry credentials or PR code needed. Run this image
    # in a separate control environment on a Railway cron schedule.
    budget_error = None
    try:
        stop_all = budget_status()["over"]
    except Exception as error:
        # Fail closed if cost cannot be established, while still attempting
        # cleanup with independently available environment/deletion APIs. Body
        # reads can raise raw TimeoutError/OSError outside urllib's URLError.
        stop_all = True
        budget_error = error
    cleanup_failed = False
    for env in list(environments()):
        record = parse_name(env["name"])
        if record and (stop_all or record["expires_at"] <= time.time()):
            try:
                remove(env["name"])
            except Exception:
                # One failing deletion must not leave all remaining previews
                # running over budget. The next scheduled sweep will retry it.
                cleanup_failed = True
    if cleanup_failed:
        raise RuntimeError("Preview cleanup did not complete; the next sweep will retry")
    if budget_error:
        raise RuntimeError("Preview budget is unavailable; managed previews were stopped") from None


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("command", choices=["preflight", "reap", "inventory"])
    args = parser.parse_args()
    if args.command == "reap":
        reap_expired()
    elif args.command == "preflight":
        preflight()
        print("Railway preview configuration is ready")
    else:
        print(json.dumps(inventory(), indent=2))
