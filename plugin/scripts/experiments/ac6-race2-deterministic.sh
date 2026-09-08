#!/usr/bin/env bash
# T11 — DETERMINISTIC adversarial harness for AC6 (concurrent claim through
# labels). It is NOT part of `npm test`: it is a live experiment against a real
# GitHub repository (by default, `josemerca/ct-loop-sandbox`), meant to be run
# by hand. See task-11-report.md for the verdict and the raw output of the last
# run.
#
# What it builds: the exact interleaving that the original AC6 (T10, 14 rounds
# of 2 natural claimants) never reached, by construction of the scheduler:
#
#   1. LOW  collision check → clean (neither has written yet)
#   2. HIGH collision check → clean
#   3. HIGH writes status:in-progress + re-reads → sees only itself → exit 0
#   4. LOW  writes status:in-progress + re-reads → sees HIGH, but HIGH > LOW →
#      claimLost(LOW) == false (the tie-break only makes the HIGHER one lose)
#      → exit 0
#   → if both exit 0, it is a real double claim, not just "possible in theory".
#
# Mechanism: CT_CLAIM_PRECLAIM_DELAY_MS (a hook in dispatch-check.mjs, see the
# comment next to its definition) is set to CT_AC6_PRECLAIM_LOW_MS ONLY in LOW
# ("skew"), to force LOW to pass its collision check and then fall asleep while
# HIGH completes its whole cycle (write + readback + decision). HIGH uses
# CT_CLAIM_PRECLAIM_DELAY_MS=0 (the normal behaviour). No start-up barrier is
# needed here: as long as the skew is greater than HIGH's full cycle, the
# asymmetry of the timings dominates any bias of a few ms in launching the two
# processes in the background from bash.
#
# (fix round 2, T11 review — José's decision): this script no longer passes
# --settle-ms — that flag and the whole settling wait were withdrawn from
# dispatch-check.mjs. The reason is NOT that the settle was shown to add
# nothing (that has not been shown): it is that we do not want to mitigate a
# real race with a time window, whatever that window measures. What was
# measured (task-11-report.md §5): three skew points (500, 3000 and 8000ms)
# gave the same result against settle=0 and settle=2000; a fourth point,
# skew=1000, DID diverge (settle=0 → double claim 3/3; settle=2000 → no double
# claim 3/3) — n=1, not conclusive. The only knob left for reproducing the
# double claim is the skew of this very script.
#
# After each round the REAL INVARIANT is checked against GitHub (not the exit
# code, which is only what each process BELIEVES): at most one issue carrying
# the shared token may be in status:in-progress.
set -uo pipefail

REPO="${CT_AC6_REPO:-josemerca/ct-loop-sandbox}"
SCRIPT="$(cd "$(dirname "$0")/.." && pwd)/dispatch-check.mjs"
LOW="${CT_AC6_LOW:-3}"    # the LOWER-numbered issue — by construction it can never lose
HIGH="${CT_AC6_HIGH:-4}"  # the HIGHER-numbered issue — the only one claimLost() can make lose
TOKEN_LABEL="${CT_AC6_TOKEN_LABEL:-touches:t11}"
SCRATCH="$(cd "$(dirname "$0")" && pwd)"
RESULTS_DIR="$SCRATCH/race2-results"
mkdir -p "$RESULTS_DIR"
ROUNDS="${CT_AC6_ROUNDS:-3}"

# The skew must exceed HIGH's full cycle (collision check + write + readback,
# all of it with no artificial wait left in it). In practice, a few hundred ms
# of real network latency are already enough for that cycle — 8000ms leaves a
# generous margin.
PRECLAIM_LOW_MS="${CT_AC6_PRECLAIM_LOW_MS:-8000}"

# Exact comparison per label, not substring (fix round 1, Minor 3): a CSV of
# labels compared with `== *"status:in-progress"*` would give a false positive
# if some other label contained that string. It is compared element by element
# after splitting on the comma.
has_label() {
  local csv="$1" target="$2" IFS=','
  local l
  for l in $csv; do
    [[ "$l" == "$target" ]] && return 0
  done
  return 1
}

# Preflight (fix round 1, findings Important 2 and 3): without this, if the
# fixture (the LOW/HIGH issues, or the token label) does not exist — for example
# because an earlier run cleaned it up, as really happened in this task — the
# script went on in silence, with no shared token, and the result ("VIOLADO" or
# "OK") measured nothing about the lock: it measured a broken fixture. It is now
# impossible for an absent fixture to be read as a success or as a failure of
# the lock: it aborts noisily before the first round.
preflight() {
  echo "-- preflight --"
  if ! gh label create "$TOKEN_LABEL" --repo "$REPO" --color 5319e7 \
      --description "T11 AC6 harness — temporal" --force >/dev/null; then
    echo "FATAL: no se pudo crear/actualizar el label '$TOKEN_LABEL' en $REPO. Abortando sin correr ninguna ronda." >&2
    exit 1
  fi
  for n in "$LOW" "$HIGH"; do
    if ! gh issue view "$n" --repo "$REPO" --json number >/dev/null 2>&1; then
      echo "FATAL: el issue #$n (fixture LOW/HIGH) no existe en $REPO. Abortando sin correr ninguna ronda." >&2
      echo "       Ajusta CT_AC6_LOW/CT_AC6_HIGH a issues existentes, o recrea el fixture." >&2
      exit 1
    fi
  done
  echo "OK: label '$TOKEN_LABEL' listo, issues #$LOW y #$HIGH existen."
}

reset_pair() {
  gh issue edit "$LOW" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  gh issue edit "$HIGH" --repo "$REPO" \
    --remove-label status:in-progress --remove-label status:in-review --remove-label status:ready >/dev/null 2>&1 || true
  if ! gh issue edit "$LOW" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
    echo "FATAL: no se pudo poner #$LOW en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
    exit 1
  fi
  if ! gh issue edit "$HIGH" --repo "$REPO" --add-label status:ready --add-label "$TOKEN_LABEL" >/dev/null; then
    echo "FATAL: no se pudo poner #$HIGH en status:ready + $TOKEN_LABEL. Abortando (no se corre la ronda con un fixture a medias)." >&2
    exit 1
  fi
}

label_state() {
  gh issue view "$1" --repo "$REPO" --json labels -q '[.labels[].name] | join(",")'
}

run_round() {
  local round="$1"
  reset_pair
  echo "--- pre-round label state ---"
  echo "#$LOW: $(label_state "$LOW")"
  echo "#$HIGH: $(label_state "$HIGH")"

  local outlow="$RESULTS_DIR/round-${round}-skew${PRECLAIM_LOW_MS}-low.out"
  local outhigh="$RESULTS_DIR/round-${round}-skew${PRECLAIM_LOW_MS}-high.out"

  CT_CLAIM_PRECLAIM_DELAY_MS=$PRECLAIM_LOW_MS node "$SCRIPT" "$LOW" --repo "$REPO" >"$outlow" 2>&1 &
  PID_LOW=$!
  CT_CLAIM_PRECLAIM_DELAY_MS=0 node "$SCRIPT" "$HIGH" --repo "$REPO" >"$outhigh" 2>&1 &
  PID_HIGH=$!

  wait "$PID_LOW"; CODE_LOW=$?
  wait "$PID_HIGH"; CODE_HIGH=$?

  echo "=== round $round (skew=${PRECLAIM_LOW_MS}ms) ==="
  echo "-- LOW  #$LOW  exit=$CODE_LOW --"
  cat "$outlow"
  echo "-- HIGH #$HIGH exit=$CODE_HIGH --"
  cat "$outhigh"
  echo "-- real label state tras la ronda (fuente de verdad) --"
  local labels_low labels_high
  labels_low="$(label_state "$LOW")"
  labels_high="$(label_state "$HIGH")"
  echo "#$LOW: $labels_low"
  echo "#$HIGH: $labels_high"

  local n_inprogress=0
  has_label "$labels_low" "status:in-progress" && n_inprogress=$((n_inprogress+1))
  has_label "$labels_high" "status:in-progress" && n_inprogress=$((n_inprogress+1))
  echo "INVARIANTE (a lo sumo 1 in-progress con token compartido): in_progress_count=$n_inprogress $( [[ $n_inprogress -le 1 ]] && echo OK || echo VIOLADO )"
  if [[ "$CODE_LOW" -eq 0 && "$CODE_HIGH" -eq 0 ]]; then
    echo "DOBLE CLAIM POR EXIT CODE: ambos procesos exit 0"
  fi
  echo
}

preflight
for r in $(seq 1 "$ROUNDS"); do run_round "$r"; done
