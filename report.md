Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.

# IMD free request evaluator consistency report

## Run

The published dataset is the final run on **2026-10-02 UTC**, from **18:40:56 to 18:45:54**. It sent the 20 fixed cases in [`bodies/requests.json`](bodies/requests.json) to `POST https://api.imd.fun/requests/check` five times each: **100 calls**. The worker could reach the endpoint. All 100 replies were received: 95 HTTP 200 and 5 HTTP 400; there were no transport failures. The five 400 responses were the continuation example's literal `PARENT_JOB_ID` placeholder failing UUID validation.

The runner records the raw response body, parsed response, HTTP status, request, attempt, and normalized verdict for every call in [`results/latest.json`](results/latest.json). It scores a verdict by HTTP status, action, kind, judged flag, blocker codes (including fact IDs), validation error and detail, and a drafted oracle request when present. Suggestions and prose details are retained in raw results but excluded from the agreement score.

Agreement is the share of five runs matching the modal verdict for a body. Action agreement is the unweighted mean of that action's body rates. On this definition, 18 of 20 bodies were unanimous, one had 3/5 modal agreement, and one had 3/5 modal agreement after preserving blocker fact IDs. The overall mean across bodies was 96%.

The final run logged start intervals of 2,999–3,004 ms at millisecond precision. The runner now waits for 3,050 ms between monotonic start samples and checks the interval again after waking, adding room for timer granularity. The captured run used the same sequential 3-second wait without that buffer; the 2,999 ms sample means its log does not establish that every dispatch cleared 3.000 seconds. A strict-spacing rerun would require another 100 calls, but the assignment's 200 evaluator-call budget was used: an earlier 100-call schema-shape pass was superseded by this corrected final batch. Only the final batch is published in `results/latest.json`.

## Agreement by body

| Case | Action | Agreement | Modal result |
| --- | --- | ---: | --- |
| `job-report-doc-example` | `job.open` | 100% | no blockers |
| `job-audit-doc-example` | `job.open` | 100% | `not_found` |
| `job-continue-doc-example` | `job.continue` | 100% | HTTP 400 `invalid_request` (`PARENT_JOB_ID` is not a UUID) |
| `launch-tip-vault-variant` | `launch.open` | 100% | `launch_requires_review` |
| `workflow-tip-vault-doc-example` | `workflow.open` | 100% | no blockers |
| `workflow-tip-jar-doc-example` | `workflow.open` | 100% | no blockers |
| `oracle-release-doc-example` | `oracle.request` | 100% | no blockers |
| `oracle-burn-doc-example` | `oracle.request` | 100% | `ambiguous_question` |
| `oracle-agent-count-doc-example` | `oracle.request` | 100% | `ambiguous_question` |
| `oracle-v4-price-doc-example` | `oracle.request` | 100% | `ambiguous_question` |
| `oracle-v4-volume-doc-example` | `oracle.request` | 60% | modal blocker `ambiguous_question`; absent in 2 runs |
| `schedule-daily-weth-doc-example` | `schedule.create` | 100% | no blockers |
| `schedule-weekly-digest-doc-example` | `schedule.create` | 100% | no blockers |
| `schedule-topup-doc-example` | `schedule.topup` | 100% | `invalid_input` (`SCHEDULE_ID` is not a UUID) |
| `job-report-short-variant` | `job.open` | 100% | no blockers |
| `job-audit-scope-variant` | `job.open` | 100% | `not_found` |
| `launch-tip-jar-variant` | `launch.open` | 100% | `bad_path_count`, `missing_fact` |
| `workflow-tip-vault-short-variant` | `workflow.open` | 60% | `missing_fact:token_name` and `missing_fact:token_symbol` in the modal verdict |
| `oracle-release-date-variant` | `oracle.request` | 100% | no blockers |
| `schedule-one-run-variant` | `schedule.create` | 100% | no blockers |

## Agreement by action

| Action | Bodies | Calls | Mean body agreement |
| --- | ---: | ---: | ---: |
| `job.continue` | 1 | 5 | 100% |
| `job.open` | 4 | 20 | 100% |
| `launch.open` | 2 | 10 | 100% |
| `oracle.request` | 6 | 30 | 93.3% |
| `schedule.create` | 3 | 15 | 100% |
| `schedule.topup` | 1 | 5 | 100% |
| `workflow.open` | 3 | 15 | 86.7% |

## Blockers that changed

- `oracle-v4-volume-doc-example`: `ambiguous_question` appeared in runs 1–3 and was absent in runs 4–5. The drafted request was otherwise identical; the two unblocked responses moved the wording concern to a `wording` suggestion.
- `workflow-tip-vault-short-variant`: `evaluation_unavailable` appeared only in run 1. `missing_fact:token_symbol` appeared in four runs and was absent in run 2; `missing_fact:token_name` appeared in all five. The single unavailable-evaluation response also contained both missing-fact blockers.

The other bodies had stable blocker sets. The stable `not_found` and invalid-input results come from documentation placeholders (`owner/repo`, `PARENT_JOB_ID`, and `SCHEDULE_ID`), so they are useful as validation checks but not as examples of complete runnable requests.

## Suggestions

1. Keep the oracle wording decision stable for near-boundary prompts. For the pool ranking example, either return `ambiguous_question` every time or return a consistent non-blocking wording suggestion when the question is still usable.
2. Separate transient evaluator availability from semantic blocker decisions. A retryable status or explicit evaluation field would let callers distinguish service interruption from a changed request judgment.
3. Mark documentation IDs and repositories as placeholders that must be replaced before a check, or include syntactically valid sample UUIDs and a public example repository. The current templates consistently produce validation errors or `not_found` when copied literally.
4. Keep the free-check oracle examples visually distinct from full paid oracle request bodies. The check route accepts the shorter `question`/`panelSize` form; the paid shape includes fields the free route rejects.
5. Treat five repeats as a quick regression signal, not a broad reliability estimate. The included cases can seed a longer scheduled QA sample after the timing correction is observed in a future run.

## Reproduce

From the repository root with Node.js 20 or newer, run `npm run check`. It uses built-in `fetch`, makes 100 sequential calls, and replaces `results/latest.json` in the same format. `node scripts/check-consistency.mjs --summarize-only` recomputes the summary from the saved responses without using the network. The runner calls only the free check route; it does not submit or pay for any request.
