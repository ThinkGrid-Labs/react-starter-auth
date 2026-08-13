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
        entryFileNames: '[name].mjs',
        chunkFileNames: 'shared/[name]-[hash].mjs',
      },
      {
        dir: './dist',
        format: 'cjs',
        sourcemap: true,
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
        sourcemap: true,
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
