"""Controller security/lifecycle tests; all Railway and HTTP transport is mocked.

Run: python3 -m unittest discover -s scripts/preview -p 'test_runtime.py'
"""

import copy
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import unittest
from email.message import Message
from unittest.mock import patch
import urllib.error
import urllib.parse
import urllib.request
import urllib.response


spec = importlib.util.spec_from_file_location("preview_runtime", Path(__file__).with_name("runtime.py"))
runtime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(runtime)

PROJECT = "11111111-1111-1111-1111-111111111111"
APP = "22222222-2222-2222-2222-222222222222"
GATEWAY = "33333333-3333-3333-3333-333333333333"
ENVIRONMENT = "44444444-4444-4444-4444-444444444444"
WORKSPACE = "55555555-5555-5555-5555-555555555555"
PRIMARY = "66666666-6666-6666-6666-666666666666"
REAPER = "77777777-7777-7777-7777-777777777777"
NOW = 1800000000
EXPIRY = NOW + 3600
SHA = "a" * 40
IMAGE = "ghcr.io/flintsh/flare-preview@sha256:" + "b" * 64
GATEWAY_IMAGE = "ghcr.io/flintsh/flare-preview-gateway@sha256:" + "c" * 64
NAME = runtime.make_name(42, 100, 1, EXPIRY)
URL = "https://preview-example.up.railway.app"


def project_data():
    return {
        "id": PROJECT, "name": "flare-pr-previews", "workspaceId": WORKSPACE,
        "primaryEnvironmentId": PRIMARY,
        "workspace": {"projectCount": 8, "customer": {
            "usageLimit": {"hardLimit": 50, "isOverLimit": False},
        }},
        "services": {"edges": [{"node": {"id": identifier, "name": name}} for identifier, name in (
            (APP, "preview-app"), (GATEWAY, "preview-gateway"), (REAPER, "preview-reaper"))]},
        "volumes": {"edges": []},
    }


def block_network(test_case):
    # Block below urllib's convenience APIs so future opener changes cannot
    # accidentally send even synthetic tokens or perform external DNS lookups.
    for target in ("socket.create_connection", "socket.socket.connect", "socket.getaddrinfo"):
        blocker = patch(target, side_effect=AssertionError("Unexpected network access"))
        blocker.start()
        test_case.addCleanup(blocker.stop)


class RuntimeTests(unittest.TestCase):
    def setUp(self):
        self.addCleanup(patch.stopall)
        block_network(self)
        patch.dict(os.environ, {
            "PREVIEW_RAILWAY_PROJECT_ID": PROJECT,
            "PREVIEW_RAILWAY_APP_SERVICE_ID": APP,
            "PREVIEW_RAILWAY_GATEWAY_SERVICE_ID": GATEWAY,
            "PREVIEW_GATEWAY_IMAGE": GATEWAY_IMAGE,
            "PREVIEW_MONTHLY_BUDGET_USD": "20",
            "RAILWAY_API_TOKEN": "synthetic-controller-token",
            "RAILWAY_TOKEN": "synthetic-project-token-must-not-be-used",
        }, clear=True).start()
        patch.object(runtime.subprocess, "run", side_effect=AssertionError("Unexpected subprocess access")).start()

    def test_namespace_matches_only_complete_preview_generations(self):
        self.assertEqual(runtime.parse_name(NAME), {
            "namespace": NAME, "pr": 42, "run_id": 100, "attempt": 1,
            "expires_at": EXPIRY, "sha": "",
        })
        for value in ("production", "control", "flare-pr-42", NAME + "-extra", NAME + "\n",
                      NAME.replace("flpr-16-", "flpr-0-"), NAME.upper(),
                      NAME.replace("flpr-16-", "flpr-016-"), "flpr-1-1-1-" + "z" * 23,
                      "flpr-1-1-1-zzzzzzz", None):
            with self.subTest(value=value):
                self.assertIsNone(runtime.parse_name(value))

    def test_compact_name_preserves_generation_and_expiry_within_provider_limit(self):
        name = runtime.make_name(999999, 30000000000, 123, EXPIRY)
        self.assertLessEqual(len(name), 32)
        self.assertEqual(runtime.parse_name(name), {
            "namespace": name, "pr": 999999, "run_id": 30000000000,
            "attempt": 123, "expires_at": EXPIRY, "sha": "",
        })
        for values in ((0, 1, 1, EXPIRY), (1, True, 1, EXPIRY), (1, 1, -1, EXPIRY),
                       (1, 1, 1, 2**32), (1, 2**63, 1, EXPIRY),
                       (2**63 - 1, 2**63 - 1, 2**63 - 1, EXPIRY)):
            with self.subTest(values=values), self.assertRaises(ValueError):
                runtime.make_name(*values)

    def test_preflight_accepts_preview_only_project_in_existing_paid_workspace(self):
        data = project_data()
        patch.object(runtime, "project", return_value=data).start()
        patch.object(runtime, "budget_status", return_value={"spent": 0, "budget": 20, "over": False}).start()
        self.assertEqual(runtime.preflight(), data)
        # A workspace's project count and account limit are unrelated to the
        # preview project's own guard. A reaper service is optional.
        del data["workspace"]
        data["services"]["edges"].pop()
        self.assertEqual(runtime.preflight(), data)

    def test_preflight_rejects_unrelated_services_volumes_and_wrong_private_app(self):
        current = patch.object(runtime, "project", return_value=project_data()).start()
        patch.object(runtime, "budget_status", return_value={"spent": 0, "budget": 20, "over": False}).start()
        cases = []
        for key, value in (("name", "production"), ("volumes", {"edges": [{"node": {"id": "volume"}}]}),
                           ("id", WORKSPACE),
                           ("services", {"edges": [{"node": {"id": APP, "name": "preview-app"}}]})):
            changed = project_data()
            changed[key] = value
            cases.append(changed)
        changed = project_data()
        changed["services"]["edges"][0]["node"]["name"] = "production-app"
        cases.append(changed)
        changed = project_data()
        changed["services"]["edges"][-1]["node"]["name"] = "production-database"
        cases.append(changed)
        changed = project_data()
        changed["services"]["edges"].append({"node": {"id": WORKSPACE, "name": "preview-reaper"}})
        cases.append(changed)
        for changed in cases:
            with self.subTest(project=changed):
                current.return_value = changed
                with self.assertRaises((ValueError, RuntimeError)):
                    runtime.preflight()
        current.return_value = project_data()
        for override in ({"PREVIEW_GATEWAY_IMAGE": "ghcr.io/flintsh/gateway:latest"},
                         {"PREVIEW_RAILWAY_GATEWAY_SERVICE_ID": APP}):
            with patch.dict(os.environ, override), self.assertRaises((ValueError, RuntimeError)):
                runtime.preflight()

    def test_preflight_blocks_budget_exhaustion_and_usage_outage(self):
        patch.object(runtime, "project", return_value=project_data()).start()
        with patch.object(runtime, "budget_status", return_value={"spent": 20, "budget": 20, "over": True}):
            with self.assertRaisesRegex(RuntimeError, "monthly usage budget"):
                runtime.preflight()
        with patch.object(runtime, "budget_status", side_effect=RuntimeError("usage unavailable")):
            with self.assertRaisesRegex(RuntimeError, "usage unavailable"):
                runtime.preflight()

    def test_budget_sums_current_project_usage_including_deleted_resources(self):
        rows = [
            {"measurement": "MEMORY_USAGE_GB", "value": 43200},
            {"measurement": "CPU_USAGE", "value": 21600},
            {"measurement": "NETWORK_TX_GB", "value": 2},
            {"measurement": "NETWORK_TX_GB", "value": 4},
            {"measurement": "DISK_USAGE_GB", "value": 43200},
            {"measurement": "BACKUP_USAGE_GB", "value": 43200},
        ]
        with patch.object(runtime, "gql", return_value={"usage": rows}) as query:
            self.assertEqual(runtime.budget_status(), {"spent": 20.6, "budget": 20.0, "over": True})
        document, variables = query.call_args.args
        self.assertIn("usage(projectId: $id, includeDeleted: true", document)
        self.assertNotIn("startDate", document)
        self.assertNotIn("endDate", document)
        self.assertNotIn("estimatedUsage", document)
        self.assertEqual(variables["id"], PROJECT)
        self.assertEqual(set(variables["measurements"]), set(runtime.USAGE_RATES))

    def test_budget_accepts_empty_new_project_and_stops_at_exact_threshold(self):
        with patch.object(runtime, "gql", return_value={"usage": []}):
            self.assertEqual(runtime.budget_status(), {"spent": 0.0, "budget": 20.0, "over": False})
        with patch.object(runtime, "gql", return_value={"usage": [
            {"measurement": "MEMORY_USAGE_GB", "value": 86400},
        ]}):
            self.assertEqual(runtime.budget_status(), {"spent": 20.0, "budget": 20.0, "over": True})
        with patch.dict(os.environ, {"PREVIEW_MONTHLY_BUDGET_USD": "20.01"}), patch.object(runtime, "gql", return_value={"usage": [
            {"measurement": "CPU_USAGE", "value": 43200},
        ]}):
            self.assertFalse(runtime.budget_status()["over"])

    def test_budget_rejects_invalid_configuration_before_network(self):
        with patch.object(runtime, "gql", side_effect=AssertionError("Budget must validate before API")):
            for value in ("", "0", "0.00", "-1", "NaN", "Infinity", "true", " 20 ", "1e2", "2.001", "9" * 33):
                with self.subTest(value=value), patch.dict(os.environ, {"PREVIEW_MONTHLY_BUDGET_USD": value}):
                    with self.assertRaisesRegex(ValueError, "positive dollar amount"):
                        runtime.budget_status()

    def test_budget_fails_closed_on_missing_unknown_or_nonfinite_usage(self):
        responses = [{}, {"usage": None}, {"usage": {}}, {"usage": [None]},
                     {"usage": [{"measurement": [], "value": 1}]},
                     {"usage": [{"measurement": "UNPRICED_RESOURCE", "value": 1}]}]
        for value in (None, "1.0", True, -1, float("nan"), float("inf")):
            responses.append({"usage": [{"measurement": "CPU_USAGE", "value": value}]})
        for response in responses:
            with self.subTest(response=response), patch.object(runtime, "gql", return_value=response):
                with self.assertRaises(RuntimeError):
                    runtime.budget_status()

    def test_cli_creates_empty_environment_with_explicit_target_and_no_user_lookup(self):
        process = patch.object(runtime.subprocess, "run", return_value=
            subprocess.CompletedProcess([], 0, json.dumps({"id": ENVIRONMENT, "name": NAME}), "")
        ).start()
        with patch.dict(os.environ, {"RAILWAY_PROJECT_ID": "unrelated-project",
                                    "RAILWAY_ENVIRONMENT_ID": "control-environment",
                                    "RAILWAY_SERVICE_ID": "control-reaper"}):
            result = runtime.cli(project_data(), PRIMARY, "environment", "new", NAME)
        self.assertEqual(result["id"], ENVIRONMENT)
        commands = [call.args[0] for call in process.call_args_list]
        self.assertEqual(commands, [["railway", "environment", "new", NAME, "--json"]])
        self.assertNotIn("--duplicate", commands[0])
        for call in process.call_args_list:
            self.assertNotIn("RAILWAY_TOKEN", call.kwargs["env"])
            self.assertNotIn("RAILWAY_SERVICE_ID", call.kwargs["env"])
            self.assertEqual(call.kwargs["env"]["RAILWAY_PROJECT_ID"], PROJECT)
            self.assertEqual(call.kwargs["env"]["RAILWAY_ENVIRONMENT_ID"], PRIMARY)
            self.assertEqual(call.kwargs["stdin"], subprocess.DEVNULL)
            self.assertTrue(call.kwargs["capture_output"])
            self.assertNotIn("shell", call.kwargs)
        self.assertFalse(Path(process.call_args.kwargs["cwd"]).exists())

    def test_cli_deletes_explicit_environment_without_linking_or_prompting(self):
        with patch.object(runtime.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 0, json.dumps({"id": ENVIRONMENT}), "")) as process:
            runtime.cli(project_data(), ENVIRONMENT, "environment", "delete", ENVIRONMENT, "--yes")
        process.assert_called_once()
        self.assertEqual(process.call_args.args[0],
                         ["railway", "environment", "delete", ENVIRONMENT, "--yes", "--json"])
        self.assertEqual(process.call_args.kwargs["env"]["RAILWAY_PROJECT_ID"], PROJECT)
        self.assertEqual(process.call_args.kwargs["env"]["RAILWAY_ENVIRONMENT_ID"], ENVIRONMENT)
        self.assertEqual(process.call_args.kwargs["stdin"], subprocess.DEVNULL)

    def test_api_and_cli_errors_do_not_expose_provider_error_bodies(self):
        body = io.BytesIO(json.dumps({"errors": [{"message": "synthetic-sensitive-provider-value"}]}).encode())
        with patch.object(runtime.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = body
            with self.assertRaises(RuntimeError) as raised:
                runtime.gql("query { project { id } }", {})
            self.assertNotIn("synthetic-sensitive-provider-value", str(raised.exception))
        with patch.object(runtime.subprocess, "run", return_value=subprocess.CompletedProcess(
                [], 1, "synthetic-sensitive-output", "synthetic-sensitive-error")):
            with self.assertRaises(RuntimeError) as raised:
                runtime.cli(project_data(), PRIMARY, "environment", "new", NAME)
            self.assertNotIn("synthetic-sensitive", str(raised.exception))

    def test_api_success_uses_authenticated_json_and_disables_redirects(self):
        data = {"project": {"id": PROJECT}}
        with patch.object(runtime.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = io.BytesIO(json.dumps({"data": data}).encode())
            self.assertEqual(runtime.gql("query Preview($id: String!) { project(id: $id) { id } }",
                                         {"id": PROJECT}), data)
            self.assertIsInstance(factory.call_args.args[0], runtime.NoRedirect)
            request = factory.return_value.open.call_args.args[0]
            self.assertEqual(request.full_url, runtime.API)
            self.assertEqual(request.get_header("Authorization"), "Bearer synthetic-controller-token")
            self.assertEqual(request.get_header("User-agent"), "flare-pr-previews/1.0")
            self.assertEqual(json.loads(request.data)["variables"], {"id": PROJECT})
            self.assertEqual(factory.return_value.open.call_args.kwargs["timeout"], 60)

    def test_api_rejects_oversized_response_after_a_bounded_read(self):
        class TrackedResponse(io.BytesIO):
            def __init__(self):
                super().__init__(b" " * (4 * 1024**2 + 2))
                self.read_sizes = []

            def read(self, size=-1):
                self.read_sizes.append(size)
                return super().read(size)

        response = TrackedResponse()
        with patch.object(runtime.urllib.request, "build_opener") as factory:
            factory.return_value.open.return_value = response
            with self.assertRaisesRegex(RuntimeError, "Railway API request failed"):
                runtime.gql("query { project { id } }", {})
        self.assertEqual(response.read_sizes, [4 * 1024**2 + 1])

    def test_patch_waits_through_workflow_visibility_lag_and_running_state(self):
        responses = [{"environmentPatchCommit": "workflow-123"}] + [
            {"workflowStatus": {"status": status}} for status in ("NotFound", "Running", "Complete")
        ]
        with patch.object(runtime, "gql", side_effect=responses) as query, patch.object(runtime.time, "sleep") as sleep:
            result = runtime.patch(ENVIRONMENT, {APP: {"isCreated": True}})
        self.assertEqual(result, {"environmentPatchCommit": "workflow-123"})
        self.assertEqual(query.call_count, 4)
        self.assertEqual(sleep.call_count, 2)
        for call in query.call_args_list[1:]:
            self.assertEqual(call.args[1], {"workflow": "workflow-123"})
            self.assertNotIn("error", call.args[0])
            self.assertLessEqual(call.kwargs["timeout"], 15)

    def test_patch_stops_on_failed_workflow_without_exposing_error(self):
        with patch.object(runtime, "gql", side_effect=[
            {"environmentPatchCommit": "workflow-123"},
            {"workflowStatus": {"status": "Error", "error": "synthetic-sensitive-variable"}},
        ]) as query, patch.object(runtime.time, "sleep") as sleep:
            with self.assertRaisesRegex(RuntimeError, "configuration workflow failed") as raised:
                runtime.patch(ENVIRONMENT, {})
        self.assertNotIn("synthetic-sensitive", str(raised.exception))
        self.assertEqual(query.call_count, 2)
        sleep.assert_not_called()

    def test_patch_bounds_missing_and_never_finishing_workflows(self):
        for status in ("NotFound", "Running", "UnknownStatus"):
            with self.subTest(status=status):
                clock = [0]
                def advance(seconds):
                    clock[0] += seconds
                def response(query, variables, **kwargs):
                    return ({"environmentPatchCommit": "workflow-123"} if "mutation" in query
                            else {"workflowStatus": {"status": status}})
                with patch.object(runtime, "gql", side_effect=response) as query, patch.object(runtime.time, "monotonic", side_effect=lambda: clock[0]), patch.object(runtime.time, "sleep", side_effect=advance):
                    with self.assertRaisesRegex(RuntimeError, "deadline"):
                        runtime.patch(ENVIRONMENT, {})
                self.assertLessEqual(query.call_count, 61)
                self.assertLessEqual(clock[0], 120)

    def test_patch_rejects_invalid_workflow_reference_before_polling(self):
        for workflow_id in (None, "", 42, "x" * 1025):
            with self.subTest(workflow_id=workflow_id), patch.object(runtime, "gql", return_value={"environmentPatchCommit": workflow_id}) as query:
                with self.assertRaisesRegex(RuntimeError, "invalid configuration workflow"):
                    runtime.patch(ENVIRONMENT, {})
                query.assert_called_once()

    def test_environment_inventory_paginates_and_ignores_deleted_rows(self):
        query = patch.object(runtime, "gql", side_effect=[
            {"environments": {"pageInfo": {"hasNextPage": True, "endCursor": "cursor-1"},
                              "edges": [{"node": {"id": "deleted", "deletedAt": "2026-01-01"}}]}},
            {"environments": {"pageInfo": {"hasNextPage": False, "endCursor": "cursor-2"},
                              "edges": [{"node": {"id": ENVIRONMENT, "name": NAME, "deletedAt": None}}]}},
        ]).start()
        self.assertEqual([env["id"] for env in runtime.environments()], [ENVIRONMENT])
        self.assertEqual(query.call_args_list[1].args[1]["after"], "cursor-1")

    def test_inventory_reads_full_sha_only_from_trusted_gateway_configuration(self):
        details = {"serviceInstances": {"edges": [
            {"node": {"serviceId": APP, "source": {"image": IMAGE},
                      "latestDeployment": {"status": "SUCCESS"}}},
            {"node": {"serviceId": GATEWAY, "latestDeployment": {"status": "SUCCESS"},
                      "domains": {"serviceDomains": [{"domain": "preview-example.up.railway.app"}]}}},
        ]}}
        patch.object(runtime, "details", return_value=details).start()
        with patch.object(runtime, "gql", return_value={"variables": {"PREVIEW_HEAD_SHA": SHA}}) as query:
            result = runtime.entry({"id": ENVIRONMENT, "name": NAME})
        self.assertTrue(result["ready"])
        self.assertEqual(result["sha"], SHA)
        self.assertEqual(result["expires_at"], EXPIRY)
        self.assertEqual(query.call_args.args[1], {
            "project": PROJECT, "environment": ENVIRONMENT, "service": GATEWAY,
        })
        self.assertNotIn("config(decryptVariables", query.call_args.args[0])
        for variables in ({}, None, {"PREVIEW_HEAD_SHA": SHA.upper()}, {"PREVIEW_HEAD_SHA": "incomplete"},
                          {"PREVIEW_HEAD_SHA": {"value": SHA}}):
            with self.subTest(variables=variables), patch.object(runtime, "gql", return_value={"variables": variables}):
                result = runtime.entry({"id": ENVIRONMENT, "name": NAME})
                self.assertEqual(result["sha"], "")
                self.assertFalse(result["ready"])

    def test_inventory_keeps_interrupted_empty_environment_reapable_without_metadata(self):
        with patch.object(runtime, "details", return_value={"serviceInstances": {"edges": []}}), patch.object(runtime, "gql") as query:
            result = runtime.entry({"id": ENVIRONMENT, "name": NAME})
        query.assert_not_called()
        self.assertEqual(result["expires_at"], EXPIRY)
        self.assertEqual(result["sha"], "")
        self.assertFalse(result["ready"])

    def test_deletion_is_scoped_idempotent_and_preserves_primary(self):
        patch.object(runtime, "project", return_value=project_data()).start()
        listing = patch.object(runtime, "environments", return_value=[]).start()
        cli = patch.object(runtime, "cli").start()
        with self.assertRaises(ValueError):
            runtime.remove("production")
        runtime.remove(NAME)
        cli.assert_not_called()
        listing.return_value = [{"id": PRIMARY, "name": NAME}]
        with self.assertRaises(ValueError):
            runtime.remove(NAME)
        cli.assert_not_called()
        listing.side_effect = [[{"id": ENVIRONMENT, "name": NAME}], []]
        runtime.remove(NAME)
        cli.assert_called_once_with(project_data(), ENVIRONMENT, "environment", "delete", ENVIRONMENT, "--yes")

    def test_reaper_deletes_only_owned_expired_environments(self):
        future = runtime.make_name(42, 100, 1, NOW + runtime.TTL)
        expired = runtime.make_name(42, 100, 1, NOW - 1)
        patch.object(runtime, "time", wraps=runtime.time).start().time.return_value = NOW
        patch.object(runtime, "environments", return_value=[
            {"id": "expired", "name": expired}, {"id": "future", "name": future},
            {"id": "control", "name": "control"}, {"id": "unrelated", "name": "production"},
        ]).start()
        remove = patch.object(runtime, "remove").start()
        patch.object(runtime, "budget_status", return_value={"spent": 1, "budget": 20, "over": False}).start()
        runtime.reap_expired()
        remove.assert_called_once_with(expired)

    def test_reaper_stops_all_owned_previews_at_budget_and_preserves_control(self):
        expired = runtime.make_name(42, 100, 1, NOW - 1)
        patch.object(runtime, "environments", return_value=[
            {"id": ENVIRONMENT, "name": NAME}, {"id": "expired", "name": expired},
            {"id": PRIMARY, "name": "control"}, {"id": "unrelated", "name": "production"},
        ]).start()
        patch.object(runtime, "budget_status", return_value={"spent": 20, "budget": 20, "over": True}).start()
        with patch.object(runtime, "remove") as remove:
            runtime.reap_expired()
        self.assertEqual([call.args[0] for call in remove.call_args_list], [NAME, expired])

    def test_reaper_fails_closed_during_usage_outage_and_attempts_every_deletion(self):
        another = runtime.make_name(43, 100, 1, EXPIRY)
        patch.object(runtime, "environments", return_value=[
            {"id": ENVIRONMENT, "name": NAME}, {"id": "another", "name": another},
            {"id": PRIMARY, "name": "control"},
        ]).start()
        patch.object(runtime, "budget_status", side_effect=RuntimeError("usage unavailable")).start()
        with patch.object(runtime, "remove") as remove:
            with self.assertRaisesRegex(RuntimeError, "budget is unavailable"):
                runtime.reap_expired()
        self.assertEqual([call.args[0] for call in remove.call_args_list], [NAME, another])
        with patch.object(runtime, "remove", side_effect=[RuntimeError("synthetic-secret-error"), None]) as remove:
            with self.assertRaisesRegex(RuntimeError, "cleanup did not complete") as error:
                runtime.reap_expired()
        self.assertNotIn("synthetic-secret", str(error.exception))
        self.assertEqual([call.args[0] for call in remove.call_args_list], [NAME, another])

    def test_reaper_still_cleans_up_after_usage_response_body_socket_failures(self):
        patch.object(runtime, "environments", return_value=[
            {"id": ENVIRONMENT, "name": NAME}, {"id": PRIMARY, "name": "preview-control"},
        ]).start()
        for failure in (TimeoutError("synthetic-sensitive-timeout"),
                        ConnectionResetError("synthetic-sensitive-connection-reset")):
            class FailingBody(io.BytesIO):
                def read(self, size=-1):
                    raise failure

            with self.subTest(failure=type(failure).__name__), patch.object(runtime.urllib.request, "build_opener") as factory, patch.object(runtime, "remove") as remove:
                factory.return_value.open.return_value = FailingBody()
                with self.assertRaisesRegex(RuntimeError, "budget is unavailable") as raised:
                    runtime.reap_expired()
                remove.assert_called_once_with(NAME)
                self.assertNotIn("synthetic-sensitive", str(raised.exception))

    def expected_services(self):
        return {
            APP: runtime.service_config(1, 2 * 1024**3, 4 * 1024**3, "/api/health", "/preview/boot.sh"),
            GATEWAY: runtime.service_config(.5, 256 * 1024**2, 256 * 1024**2,
                                            "/_preview/health", "node /gateway/gateway.cjs"),
        }

    def test_configuration_readback_rejects_unbounded_or_nonempty_services(self):
        expected = self.expected_services()
        config = {"services": copy.deepcopy(expected)}
        query = patch.object(runtime, "gql", return_value={"environment": {"config": config}}).start()
        runtime.verify_config(ENVIRONMENT, expected)
        config["services"][APP]["source"] = None
        config["services"][APP]["networking"] = None
        runtime.verify_config(ENVIRONMENT, expected)
        cases = []
        for key in ("sharedVariables", "volumes", "buckets"):
            changed = copy.deepcopy(config)
            changed[key] = {"unexpected": {}}
            cases.append(changed)
        for key, value in (
            ("variables", {"CREDENTIAL": {"value": "synthetic-value"}}),
            ("source", {"repo": "owner/production"}),
            ("source", {"image": "ghcr.io/owner/unexpected:latest"}),
            ("volumeMounts", {"volume": {"mountPath": "/app/uploads"}}),
            ("networking", {"serviceDomains": {"bypass.up.railway.app": {"port": 3000}}}),
            ("networking", {"tcpProxies": {"3000": {}}}),
        ):
            changed = copy.deepcopy(config)
            changed["services"][APP][key] = value
            cases.append(changed)
        for key, value in (("numReplicas", 2), ("restartPolicyType", "ALWAYS"),
                           ("limitOverride", {"containers": {"cpu": 1}})):
            changed = copy.deepcopy(config)
            changed["services"][APP]["deploy"][key] = value
            cases.append(changed)
        changed = copy.deepcopy(config)
        changed["services"]["unrelated-service"] = {}
        cases.append(changed)
        for changed in cases:
            with self.subTest(config=changed):
                query.return_value = {"environment": {"config": changed}}
                with self.assertRaises(RuntimeError):
                    runtime.verify_config(ENVIRONMENT, expected)

    def test_configuration_accepts_normalized_regions_only_with_one_total_replica(self):
        expected = self.expected_services()
        config = {"services": copy.deepcopy(expected)}
        for service in config["services"].values():
            del service["deploy"]["numReplicas"]
            service["deploy"]["multiRegionConfig"] = {"us-east4-eqdc4a": {"numReplicas": 1}}
        with patch.object(runtime, "gql", return_value={"environment": {"config": config}}):
            runtime.verify_config(ENVIRONMENT, expected)
            config["services"][APP]["deploy"]["multiRegionConfig"]["inactive-region"] = {"numReplicas": 0}
            runtime.verify_config(ENVIRONMENT, expected)
        invalid = [None, {}, [], {"region": {}}, {"region": {"numReplicas": True}},
                   {"region": {"numReplicas": -1}}, {"region": {"numReplicas": 0}},
                   {"first": {"numReplicas": 1}, "second": {"numReplicas": 1}}]
        for regions in invalid:
            changed = copy.deepcopy(config)
            changed["services"][APP]["deploy"]["multiRegionConfig"] = regions
            with self.subTest(regions=regions), patch.object(runtime, "gql", return_value={"environment": {"config": changed}}):
                with self.assertRaises(RuntimeError):
                    runtime.verify_config(ENVIRONMENT, expected)
        for key, value in (("numReplicas", 2), ("restartPolicyType", "ALWAYS")):
            changed = copy.deepcopy(config)
            changed["services"][APP]["deploy"][key] = value
            with self.subTest(key=key), patch.object(runtime, "gql", return_value={"environment": {"config": changed}}):
                with self.assertRaises(RuntimeError):
                    runtime.verify_config(ENVIRONMENT, expected)

    def mock_deployment(self):
        events = []
        saved = {}
        patch.object(runtime.time, "time", return_value=NOW).start()
        patch.object(runtime.time, "sleep").start()
        patch.object(runtime, "preflight", return_value=project_data()).start()
        listing = patch.object(runtime, "environments", return_value=[]).start()
        create = patch.object(runtime, "cli", side_effect=lambda *args: (
            events.append(("create", args)) or {"id": ENVIRONMENT, "name": NAME})).start()

        def save(environment, services):
            self.assertEqual(environment, ENVIRONMENT)
            events.append(("patch", copy.deepcopy(services)))
            for identifier, value in services.items():
                saved.setdefault(identifier, {}).update(copy.deepcopy(value))

        patch.object(runtime, "patch", side_effect=save).start()

        def gql(query, variables):
            if "PreviewConfiguration" in query:
                events.append(("verify", variables))
                return {"environment": {"config": {"services": saved}}}
            if "PreviewDomain" in query:
                self.assertEqual(variables["input"]["serviceId"], GATEWAY)
                events.append(("domain", variables))
                return {"serviceDomainCreate": {"domain": urllib.parse.urlsplit(URL).hostname}}
            raise AssertionError("Unexpected API query")

        query = patch.object(runtime, "gql", side_effect=gql).start()
        patch.object(runtime, "entry", return_value={"id": ENVIRONMENT, "namespace": NAME,
                                                    "url": URL, "ready": True, "failed": False,
                                                    "image": IMAGE}).start()
        patch.object(runtime, "details", return_value={"serviceInstances": {"edges": []}}).start()
        smoke = patch.object(runtime, "smoke", side_effect=lambda url: events.append(("smoke", url))).start()
        remove = patch.object(runtime, "remove").start()
        return events, saved, listing, create, query, smoke, remove

    def deploy(self, **overrides):
        arguments = dict(pr=42, sha=SHA, run_id=100, attempt=1, image=IMAGE,
                         domain="", expires_at=EXPIRY)
        arguments.update(overrides)
        return runtime.deploy(**arguments)

    def test_deployment_verifies_limits_before_assigning_images_and_smokes_login(self):
        events, saved, _, _, _, _, remove = self.mock_deployment()
        result = self.deploy()
        self.assertTrue(result["ready"])
        self.assertEqual([item[0] for item in events], ["create", "patch", "verify", "domain", "patch", "smoke"])
        for service in events[1][1].values():
            self.assertNotIn("source", service)
            self.assertEqual(service["deploy"]["restartPolicyType"], "NEVER")
            # Railway rejects retry count zero even when policy is NEVER.
            self.assertNotIn("restartPolicyMaxRetries", service["deploy"])
            limits = service["deploy"]["limitOverride"]["containers"]
            self.assertGreater(limits["diskBytes"], 0)
            self.assertGreater(limits["memoryBytes"], 0)
        self.assertEqual(saved[APP]["source"]["image"], IMAGE)
        self.assertEqual(saved[GATEWAY]["source"]["image"], GATEWAY_IMAGE)
        self.assertEqual(saved[APP]["variables"]["HOSTNAME"]["value"], "::")
        self.assertEqual(saved[GATEWAY]["variables"]["PREVIEW_HEAD_SHA"]["value"], SHA)
        self.assertNotIn("PREVIEW_HEAD_SHA", saved[APP]["variables"])
        self.assertNotIn("synthetic-controller-token", json.dumps(saved))
        self.assertNotIn("synthetic-project-token", json.dumps(saved))
        remove.assert_not_called()

    def test_deployment_retries_routing_delay_without_recreating_environment(self):
        _, _, _, create, _, smoke, remove = self.mock_deployment()
        smoke.side_effect = [urllib.error.URLError("edge not ready"), None]
        self.assertTrue(self.deploy()["ready"])
        self.assertEqual(smoke.call_count, 2)
        create.assert_called_once()
        remove.assert_not_called()

    def test_rejected_limits_never_start_an_image_and_remove_the_empty_environment(self):
        events, _, _, _, query, smoke, remove = self.mock_deployment()
        original = query.side_effect

        def omit_disk_limit(document, variables):
            result = copy.deepcopy(original(document, variables))
            if "PreviewConfiguration" in document:
                limits = result["environment"]["config"]["services"][APP]["deploy"]["limitOverride"]
                del limits["containers"]["diskBytes"]
            return result

        query.side_effect = omit_disk_limit
        with self.assertRaisesRegex(RuntimeError, "limits"):
            self.deploy()
        self.assertEqual([event[0] for event in events], ["create", "patch", "verify"])
        smoke.assert_not_called()
        remove.assert_called_once_with(NAME)

    def test_capacity_duplicate_and_invalid_generations_never_create_environment(self):
        _, _, listing, create, _, _, remove = self.mock_deployment()
        for overrides in ({"pr": True}, {"run_id": 0}, {"sha": "not-a-sha"},
                          {"image": "ghcr.io/flintsh/flare:latest"}, {"expires_at": NOW},
                          {"expires_at": NOW + runtime.TTL + 1}):
            with self.subTest(overrides=overrides), self.assertRaises(ValueError):
                self.deploy(**overrides)
        listing.return_value = [{"id": str(index), "name": runtime.make_name(42, index + 1, 1, EXPIRY)}
                                for index in range(runtime.MAX_ACTIVE)]
        with self.assertRaisesRegex(RuntimeError, "capacity"):
            self.deploy()
        listing.return_value = [{"id": ENVIRONMENT, "name": NAME}]
        with self.assertRaisesRegex(RuntimeError, "already exists"):
            self.deploy()
        create.assert_not_called()
        remove.assert_not_called()

    def test_interrupted_creation_and_bad_domain_trigger_cleanup_by_owned_name(self):
        _, _, _, create, query, _, remove = self.mock_deployment()
        for failure in (RuntimeError("creation interrupted"), KeyboardInterrupt()):
            create.side_effect = failure
            with self.assertRaises(type(failure)):
                self.deploy()
            remove.assert_called_with(NAME)
        create.side_effect = None
        create.return_value = {"id": ENVIRONMENT, "name": NAME}
        original = query.side_effect
        query.side_effect = lambda document, variables: (
            {"serviceDomainCreate": {"domain": "example.com"}} if "PreviewDomain" in document
            else original(document, variables))
        with self.assertRaisesRegex(RuntimeError, "domain"):
            self.deploy()
        remove.assert_called_with(NAME)


class InMemoryHTTPS(urllib.request.HTTPSHandler):
    """Fake only transport, retaining urllib cookie and redirect behavior."""

    def __init__(self, case, role="USER", redirect=False, oversized=False,
                 notice_policy="same-origin", acknowledgment_cookie=True, acknowledgment_location="/"):
        super().__init__()
        self.case = case
        self.role = role
        self.redirect = redirect
        self.oversized = oversized
        self.notice_policy = notice_policy
        self.acknowledgment_cookie = acknowledgment_cookie
        self.acknowledgment_location = acknowledgment_location
        self.requests = []

    def https_open(self, request):
        self.requests.append(request)
        headers = Message()
        status = 200
        path = urllib.parse.urlsplit(request.full_url).path
        cookie = request.get_header("Cookie", "")
        if path in ("/_preview", "/_preview/enter"):
            self.case.assertNotIn("flare_preview_ack=1", cookie)
        else:
            self.case.assertIn("flare_preview_ack=1", cookie)
        if self.redirect:
            status = 302
            headers["Location"] = "https://external.example.test/collect"
            body = b""
        elif self.oversized:
            body = b" " * 65537
        elif path == "/_preview":
            self.case.assertEqual(request.get_method(), "GET")
            headers["Content-Type"] = "text/html; charset=utf-8"
            headers["Referrer-Policy"] = self.notice_policy
            body = b'<form method="post" action="/_preview/enter"><button>Open preview</button></form>'
        elif path == "/_preview/enter":
            self.case.assertEqual(request.get_method(), "POST")
            self.case.assertEqual(request.get_header("Origin"), URL)
            status = 303
            headers["Location"] = self.acknowledgment_location
            if self.acknowledgment_cookie:
                headers["Set-Cookie"] = "flare_preview_ack=1; Path=/; Max-Age=3600; Secure; HttpOnly; SameSite=Lax"
            body = b""
        elif path == "/_preview/health":
            body = b'{"status":"ready"}'
        elif path == "/api/auth/csrf":
            headers["Set-Cookie"] = "__Host-next-auth.csrf-token=csrf%7Chash; Path=/; Secure; HttpOnly"
            body = b'{"csrfToken":"csrf"}'
        elif path == "/api/auth/callback/credentials":
            self.case.assertIn("__Host-next-auth.csrf-token=csrf%7Chash", cookie)
            form = urllib.parse.parse_qs(request.data.decode())
            self.case.assertEqual(form["csrfToken"], ["csrf"])
            self.case.assertEqual(form["email"], ["demo@example.test"])
            self.case.assertEqual(form["password"], ["Flare-preview-only!2026"])
            headers["Set-Cookie"] = "__Secure-next-auth.session-token=synthetic-session; Path=/; Secure; HttpOnly"
            body = json.dumps({"url": URL + "/dashboard"}).encode()
        elif path == "/api/auth/session":
            self.case.assertIn("__Secure-next-auth.session-token=synthetic-session", cookie)
            body = json.dumps({"user": {"email": "demo@example.test", "role": self.role}}).encode()
        else:
            raise AssertionError("Unexpected smoke request")
        response = urllib.response.addinfourl(io.BytesIO(body), headers, request.full_url, status)
        response.msg = "synthetic response"
        return response


class SmokeTests(unittest.TestCase):
    def setUp(self):
        block_network(self)

    def transport(self, **options):
        transport = InMemoryHTTPS(self, **options)
        original = urllib.request.build_opener
        replacement = patch.object(runtime.urllib.request, "build_opener",
                                   side_effect=lambda *handlers: original(transport, *handlers))
        replacement.start()
        self.addCleanup(replacement.stop)
        return transport

    def test_real_cookiejar_preserves_ack_csrf_and_session_cookies(self):
        transport = self.transport()
        runtime.smoke(URL)
        self.assertEqual([urllib.parse.urlsplit(request.full_url).path for request in transport.requests], [
            "/_preview", "/_preview/enter", "/_preview/health", "/api/auth/csrf",
            "/api/auth/callback/credentials", "/api/auth/session",
        ])

    def test_smoke_rejects_notice_policy_that_nulls_browser_form_origin(self):
        transport = self.transport(notice_policy="no-referrer")
        with self.assertRaisesRegex(RuntimeError, "same-origin form"):
            runtime.smoke(URL)
        self.assertEqual(len(transport.requests), 1)

    def test_smoke_requires_real_acknowledgment_cookie_and_local_redirect(self):
        transport = self.transport(acknowledgment_cookie=False)
        with self.assertRaisesRegex(RuntimeError, "notice acknowledgment"):
            runtime.smoke(URL)
        self.assertEqual(len(transport.requests), 2)
        transport.requests.clear()
        transport.acknowledgment_cookie = True
        transport.acknowledgment_location = "https://external.example.test/collect"
        with self.assertRaisesRegex(RuntimeError, "notice acknowledgment"):
            runtime.smoke(URL)
        self.assertEqual(len(transport.requests), 2)

    def test_smoke_requires_demo_user_and_bounded_responses(self):
        transport = self.transport(role="ADMIN")
        with self.assertRaisesRegex(RuntimeError, "login smoke"):
            runtime.smoke(URL)
        transport.oversized = True
        with self.assertRaisesRegex(RuntimeError, "exceeds limit"):
            runtime.smoke(URL)

    def test_redirect_is_not_followed_to_a_pr_controlled_origin(self):
        transport = self.transport(redirect=True)
        with self.assertRaises(urllib.error.HTTPError):
            runtime.smoke(URL)
        self.assertEqual(len(transport.requests), 1)

    def test_smoke_accepts_only_a_railway_https_origin(self):
        with patch.object(runtime.urllib.request, "build_opener") as opener:
            for value in ("http://preview-example.up.railway.app", "https://example.com", URL + "/path",
                          URL + "?query=1", URL + "#fragment", URL.replace("https://", "https://user:pass@")):
                with self.subTest(value=value), self.assertRaises(ValueError):
                    runtime.smoke(value)
            opener.assert_not_called()


if __name__ == "__main__":
    unittest.main()
