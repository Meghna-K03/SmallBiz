// AI grounding for the priority / validated-forecast fields. The provider is always
// stubbed: these tests never call Groq and never touch the database.
//
// Run with: npm test   (or npm run test:pure)
import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'
import {
  buildFallbackExplanation,
  buildMessages,
  explainProduct,
  isAcceptableExplanation,
  parseExplainInput,
  setExplanationProvider,
  SYSTEM_PROMPT,
} from '../src/services/aiExplanation'

const base = {
  product: 'Milk',
  currentStock: 15,
  averageDailyDemand: 3.05,
  stockCoverage: 4.92,
  forecastedDemand: 21.34,
  minimumStock: 20,
  recommendedPurchase: 27,
  status: 'Needs Restocking',
  forecastHorizonDays: 7,
}
const extended = {
  ...base,
  restockPriority: 'High',
  forecastModel: 'Moving average',
  forecastReliability: 'Sufficient',
  forecastErrorPercent: 64.5,
}

afterEach(() => setExplanationProvider(null))

describe('extended explain input', () => {
  it('leaves the original input shape unchanged when the extra fields are not sent', () => {
    const i = parseExplainInput(base)
    assert.ok(!('restockPriority' in i) && !('forecastModel' in i) && !('forecastErrorPercent' in i))
  })

  it('accepts the verified extras and passes them to the model as data', () => {
    const i = parseExplainInput(extended)
    assert.equal(i.restockPriority, 'High')
    const user = buildMessages(i)[1]
    assert.deepEqual(JSON.parse(user.content), i)
  })

  it('rejects values the backend would never send', () => {
    for (const bad of [{ restockPriority: 'Urgent' }, { forecastModel: 'LSTM' }, { forecastReliability: 'Great' }, { forecastErrorPercent: -1 }, { forecastErrorPercent: 'low' }]) {
      assert.throws(() => parseExplainInput({ ...extended, ...bad }), (e: any) => e.status === 400 && e.code === 'VALIDATION_ERROR', JSON.stringify(bad))
    }
  })

  it('accepts null for an unavailable error figure', () => {
    assert.equal(parseExplainInput({ ...extended, forecastErrorPercent: null }).forecastErrorPercent, null)
  })
})

describe('grounding rules', () => {
  it('the prompt forbids inventing competitor, market or other outside information', () => {
    assert.match(SYSTEM_PROMPT, /competitors, market prices/)
    assert.match(SYSTEM_PROMPT, /do not have that information/)
  })

  it('accepts a reply that only uses supplied numbers, including the error percentage', () => {
    const i = parseExplainInput(extended)
    assert.ok(isAcceptableExplanation('Milk has 15 in stock and the forecast was off by about 64.5% on recent days.', i))
  })

  it('rejects a reply containing a number the backend did not supply', () => {
    const i = parseExplainInput(extended)
    assert.equal(isAcceptableExplanation('Milk is priced at 58 rupees, up 12% from a competitor.', i), false)
  })

  it('an invented error percentage is rejected when none was supplied', () => {
    const i = parseExplainInput(base)
    assert.equal(isAcceptableExplanation('The forecast is about 90% accurate.', i), false)
  })
})

describe('fallback when AI is unavailable', () => {
  it('provider error -> deterministic explanation built only from supplied values', async () => {
    setExplanationProvider(async () => {
      throw new Error('network down')
    })
    const r = await explainProduct(parseExplainInput(extended))
    assert.equal(r.source, 'fallback')
    assert.match(r.explanation, /restock priority as High/)
    assert.match(r.explanation, /off by about 64.5%/)
    assert.match(r.explanation, /not a guarantee/)
  })

  it('an unusable AI reply (invented numbers) -> fallback', async () => {
    setExplanationProvider(async () => 'Milk will sell 999 units next week.')
    assert.equal((await explainProduct(parseExplainInput(extended))).source, 'fallback')
  })

  it('fallback is deterministic and passes its own number check', () => {
    const i = parseExplainInput(extended)
    assert.equal(buildFallbackExplanation(i), buildFallbackExplanation(i))
    assert.ok(isAcceptableExplanation(buildFallbackExplanation(i), i))
  })

  it('limited history is called out in the fallback', () => {
    const t = buildFallbackExplanation(parseExplainInput({ ...extended, forecastReliability: 'Limited History' }))
    assert.match(t, /limited sales history/)
  })

  it('a good AI reply is used and labelled as AI', async () => {
    setExplanationProvider(async () => 'Milk has 15 in stock against a minimum of 20, and its priority is High.')
    assert.equal((await explainProduct(parseExplainInput(extended))).source, 'groq')
  })
})
