import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import filesize from 'rollup-plugin-filesize';
import license from 'rollup-plugin-license';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
// The official plugin. rollup-plugin-typescript2 has been unmaintained since
// 2023 and silently stops transforming under Rollup >= 4.59, which is the first
// version without the path-traversal advisory — the file then reaches Rollup's
// parser as raw TypeScript and fails on `export type`.
import typescript from '@rollup/plugin-typescript';

const input = 'src/index.tsx';

// Subpath entries. `core` and `server` never import React, so a Next.js
// middleware or route handler pulling in `/server` does not drag the client
// bundle along with it.
const entries = {
  index: 'src/index.tsx',
  core: 'src/core/index.ts',
  server: 'src/server/index.ts',
  next: 'src/adapters/next.ts',
  'react-router': 'src/adapters/react-router.ts',
  node: 'src/adapters/node.ts',
};

// Real runtime dependencies: keep them external so consumers resolve them
// through npm rather than getting a second copy inlined.
const external = ['react', 'react-dom', 'react/jsx-runtime', 'jose'];

const globals = {
  react: 'React',
  'react-dom': 'ReactDOM',
  jose: 'jose',
};

const licenseBanner = license({
  banner: {
    content: '/*! <%= pkg.name %> v<%= pkg.version %> | <%= pkg.license %> */',
    commentStyle: 'none',
  },
});

/**
 * Sourcemaps without the embedded original source.
 *
 * `sourcesContent` inlines every `.ts` file into the maps, which made them ~62%
 * of the installed package. Stack traces still resolve to the original file and
 * line; only the "view source" step needs the repository, which is public.
 */
const sourcemapExcludeSources = true;

export default [
  // ESM + CJS. Declarations are emitted here only, from tsconfig.build.json,
  // which excludes __tests__ so test typings stay out of the tarball.
  {
    input: entries,
    output: [
      {
        dir: './dist',
        format: 'esm',
        sourcemap: true,
        sourcemapExcludeSources,
        entryFileNames: '[name].mjs',
        chunkFileNames: 'shared/[name]-[hash].mjs',
      },
      {
        dir: './dist',
        format: 'cjs',
        sourcemap: true,
        sourcemapExcludeSources,
        exports: 'named',
        entryFileNames: '[name].cjs',
        chunkFileNames: 'shared/[name]-[hash].cjs',
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve(),
      typescript({
        tsconfig: 'tsconfig.build.json',
        // tsconfig.json sets noEmit for the typecheck script; the build needs
        // emit on, and declarations laid out to match the exports map.
        compilerOptions: {
          noEmit: false,
          declaration: true,
          declarationMap: true,
          declarationDir: './dist',
          rootDir: './src',
        },
      }),
      filesize(),
    ],
    external,
  },

  // UMD for <script> consumers. No declarations — the ESM/CJS build owns those.
  {
    input,
    output: [
      {
        file: './dist/index.umd.js',
        format: 'umd',
        name: 'ReactStarterAuth',
        // No map for the UMD build: it is the minified <script> bundle for CDN
        // use, and its map was the single largest file in the package. The ESM
        // and CJS builds that real projects import still ship theirs.
        sourcemap: false,
        exports: 'named',
        globals,
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve(),
      typescript({
        tsconfig: 'tsconfig.build.json',
        // No declarations here — the ESM/CJS build above owns those. sourceMap
        // is off to match this output, which ships without a map.
        compilerOptions: {
          noEmit: false,
          declaration: false,
          declarationMap: false,
          sourceMap: false,
        },
      }),
      terser(),
      licenseBanner,
      filesize(),
    ],
    external,
  },
];
