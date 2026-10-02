#!/usr/bin/env node

import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const EXPERIMENTAL_NOTICE = 'Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.';
const ENDPOINT = 'https://api.imd.fun/requests/check';
const RUNS_PER_CASE = 5;
const MIN_INTERVAL_MS = 3_000;
const SPACING_BUFFER_MS = 50;
const MAX_CALLS = 200;
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = path.resolve(SCRIPT_DIR, '..');
const BODIES_FILE = path.join(ROOT_DIR, 'bodies', 'requests.json');
const RESULTS_DIR = path.join(ROOT_DIR, 'results');
const RESULTS_FILE = path.join(RESULTS_DIR, 'latest.json');

function help() {
  return `${EXPERIMENTAL_NOTICE}\n\nUsage: node scripts/check-consistency.mjs [--summarize-only]\n\nSends each of the 20 fixed cases in bodies/requests.json five times to:\n  ${ENDPOINT}\n\nCalls are sequential, with at least 3 seconds between request starts (100 calls total).\nRaw requests, responses, verdicts and agreement summaries replace results/latest.json.\nUse --summarize-only to recalculate analysis from saved responses without network calls.\nRequires Node.js 20 or newer. Uses built-in fetch; no dependencies.\n`;
}

function stableStringify(value) {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function blockerLabel(blocker) {
  if (typeof blocker === 'string') return blocker;
  if (blocker && typeof blocker === 'object' && !Array.isArray(blocker)) {
    if (typeof blocker.code === 'string') {
      return typeof blocker.fact === 'string' ? `${blocker.code}:${blocker.fact}` : blocker.code;
    }
    for (const key of ['id', 'code', 'key', 'type', 'blocker', 'reason']) {
      if (typeof blocker[key] === 'string') return blocker[key];
    }
  }
  return stableStringify(blocker);
}

function extractBlockers(response) {
  const blockers = response && typeof response === 'object' ? response.blockers : undefined;
  if (blockers == null) return [];
  const values = Array.isArray(blockers) ? blockers : [blockers];
  return [...new Set(values.map(blockerLabel))].sort();
}

function makeVerdict(record) {
  return {
    httpStatus: record.httpStatus,
    action: record.response?.action ?? record.action,
    kind: record.response?.kind ?? null,
    judged: record.response?.judged ?? null,
    blockers: extractBlockers(record.response),
    error: record.response?.error ?? null,
    detail: record.response?.detail ?? null,
    request: record.response?.request ?? null,
    transportError: record.transportError ?? null,
  };
}

function summarize(records, cases) {
  const perBody = [];
  for (const testCase of cases) {
    const bodyRecords = records.filter((record) => record.caseId === testCase.id);
    const verdictCounts = new Map();
    const seenByBlocker = new Map();

    for (const record of bodyRecords) {
      const verdict = makeVerdict(record);
      const key = stableStringify(verdict);
      const current = verdictCounts.get(key) ?? { verdict, count: 0 };
      current.count += 1;
      verdictCounts.set(key, current);

      for (const label of verdict.blockers) {
        seenByBlocker.set(label, (seenByBlocker.get(label) ?? 0) + 1);
      }
    }

    const verdictVariants = [...verdictCounts.values()].sort((a, b) => b.count - a.count || stableStringify(a.verdict).localeCompare(stableStringify(b.verdict)));
    const mode = verdictVariants[0] ?? { verdict: null, count: 0 };
    const blockerFlips = [...seenByBlocker.entries()]
      .filter(([, presentCount]) => presentCount > 0 && presentCount < bodyRecords.length)
      .map(([blocker, presentCount]) => ({ blocker, presentRuns: presentCount, absentRuns: bodyRecords.length - presentCount }));

    perBody.push({
      caseId: testCase.id,
      action: testCase.action,
      label: testCase.label,
      runCount: bodyRecords.length,
      agreementRate: bodyRecords.length ? mode.count / bodyRecords.length : 0,
      modalVerdict: mode.verdict,
      verdictVariants,
      blockerFlips,
    });
  }

  const actionGroups = new Map();
  for (const body of perBody) {
    const group = actionGroups.get(body.action) ?? [];
    group.push(body);
    actionGroups.set(body.action, group);
  }
  const perAction = [...actionGroups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([action, bodiesInAction]) => ({
    action,
    bodyCount: bodiesInAction.length,
    runCount: bodiesInAction.reduce((sum, body) => sum + body.runCount, 0),
    agreementRate: bodiesInAction.reduce((sum, body) => sum + body.agreementRate, 0) / bodiesInAction.length,
  }));

  return {
    agreementDefinition: 'For each body, modal verdict count divided by run count; a verdict is HTTP status, response action, sorted blockers, and transport error. Per-action rate is the unweighted mean of its body rates.',
    verdictDefinition: 'Suggestions and explanatory fields are retained in each raw response but excluded from the verdict score.',
    perBody,
    perAction,
  };
}

function validateCases(cases) {
  if (!Array.isArray(cases) || cases.length !== 20) {
    throw new Error(`Expected exactly 20 cases; found ${Array.isArray(cases) ? cases.length : 'no array'}.`);
  }
  const ids = new Set();
  for (const testCase of cases) {
    if (!testCase.id || ids.has(testCase.id)) throw new Error(`Missing or duplicate case id: ${testCase.id ?? '(empty)'}`);
    ids.add(testCase.id);
    if (!testCase.body || testCase.body.action !== testCase.action || !('input' in testCase.body)) {
      throw new Error(`Case ${testCase.id} must contain an {action, input} body matching its action metadata.`);
    }
  }
  const callCount = cases.length * RUNS_PER_CASE;
  if (callCount > MAX_CALLS) throw new Error(`Planned call count ${callCount} exceeds the hard limit ${MAX_CALLS}.`);
}

async function waitForSpacing(previousStart) {
  if (previousStart === null) return;
  const targetIntervalMs = MIN_INTERVAL_MS + SPACING_BUFFER_MS;
  while (true) {
    const remaining = targetIntervalMs - (performance.now() - previousStart);
    if (remaining <= 0) return;
    await new Promise((resolve) => setTimeout(resolve, Math.ceil(remaining) + 5));
  }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    process.stdout.write(help());
    return;
  }
  if (args.length === 1 && args[0] === '--summarize-only') {
    const output = JSON.parse(await readFile(RESULTS_FILE, 'utf8'));
    for (const record of output.records) record.verdict = makeVerdict(record);
    output.summary = summarize(output.records, output.cases);
    output.run.minimumObservedIntervalMs = Math.min(...output.records.slice(1).map((record) => record.intervalFromPreviousStartMs));
    await writeFile(RESULTS_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
    process.stdout.write(`Updated verdict normalization and summary in ${path.relative(ROOT_DIR, RESULTS_FILE)}; no network calls made.\n`);
    return;
  }
  if (args.length) {
    process.stderr.write(`Unknown argument: ${args[0]}\n\n${help()}`);
    process.exitCode = 2;
    return;
  }
  if (Number(process.versions.node.split('.')[0]) < 20) {
    throw new Error('Node.js 20 or newer is required for built-in fetch.');
  }

  const dataset = JSON.parse(await readFile(BODIES_FILE, 'utf8'));
  validateCases(dataset.cases);

  const plannedCallCount = dataset.cases.length * RUNS_PER_CASE;
  const runStartedAt = new Date().toISOString();
  const runMonotonicStart = performance.now();
  const runId = runStartedAt.replace(/[-:.]/g, '');
  const records = [];
  let previousStart = null;

  process.stdout.write(`Running ${dataset.cases.length} cases × ${RUNS_PER_CASE} runs = ${plannedCallCount} calls. Minimum spacing: ${MIN_INTERVAL_MS} ms.\n`);

  for (let caseIndex = 0; caseIndex < dataset.cases.length; caseIndex += 1) {
    const testCase = dataset.cases[caseIndex];
    for (let attempt = 1; attempt <= RUNS_PER_CASE; attempt += 1) {
      await waitForSpacing(previousStart);
      const callStartClock = performance.now();
      const intervalFromPreviousStartMs = previousStart === null ? null : Math.round(callStartClock - previousStart);
      previousStart = callStartClock;
      const startedAt = new Date().toISOString();
      const startedClock = callStartClock;
      const record = {
        sequence: records.length + 1,
        caseId: testCase.id,
        action: testCase.action,
        attempt,
        startedAt,
        startOffsetMs: Math.round(callStartClock - runMonotonicStart),
        intervalFromPreviousStartMs,
        request: testCase.body,
      };

      try {
        const response = await fetch(ENDPOINT, {
          method: 'POST',
          headers: { 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify(testCase.body),
          signal: AbortSignal.timeout(30_000),
        });
        const rawBody = await response.text();
        let parsedBody = null;
        try {
          parsedBody = JSON.parse(rawBody);
        } catch {
          // Preserve non-JSON response bytes in rawBody for inspection.
        }
        record.httpStatus = response.status;
        record.responseHeaders = Object.fromEntries(response.headers.entries());
        record.rawBody = rawBody;
        record.response = parsedBody;
      } catch (error) {
        record.httpStatus = null;
        record.responseHeaders = {};
        record.rawBody = null;
        record.response = null;
        record.transportError = `${error.name}: ${error.message}`;
      }

      record.finishedAt = new Date().toISOString();
      record.elapsedMs = Math.round(performance.now() - startedClock);
      record.verdict = makeVerdict(record);
      records.push(record);
      process.stdout.write(`\r${String(records.length).padStart(3)}/${plannedCallCount} calls · ${testCase.id} run ${attempt}/5${records.length === plannedCallCount ? '\n' : ''}`);
    }
  }

  await mkdir(RESULTS_DIR, { recursive: true });
  const output = {
    schemaVersion: 1,
    run: {
      id: runId,
      startedAt: runStartedAt,
      finishedAt: new Date().toISOString(),
      endpoint: ENDPOINT,
      method: 'POST',
      caseCount: dataset.cases.length,
      runsPerCase: RUNS_PER_CASE,
      callCount: records.length,
      maxCallBudget: MAX_CALLS,
      minIntervalMs: MIN_INTERVAL_MS,
      minimumObservedIntervalMs: Math.min(...records.slice(1).map((record) => record.intervalFromPreviousStartMs)),
      order: 'case order in bodies/requests.json; five sequential attempts per case',
    },
    cases: dataset.cases,
    records,
    summary: summarize(records, dataset.cases),
  };
  await writeFile(RESULTS_FILE, `${JSON.stringify(output, null, 2)}\n`, 'utf8');
  process.stdout.write(`\nSaved ${records.length} records to ${path.relative(ROOT_DIR, RESULTS_FILE)}.\n`);
}

main().catch((error) => {
  process.stderr.write(`${error.stack ?? error}\n`);
  process.exitCode = 1;
});
