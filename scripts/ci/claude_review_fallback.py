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


def main() -> None:
    report = os.environ.get("CLAUDE_EXECUTION_FILE", "")
    messages: object = None
    if report:
        messages = json.loads(Path(report).read_text(encoding="utf-8"))
    fallback = needs_codex_fallback(os.environ["CLAUDE_OUTCOME"], messages)
    with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
        output.write(f"codex_fallback={str(fallback).lower()}\n")
    if fallback:
        print(
            "::warning::Claude allowance exhausted. Requesting Codex Security Review "
            "using the linked subscription."
        )


if __name__ == "__main__":
    main()
