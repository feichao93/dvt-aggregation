import webWorkerLoader from 'rollup-plugin-web-worker-loader'
import typescript from 'rollup-plugin-typescript2'
import pkg from './package.json'
import pegjs from 'rollup-plugin-pegjs'

const config = output => ({
  input: 'src/index.ts',
  output,
  plugins: [
    typescript({ check: false }),
    pegjs(),
    webWorkerLoader({
      inline: true,
      enableUnicodeSupport: true,
    }),
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
