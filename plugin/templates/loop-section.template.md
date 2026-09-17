<!-- ct-init:loop -->
## Control Tower loop

This repo is governed by the Control Tower loop: **one issue = one slice = one session**.

- **This repo's commands** (fill them in once): build `…` · test `…` · lint `…`.
- **This repo's yardstick** —the documents of code rules that `ct-step`
  pastes into every task's brief— is declared in `.agent/conventions.md`. ct's
  own yardstick travels with the plugin and rules where the two say the same
  thing; where ct says nothing, the repo's yardstick rules in full.
- **A dispatched slice's state is `.agent/SLICE.md`**, its OWN worktree's
  (ignored by git, never product). `.agent/STATE.md` is the main checkout's
  coordinating session's, and a slice does not touch it. If you get stuck,
  write `blocked: {reason, unblock}` in your `SLICE.md` and STOP.
- **Each slice works in `.worktrees/<n>` on `feat/<n>`**, and its claim
  (`status:ready` → `status:in-progress`) is done by `/ct-next` in code: do not
  move those labels by hand. When opening the PR, put `Closes #N` in the body.
- **What does not reach the issue's body does not reach the agent**: it does not receive the spec.
- **The slices table format —the contract with `/ct-groom`— lives in
  [`docs/superpowers/CONTRATO_BASENAME_PLACEHOLDER`](docs/superpowers/CONTRATO_BASENAME_PLACEHOLDER)**:
  which columns it reads, what each one generates, and what `/ct-next` does with them. It is
  what whoever writes a spec for this repo reads. `/ct-init` maintains it, it carries its
  own version, and it is not edited by hand.
- **How to bring this repo up** to walk it end to end: the section
  «Cómo se atraviesa este repo (e2e)», below. Fill it in once.
<!-- /ct-init:loop -->
