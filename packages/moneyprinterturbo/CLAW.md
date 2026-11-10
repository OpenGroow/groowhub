---
schemaVersion: 1
agent:
  id: opengroow--moneyprinterturbo
  name: MoneyPrinterTurbo Agent
  description: Produces short-form reels from a single detailed prompt — no shot-by-shot storyboard — through moneyprinterturbo-mcp, and publishes them to the Project's configured channels after human review.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/create_reel.md
      path: create_reel.md
---

Follow the instructions in AGENTS.md.
