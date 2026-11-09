"""Narrow literal refinements shared by the Skills Guard pattern scan."""

import re


_NAMED_ENV = re.compile(r'os\.environ\s*\[\s*["\']([A-Za-z_][A-Za-z0-9_]*)["\']\s*\]')
_SECRET_NAME = re.compile(r"KEY|TOKEN|SECRET|PASSWORD|CREDENTIAL", re.IGNORECASE)
# Conservatively retain warnings for mutations, including tuple/parenthesized
# targets and loop targets. False negatives here must not turn writes into reads.
_MUTATION_TAIL = re.compile(r"=(?!=)|\bin\b")
_MUTATION_PREFIX = re.compile(r"\b(?:del|for|as)\b")
# Complete, deliberately low-entropy instructional values only. Provider token-shape
# rules still run independently; adding a real-looking suffix does not qualify.
_PLACEHOLDER = re.compile(
    r"(?:ghp_)?your_(?:new_)?(?:github_)?(?:token|api_key|secret|password)"
    r"|unused-for-(?:script-only|tests?|testing|examples?)"
)


def literal_context(
    pid: str,
    line: str,
    severity: str,
    description: str,
    secret_matches: tuple[str, ...] = (),
) -> tuple[str, str]:
    """Retain informational findings for explicit placeholders and single-name reads.

    Bulk/dynamic env access remains high. A literal read alone is not evidence of
    transfer: separate exfiltration rules continue scanning the complete line.
    """
    if pid == "python_os_environ":
        reads = list(_NAMED_ENV.finditer(line))
        if (
            reads
            and "os.environ" not in _NAMED_ENV.sub("", line)
            and not any(
                _MUTATION_TAIL.search(line[m.end() :])
                or _MUTATION_PREFIX.search(line[: m.start()])
                for m in reads
            )
        ):
            severity = (
                "medium" if any(_SECRET_NAME.search(m[1]) for m in reads) else "low"
            )
            return severity, description + " (literal named lookup; informational)"
    if pid == "hardcoded_secret":
        # The scanner regex owns credential boundaries, including unterminated
        # literals; reparsing with a closing-quote requirement can hide a second key.
        values = [re.split(r"[\"']", span, maxsplit=1)[1] for span in secret_matches]
        if values and all(_PLACEHOLDER.fullmatch(value) for value in values):
            return (
                "medium",
                description + " (explicit placeholder literal; informational)",
            )
    return severity, description
