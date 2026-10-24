# Local CI

Preserves the existing dependency-free Node tests, JavaScript syntax checks and Chrome store ZIP/hash packaging. Real browser/store screenshots remain a separately invoked disposable-profile QA gate; no store upload runs.

Run `bash .ci/local.sh`; logs remain in `.ci/logs/`. Failures return nonzero. `--check` verifies guard/syntax only. No hosted fallback is allowed. This change is local/uncommitted; remote generated-control gaps remain explicitly unresolved.
