import resolve from '@rollup/plugin-node-resolve';
import commonjs from '@rollup/plugin-commonjs';
import terser from '@rollup/plugin-terser';
import json from '@rollup/plugin-json';

export default [
  // ESM bundle for npm/bundler consumers — dependencies stay external
  {
    input: 'src/index.js',
    external: ['regl', 'd3-scale', 'proj4', 'projnames'],
    output: {
      file: 'dist/gladly.esm.js',
      format: 'esm',
    },
  },
  // Standalone IIFE bundle for <script> tag use — all dependencies bundled in
  {
    input: 'src/index.js',
    plugins: [resolve(), commonjs(), json()],
    output: [
      {
        file: 'dist/gladly.iife.js',
        format: 'iife',
        name: 'Gladly',
      },
      {
        file: 'dist/gladly.iife.min.js',
        format: 'iife',
        name: 'Gladly',
        plugins: [terser()],
      },
    ],
  },
];
