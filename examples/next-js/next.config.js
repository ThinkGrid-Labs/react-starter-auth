const path = require('path');

/** @type {import('next').NextConfig} */
const nextConfig = {
  // The library above has its own lockfile, so Next would otherwise infer a
  // workspace root somewhere up the tree and warn about it.
  outputFileTracingRoot: path.join(__dirname),

  // The e2e suite drives the dev server over 127.0.0.1 rather than localhost.
  allowedDevOrigins: ['127.0.0.1'],
};

module.exports = nextConfig;
