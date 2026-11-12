import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.ci.claude_review_fallback import completion_report, needs_codex_fallback

HEAD = "a" * 40
SCOPE = ["backend/farm/views/crops.py"]


def completed_messages(**changes: object) -> list[dict[str, object]]:
    evidence = {
        "reviewed_sha": HEAD,
        "scope": SCOPE,
        "security_review_completed": True,
        "result": "no_issues",
        "unfixed_findings": [],
        **changes,
    }
    return [
        {
            "type": "result",
            "subtype": "success",
            "is_error": False,
            "num_turns": 4,
            "result": json.dumps(evidence),
        }
    ]


class ClaudeReviewFallbackTests(unittest.TestCase):
    def test_success_does_not_request_codex(self) -> None:
        self.assertFalse(needs_codex_fallback("success", None))
        self.assertEqual(completion_report("success", None, HEAD, SCOPE)["state"], "claude_failed")

    def test_completed_review_requires_exact_head_scope_and_no_unresolved_findings(self) -> None:
        self.assertEqual(
            completion_report("success", completed_messages(), HEAD, SCOPE)["state"],
            "claude_completed",
        )
        for changes in (
            {"reviewed_sha": "b" * 40},
            {"scope": []},
            {"security_review_completed": False},
            {"unfixed_findings": ["a finding"]},
            {"result": "request_delivered"},
        ):
            with self.subTest(changes=changes):
                self.assertEqual(
                    completion_report("success", completed_messages(**changes), HEAD, SCOPE)[
                        "state"
                    ],
                    "claude_failed",
                )

    def test_successful_step_or_is_error_true_does_not_prove_completion(self) -> None:
        for changes in (
            {"is_error": True},
            {"num_turns": 0},
            {"subtype": "error_max_turns"},
            {"result": "No issues"},
            {"result": "null"},
        ):
            messages = completed_messages()
            messages[-1].update(changes)
            with self.subTest(changes=changes):
                self.assertEqual(
                    completion_report("success", messages, HEAD, SCOPE)["state"], "claude_failed"
                )

    def test_allowance_is_recorded_as_incomplete(self) -> None:
        messages = [{"type": "result", "is_error": True, "result": "insufficient_quota"}]
        report = completion_report("failure", messages, HEAD, SCOPE)
        self.assertEqual(report["state"], "claude_allowance_exhausted")
        self.assertNotIn("result", report)

    def test_valid_report_on_a_failed_job_is_not_completion(self) -> None:
        self.assertEqual(
            completion_report("failure", completed_messages(), HEAD, SCOPE)["state"],
            "claude_failed",
        )

    def test_allowance_errors_request_codex(self) -> None:
        for error in (
            "You've hit your limit · resets 5pm (Europe/Vienna)",
            "Your credit balance is too low to access the Anthropic API.",
            "rate_limit_error",
            "usage_limit_reached",
            "insufficient_quota",
            "Weekly usage allowance exhausted",
        ):
            with self.subTest(error=error):
                messages = [{"type": "result", "is_error": True, "result": error}]
                self.assertTrue(needs_codex_fallback("failure", messages))

    def test_assistant_api_error_requests_codex(self) -> None:
        messages = [{"type": "assistant", "error": "rate_limit_error", "message": {}}]
        self.assertTrue(needs_codex_fallback("failure", messages))

    def test_structured_result_errors_are_checked(self) -> None:
        messages = [{"type": "result", "is_error": True, "errors": ["insufficient_quota"]}]
        self.assertTrue(needs_codex_fallback("failure", messages))

    def test_unrelated_errors_and_missing_reports_remain_failures(self) -> None:
        for messages in (
            None,
            [],
            {},
            [{"type": "result", "is_error": True, "errors": ["Invalid API key"]}],
            [{"type": "result", "is_error": True, "errors": ["Tests failed"]}],
            [{"type": "result", "is_error": True, "errors": ["error_max_turns"]}],
            [{"type": "result", "is_error": True, "errors": ["Reached max turns limit"]}],
        ):
            with self.subTest(messages=messages), self.assertRaises(ValueError):
                needs_codex_fallback("failure", messages)

    def test_quoted_allowance_messages_do_not_trigger_fallback(self) -> None:
        messages = [
            {"type": "user", "message": {"content": "rate_limit_error"}},
            {"type": "assistant", "message": {"content": "You've hit your limit"}},
            {"type": "result", "is_error": False, "result": "insufficient_quota"},
        ]
        with self.assertRaises(ValueError):
            needs_codex_fallback("failure", messages)

    def test_cli_sets_output_without_printing_execution_details(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            report, output = Path(directory) / "report.json", Path(directory) / "output"
            scope = Path(directory) / "scope.json"
            scope.write_text(json.dumps(SCOPE), encoding="utf-8")
            completion = Path(directory) / "completion.json"
            report.write_text(
                json.dumps(
                    [
                        {
                            "type": "result",
                            "is_error": True,
                            "result": "credit balance is too low PRIVATE",
                        }
                    ]
                ),
                encoding="utf-8",
            )
            result = subprocess.run(
                ["python3", "scripts/ci/claude_review_fallback.py"],
                env={
                    **os.environ,
                    "CLAUDE_OUTCOME": "failure",
                    "CLAUDE_CONCLUSION": "",
                    "CLAUDE_EXECUTION_FILE": str(report),
                    "GITHUB_OUTPUT": str(output),
                    "GITHUB_RUN_ID": "123",
                    "GITHUB_RUN_ATTEMPT": "2",
                    "REVIEW_HEAD_SHA": HEAD,
                    "REVIEW_SCOPE_FILE": str(scope),
                    "REVIEW_REPORT_FILE": str(completion),
                },
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(
                output.read_text(encoding="utf-8"), "codex_fallback=true\nreview_completed=false\n"
            )
            evidence = json.loads(completion.read_text(encoding="utf-8"))
            self.assertEqual(evidence["state"], "claude_allowance_exhausted")
            self.assertEqual(evidence["run_attempt"], 2)
            self.assertNotIn("PRIVATE", result.stdout + result.stderr)
