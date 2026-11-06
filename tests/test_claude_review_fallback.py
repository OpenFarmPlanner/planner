import json
import os
import subprocess
import tempfile
import unittest
from pathlib import Path

from scripts.ci.claude_review_fallback import needs_codex_fallback


class ClaudeReviewFallbackTests(unittest.TestCase):
    def test_success_does_not_request_codex(self) -> None:
        self.assertFalse(needs_codex_fallback("success", None))

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
                },
                capture_output=True,
                text=True,
                check=True,
            )
            self.assertEqual(output.read_text(encoding="utf-8"), "codex_fallback=true\n")
            self.assertNotIn("PRIVATE", result.stdout + result.stderr)
