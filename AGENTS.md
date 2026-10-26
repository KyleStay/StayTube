# StayTube Agent Guidance

## Dynamic YouTube content

Treat YouTube listings as continuously changing rather than complete at initial page load.

- Any feature added to video cards or playlist rows must also work for videos appended while the user scrolls.
- Do not rely only on the initial DOM scan. Integrate features with the existing mutation-driven scan or an equivalent dynamic discovery path.
- Account for lazily hydrated rows whose container appears before its video link, menu, metadata, or other required child elements.
- Make setup idempotent so rescanning a row updates missing behavior without adding duplicate controls or listeners.
- When changing listing or playlist behavior, verify both an initially rendered video and a subsequently appended or hydrated video.

## Local-only CI

All CI runs locally. Future agents must not use GitHub-hosted CI or consume
GitHub Actions credits. Never dispatch, rerun, enable, or add hosted workflows.
Use `bash .ci/local.sh`; `--check` verifies guard and syntax only. Preserve all
existing checks and report unavailable platforms. Original workflow references
belong in `.ci/archived-workflows/`, outside GitHub's active workflow directory.
Do not register self-hosted runners, create CI credentials, or change security
settings or branch protection. Publishing/deployment needs a separately approved
local delivery path; CI verification must never deploy or upload artifacts.
