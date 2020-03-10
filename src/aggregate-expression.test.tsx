import createAggregateFunction, { IndicatorConfig } from './createAggregateFunction'

const testData = [
  { income: 20, target: 80 },
  { income: 10, target: 20 },
  { income: 30, target: 50 },
  { income: 40, target: 90 },
  // sum:  { income: 100, target: 240 }
]

describe('SUM 聚合表达式', () => {
  const indicators: IndicatorConfig[] = [
    { code: 'income', name: '收入', expression: 'SUM(income)' },
    { code: 'target', name: '目标', expression: 'SUM(target)' },
  ]
  const aggregate = createAggregateFunction(indicators)

  test('编译结果', () => {
    expect(aggregate.toString()).toMatchSnapshot()
  })

  test('运行结果', () => {
    const actual = aggregate(testData)
    expect(actual.income).toBeCloseTo(100)
    expect(actual.target).toBeCloseTo(240)
  })
})

describe('简单的计算表达式', () => {
  const indicators: IndicatorConfig[] = [
    { code: 'income', name: '收入', expression: 'SUM(income)' },
    { code: 'target', name: '目标', expression: 'SUM(target)' },
    { code: 'act_rate', name: '达成率', expression: 'income / target' },
  ]
  const aggregate = createAggregateFunction(indicators)

  test('编译结果', () => {
    expect(aggregate.toString()).toMatchSnapshot()
  })

  test('运行结果', () => {
    const actual = aggregate(testData)
    expect(actual.act_rate).toBeCloseTo(100 / 240)
  })
})

describe('AVG/MAX/MIN 聚合表达式', () => {
  const indicators: IndicatorConfig[] = [
    { code: 'income', name: 'income', expression: 'SUM(income)' },
    { code: 'target', name: 'target', expression: 'SUM(target)' },
    { code: 'max_income', name: '最大收入', expression: 'MAX(income)' },
    { code: 'min_target', name: '最小目标', expression: 'MIN(target)' },
    { code: 'avg_income', name: '平均收入', expression: 'AVG(income)' },
  ]
  const aggregate = createAggregateFunction(indicators)

  test('编译结果', () => {
    expect(aggregate.toString()).toMatchSnapshot()
  })

  test('运行结果', () => {
    const actual = aggregate(testData)
    expect(actual.max_income).toBeCloseTo(40)
    expect(actual.min_target).toBeCloseTo(20)
    expect(actual.avg_income).toBeCloseTo(25)
  })
})

describe('复杂的计算表达式', () => {
  const indicators: IndicatorConfig[] = [
    { code: 'income', name: '收入', expression: 'SUM(income)' },
    { code: 'target', name: '目标', expression: 'SUM(target)' },
    { code: 'code_1', name: 'code_1', expression: '(target - income) / SUM(income)' },
    { code: 'code_2', name: 'code_2', expression: 'MAX(target) - MIN(income)' },
    { code: 'code_3', name: 'code_3', expression: 'MIN(target) - MAX(income)' },
    { code: 'code_4', name: 'code_4', expression: 'code_2 + code_3' },
  ]
  const aggregate = createAggregateFunction(indicators)

  test('编译结果', () => {
    expect(aggregate.toString()).toMatchSnapshot()
  })

  test('运行结果', () => {
    const actual = aggregate(testData)
    expect(actual.code_1).toBeCloseTo((240 - 100) / 100)
    expect(actual.code_2).toBeCloseTo(90 - 10)
    expect(actual.code_3).toBeCloseTo(20 - 40)
    expect(actual.code_4).toBeCloseTo(actual.code_2 + actual.code_3)
  })
})
