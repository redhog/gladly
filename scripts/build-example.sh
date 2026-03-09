#!/usr/bin/env bash
set -euo pipefail

# Assemble a self-contained static build of the example in dist-example/.
# The example HTML is placed at the root so it becomes the GitHub Pages homepage.
# Absolute /node_modules/ and /example/vendor/ paths in the import map are
# rewritten to relative paths that work regardless of the URL sub-path.

rm -rf dist-example
mkdir -p dist-example

# Rewrite import map and script src paths:
#   /node_modules/X  →  ./node_modules/X  (import map entries + UMD script tags)
#   /example/vendor/ →  ./vendor/          (vendor shim entries)
sed \
  -e 's|src="/node_modules/|src="./node_modules/|g' \
  -e 's|"/node_modules/|"./node_modules/|g' \
  -e 's|"/example/vendor/|"./vendor/|g' \
  example/index.html > dist-example/index.html

# Example JS files and vendor shims
cp example/*.js dist-example/
cp -r example/vendor dist-example/

# Gladly source (imported directly by example scripts)
cp -r src dist-example/

# node_modules — only the packages referenced by the import map
mkdir -p dist-example/node_modules
for pkg in \
  d3-selection d3-zoom d3-scale d3-axis \
  d3-dispatch d3-drag d3-interpolate d3-transition \
  d3-array d3-format d3-time d3-time-format \
  d3-color d3-ease d3-timer \
  internmap projnames regl proj4
do
  cp -r "node_modules/$pkg" dist-example/node_modules/
done

# Scoped package (@json-editor/json-editor)
mkdir -p "dist-example/node_modules/@json-editor"
cp -r "node_modules/@json-editor/json-editor" "dist-example/node_modules/@json-editor/"
