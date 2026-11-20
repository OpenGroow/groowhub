# Plan the next Missions

## Payload

The payload is empty (`{}`). Everything you need, you read through the `opengroow` MCP server.

## Workflow

1. **Read what was already decided.**
   Before you plan, call `list_plan_history` and read it. It lists your previous Plans, newest first, with the items you proposed (`items`), the items the user declined when approving (`declinedItems`) and the feedback the user gave when rejecting a Plan (`feedback`). Do not propose again an item that was declined, and apply every piece of feedback. You may revisit a declined idea only if you say in the item's `reason` what changed since. Then read `list_recent_missions` and `get_analytics_summary` as usual.
2. **Read the Brand Core** with `get_brand_core`. Every proposal must fit the audience, tone and editorial rules. When it returns `null`, say so in the summary and keep the proposals generic.
3. **Read what can run** with `list_mission_types`. You may only propose a `type` that appears there. Never propose the `plan` type itself. Each type also tells you what a valid payload looks like: `defaultPayload` (its keys), `fields` (typed, with required fields and the allowed options of a select) and `lastSuccessfulPayload` (the payload of the last Mission of that type that succeeded, when there is one).
4. **Plan only from results.** Every item must start from a Mission that is done and whose Publication has measured analytics (`list_publications` returns `status: "data"`). You never invent an item from nothing, from the Brand Core alone or from a gap you imagine. If no Publication has `status: "data"`, skip to step 6 and return an empty plan.
5. **Read the performance** with `get_analytics_summary` (default window, then a shorter `days` if the recent trend matters), and `list_publications` for the posts behind a group when you need examples.
   - A group with status `no_data` means "linked to analytics but nothing read yet". `unavailable` means the channel has no analytics adapter. Neither means "it performed badly": draw no conclusion from them, and say that you could not measure them.
   - Read each metric with its direction. For a metric where lower is better (a search position, for example), a falling number is an improvement.
   - Compare like with like (same platform and format) and prefer groups with enough publications to mean something. Do not conclude from one post.
6. **Find the winners and replicate them.** Call `list_publications` with `sort: "best"` (and a `limit`) to get the top performers by each adapter's primary metric, direction respected. Each one carries `missionId`, `missionPayload`, the payload of the Mission that produced it, and `missionType`. Never rank a Publication whose `status` is `no_data` or `unavailable`. For each winner worth repeating, set the item's `basedOn` to its `missionId`, start from its `missionPayload`, change **2 or 3 elements** (the topic, the angle, the hook, the format, a style option: whatever the `fields` of that type allow) and keep the rest, so the new item is the same recipe with a few deliberate changes. Do not copy a payload unchanged, and do not rewrite it from scratch. When a winner's Mission type is not in `list_mission_types`, replicate it with the closest type that is, and say so.
   Call `list_sources` to see how the Project's content is made (the Sources it analysed: their content patterns, reproducible elements and analysis). When a winner clearly echoes a Source (same pattern, same hook, same origin), name that Source in the item's `reason` and prefer its reproducible elements for the changes. A Source is read-only context: you never create or change one.
7. **Decide** what to produce next among the winners: what worked deserves more of the same with deliberate changes. Rank by expected value for the Project and keep the best, **at most 5 items**. Fewer is better than padding. Do not propose an item without a measured origin. If there is none (no Mission has measured analytics yet, or nothing worth repeating), return an empty `plan` and explain why in the summary, for example "No Mission has measured analytics yet: publish and wait for the first readings." The user sees that explanation.
8. **Write each item** as described below, then write the result.

## Each Plan item

```json
{
  "type": "create_article",
  "basedOn": "<missionId of the winning Publication>",
  "payload": { "topic": "a new angle", "length": "long" },
  "reason": "Replicates \"Article 12\" (4,800 views, the best of the month): same structure, new topic, shorter intro and a question as the title. Echoes the Source \"Example guide\" (example.com).",
  "figures": [
    { "label": "Articles, median views (30 days)", "value": 1200 },
    { "label": "Reels, median views (30 days)", "value": 310 }
  ]
}
```

- `type`: a Mission type from `list_mission_types`.
- `basedOn`: required. The `missionId` exactly as `list_publications` returns it, of a done Mission whose Publication is measured (`status: "data"`). OpenGroow refuses an item whose Mission is not done, has no measurement, or is not this Project's.
- `payload`: what a person would fill in to create that Mission by hand, written with the keys of `defaultPayload` / `fields` (and the shape of `lastSuccessfulPayload`). For a replication, it is the winner's `missionPayload` with its 2 or 3 changes. When you do not know a field, leave it out: the Mission type's own defaults apply. Do not invent publishing channels, dates or identifiers.
- `reason`: one or two sentences a human can judge, in the Project's language. For a replication, cite the originating Mission (its name or number, from `missionName`) and say what you changed and why; when relevant, cite the Source (its label and origin) it echoes.
- `figures`: at least one, taken from the tools' answers, never estimated. `label` says what the number is and over which period; `value` is a number or a short string.

OpenGroow checks `basedOn` and each item with the rules of a manual Mission creation (active type, publishable channels, scheduling) and sends back the ones that fail, with their position: correct those items and write the result again.

## Result

Write the RunResult with the Plan next to the summary. The Plan is always reviewed by a human, so the status is `needs_human_review`:

```json
{
  "status": "needs_human_review",
  "summary": "Two sentences: what the data shows, and what you propose.",
  "reviewQuestions": [],
  "plan": [ { "type": "...", "basedOn": "...", "payload": {}, "reason": "...", "figures": [ { "label": "...", "value": 0 } ] } ]
}
```

With nothing measured, write `"plan": []` and put the explanation in `summary`: an empty Plan without an explanation is refused.

Never write `status: "success"` for a Plan, and never put more than 5 items in `plan`.
