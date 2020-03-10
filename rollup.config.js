import webWorkerLoader from 'rollup-plugin-web-worker-loader'
import typescript from 'rollup-plugin-typescript2'
import pkg from './package.json'
import pegjs from 'rollup-plugin-pegjs'
import replace from '@rollup/plugin-replace'

const config = output => ({
  input: 'src/dvt-aggregation.ts',
  output,
  plugins: [
    typescript({ check: false }),
    pegjs(),
    webWorkerLoader({
      inline: true,
      enableUnicodeSupport: true,
    }),
    replace({ DVT_AGGREGATION_VERSION: JSON.stringify(pkg.version) }),
  ],
  treeshake: {
    moduleSideEffects: false,
  },
})

export default [
  config({
    file: pkg.module,
    format: 'esm',
  }),
  config({
    file: pkg.main,
    format: 'cjs',
  }),
]
