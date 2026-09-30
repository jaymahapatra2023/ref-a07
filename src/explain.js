/**
 * The breakdown in plain language.
 *
 * Two rules. Insurance terms are used with their meaning intact and defined on first use, because
 * a translation that changes what a term means is worse than the jargon. And every figure is
 * tagged as either plan-derived — it follows from a term the employee entered — or estimated,
 * with what the estimate depends on. An employee who cannot tell those apart cannot tell which
 * numbers to trust.
 */

const GLOSSARY = {
  'annual maximum': 'the most your plan will pay towards your care in one plan year',
  deductible: 'the amount you pay yourself before the plan starts paying its share',
  coinsurance: 'the share of the cost your plan pays once the deductible is met',
  'waiting period': 'time you must be enrolled before the plan covers a category of care',
  'frequency limit': 'how many of a given treatment the plan covers in one plan year',
}

const money = (cents) => `$${(Math.abs(cents) / 100).toFixed(2)}`

export function explainEstimate(estimate) {
  const paragraphs = []

  paragraphs.push(
    `For ${estimate.description} (${estimate.procedureCode}), the reference cost in your network ` +
    `is ${money(estimate.allowedCents)}. That figure is an estimate.`)

  if (estimate.waitingPeriodBlocks) {
    paragraphs.push(
      'Your plan has a waiting period for this category that you have not served yet, so the ' +
      `plan would pay nothing towards it today and you would owe ${money(estimate.allowedCents)}. ` +
      `A waiting period is ${GLOSSARY['waiting period']}.`)
  } else {
    paragraphs.push(
      `Your plan would pay ${money(estimate.planPaysCents)} and you would owe ` +
      `${money(estimate.employeeOwesCents)}.`)
  }

  if (estimate.cappedByAnnualMaximum) {
    paragraphs.push(
      'That is less than your coinsurance alone would suggest, because your annual maximum — ' +
      `${GLOSSARY['annual maximum']} — runs out part-way through this procedure.`)
  }

  if (estimate.missingTerms.length > 0) {
    paragraphs.push(
      `You have not given ${estimate.missingTerms.join(', ')}, so those terms could not be ` +
      'applied and this estimate may be wrong in their direction.')
  }

  return {
    paragraphs,
    lines: estimate.lines.map((line) => ({
      label: line.label,
      amount: `${line.amountCents < 0 ? '-' : ''}${money(line.amountCents)}`,
      because: line.basis,
      // The distinction the whole breakdown turns on.
      certainty: line.estimated ? 'estimated' : 'from your plan',
      dependsOn: line.dependsOn,
    })),
    glossaryUsed: Object.entries(GLOSSARY)
      .filter(([term]) => paragraphs.join(' ').toLowerCase().includes(term))
      .map(([term, meaning]) => ({ term, meaning })),
  }
}

export const LIMITS_NOTICE =
  'This is an estimate, not a quote, and not a substitute for your plan document or for the ' +
  'treatment plan your dentist gives you. Figures marked "estimated" come from reference cost ' +
  'data for your area and will differ from what your own dentist charges. Figures marked "from ' +
  'your plan" follow from the terms you entered here — if you entered them wrongly, they are wrong.'
