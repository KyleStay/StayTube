#!/bin/zsh
set -eu

project_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
node_bin="$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node"
if [[ ! -x "$node_bin" ]]; then
  node_bin=$(command -v node)
fi

cd "$project_dir"
if "$node_bin" scripts/capture-store-screenshots.cjs; then
  open "$project_dir/store-assets/screenshots"
else
  print "Screenshot capture failed. Read the error above; no mock images were substituted."
fi
read -r "reply?Press Return to close. "
