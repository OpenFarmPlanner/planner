import json
import os
import re
from pathlib import Path

ALLOWANCE_ERROR = re.compile(
    r"\brate_limit(?:_error)?\b|usage_limit_reached|insufficient_quota|billing_error|"
    r"credit balance.{0,40}(?:too low|insufficient|exhausted)|"
    r"you(?:'ve| have)? (?:hit|reached|exceeded) your (?:usage |rate |session |weekly )?limit|"
    r"(?:usage|rate|session|weekly) limit.{0,40}(?:reached|exceeded|exhausted)|"
    r"(?:usage|quota|allowance).{0,40}(?:exhausted|exceeded)|"
    r"out of (?:extra usage|credits)",
    re.IGNORECASE,
)


def needs_codex_fallback(outcome: str, messages: object) -> bool:
    if outcome == "success":
        return False
    if not isinstance(messages, list):
        raise ValueError("Claude failed without a usable execution report.")
    for message in messages:
        if not isinstance(message, dict):
            continue
        # Inspect error responses only; quoted code and tool output are not
        # evidence that the reviewer's allowance was exhausted.
        if message.get("type") == "result" and message.get("is_error") is True:
            text = json.dumps([message.get("result"), message.get("errors")])
        elif message.get("type") == "assistant" and message.get("error"):
            text = json.dumps([message["error"], message.get("message", {}).get("content")])
        else:
            continue
        if ALLOWANCE_ERROR.search(text):
            return True
    raise ValueError(
        "Claude failed for a reason other than an exhausted allowance; inspect its logs."
    )


_FENCE = re.compile(r"```(?:json)?\s*(\{.*\})\s*```\s*\Z", re.DOTALL)


def _trailing_json_object(text: object) -> object:
    """Return the JSON object that ends the reviewer's final message, if any.

    Accepts the bare object the prompt asks for, the same object in a closing
    ```json fence, or prose followed by the object. Only an object that runs to
    the very end of the message counts; everything it contains is validated
    separately and no other text is used.
    """
    if not isinstance(text, str):
        return None
    text = text.strip()
    fenced = _FENCE.search(text)
    if fenced:
        text = fenced.group(1)
    decoder = json.JSONDecoder()
    start = text.rfind("{")
    while start != -1:
        try:
            value, end = decoder.raw_decode(text, start)
        except ValueError:
            pass
        else:
            if end == len(text) and isinstance(value, dict):
                return value
        start = text.rfind("{", 0, start)
    return None


def _scope_matches(reported: object, scope: list[str]) -> bool:
    """Same set of paths, each listed once; the order the reviewer used does not matter."""
    return (
        isinstance(reported, list)
        and all(isinstance(path, str) for path in reported)
        and len(reported) == len(set(reported))
        and sorted(reported) == sorted(scope)
    )


def _evidence_problem(evidence: object, head: str, scope: list[str]) -> str | None:
    if not isinstance(evidence, dict):
        return "terminal result is not a JSON object"
    if evidence.get("security_review_completed") is not True:
        return "security_review_completed is not true"
    if evidence.get("reviewed_sha") != head:
        return "reviewed_sha does not match the head"
    if not _scope_matches(evidence.get("scope"), scope):
        return "scope does not match the changed files"
    if evidence.get("result") not in ("no_issues", "issues_fixed"):
        return "result is not no_issues or issues_fixed"
    if evidence.get("unfixed_findings") != []:
        return "unfixed_findings is not empty"
    return None


def completion_report(
    outcome: str, messages: object, head: str, scope: list[str]
) -> dict[str, object]:
    """Routing success is distinct from a validated, exact-head security review.

    A rejected report carries a fixed, non-sensitive ``reason`` and never any of
    the reviewer's text.
    """
    report: dict[str, object] = {
        "schema": 1,
        "provider": "claude",
        "head_sha": head,
        "scope": sorted(scope),
        "state": "claude_failed",
    }

    def failed(reason: str) -> dict[str, object]:
        return {**report, "reason": reason}

    if not re.fullmatch(r"[0-9a-f]{40}", head) or not scope:
        return failed("invalid head SHA or empty scope")
    try:
        if needs_codex_fallback(outcome, messages):
            return {**report, "state": "claude_allowance_exhausted"}
    except ValueError:
        return failed(f"review step outcome is {outcome or 'unknown'}")
    if not isinstance(messages, list) or not messages:
        return failed("no execution report")
    terminal = messages[-1]
    if (
        not isinstance(terminal, dict)
        or terminal.get("type") != "result"
        or terminal.get("is_error") is not False
        or terminal.get("subtype") != "success"
        or not isinstance(terminal.get("num_turns"), int)
        or terminal["num_turns"] < 1
    ):
        return failed("last message is not a successful result")
    evidence = _trailing_json_object(terminal.get("result"))
    if evidence is None:
        return failed("terminal result does not end with a JSON object")
    problem = _evidence_problem(evidence, head, scope)
    if problem:
        return failed(problem)
    return {**report, "state": "claude_completed", "result": evidence["result"]}


def main() -> None:
    execution_file = os.environ.get("CLAUDE_EXECUTION_FILE", "")
    messages: object = None
    try:
        if execution_file:
            messages = json.loads(Path(execution_file).read_text(encoding="utf-8"))
    except (OSError, ValueError):
        pass
    report = completion_report(
        os.environ["CLAUDE_OUTCOME"],
        messages,
        os.environ["REVIEW_HEAD_SHA"],
        json.loads(Path(os.environ["REVIEW_SCOPE_FILE"]).read_text(encoding="utf-8")),
    )
    report["run_id"] = int(os.environ["GITHUB_RUN_ID"])
    report["run_attempt"] = int(os.environ["GITHUB_RUN_ATTEMPT"])
    fallback = report["state"] == "claude_allowance_exhausted"
    completed = report["state"] == "claude_completed"
    Path(os.environ["REVIEW_REPORT_FILE"]).write_text(json.dumps(report), encoding="utf-8")
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"codex_fallback={str(fallback).lower()}\n")
        output.write(f"review_completed={str(completed).lower()}\n")
    print(f"Security review state: {report['state']}")
    if "reason" in report:
        print(f"Reason: {report['reason']}")
    if fallback:
        print(
            "::warning::Claude allowance exhausted; security review did not complete. "
            "The Codex fallback can request a review, but cannot certify completion."
        )


if __name__ == "__main__":
    main()
