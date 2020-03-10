// @ts-ignore
import _parser from './grammar.pegjs'

// @ts-ignore
const version = DVT_AGGREGATION_VERSION

const parser = _parser as {
  parse(expression: string): Expression
}

type AggrFuncName = 'MAX' | 'MIN' | 'SUM' | 'AVG' | 'COUNT'
type OP = '+' | '-' | '*' | '/'

type Expression = NumberLiteral | Field | ArithmeticExpression | AggrFuncCallExpression
type NumberLiteral = { type: 'n'; n: number }
type Field = { type: 'field'; code: string }
type ArithmeticExpression = { type: 'arithmetic'; ops: OP[]; terms: Expression[] }
type AggrFuncCallExpression = { type: 'aggr-func-call'; funcName: AggrFuncName; subExpr: Expression }

function collectCodeWithDepFlag(rootExpr: Expression) {
  const result: Array<{ code: string; isDep: boolean }> = []
  dfs(rootExpr, false)
  return result

  function dfs(expr: Expression, inAggrFuncCall: boolean) {
    if (expr.type === 'arithmetic') {
      for (const term of expr.terms) {
        dfs(term, false)
      }
    } else if (expr.type === 'field') {
      const index = result.findIndex(({ code }) => code === expr.code)
      if (index === -1) {
        result.push({ code: expr.code, isDep: !inAggrFuncCall })
      } else {
        if (!inAggrFuncCall) {
          result[index].isDep = true
        }
      }
    } else if (expr.type === 'aggr-func-call') {
      dfs(expr.subExpr, true)
    }
  }
}

// todo 不允许嵌套聚合调用
// todo 更加严格的输入检查
function convertItems(items: Item[]): Item[] {
  let safeCodeCount = 0
  const genSafeCode = () => `safe_code_${safeCodeCount++}`

  return items.flatMap(dfs)

  function dfs(item: Item): Item[] {
    const { code, deps, expr } = item
    const result: Item[] = []
    if (expr.type === 'aggr-func-call') {
      if (expr.funcName === 'AVG') {
        const numerator = genSafeCode() // 分子
        const denominator = genSafeCode() // 分母
        result.push(
          ...dfs({
            code: numerator,
            deps: [],
            expr: {
              type: 'aggr-func-call',
              funcName: 'SUM',
              subExpr: expr.subExpr,
            },
          }),
          ...dfs({
            code: denominator,
            deps: [],
            expr: {
              type: 'aggr-func-call',
              funcName: 'COUNT',
              subExpr: expr.subExpr,
            },
          }),
          {
            code,
            deps: [numerator, denominator],
            expr: {
              type: 'arithmetic',
              terms: [
                { type: 'field', code: numerator },
                { type: 'field', code: denominator },
              ],
              ops: ['/'],
            },
          },
        )
      } else if (expr.subExpr.type === 'arithmetic') {
        const safeCode = genSafeCode()
        result.push(
          ...dfs({
            code,
            deps: [],
            expr: {
              type: 'aggr-func-call',
              funcName: expr.funcName,
              subExpr: { type: 'field', code: safeCode },
            },
          }),
          ...dfs({
            code: safeCode,
            deps: [],
            expr: expr.subExpr,
          }),
        )
      } else {
        result.push(item)
      }
    } else if (expr.type === 'arithmetic') {
      const transformedTerms: Expression[] = []
      const appendDeps: string[] = []
      for (const term of expr.terms) {
        if (term.type === 'aggr-func-call') {
          const safeCode = genSafeCode()
          result.push(
            ...dfs({
              code: safeCode,
              deps: [],
              expr: {
                type: 'aggr-func-call',
                funcName: term.funcName,
                subExpr: term.subExpr,
              },
            }),
          )
          transformedTerms.push({ type: 'field', code: safeCode })
          appendDeps.push(safeCode)
        } else {
          transformedTerms.push(term)
        }
      }
      result.push({
        code,
        expr: { ...expr, terms: transformedTerms },
        deps: mergeDeps(deps, appendDeps),
      })
    } else {
      result.push(item)
    }

    return result
  }
}

type Item = { code: string; expr: Expression; deps: string[] }

export interface IndicatorConfig {
  name: string
  code: string
  expression?: string
}

function parseIndicators(indicators: IndicatorConfig[]): Item[] {
  const allIndCodes = new Set(indicators.map(ind => ind.code))
  return indicators.map(ind => {
    if (ind.expression == null) {
      throw new Error(`${ind.code}:${ind.name} 缺少聚合表示式`)
    }
    let expr: Expression
    try {
      expr = parser.parse(ind.expression)
    } catch (e) {
      console.warn(`解析 ${ind.code}:${ind.name} 的表达式失败，请仔细检查下列表示是否正确` + `\n\t${ind.expression}`)
      throw e
    }
    const codesWithDepFlag = collectCodeWithDepFlag(expr)
    codesWithDepFlag.forEach(({ code }) => {
      if (!allIndCodes.has(code)) {
        throw new Error(`${code} 不是合法的指标 code`)
      }
    })
    return {
      code: ind.code,
      expr,
      deps: codesWithDepFlag.filter(({ isDep }) => isDep).map(({ code }) => code),
    }
  })
}

function emit(indicators: IndicatorConfig[], items: Item[]) {
  const sumItems = items.filter(({ expr }) => expr.type === 'aggr-func-call' && expr.funcName === 'SUM')
  const countItems = items.filter(({ expr }) => expr.type === 'aggr-func-call' && expr.funcName === 'COUNT')
  const maxItems = items.filter(({ expr }) => expr.type === 'aggr-func-call' && expr.funcName === 'MAX')
  const minItems = items.filter(({ expr }) => expr.type === 'aggr-func-call' && expr.funcName === 'MIN')

  const sumPreparation = sumItems
    .map(({ code }) => {
      return `${t.field('r', code)} = 0;`
    })
    .join('\n')

  const countPreparation = countItems
    .map(({ code }) => {
      return `${t.field('r', code)} = 0;`
    })
    .join('\n')

  const maxPreparation = maxItems
    .map(({ code }) => {
      return `${t.field('r', code)} = -Infinity;`
    })
    .join('\n')

  const minPreparation = minItems
    .map(({ code }) => {
      return `${t.field('r', code)} = Infinity;`
    })
    .join('\n')

  const countCalculation = countItems
    .map(({ code, expr }) => {
      if (expr.type === 'aggr-func-call') {
        return `${t.field('r', code)} += ${t.field('d', code, '1')};`
      } else {
        throw new Error()
      }
    })
    .join('\n')

  const sumCalculation = sumItems
    .map(({ code, expr }) => {
      const subExpr = (expr as AggrFuncCallExpression).subExpr
      return `${t.field('r', code)} += ${t.makeJSExpression(subExpr, 'd')} || 0;`
    })
    .join('\n')

  const maxCalculation = maxItems
    .map(({ code, expr }) => {
      const subExpr = (expr as AggrFuncCallExpression).subExpr
      return `${t.field('r', code)} = Math.max(${t.field('r', code)}, ${t.makeJSExpression(subExpr, 'd')});`
    })
    .join('\n')

  const minCalculation = minItems
    .map(({ code, expr }) => {
      const subExpr = (expr as AggrFuncCallExpression).subExpr
      return `${t.field('r', code)} = Math.min(${t.field('r', code)}, ${t.makeJSExpression(subExpr, 'd')});`
    })
    .join('\n')

  const derivedCalculation = items
    .filter(({ code, expr }) => {
      return expr.type !== 'aggr-func-call'
    })
    .map(({ code, expr }) => {
      return `${t.field('r', code)} = ${t.makeJSExpression(expr, 'r')};`
    })
    .join('\n')

  // 这里需要使用 [...].join('\n')，不能直接使用模板字符串，否则 rollup 在编译的时候会把代码破坏掉
  return [
    t.__(`/* aggregate function generated by dvt-aggregation@${version}`),
    t.____(...indicators.map(ind => `${ind.name}: ${ind.code} = ${ind.expression}`)),
    t.__('*/'),
    '',

    t.__('let r = {};'),
    '',
    t.__(countPreparation, sumPreparation, maxPreparation, minPreparation),
    '',
    t.__('for (const d of slice) {'),
    t.____(sumCalculation, countCalculation, maxCalculation, minCalculation),
    t.__('}'),
    '',
    t.__(derivedCalculation),
    '',
    t.__('return r;'),
  ].join('\n')
}

const t = {
  __(...ss: string[]) {
    return t.indent(1, ...ss)
  },
  ____(...ss: string[]) {
    return t.indent(2, ...ss)
  },
  indent(n: number, ...ss: string[]) {
    return ss
      .join('\n')
      .split('\n')
      .filter(s => !s.match(/^\s*$/))
      .map(line => '  '.repeat(n).concat(line.trim()))
      .join('\n')
  },

  field(objectId: string, field: string, defaultValue?: string) {
    if (defaultValue == null) {
      return `${objectId}['${field}']`
    }
    return `(${objectId}['${field}'] || ${defaultValue})`
  },

  makeJSExpression(rootExpr: Expression, refObjectId: string) {
    return dfs(rootExpr)

    function dfs(expr: Expression): string {
      if (expr.type === 'arithmetic') {
        const termsJSExpr = expr.terms.map(dfs)
        const opJSExpr = expr.ops
        const result = [termsJSExpr[0]]
        for (let i = 0; i < opJSExpr.length; i++) {
          result.push(opJSExpr[i], termsJSExpr[i + 1])
        }
        return `(${result.join(' ')})`
      } else if (expr.type === 'field') {
        return t.field(refObjectId, expr.code)
      } else if (expr.type === 'n') {
        return String(expr.n)
      } else {
        throw new Error('当前暂不支持该运算过程')
      }
    }
  },
}

function topologicalSort<T extends { code: string; deps: string[] }>(array: T[]): T[] {
  const result: T[] = []

  const size = array.length

  const edgesMap = new Map<string, number[]>()
  for (let i = 0; i < size; i++) {
    for (const dep of array[i].deps) {
      if (!edgesMap.has(dep)) {
        edgesMap.set(dep, [])
      }
      edgesMap.get(dep).push(i)
    }
  }

  const indegrees = array.map(({ deps }) => deps.length)
  const used = new Array(size).fill(false)

  while (true) {
    let i = 0
    for (; i < size; i++) {
      if (indegrees[i] === 0 && !used[i]) {
        break
      }
    }
    if (i === size) {
      break
    }
    used[i] = true
    const item = array[i]
    result.push(item)
    if (edgesMap.has(item.code)) {
      for (const index of edgesMap.get(item.code)) {
        indegrees[index]--
      }
    }
  }
  if (result.length !== size) {
    const firstFailCode = array[used.findIndex(u => !u)].code
    const circle = findCircularDependency(firstFailCode, array)
    throw new Error('指标计算之间存在相互依赖关系\n\t' + circle.join(' -> ') + '\n（说明：A -> B 表示A的计算依赖于B）')
  }

  return result
}

function findCircularDependency(startCode: string, array: Array<{ code: string; deps: string[] }>) {
  const graph = new Map(array.map(({ code, deps }) => [code, deps]))
  const circle: string[] = []
  dfs(startCode)
  return circle

  function dfs(currentCode: string) {
    if (circle.length > 0 && circle[0] === currentCode) {
      circle.push(currentCode)
      return true
    }
    circle.push(currentCode)
    if (graph.has(currentCode)) {
      for (const nextCode of graph.get(currentCode)) {
        if (dfs(nextCode)) {
          return true
        }
      }
    }
    circle.pop()
    return false
  }
}

function mergeDeps(deps: string[], appendDeps: string[]) {
  const set = new Set(deps)
  const result = deps.slice()
  for (const d of appendDeps) {
    if (!set.has(d)) {
      set.add(d)
      result.push(d)
    }
  }
  return result
}

export default function createAggregateFunction(indicators: IndicatorConfig[]): (slice: any[]) => any {
  const template = emit(indicators, topologicalSort(convertItems(parseIndicators(indicators))))
  return new Function('slice', template) as any
}
