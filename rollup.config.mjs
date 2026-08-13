import resolve from '@rollup/plugin-node-resolve';
import terser from '@rollup/plugin-terser';
import filesize from 'rollup-plugin-filesize';
import license from 'rollup-plugin-license';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import typescript from 'rollup-plugin-typescript2';

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
      typescript({ tsconfig: 'tsconfig.build.json', clean: true }),
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
        clean: true,
        tsconfigOverride: {
          compilerOptions: { declaration: false, declarationMap: false },
        },
      }),
      terser(),
      licenseBanner,
      filesize(),
    ],
    external,
  },
];
