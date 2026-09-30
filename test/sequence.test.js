/** The plan-year ordering, and the reasons it gives. */
import { strict as assert } from 'node:assert'
import { test } from 'node:test'
import { expiringBenefits, sequenceCare } from '../src/sequence.js'

const PLAN = {
  annualMaximumCents: 150000, annualMaximumUsedCents: 0,
  deductibleCents: 5000, deductibleMetCents: 0,
  coinsurance: { preventive: 1, basic: 0.8, major: 0.5 },
  network: 'IN_NETWORK',
  waitingPeriodsMonths: { preventive: 0, basic: 0, major: 0 },
  frequencyLimitsPerYear: { D1110: 2 }, frequencyUsedPerYear: { D1110: 2 },
  monthsEnrolled: 24, fsaBalanceCents: 12000,
}

test('urgent care comes first and every step says why it is there', () => {
  const { steps } = sequenceCare(PLAN, ['D1110', 'D2740', 'D2391'])
  assert.equal(steps[0].procedureCode, 'D2740')
  for (const step of steps) assert.ok(step.reasons.length > 0)
})

test('the deductible is named on the step that actually pays it', () => {
  const { steps } = sequenceCare(PLAN, ['D2740', 'D2391'])
  const paying = steps.filter((s) => s.reasons.some((r) => /deductible gets paid/.test(r)))
  assert.equal(paying.length, 1)
})

test('a procedure past its frequency limit is moved into the next plan year, with the reason', () => {
  const { steps } = sequenceCare(PLAN, ['D1110', 'D2391'])
  const cleaning = steps.find((s) => s.procedureCode === 'D1110')
  assert.equal(cleaning.planYear, 'next')
  assert.match(cleaning.reasons.join(' '), /covers 2 of these per plan year/)
})

test('expiring benefits name what is left, not merely that something expires', () => {
  const items = expiringBenefits(PLAN, { monthsLeftInPlanYear: 2 })
  assert.ok(items.some((i) => i.kind === 'annual maximum' && i.remaining === '1500.00'))
  assert.ok(items.some((i) => i.kind === 'flexible spending account balance'))
  for (const item of items) assert.equal(item.expiresInMonths, 2)
})

test('nothing is reported as expiring when nothing is left', () => {
  const spent = {
    ...PLAN, annualMaximumUsedCents: 150000, fsaBalanceCents: 0,
    frequencyUsedPerYear: { D1110: 2 },
  }
  assert.deepEqual(expiringBenefits(spent), [])
})
