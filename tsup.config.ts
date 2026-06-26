import { defineConfig } from 'tsup'

// Build the library with tsup (esbuild + rollup-dts) rather than raw tsc.
//
// Why not tsc: with `moduleResolution: "Bundler"`, tsc emits extensionless
// relative imports (`import './constants'`) which Node's native ESM resolver
// rejects — fine for bundlers, broken for Node / vitest / Next.js consumers.
// tsup resolves and bundles per entry, so the published dist is valid ESM that
// any Node consumer can load.
export default defineConfig({
  entry: ['src/index.ts', 'src/adapters/index.ts'],
  format: ['esm'],
  dts: true,
  outDir: 'dist',
  target: 'es2020',
  sourcemap: true,
  clean: true,
  splitting: true, // share chunks between the two entries (no duplicate code)
  treeshake: true,
  external: ['react', 'react-dom'], // peer deps — never bundle the host's React
})
