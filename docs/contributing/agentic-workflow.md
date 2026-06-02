# Agentic Workflow for Contributors

This guide explains how to collaborate effectively on Quebracho using issue-first development, reviewable PR slices, and SDD artifacts.

## Why This Exists

Quebracho is an IDE with native capabilities (Tauri + Rust) and frontend orchestration (React + TypeScript). Fast iteration without guardrails can degrade security, performance, and maintainability.

This workflow keeps the project healthy while allowing rapid feature growth.

## Golden Path

1. Create or pick an approved issue.
2. Explore and scope impact.
3. Produce a small implementation slice.
4. Validate with local checks.
5. Open a focused PR linked to the issue.

## Skills and When to Use Them

Use the right skill for the job:

| Skill | Use when | Output |
| --- | --- | --- |
| `issue-creation` | Creating bug/feature issue | Complete issue with clear acceptance criteria |
| `sdd-explore` | Clarifying requirements/impact | Risks, boundaries, implementation direction |
| `sdd-propose` | Defining intended change scope | Change proposal |
| `sdd-spec` | Formalizing behavior | Requirements and scenarios |
| `sdd-design` | Cross-layer design decisions | Architecture and tradeoffs |
| `sdd-tasks` | Breaking implementation into steps | Reviewable task plan |
| `sdd-apply` | Executing planned tasks | Code changes aligned with spec/design |
| `sdd-verify` | Verifying implementation | Evidence of compliance and checks |
| `branch-pr` | Opening/preparing PRs | Correct PR metadata and workflow compliance |
| `work-unit-commits` | Splitting large work safely | Commit/PR slices that are easy to review |
| `chained-pr` | Work exceeds review budget | Ordered PR stack with clear dependencies |
| `cognitive-doc-design` | Writing docs/PR explanations | Fast-to-scan contributor docs |
| `comment-writer` | Review comments and async collaboration | Clear, respectful, actionable feedback |

## PR Sizing Strategy

- Preferred: one PR under ~400 changed lines.
- If larger, split by behavior/work-unit, not by file type.
- Keep tests/docs with the code they validate.

Use chained PRs when:

- A single change exceeds review budget.
- Risk is concentrated in native boundary or process control.
- Multiple independent slices can be merged incrementally.

## Issue Lifecycle

1. Open issue using template.
2. Maintainer triages (`status:needs-review`).
3. Maintainer approves (`status:approved`).
4. Contributor opens PR linked to issue.
5. Merge and close via `Closes #N`.

## Performance-First Engineering Checklist

Before opening PR, verify:

- No new hot path does full filesystem recursion without need.
- Filesystem watcher storms are debounced/coalesced.
- Renderer updates are incremental where possible.
- Native command payloads are minimal and explicit.
- Memory-heavy operations are bounded and justified.

## Security Checklist for Tauri Changes

- Input paths validated and normalized.
- Operations constrained to permitted boundaries.
- No unnecessary native command exposed to renderer.
- Security-relevant config changes documented.

## Recommended Local Commands

- `npm run ci:check`
- `npm run dev`

## Maintainer Notes

- Enforce issue-first and PR template completion.
- Request PR slicing when review load is too high.
- Prioritize performance and native-boundary correctness over feature speed.
