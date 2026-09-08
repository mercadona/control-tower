# <Epic name> — Execution spec

**Handoff origen:** `docs/superpowers/specs/YYYY-MM-DD-<topic>-design.md`
**Fecha de congelación:** —
**Estado:** DRAFT

## Hipótesis del experimento

**The bet:** <what we believe will happen if we build this, falsifiable and
measurable — with no bet there is no epic and the groom rejects the spec>.

**How we will know it failed:** <the observable condition that knocks the bet
down>.

**Anti-scope — what this epic does NOT do:** <an explicit list of what stays
out, so that no agent "throws it in">.

## Decisiones congeladas

<!-- Every decision carries an ID (D-1, D-2…) and its provenance:
     - hablada: the user said it — quote their literal phrase where possible
     - deducida: it follows from something spoken — say from what
     - propuesta: the writer's idea — a propuesta is NEVER frozen: you ask the
       user, or you park it under «Decisiones aparcadas»

     Gaps are NOT filled in by eye: they are flagged with the clarification
     marker, which is the words NEEDS CLARIFICATION inside square brackets
     (opening bracket flush against the N). It is deliberately not written
     literally here: `/ct-groom` looks for it by grep over the WHOLE file,
     comments included and with no exception (`analyzeSpecFreeze`,
     scripts/groom.js), so a literal example in this template would knock down
     with exit 2 the groom of any spec that copied it without deleting this
     block.

     Freezing with a pending marker is invalid (exit 2). -->

- **D-1 · <Topic>** — <the decision, in one or two sentences>. *(Procedencia:
  hablada — «<literal quote>».)*
- **D-2 · <Topic>** — <the decision>. *(Procedencia: deducida de D-1.)*

## Enfoque técnico

<Short paragraph(s): the build order, which module is the heart, which areas
there are and why the slices serialize or not. This is not the plan — it is the
rationale that each slice's plan needs and cannot deduce.>

<!-- INSTRUCTIONS FOR «Contexto del epic» — deliberately OUTSIDE the section.
     Everything left INSIDE that section is copied, byte by byte, into the body
     of every issue of the epic: a multi-line comment placed in there is NOT
     discarded, it travels verbatim to the N issues (verified with
     `readEpicContext`). That is why these instructions live up here.

     The groom's hard rules for the content of that section:
     - bullets, bold text and PROPERLY CLOSED code fences only
     - no ### headings or lower inside (they truncate the section)
     - no single-line HTML comments (they truncate the section)
     - no unclosed fence or comment (it swallows the rest of the spec, the
       slices table included)
     Typical content: stack, repo conventions, calculation rules, invariants
     that EVERY slice must respect. -->

## Contexto del epic

- Stack: <language, frameworks, versions>.
- <Cross-cutting invariant 1>.
- <Cross-cutting invariant 2>.

## Tabla de slices

<!-- THE FULL CONTRACT OF THIS TABLE lives in `docs/superpowers/CONTRATO-SLICES.md`
     in this very repo (/ct-init seeds it and versions it): which columns
     /ct-groom reads, what each one generates, what aborts and what /ct-next
     does with whatever you write here. Read it before filling in the table —
     the summary below is a reminder of the traps, not the contract.

     Table contract v18 (/ct-groom validates it, exit != 0 if it fails):
     - Issue title = "#N <Slice>": short and readable, not a sentence.
     - Tipo: ui | backend | infra | bugfix (it decides the agent's addendum;
       ui implies a visual gate, infra implies an apply gate).
     - Dep: "#N" is the slice's ORDER in this table, not an issue number.
     - Acepta: the comma ALWAYS separates criteria; a literal comma inside a
       criterion is escaped as \,
     - Protegido: free text, what the slice may NOT touch.
     - Área/Toca: comma-separated tokens; they drive collision and
       serialization between slices (migration, ci and pbxproj serialize).
     - Gate: only to deviate from the Tipo's default — add (visual, apply) or
       waive (!visual). Empty or – = no declaration.
     - "No value" = – (any dash variant) or an empty cell. -->

| # | Slice | Tipo | Entrega | Dep | Acepta | Protegido | Área | Toca | Gate |
|---|-------|------|---------|-----|--------|-----------|------|------|------|
| 1 | <short name> | backend | <what it delivers, one sentence> | – | <criterion 1>, <criterion 2> | <what it does not touch> | <area> | – | – |
| 2 | <short name> | backend | <what it delivers> | #1 | <criteria> | – | <area> | – | – |

## Decisiones aparcadas (BLOCKED)

| ID | Fila | Qué falta decidir | Opciones vistas | Estado |
|----|------|-------------------|-----------------|--------|

*(Empty at freeze time is valid. This is where the unresolved «propuesta» go,
along with the future explicitly discarded, in case it is picked up again.)*

## Registro de cierre (evidencia)

| Slice | specReviewedSha | codeReviewedSha | uiScreenshot | Gate cerrado con |
|-------|-----------------|-----------------|--------------|------------------|
