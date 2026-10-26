# Local CI

Preserves the existing dependency-free Node tests, JavaScript syntax checks and Chrome store ZIP/hash packaging. Real browser/store screenshots remain a separately invoked disposable-profile QA gate; no store upload runs.

Run `bash .ci/local.sh`; logs remain in `.ci/logs/`. Output is printed after the build completes, and failures return nonzero. `--check` verifies guard/syntax only. No hosted fallback is allowed. The local guard rejects active workflow files and GitHub Actions execution; it does not change hosted security settings or branch protections.
