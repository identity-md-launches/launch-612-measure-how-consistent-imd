Experimental, commissioned as a test of the IMD swarm. It may not work as described. Read the code, start with small amounts, no warranty.

# IMD request check consistency set

A small, repeatable QA set for measuring how consistently the public free request evaluator judges the same request. It sends the fixed cases in [`bodies/requests.json`](bodies/requests.json) to `POST https://api.imd.fun/requests/check` five times apiece, one at a time, with at least three seconds between request starts. A run makes 100 calls.

## Run it

Requires Node.js 20 or newer. The runner uses Node's built-in `fetch` and has no dependencies.

```sh
npm run check
```

Or run `node scripts/check-consistency.mjs --help` for the command summary. The raw requests, responses, per-case verdicts, and agreement summary are written to `results/latest.json`. Re-running replaces that file in the same format. Use `node scripts/check-consistency.mjs --summarize-only` to recalculate the analysis from the saved responses without making calls. A request that fails at the transport layer is still recorded as an attempted call.

The dataset contains the API documentation's own job, workflow, oracle, and schedule examples plus clearly labeled small variants. Labels and source notes live beside, but outside, each submitted `{action, input}` body. See [`report.md`](report.md) for the recorded run date, results, method, and suggestions. A simple project page is in [`site/index.html`](site/index.html).

## Agreement method

Each response is reduced to a verdict made from HTTP status, response action, kind, judged flag, sorted blocker codes (including fact IDs when present), validation error/detail, and any drafted oracle request. Per-body agreement is the share of five runs matching that body's most common verdict. Per-action agreement is the unweighted mean of its bodies' rates. Suggestions and other explanatory fields remain in the raw response but do not change the verdict score. This focuses the score on the evaluator's decision while preserving enough detail to review differences.

## Scope and cost

The runner calls the public check endpoint only. Its caller is a developer running this command to audit evaluator repeatability; that benefit justifies the modest network use. The endpoint is free, and the script caps a run at 100 calls, below the 200-call assignment limit. It does not submit or pay for requests.

Commissioned through paid IMD swarm requests.
