#!/usr/bin/env bash
# T11 — STOCHASTIC arm of the AC6 adversarial harness: 8 real claimants over
# the same shared token, released by a real start-up barrier (FIFO, the T9
# technique — see task-9-report.md, section "mecanismo de barrera") instead of
# `sleep`, with start-up jitter. It is NOT part of `npm test`: a live
# experiment against a real GitHub repository.
#
# Unlike ac6-race2-deterministic.sh, this arm does NOT use the
# CT_CLAIM_PRECLAIM_DELAY_MS hook: here real network latency and the OS
# scheduler are left to produce (or not) the double claim by themselves, with 8
# runners instead of 2, to maximise the probability of an overlap against T10's
# 14 rounds of 2 runners that never saw one.
#
# Self-contained fixture (fix round 1, T11 review): by default (without
# CT_AC6_ISSUES) the script itself creates N disposable issues at start-up and
# DELETES them at the end (success, failure or Ctrl-C, via `trap ... EXIT`) — it
# never depends on issue numbers pinned by hand in an earlier session, which is
# exactly what broke last time (the #5-#12 fixture was deleted when the sandbox
# was cleaned and the script went on "working" against a non-existent fixture,
# reading 0 for everything and reporting `in_progress_count=0 OK` — a vacuous
# pass). If CT_AC6_ISSUES is passed by hand, the preflight verifies that every
# issue exists and aborts noisily if not.
#
# After every round the REAL INVARIANT is checked against GitHub (not the exit
# code): at most one issue THAT CARRIES THE SHARED TOKEN may be in
# status:in-progress (fix round 1, finding Important 3: before, in-progress was
# counted without requiring the token, so it was in fact measuring nothing about
# the shared token).
#
# (fix round 2, T11 review — José's decision): this script no longer passes
# --settle-ms — that flag and the whole settling wait were withdrawn from
# dispatch-check.mjs (see that file's header comment). There are no longer two
# arms to compare here, just N rounds.
set -uo pipefail

REPO="${CT_AC6_REPO:-josemerca/ct-loop-sandbox}"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/dispatch-check.mjs"
TOKEN_LABEL="${CT_AC6_TOKEN_LABEL:-touches:t11-stoch}"
N_DEFAULT=8
ROUNDS="${CT_AC6_ROUNDS:-3}"
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRATCH/race8-results"
mkdir -p "$RESULTS_DIR"

AUTO_ISSUES=0
if [[ -z "${CT_AC6_ISSUES:-}" ]]; then
  AUTO_ISSUES=1
  ISSUES=()
else
  read -ra ISSUES <<< "$CT_AC6_ISSUES"
fi

# Exact comparison by label, not substring (fix round 1, Minor 3).
has_label() {
  local csv="$1" target="$2" IFS=','
  local l
  for l in $csv; do
    [[ "$l" == "$target" ]] && return 0
  done
  return 1
}

cleanup_auto_issues() {
  [[ "$AUTO_ISSUES" -eq 1 ]] || return 0
  [[ "${#ISSUES[@]}" -eq 0 ]] && return 0
  echo "-- cleanup: borrando los ${#ISSUES[@]} issues desechables creados por este run --"
  for n in "${ISSUES[@]}"; do
    local node_id
    node_id="$(gh issue view "$n" --repo "$REPO" --json id -q .id 2>/dev/null || true)"
    if [[ -n "$node_id" ]]; then
      gh api graphql -f query='mutation($id: ID!) { deleteIssue(input: {issueId: $id}) { clientMutationId } }' -f id="$node_id" >/dev/null 2>&1 \
        && echo "   #$n borrado" \
        || echo "   ATENCIÓN: no se pudo borrar #$n — bórralo a mano (gh issue view/delete vía GraphQL) en $REPO" >&2
    fi
  done
}
trap cleanup_auto_issues EXIT

# Preflight (fix round 1, findings Important 2 and 3): it creates the token's
# label idempotently (--force) and either creates the disposable fixture or
# verifies the one it was handed — IT ABORTS NOISILY if anything is missing,
# instead of going on with a broken fixture that would produce a "pass" meaning
# nothing (the real bug observed last time).
preflight() {
  echo "-- preflight --"
  if ! gh label create "$TOKEN_LABEL" --repo "$REPO" --color 5319e7 \
      --description "T11 AC6 harness estocástico — temporal" --force >/dev/null; then
    echo "FATAL: no se pudo crear/actualizar el label '$TOKEN_LABEL' en $REPO. Abortando sin correr ninguna ronda." >&2
    exit 1
  fi

  if [[ "$AUTO_ISSUES" -eq 1 ]]; then
    echo "creando $N_DEFAULT issues desechables en $REPO..."
    for i in $(seq 1 "$N_DEFAULT"); do
      local url num
      url="$(gh issue create --repo "$REPO" \
        --title "T11 race8 disposable (auto) #$i" \
        --body "Creado automáticamente por scripts/experiments/ac6-race8-stochastic.sh. Se borra al terminar el run (trap EXIT). Si sobrevive, algo interrumpió el script antes del cleanup — seguro de borrar a mano." \
        2>/dev/null)" || { echo "FATAL: no se pudo crear el issue desechable #$i en $REPO. Abortando." >&2; exit 1; }
      num="${url##*/}"
      ISSUES+=("$num")
    done
    echo "OK: fixture creado: ${ISSUES[*]}"
  else
    for n in "${ISSUES[@]}"; do
      if ! gh issue view "$n" --repo "$REPO" --json number >/dev/null 2>&1; then
        echo "FATAL: el issue #$n (CT_AC6_ISSUES) no existe en $REPO. Abortando sin correr ninguna ronda." >&2
        exit 1
      fi
    done
    echo "OK: label '$TOKEN_LABEL' listo, los ${#ISSUES[@]} issues de CT_AC6_ISSUES existen: ${ISSUES[*]}"
  fi
  N=${#ISSUES[@]}
}

reset_all() {
  for n in "${ISSUES[@]}"; do
    gh issue edit "$n" --repo "$REPO" --remove-label status:in-progress --remove-label status:in-review >/dev/null 2>&1 || true
    if ! gh issue edit "$n" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
      echo "FATAL: no se pudo poner #$n en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
      exit 1
    fi
  done
}

run_round() {
  local round="$1"
  reset_all

  local FIFO="$RESULTS_DIR/barrier-${round}.fifo"
  local TIMING="$RESULTS_DIR/timing-${round}.txt"
  rm -f "$FIFO" "$TIMING"
  mkfifo "$FIFO"
  exec 3<>"$FIFO"

  PIDS=()
  for n in "${ISSUES[@]}"; do
    (
      read -r -n 1 -u 3 _
      # Real start-up jitter (not the delay hook): 0-80ms, it simulates that in
      # the real world 8 runners do not start on the exact same CPU tick even
      # though they share the same trigger signal.
      jitter_ms=$(( RANDOM % 80 ))
      python3 -c "import time; time.sleep($jitter_ms/1000)"
      out="$RESULTS_DIR/round-${round}-issue${n}.out"
      t0=$(python3 -c 'import time; print(int(time.time()*1000))')
      node "$SCRIPT" "$n" --repo "$REPO" >"$out" 2>&1
      code=$?
      t1=$(python3 -c 'import time; print(int(time.time()*1000))')
      echo "$n $code $t0 $t1 jitter=${jitter_ms}ms" >> "$TIMING"
    ) &
    PIDS+=($!)
  done

  sleep 0.3
  head -c "$N" /dev/zero | tr '\0' 'X' >&3
  wait "${PIDS[@]}"
  exec 3>&-

  echo "=== round $round (N=$N) — timing crudo (issue code T0_ms T1_ms jitter) ==="
  sort -k1,1n "$TIMING"

  echo "-- overlap check (pares [T0,T1] que se solapan realmente) --"
  python3 - "$TIMING" <<'PYEOF'
import sys, itertools
rows = []
with open(sys.argv[1]) as f:
    for line in f:
        parts = line.split()
        n, code, t0, t1 = int(parts[0]), int(parts[1]), int(parts[2]), int(parts[3])
        rows.append((n, code, t0, t1))
overlap = 0
total = 0
for a, b in itertools.combinations(rows, 2):
    total += 1
    if max(a[2], b[2]) < min(a[3], b[3]):
        overlap += 1
spread = max(r[2] for r in rows) - min(r[2] for r in rows)
print(f"T0_spread_ms={spread} overlapping_pairs={overlap}/{total} exit0_count={sum(1 for r in rows if r[1]==0)}")
PYEOF

  echo "-- outputs por issue --"
  for n in "${ISSUES[@]}"; do
    echo "-- issue #$n --"
    cat "$RESULTS_DIR/round-${round}-issue${n}.out"
  done

  echo "-- real label state tras la ronda (fuente de verdad) --"
  local inprog=0
  for n in "${ISSUES[@]}"; do
    local labels
    labels="$(gh issue view "$n" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")')"
    echo "#$n: $labels"
    # It requires BOTH: status:in-progress AND the shared token (fix round 1,
    # finding Important 3) — counting in-progress without the token checks
    # nothing about the experiment's premise (the shared token).
    if has_label "$labels" "status:in-progress" && has_label "$labels" "$TOKEN_LABEL"; then
      inprog=$((inprog+1))
    fi
  done
  echo "INVARIANTE (a lo sumo 1 in-progress CON $TOKEN_LABEL): in_progress_count=$inprog $( [[ $inprog -le 1 ]] && echo OK || echo VIOLADO )"
  echo
}

preflight
for r in $(seq 1 "$ROUNDS"); do run_round "$r"; done
