#!/bin/sh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)
output_dir="$project_dir/dist"
package_name="staytube-1.0.3-chrome-web-store.zip"

mkdir -p "$output_dir"
rm -f "$output_dir/$package_name"

cd "$project_dir"
zip -q -r "$output_dir/$package_name" \
  manifest.json \
  src \
  assets/icons \
  -x '*.DS_Store'

printf '%s\n' "$output_dir/$package_name"
