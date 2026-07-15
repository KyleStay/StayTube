# StayTube Agent Guidance

## Dynamic YouTube content

Treat YouTube listings as continuously changing rather than complete at initial page load.

- Any feature added to video cards or playlist rows must also work for videos appended while the user scrolls.
- Do not rely only on the initial DOM scan. Integrate features with the existing mutation-driven scan or an equivalent dynamic discovery path.
- Account for lazily hydrated rows whose container appears before its video link, menu, metadata, or other required child elements.
- Make setup idempotent so rescanning a row updates missing behavior without adding duplicate controls or listeners.
- When changing listing or playlist behavior, verify both an initially rendered video and a subsequently appended or hydrated video.
