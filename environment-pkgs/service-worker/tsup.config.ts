import { defineConfig } from 'tsup'

const buildWorkerConfig = defineConfig({
  entry: ['worker/index.ts'],
  outDir: 'dist/worker',
  format: ['esm'],
  platform: 'browser',
  noExternal: [/.*/],
})

const buildPluginConfig = defineConfig({
  entry: ['index.ts'],
  outDir: 'dist',
  dts: true,
  format: ['esm'],
  platform: 'node',
})

export default [buildWorkerConfig, buildPluginConfig]
