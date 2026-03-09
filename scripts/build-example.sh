#!/usr/bin/env bash
set -euo pipefail

# Assemble a self-contained static build of the example in dist-example/.
# The example HTML is placed at the root so it becomes the GitHub Pages homepage.
# Absolute /node_modules/ and /example/vendor/ paths in the import map are
# rewritten to relative paths that work regardless of the URL sub-path.

rm -rf dist-example
mkdir -p dist-example

# Keep the full example/ directory structure so all relative imports
# (e.g. "../src/index.js", "../../src/...") remain valid.
cp -r example dist-example/

# Rewrite only the import map's absolute /node_modules/ and /example/vendor/
# paths to be relative from example/index.html's new location.
#   /node_modules/X  →  ../node_modules/X
#   /example/vendor/ →  ./vendor/
sed -i \
  -e 's|src="/node_modules/|src="../node_modules/|g' \
  -e 's|"/node_modules/|"../node_modules/|g' \
  -e 's|"/example/vendor/|"./vendor/|g' \
  dist-example/example/index.html

# Root redirect so the Pages homepage points to the example
echo '<meta http-equiv="refresh" content="0;url=example/">' > dist-example/index.html

# Gladly source (imported directly by example scripts via ../src/...)
cp -r src dist-example/

# node_modules — only the specific files referenced by the import map
mkdir -p dist-example/node_modules

# d3 sub-packages and internmap: only src/ is needed
for pkg in \
  d3-selection d3-zoom d3-scale d3-axis \
  d3-dispatch d3-drag d3-interpolate d3-transition \
  d3-array d3-format d3-time d3-time-format \
  d3-color d3-ease d3-timer \
  internmap
do
  mkdir -p "dist-example/node_modules/$pkg"
  cp -r "node_modules/$pkg/src" "dist-example/node_modules/$pkg/"
done

# projnames: ESM entry + data file only
mkdir -p dist-example/node_modules/projnames
cp node_modules/projnames/index.mjs dist-example/node_modules/projnames/
cp node_modules/projnames/epsgnames.json dist-example/node_modules/projnames/

# UMD dist files only
mkdir -p dist-example/node_modules/regl/dist
cp node_modules/regl/dist/regl.js dist-example/node_modules/regl/dist/

mkdir -p dist-example/node_modules/proj4/dist
cp node_modules/proj4/dist/proj4.js dist-example/node_modules/proj4/dist/

mkdir -p "dist-example/node_modules/@json-editor/json-editor/dist"
cp "node_modules/@json-editor/json-editor/dist/jsoneditor.js" \
   "dist-example/node_modules/@json-editor/json-editor/dist/"
