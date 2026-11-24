"""Prepare bounded queue-maintenance tasks for the owner's interactive coding assistant."""

import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import sys
import tempfile
from qa_references import references, issue_links

qa = Path(__file__).resolve().parents[2] / ".qa-review"
repo = qa.parent


def run(args, **kwargs):
    return subprocess.check_output(args, cwd=repo, text=True, **kwargs)


def live_queue():
    # Read the same owner-verified queue body as the worker, from trusted main.
    reader = run(["git", "show", "main:scripts/ci/agent_task_context.cjs"])
    queue = json.loads(
        run(
            [
                "node",
                "-e",
                reader + "\nconsole.log(JSON.stringify(module.exports.readTask(1058)))",
            ]
        )
    )
    if queue["state"] != "open" or queue.get("pull_request"):
        raise ValueError("Expected open execution queue #1058.")
    section = re.search(
        r"^## Ordered work items[ \t]*\r?\n(.*?)(?=^## |\Z)", queue["body"], re.M | re.S
    )
    if not section:
        raise ValueError("Cannot identify ordered work items.")
    rows = {}
    for line in section[1].splitlines():
        if not line.strip():
            continue
        match = re.fullmatch(r"\s*-\s*\[([ xX])\]\s+(PR\s+)?#([1-9]\d*)(?:\s.*)?", line)
        if not match or int(match[3]) in rows:
            raise ValueError(
                "Malformed or duplicate queue entry. Inspect #1058 before continuing."
            )
        rows[int(match[3])] = dict(
            row=line,
            position=len(rows) + 1,
            checked=match[1].lower() == "x",
            pr=bool(match[2]),
        )
    return queue, rows


def metadata(numbers):
    """Fetch lightweight implementation evidence. Codex resolves ambiguous links in the live preflight."""
    out = {}
    for start in range(0, len(numbers), 25):
        chunk = numbers[start : start + 25]
        fields = " ".join(
            f"i{n}: issue(number:{n}) {{ number state stateReason title closedByPullRequestsReferences(first:50,includeClosedPrs:true) {{ pageInfo {{ hasNextPage }} nodes {{ number state mergeCommit {{ oid }} }} }} }}"
            for n in chunk
        )
        query = (
            'query { repository(owner:"OpenFarmPlanner",name:"planner"){'
            + fields
            + "} }"
        )
        res = json.loads(run(["gh", "api", "graphql", "-f", "query=" + query]))
        if res.get("errors"):
            raise ValueError("Incomplete GitHub response.")
        for n in chunk:
            issue = res["data"]["repository"][f"i{n}"]
            if not issue or issue["number"] != n:
                raise ValueError(f"Cannot verify queue issue #{n}.")
            out[n] = issue
    return out


def plan(mode, results, decisions, queue, rows, info):
    active = {i["number"]: i for i in results["issues"]}
    entries = []

    def entry(n, reason):
        card, decision, live = (
            active.get(n, {}),
            decisions.get(str(n), {}),
            info.get(n, {}),
        )
        return dict(
            issue=n,
            title=live.get("title", card.get("title")),
            reason=reason,
            position=rows.get(n, {}).get("position"),
            reviewedPR=card.get("pr"),
            reviewedCommit=card.get("commit"),
            decisionRevision=decision.get("revision", 0),
            linkedFollowup=decision.get("followupIssue"),
            references=live.get("issueReferences", []),
        )

    if mode == "sync":
        for n, card in active.items():
            if decisions.get(str(n), {}).get("status") != "Accepted":
                continue
            if n not in rows:
                reason = "already absent — reconcile locally"
            elif rows[n]["pr"] or info[n]["state"] != "CLOSED":
                reason = "skip — no closed implementation issue"
            else:
                reason = "verify for batch removal"
            entries.append(entry(n, reason))
    else:
        for n, row in rows.items():
            if row["pr"] or row["checked"]:
                continue
            live = info[n]
            if live["state"] != "CLOSED" or live["stateReason"] == "NOT_PLANNED":
                continue
            linked = live["closedByPullRequestsReferences"]
            merged = {
                p["mergeCommit"]["oid"]
                for p in linked["nodes"]
                if p.get("mergeCommit") and p["state"] == "MERGED"
            }
            if n not in active:
                entries.append(
                    entry(
                        n,
                        "check implementation and prepare new QA"
                        if not merged
                        else "prepare new QA",
                    )
                )
            elif (
                active[n]["commit"] not in merged
                or len(merged) > 1
                or linked["pageInfo"]["hasNextPage"]
            ):
                entries.append(
                    entry(n, "recheck implementation against existing evidence")
                )
            elif (
                active[n]["queueRow"] != row["row"]
                or active[n]["position"] != row["position"]
            ):
                entries.append(entry(n, "update queue position or manual hint"))
        for n in active:
            if n not in rows or rows[n]["checked"]:
                entries.append(entry(n, "reconcile archived or checked row"))
            elif (
                rows[n]["pr"]
                or info[n]["state"] != "CLOSED"
                or info[n]["stateReason"] == "NOT_PLANNED"
            ):
                entries.append(entry(n, "reconcile reopened or ineligible issue"))
    return {
        "repository": "OpenFarmPlanner/planner",
        "queue": 1058,
        "mode": mode,
        "queueUpdatedAt": queue["updated_at"],
        "entries": entries,
    }


def launch(mode, preview=False, agent="auto"):
    results = json.loads((qa / "results.json").read_text())
    decisions = json.loads((qa / "decisions.json").read_text())
    queue, rows = live_queue()
    accepted = {
        i["number"]
        for i in results["issues"]
        if decisions.get(str(i["number"]), {}).get("status") == "Accepted"
    }
    numbers = [
        n
        for n, row in rows.items()
        if not row["pr"] and (mode == "refresh" or n in accepted)
    ]
    info = metadata(numbers)
    if mode == "sync":
        for n, sources in references(numbers).items():
            info[n]["issueReferences"] = issue_links(n, sources)
    job = plan(mode, results, decisions, queue, rows, info)
    print(f"OpenFarmPlanner #{job['queue']} · {mode}")
    positional = [
        i
        for i in job["entries"]
        if i["reason"] == "update queue position or manual hint"
    ]
    for i in job["entries"]:
        if i["reason"] == "update queue position or manual hint":
            continue
        print(f"  #{i['issue']}  {i['title']}  [{i['reason']}]")
        if mode == "sync":
            for link in i["references"]:
                if link["explicit"]:
                    print(f"    QA follow-up: #{link['number']} {link['title']}")
            related = [
                f"#{link['number']}" for link in i["references"] if not link["explicit"]
            ]
            if related:
                print("    Other referencing issues: " + ", ".join(related))
    if positional:
        print(
            f"  {len(positional)} existing cards have updated queue positions or manual hints."
        )
    if not job["entries"]:
        print("No changes to process.")
        return
    if preview:
        print("Preview only. No review state or GitHub changes.")
        return
    if mode == "sync" and (not sys.stdin.isatty() or not sys.stdout.isatty()):
        raise ValueError(
            "Use an interactive terminal for the assistant session, or pass --preview."
        )
    folder = qa / "runs"
    folder.mkdir(mode=0o700, exist_ok=True)
    task = (qa / "test-data" / f"round-{mode}.txt").read_text()
    # Lock only the choice and handoff. The descriptor closes when the CLI starts.
    with (folder / "launcher.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        state = folder / "last-agent"
        previous = state.read_text().strip() if state.exists() else ""
        chosen = (
            ("claude" if previous == "codex" else "codex") if agent == "auto" else agent
        )
        binary = shutil.which(chosen)
        if not binary:
            raise ValueError(
                f"{chosen} CLI unavailable. Select the other assistant with --agent."
            )
        with tempfile.NamedTemporaryFile(
            "w", prefix=mode + "-", suffix=".json", dir=folder, delete=False
        ) as f:
            json.dump({**job, "agent": chosen}, f, ensure_ascii=False, indent=2)
            manifest = Path(f.name).relative_to(repo)
        prompt = f"Perform the owner's local OpenFarmPlanner QA {mode} workflow. Read {repo/manifest} for the frozen candidate list. Repository root: {repo}.\n\n{task}"
        args = [binary]
        if mode == "refresh":
            prompt += "\nRun unattended. Complete the authorized checks and local dashboard update. Record any blocked check with its reason, then continue independently with the remaining checks. The launcher has already updated the QA release. Read the repository from its root, write QA output under the review workspace, and keep GitHub read-only."
            if chosen == "codex":
                args.extend(
                    [
                        "-a",
                        "never",
                        "exec",
                        "--sandbox",
                        "workspace-write",
                        "-c",
                        "sandbox_workspace_write.network_access=true",
                        "--cd",
                        str(qa),
                        "--model",
                        "gpt-5.6-sol",
                    ]
                )
            else:
                args.extend(["--print", "--permission-mode", "auto", "--no-chrome"])
        elif chosen == "codex":
            args.extend(
                [
                    "-a",
                    "never",
                    "--sandbox",
                    "workspace-write",
                    "-c",
                    "sandbox_workspace_write.network_access=true",
                    "--cd",
                    str(repo),
                    "--model",
                    "gpt-5.6-sol",
                ]
            )
        else:
            args.append("--no-chrome")
        args.append(prompt)
        state.write_text(chosen + "\n")
        try:
            if mode == "sync":
                os.chdir(repo)
                print(f"Opening {chosen} in this terminal.", flush=True)
                os.execv(binary, args)
                return
            print(f"Refreshing the local dashboard with {chosen}.", flush=True)
            process = subprocess.Popen(args, cwd=qa, stdin=subprocess.DEVNULL)
        except OSError:
            state.write_text(previous)
            raise
    # Release the agent-selection lock before waiting for the unattended run.
    code = process.wait()
    if code:
        raise subprocess.CalledProcessError(code, args)
