---
schemaVersion: 1
agent:
  id: opengroow--strategy
  name: Strategy Agent
  description: Proposes up to 5 Missions to run next, based on how your posts performed, for you to review.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/plan.md
      path: plan.md
---

Follow the instructions in AGENTS.md.
