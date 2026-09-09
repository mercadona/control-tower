---
description: Groom an epic — spec §9 → GitHub (Milestone + issues + labels + Project v2 + Sprint)
---
Run the groom over the epic's spec. Dry run first, to review the plan:
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --dry-run
```
Review the JSON. If it looks right, run it for real (add `--project <n>` for the Project v2):
```
node ${CLAUDE_PLUGIN_ROOT}/scripts/ct-groom.mjs "$1" --repo "<owner/repo>" --milestone "<Epic>" --project <n>
```

Groom with the spec already pushed to the default branch (otherwise the issues are born with no link to the spec). One invocation = one `--milestone` = one epic. It is idempotent by existence: re-running does not duplicate, but neither does it converge — the divergences are reported through stderr and are only applied with `--reconcile` (EXPERIMENTAL: review the issue's diff afterwards). Issues are born in `status:backlog`; promoting them to `status:ready` is a human's job. **stdout is the plan** and **stderr carries the `aviso:`, `nota:` and `divergencia:` lines**: pass them on as they are.

| Exit | Significa | Qué hacer |
|---|---|---|
| `0` | No real divergence (or `--reconcile` resolved it) | promote to `status:ready` whatever should fly |
| `1` | Stopped dead, **nothing created or modified**: an issue with no milestone whose `ct-order` collides, a renamed epic, a `gh` failure, a `--project` precondition (`Sprint` field, a current iteration) | read the reason, fix it, repeat |
| `2` | The spec does not come in: malformed table, unrecognizable `Dep`, unknown gate, exemption with no reason, pending clarification marker, `## Hipótesis` absent | fix the spec — every error is reported together, also under `--dry-run` |
| `3` | Something real is left unreconciled: title, link to the spec, labels, AC, deps, `## E2E`, a duplicated section or an orphan issue | review in GitHub; `--reconcile` applies it |

`--dry-run --repo` returns the same `3` as the real run: if you automate this, do not chain with `&&`.

The table's format is fixed by the contract that `/ct-init` seeds into every repo (`docs/superpowers/CONTRATO-SLICES.md`). Full reference —columns, aborts, `--reconcile`, the link to the spec and the history—: `docs/loop/ct-groom.md` in the plugin's repo.
