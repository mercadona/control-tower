---
description: Bootstrap a repository for the Control Tower loop (.agent/STATE.md + AGENTS.md + slices contract + execution spec template)
---
Run the scaffolder over the current repository and confirm what it created:
```
bash ${CLAUDE_PLUGIN_ROOT}/scripts/ct-init.sh "$(pwd)"
```

It is idempotent: it creates what is missing and does not tread on what is there. It seeds `.agent/STATE.md`, `.agent/conventions.md` (the repository's yardstick), the contract of the slices table (versioned and maintained by `/ct-init`; a fresh repository gets `docs/superpowers/SLICES-CONTRACT.md`, and a repository that already carries the legacy `docs/superpowers/CONTRATO-SLICES.md` keeps that name), `docs/superpowers/specs/_TEMPLATE-execution-spec.md`, two sections in `AGENTS.md` (the loop's one, which links to the contract, and the e2e journey one), the `.gitignore` rules (`.worktrees/`, `.agent/SLICE.md`, `.agent/run-*`, `.claude/worktrees/`, `.claude/settings.local.json`), `.claude/settings.json` (which declares this plugin, pinned at the release that wrote it) and the scope gate (`.github/workflows/ct-scope-gate.yml`, the `.github/ct/scope-check.js` bundle it runs, and the `.github/ct/package.json` that makes node read that ESM bundle as ESM whatever the repository declares).

| Exit | What it means | What to do |
|---|---|---|
| `0` | Bootstrap done; the `warning:` lines on stderr are not failures, and neither is a `plugin-install` artifact reported `refused` | read the `--json` report (or stdout and stderr) and pass it on |
| `2` | Unrecognised option | fix the invocation (`--update-slices-contract`, `--force`) |
| `3` | `--update-slices-contract` was asked for and the block present is not recognised, or could not be hashed | pass the whole warning on, with the hash; `--force` only if the user confirms that block carries no work of theirs |
| `70` | Internal error in `ct-init.sh` itself (an artifact reported a status its own class does not allow) | this is a bug in the scaffolder, not in the target repo; report it, do not work around it |

`--json` prints ONE JSON object on stdout instead of the prose above — no other
call needs to change. It names `ctInitVersion`, `configDir`, `exitCode`, and one
`artifacts` entry per artifact this script can touch, always in the same fixed
order, each with a `status` of `created`, `already-present`, `drifted` or
`refused`. **Read this report as the structural source of truth for what
happened** — each artifact's `id` and `status` — instead of grepping the prose
on stdout for a wording that can change. Use the prose only for what the report
does not carry: the yardstick sweep's list of candidates, and a conventions
conflict's evidence.

What falls to you afterwards:

- **The scaffolder installs the plugin itself; pass on what it reports.** It
  runs `claude plugin install control-tower-loop@control-tower --scope project`
  for you and verifies with `plugin list --json` afterwards, reporting the
  outcome as the `plugin-install` artifact. **This reverses an earlier rule
  here**, which told the agent to print that command and never run it — that
  was correct until the scaffolder itself started running the install, and the
  reversal is a decision, not a drift: if you read an older note that still
  says "do not run it yourself", it is stale, not a second, conflicting truth.
  Two things stay the user's, and the scaffolder cannot do them: the repository
  folder has to be **trusted** before its `extraKnownMarketplaces` entry takes
  effect, and `ct-scope-gate` only guards anything once it is a **required
  check** on the default branch. On a genuinely clean slate the install is
  `refused` with a reason such as "folder not trusted" — say that plainly to
  the user, it is the expected outcome there, not a failure.
- **The settings file is merged, never replaced, and what it reports is passed on whole.** A repository that already had one keeps every key of its own. Our two keys and the pinned `ref` are created when absent and **reported, not overwritten**, when they carry another value — including a repository pinned at an older release, which is told with both versions named and moved only by a person. If it says the file could not be read as JSON, or that `node` was missing, say that too: neither is «the plugin is declared».
- Fill in the repository's real commands in `AGENTS.md` (build, test, lint, CI): for that, do explore the repository. **Do not touch** the loop's section beyond filling in its gaps, and **do not duplicate, rewrite or summarise the contract**: it lives in `docs/superpowers/SLICES-CONTRACT.md` on a fresh repository, or `docs/superpowers/CONTRATO-SLICES.md` on one that already had that legacy name — `/ct-init` maintains it under whichever name it finds, and it is only updated with `--update-slices-contract` when the user asks. An `AGENTS.md` bootstrapped with an earlier version carries the whole contract inside it: the scaffolder warns about that and does not touch it without that flag.
- The stdout block that begins with the literal `Yardstick candidates for this repo (deterministic sweep — it PROPOSES, it does not declare):` **is passed on to the user exactly as it is**, with its reasons and the `[skeleton: headings only]` marks (a skeleton declared today gives the judge an empty document that counts as a yardstick). In `.agent/conventions.md` write ONLY what the user confirms; if they confirm nothing, leave it with its placeholder.
- An `ATTENTION: this repo already had conventions of its own...` block on stderr (`[claim]`, `[worktrees]`, `[estado]`) is also passed on whole, with the evidence: choosing which one rules is the user's decision. Its outcome is a `señal: fecha — motivo` line in `.agent/conventions-ack.md`; tell them so, do not write it yourself.
- «No se ha podido comprobar» (no `node`) is not «there is nothing»: say that too.
- In `.agent/STATE.md` describe only the bootstrap: `task` `"Bootstrap Control Tower loop (ct-init)"`, `next_action` at `"(sin slice asignado)"`, `blocked` at `null`, `verify` empty. **Do not go looking for pending work**: the real `next_action` is seeded by `/ct-next` in the worktree's `.agent/SLICE.md`.
- If the repository is not registered in `control-tower/tower/workspaces.*.yaml`, say so; do not register it yourself.

Full reference —what each file seeds and why, the doctrine of the contract's versions and hashes, the `blocked` field, the acknowledgements—: `docs/loop/ct-init.md` in the plugin's repository.
