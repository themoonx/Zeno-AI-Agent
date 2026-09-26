---
name: Code Review
slug: code-review
description: Review code for real defects — correctness, security, and maintainability — and report findings ordered by severity with concrete fixes. Use for "review this code", "find bugs", "is this safe", or before shipping a change.
triggers: review, code review, bugs, defect, security, vulnerability, refactor, pull request, audit code, smells
tools: file_read, file_list, code_exec
---
# Code Review

Report **defects**, not preferences. Every finding must be actionable.

## Passes (in order)
1. **Correctness** — off-by-one, inverted conditions, unhandled null/undefined, wrong operator, mutation of shared state, race conditions, unawaited async, resource leaks.
2. **Security** — injection (SQL/command/template), missing authorization checks, secrets in source, unsafe deserialization, path traversal, unvalidated input reaching a sink, timing-unsafe comparison.
3. **Error handling** — swallowed exceptions, errors that lose context, failure paths that leave inconsistent state.
4. **Maintainability** — only when it will actually cause future bugs: duplicated logic that must stay in sync, dead code, misleading names.

## Rules
- **Read before judging.** Confirm the defect exists in the code you can see; do not report a suspicion as a fact.
- **Verify where you can.** If execution is available, run the code to confirm behaviour instead of guessing.
- **Quote the code**, give the file and line, explain the concrete failure scenario (inputs → wrong result), then give the fix.
- **Rate severity**: Critical (data loss / security / crash) · High (wrong results) · Medium (edge case) · Low (style with a real cost).
- If the code is sound, say so plainly. Do not manufacture findings to look thorough.

## Output
For each finding: `severity — title`, location, why it breaks, the fix. Group the fixes that belong in one commit. Finish with what you checked and found clean.