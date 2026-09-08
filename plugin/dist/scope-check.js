#!/usr/bin/env node
import { createRequire } from 'node:module'; const require = createRequire(import.meta.url);

// scripts/scope-check-cli.js
import { execFileSync } from "node:child_process";

// scripts/closing-keywords.js
var CLOSING_KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved"
];
var CLOSING_RE = new RegExp(
  String.raw`\b(${CLOSING_KEYWORDS.join("|")})\b\s{0,10}:?\s{0,10}(#\d+|[A-Za-z0-9._-]+\/[A-Za-z0-9._-]+#\d+)`,
  "gi"
);
function findClosingKeywords(text) {
  const src = typeof text === "string" ? text : "";
  const out = [];
  for (const m of src.matchAll(CLOSING_RE)) out.push({ keyword: m[1], ref: m[2] });
  return out;
}

// scripts/scope.js
var SECTION_HEADING = /^##\s+Contexto del epic\s*$/i;
var ANY_HEADING = /^#{1,6}\s+/;
var SCOPE_LINE = /^\s*[-*]?\s*\**\s*Alcance\s*\**\s*:\s*(.*)$/i;
var LOOP_ARTIFACT_PATTERNS = [
  // The kickoff ORDERS the slice's plan to be written here and committed.
  "docs/superpowers/plans/**",
  // The brainstorming skill writes the design doc and the execution spec here,
  // and the slice fills in the spec's «Registro de cierre (evidencia)» on
  // delivering.
  //
  // A LIMIT THAT HAS TO BE SAID OUT LOUD: this exemption lets the agent write
  // into the FROZEN spec without the gate seeing it — and in the incident of
  // dispatch 1 the agent put part of its false authorisation in there. The gate
  // cannot cover it: it does not judge prose, it judges files. The immutability
  // of the spec's frozen sections is a DIFFERENT check and it is unbuilt.
  "docs/superpowers/specs/**",
  // `ct-step verdict` writes the judge's verdict here when the ruling is PASS,
  // stages it and leaves it INSIDE the task's commit, because the verdict has
  // to travel in the pull request (F37's closure criterion: «el PR de un slice
  // trae un veredicto emitido por un agente que no ejecutó nada»). The
  // implementer does not choose that write and cannot avoid it, so without this
  // exemption the gate goes red in ANY epic that declares its `Alcance:` line
  // and asks for something impossible —«either the work leaves the PR, or the
  // epic's scope changes»—, which is F14's unsatisfiable wall all over again.
  "docs/superpowers/verdicts/**",
  // The run's telemetry: one row per attempt of every step of every task. The
  // loop writes it, not the implementer, and for the same reason as the verdict
  // it is going to stop living only on the disk of whoever wrote it and start
  // travelling in the pull request. The exemption is put in BEFORE that write
  // arrives on purpose: the other way round, the first slice that produces it
  // comes out red over a file of the loop's, and whoever reads the gate will not
  // be able to tell whether the red was put there by the agent or by the
  // machinery.
  "docs/superpowers/metrics/**",
  // `ct-step e2e` WRITES the journey's report here and stages it, so it
  // travels in the slice's commit. Its OWN directory and not the spec's
  // «Registro de cierre» on purpose: that exemption (specs/**, above) is the
  // hole through which, in the incident of dispatch 1, an agent put part of its
  // false authorisation — and putting precisely the evidence that something was
  // verified through there is the worst possible combination. Nobody else writes
  // here.
  "docs/superpowers/e2e/**"
];
function normalizePath(p) {
  return String(p || "").replace(/^\.\//, "").replace(/^\/+/, "");
}
function parseScope(issueBody2) {
  const texto = typeof issueBody2 === "string" ? issueBody2 : "";
  const lineas = texto.split(/\r?\n/);
  let dentro = false;
  const patterns = [];
  for (const linea of lineas) {
    if (SECTION_HEADING.test(linea)) {
      dentro = true;
      continue;
    }
    if (dentro && ANY_HEADING.test(linea)) break;
    if (!dentro) continue;
    const m = linea.match(SCOPE_LINE);
    if (!m) continue;
    const valor = m[1].replace(/^\*\*(?=\s)/, "");
    for (const trozo of valor.split(",")) {
      const limpio = trozo.replace(/`/g, "").trim();
      if (limpio) patterns.push(limpio);
    }
  }
  if (!patterns.length) {
    return {
      declared: false,
      patterns: [],
      reason: "el epic no declara `Alcance:` en su secci\xF3n `## Contexto del epic` \u2014 sin alcance declarado el gate no puede comprobar nada, y no poder comprobar NO es estar limpio"
    };
  }
  return { declared: true, patterns, reason: null };
}
function matchesPattern(path, pattern) {
  const p = normalizePath(path);
  let pat = normalizePath(pattern);
  if (!pat) return false;
  if (pat.endsWith("/")) pat = `${pat}**`;
  let re = "^";
  for (let i = 0; i < pat.length; i += 1) {
    const c = pat[i];
    if (c === "*") {
      if (pat[i + 1] === "*") {
        if (pat[i + 2] === "/") {
          re += "(?:.*/)?";
          i += 2;
        } else {
          re += ".*";
          i += 1;
        }
      } else {
        re += "[^/]*";
      }
    } else {
      re += c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    }
  }
  re += "$";
  return new RegExp(re).test(p);
}
function scopeViolations(files, patterns, extraExempt = []) {
  const pats = Array.isArray(patterns) ? patterns.filter(Boolean) : [];
  const exentos = [...LOOP_ARTIFACT_PATTERNS, ...Array.isArray(extraExempt) ? extraExempt.filter(Boolean) : []];
  return (files || []).map(normalizePath).filter((f) => f).filter((f) => !exentos.some((pat) => matchesPattern(f, pat))).filter((f) => !pats.some((pat) => matchesPattern(f, pat)));
}
function isSliceBranch(name) {
  return /^feat\/\d+$/.test(String(name || "").trim());
}
function issueFromPrBody(prBody) {
  const encontrados = findClosingKeywords(typeof prBody === "string" ? prBody : "");
  const numeros = /* @__PURE__ */ new Set();
  for (const { ref } of encontrados) {
    const m = String(ref).match(/#(\d+)$/);
    if (m) numeros.add(Number(m[1]));
  }
  if (numeros.size !== 1) return null;
  return [...numeros][0];
}

// scripts/scope-check-cli.js
var arg = (f) => {
  const i = process.argv.indexOf(f);
  if (i === -1) return void 0;
  const v = process.argv[i + 1];
  return typeof v === "string" && !v.startsWith("--") ? v : true;
};
var usage = "uso: scope-check --repo <owner/repo> --pr <n\xFAmero> [--exempt <patr\xF3n,patr\xF3n>]";
var repo = arg("--repo");
var pr = arg("--pr");
var exemptRaw = arg("--exempt");
var exempt = typeof exemptRaw === "string" ? exemptRaw.split(",").map((s) => s.trim()).filter(Boolean) : [];
if (typeof repo !== "string" || typeof pr !== "string" || !/^\d+$/.test(pr)) {
  console.error(usage);
  process.exit(2);
}
var gh = (a) => execFileSync("gh", a, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 20 * 1024 * 1024, timeout: 5 * 60 * 1e3, killSignal: "SIGKILL" });
function morir(mensaje, detalle) {
  console.error(`\u{1F6D1} scope-check: ${mensaje}`);
  if (detalle) console.error(`   ${detalle}`);
  process.exit(1);
}
var prData;
try {
  prData = JSON.parse(gh(["pr", "view", pr, "--repo", repo, "--json", "body,files,headRefName"]));
} catch (e) {
  morir(`no se pudo leer el PR #${pr} de ${repo}`, (e.stderr || e.message || "").toString().trim());
}
var issueN = issueFromPrBody(prData.body);
if (!issueN) {
  if (isSliceBranch(prData.headRefName)) {
    morir(
      `el PR #${pr} viene de la rama de slice \`${prData.headRefName}\` pero no declara un \xFAnico issue con una closing keyword en su CUERPO`,
      "A\xF1ade `Closes #<issue>` al cuerpo del PR (no al t\xEDtulo, no en un comentario). Sin \xE9l, adem\xE1s, el issue no se cierra al mergear y el slice retiene sus tokens de `area:`/`touches:` para siempre."
    );
  }
  console.log(`\u2705 scope-check: el PR #${pr} no es un slice del loop (rama \`${prData.headRefName}\`, sin closing keyword). No hay alcance de epic que comprobar.`);
  process.exit(0);
}
var issueBody;
try {
  issueBody = JSON.parse(gh(["issue", "view", String(issueN), "--repo", repo, "--json", "body"])).body;
} catch (e) {
  morir(`no se pudo leer el issue #${issueN} de ${repo}`, (e.stderr || e.message || "").toString().trim());
}
var alcance = parseScope(issueBody);
if (!alcance.declared) {
  morir(
    `el epic del issue #${issueN} no declara alcance`,
    `${alcance.reason}. A\xF1ade una l\xEDnea \`Alcance: <rutas>\` a la secci\xF3n \`## Contexto del epic\` del execution spec y re-groomea (o edita el issue). Se declara UNA vez por epic, en la congelaci\xF3n.`
  );
}
var ficheros = (prData.files || []).map((f) => f.path);
var violaciones = scopeViolations(ficheros, alcance.patterns, exempt);
if (violaciones.length) {
  console.error(`\u{1F6D1} scope-check: el PR #${pr} toca ${violaciones.length} fichero(s) FUERA del alcance declarado por su epic (issue #${issueN}).`);
  console.error("");
  console.error("   Alcance declarado:");
  for (const p of alcance.patterns) console.error(`     \u2713 ${p}`);
  console.error("");
  console.error("   Fuera de alcance:");
  for (const f of violaciones) console.error(`     \u2717 ${f}`);
  console.error("");
  console.error("   Esto NO se arregla editando el registro del PR. O el trabajo sale del PR,");
  console.error("   o el alcance del epic cambia \u2014 y cambiar el alcance de un epic congelado es");
  console.error("   una decisi\xF3n humana, no del agente.");
  process.exit(1);
}
console.log(`\u2705 scope-check: los ${ficheros.length} fichero(s) del PR #${pr} caben en el alcance del epic (issue #${issueN}).`);
process.exit(0);
