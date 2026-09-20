import { build } from 'esbuild'

// ESM bundle of the Pi extension. The Pi extension API package is peer-provided
// by the host (jiti loads extensions at runtime); it stays external.
await build({
  entryPoints: ['src/index.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'es2024',
  outfile: 'lib/index.js',
  sourcemap: false,
  minify: false,
  external: ['@earendil-works/*', '@agents-web-search/core', 'node:*'],
})
console.log('build: lib/index.js written')
