import license from 'rollup-plugin-license';
import terser from '@rollup/plugin-terser';
import filesize from 'rollup-plugin-filesize';
import peerDepsExternal from 'rollup-plugin-peer-deps-external';
import resolve from '@rollup/plugin-node-resolve';
import typescript from 'rollup-plugin-typescript2';

import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const pkg = require('./package.json');

const licenseBanner = license({
  banner: {
    content: '/*! <%= pkg.name %> v<%= pkg.version %> | <%= pkg.license %> */',
    commentStyle: 'none',
  },
});

export default [
  {
    input: 'src/index.tsx',
    output: [
      {
        dir: './dist',
        format: 'esm',
        sourcemap: true,
        preserveModules: true,
        name: 'ReactStarterAuth',
        globals: {
          "react": "React",
          "js-cookie": "Cookies",
          "axios": "Axios",
          "react-router-dom": "ReactRouterDOM"
        },
        sourcemap: true
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve(),
      typescript(),
      filesize(),
    ],
    external: ["react", "react-dom"],
  },
  {
    input: 'src/index.tsx',
    output: [
      {
        file: pkg.main.replace('.js', '.umd.js'),
        format: 'umd',
        name: 'ReactStarterAuth',
        globals: {
          "react": "React",
          "js-cookie": "Cookies",
          "axios": "Axios",
          "react-router-dom": "ReactRouterDOM"
        },
        sourcemap: true
      },
    ],
    plugins: [
      peerDepsExternal(),
      resolve(),
      typescript(),
      terser(),
      licenseBanner,
      filesize(),
    ],
    external: ["react", "react-dom"],
  },
];