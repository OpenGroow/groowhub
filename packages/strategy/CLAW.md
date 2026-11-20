---
schemaVersion: 1
agent:
  id: opengroow--strategy
  name: Strategy Agent
  description: Reads how the Project's published posts performed, together with its Missions and Brand Core, and proposes a Plan of at most 5 Missions that a human reviews and approves.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/plan.md
      path: plan.md
---

Follow the instructions in AGENTS.md.
