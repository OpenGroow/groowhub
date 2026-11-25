---
schemaVersion: 1
agent:
  id: opengroow--strategy
  name: Strategy Agent
  description: A system-level agent that periodically reads how the Project's content performed and keeps a concise Strategic Memory of what it learned. It also proposes a Content Plan for a coming period. It only reads OpenGroow's data and never creates a Mission, a Production Recipe or a Publication.
workspace:
  bootstrapFiles:
    AGENTS.md:
      source: workspace/AGENTS.md
  files:
    - source: workspace/jobs/strategic-review.md
      path: jobs/strategic-review.md
---

Follow the instructions in AGENTS.md.
