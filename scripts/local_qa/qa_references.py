"""Read same-repository backlinks for accepted review cards."""

import json
import re
import subprocess


def references(numbers):
    result = {n: [] for n in numbers}
    pending = {n: None for n in numbers}
    while pending:
        fields = []
        for n, cursor in pending.items():
            after = ",after:" + json.dumps(cursor) if cursor else ""
            fields.append(
                f"""i{n}:issue(number:{int(n)}){{timelineItems(first:50{after},itemTypes:[CROSS_REFERENCED_EVENT]){{pageInfo{{hasNextPage endCursor}} nodes{{...on CrossReferencedEvent{{source{{__typename ...on Issue{{number title body state createdAt repository{{nameWithOwner}}}} ...on PullRequest{{number title state repository{{nameWithOwner}}}}}}}}}}}}}}"""
            )
        query = (
            'query{repository(owner:"OpenFarmPlanner",name:"planner"){'
            + " ".join(fields)
            + "}}"
        )
        response = json.loads(
            subprocess.check_output(
                ["gh", "api", "graphql", "-f", "query=" + query], text=True
            )
        )["data"]["repository"]
        next_page = {}
        for n in pending:
            timeline = response[f"i{n}"]["timelineItems"]
            seen = {(s["__typename"], s["number"]) for s in result[n]}
            for event in timeline["nodes"]:
                source = event.get("source") or {}
                key = (source.get("__typename"), source.get("number"))
                if (
                    source.get("repository", {}).get("nameWithOwner")
                    != "OpenFarmPlanner/planner"
                    or key in seen
                ):
                    continue
                seen.add(key)
                result[n].append(source)
            if timeline["pageInfo"]["hasNextPage"]:
                next_page[n] = timeline["pageInfo"]["endCursor"]
        pending = next_page
    return result


def issue_links(original, sources):
    links = []
    for source in sources:
        if (
            source["__typename"] != "Issue"
            or source["number"] == 1058
            or source["title"].lower().startswith("epic:")
        ):
            continue
        # A backlink can also come from a PR, comment or unrelated parent.
        # Only a source issue explicitly referring to the reviewed issue belongs in the preview.
        body = source.get("body") or ""
        if not re.search(
            rf"(?:#{original}\b|github\.com/OpenFarmPlanner/planner/issues/{original}\b)",
            body,
            re.I,
        ):
            continue
        links.append(
            {
                "number": source["number"],
                "title": source["title"],
                "state": source["state"],
                "explicit": bool(
                    re.search(rf"^\s*QA follow-up to #{original}\b", body, re.I | re.M)
                ),
            }
        )
    return sorted(links, key=lambda item: item["number"])
