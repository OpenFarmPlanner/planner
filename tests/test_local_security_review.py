import copy
import importlib.util
import json
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts/ci/local_security_review.py"
spec = importlib.util.spec_from_file_location("local_review", SCRIPT)
review = importlib.util.module_from_spec(spec)
spec.loader.exec_module(review)


class LocalReviewTests(unittest.TestCase):
    def setUp(self) -> None:
        self.manifest = {"repo": "owner/repo", "number": 1, "head": "a" * 40,
                         "base": "b" * 40, "scope": ["deleted.py", "new.py", "old.py"]}
        self.result = {"reviewed_sha": "a" * 40, "scope": self.manifest["scope"],
                       "complete": True, "findings": [], "limitations": [],
                       "analysis": "Checked authorization and project-scoped writes."}

    def test_complete_report_uses_existing_manual_gate_contract(self) -> None:
        report = review.render(self.manifest, self.result)
        self.assertIn(f"<!-- manual-security-review:{'a' * 40} -->", report)
        self.assertIn("Result: No unresolved findings", report)
        for path in self.manifest["scope"]:
            self.assertIn(f"`{path}`", report)

    def test_partial_stale_or_unresolved_reviews_cannot_produce_clean_report(self) -> None:
        for change in [{"reviewed_sha": "c" * 40}, {"scope": ["new.py"]},
                       {"scope": self.manifest["scope"] * 2}, {"scope": None},
                       {"complete": False}, {"complete": "true"},
                       {"findings": ["Unvalidated injection candidate"]},
                       {"limitations": ["Did not inspect deleted files"]},
                       {"findings": None}, {"analysis": ""}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                review.render(self.manifest, {**self.result, **change})

    def test_scope_includes_both_names_of_renamed_files_and_deleted_files(self) -> None:
        pages = [[{"filename": "new.py", "previous_filename": "old.py"}],
                 [{"filename": "deleted.py", "status": "removed"}]]
        rows = "\n".join(json.dumps(file) for page in pages for file in page)
        with patch.object(review, "command", return_value=rows):
            self.assertEqual(review.scope_for("owner/repo", 1), self.manifest["scope"])

    def test_preparation_pins_revisions_and_refuses_reused_output(self) -> None:
        pr = {"state": "open", "head": {"sha": self.manifest["head"],
              "repo": {"full_name": "owner/repo"}}, "base": {"sha": self.manifest["base"]}}
        with TemporaryDirectory() as directory:
            output = Path(directory) / "bundle"
            with patch.object(review, "pull_request", return_value=pr), \
                 patch.object(review, "scope_for", return_value=self.manifest["scope"]), \
                 patch.object(review, "command") as run:
                review.prepare("owner/repo", 1, output)
                run.assert_any_call("git", "worktree", "add", "--detach",
                                    str(output / "source"), self.manifest["head"])
                self.assertEqual(json.loads((output / "manifest.json").read_text()), self.manifest)
                self.assertIn(self.manifest["base"], (output / "prompt.txt").read_text())
                self.assertFalse((output / "review.json").exists())
                self.assertFalse((output / "report.md").exists())
                with self.assertRaises(FileExistsError):
                    review.prepare("owner/repo", 1, output)

    def test_moved_head_base_or_scope_invalidates_finish(self) -> None:
        pr = {"state": "open", "head": {"sha": self.manifest["head"]},
              "base": {"sha": self.manifest["base"]}}
        with TemporaryDirectory() as directory:
            output = Path(directory)
            (output / "manifest.json").write_text(json.dumps(self.manifest))
            (output / "review.json").write_text(json.dumps(self.result))
            for field in ["head", "base", "state", "scope"]:
                (output / "report.md").write_text("previous clean report")
                changed = copy.deepcopy(pr)
                scope = self.manifest["scope"]
                if field == "state":
                    changed["state"] = "closed"
                elif field == "scope":
                    scope = ["extra.py"]
                else:
                    changed[field]["sha"] = "c" * 40
                with patch.object(review, "pull_request", return_value=changed), \
                     patch.object(review, "scope_for", return_value=scope), \
                     self.subTest(field=field), self.assertRaises(ValueError):
                    review.finish(output)
                self.assertFalse((output / "report.md").exists())


if __name__ == "__main__":
    unittest.main()
