# Dental cost and coverage planner

Describe the care you are planning and your plan's terms; get an itemised estimate of what the
plan pays and what you owe, with each line showing the plan term that produced it, and an order
to have the work done in across the plan year.

**This is an estimate, not a quote.** It is not a substitute for your plan document or for the
treatment plan your dentist gives you.

## Run it

```
docker build -t planner . && docker run --rm -p 8080:8080 planner
```

or, with Node 22 and no dependencies to install:

```
npm start        # http://localhost:8080
npm test         # the arithmetic and the sequencing
```

## What it does

1. **Asks for the six plan terms one at a time** — annual maximum, deductible, coinsurance by
   category, network status, waiting periods, frequency limits. `POST /session` says what it still
   needs; `POST /plan` answers one. Answering again replaces an answer and the estimate recomputes.
2. **Takes the procedure in your own words** (`POST /procedure`) and matches it to a CDT procedure
   code. An unmatched description says to ask the dentist for the code rather than guessing.
3. **Itemises the estimate** (`POST /estimate`): the reference cost, the deductible, the plan's
   coinsurance share, and any reduction because the annual maximum ran out — each line naming the
   plan term behind it and tagged *estimated* or *from your plan*.
4. **Sequences two or more procedures across the plan year** (`POST /sequence`), using the annual
   maximum, deductible timing and frequency limits, and saying for each placement which of the
   three put it there.
5. **Tracks the annual maximum** as a running balance, **compares in-network with out-of-network**
   for the same procedure from the same reference data, and **names benefits that expire** at the
   plan-year boundary with how much of each is left.

## How the numbers are produced

Every figure is computed in `src/estimate.js` or `src/sequence.js`. Both are pure functions — no
I/O, no clock, no model call — and both are tested in `test/`. No language model is on any path
that produces a number; the explanations in `src/explain.js` are composed from the computed
result. That is deliberate: a figure a reader cannot re-derive is a figure nobody can check.

Reference costs are in `src/costs.js`, transcribed from a consumer dental cost estimator, in
cents, with in-network and out-of-network figures per CDT code. `GET /reference` returns them.

## Data handling

The answers stay in memory for the session and are never written to disk. The log carries the
route, the count of plan terms given, and nothing else — no dollar figures, no procedures, no
contact details. There is no credential in this repository; `PORT` is the only variable read.
