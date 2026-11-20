# Plan the next Missions

## Payload

The payload is empty (`{}`). Everything you need, you read through the `opengroow` MCP server.

## Workflow

1. **Read what was already decided.**
   Before you plan, call `list_plan_history` and read it. It lists your previous Plans, newest first, with the items you proposed (`items`), the items the user declined when approving (`declinedItems`) and the feedback the user gave when rejecting a Plan (`feedback`). Do not propose again an item that was declined, and apply every piece of feedback. You may revisit a declined idea only if you say in the item's `reason` what changed since. Then read `list_recent_missions` and `get_analytics_summary` as usual.
2. **Read the Brand Core** with `get_brand_core`. Every proposal must fit the audience, tone and editorial rules. When it returns `null`, say so in the summary and keep the proposals generic.
3. **Read what can run** with `list_mission_types`. You may only propose a `type` that appears there. Never propose the `plan` type itself.
4. **Read the performance** with `get_analytics_summary` (default window, then a shorter `days` if the recent trend matters), and `list_publications` for the posts behind a group when you need examples.
   - A group with status `no_data` means "linked to analytics but nothing read yet". `unavailable` means the channel has no analytics adapter. Neither means "it performed badly": draw no conclusion from them, and say that you could not measure them.
   - Read each metric with its direction. For a metric where lower is better (a search position, for example), a falling number is an improvement.
   - Compare like with like (same platform and format) and prefer groups with enough publications to mean something. Do not conclude from one post.
5. **Decide** what to produce next: what worked deserves more of the same, what is flat deserves a change, and gaps (a platform or format with nothing recently) may deserve a try. Rank by expected value for the Project and keep the best, **at most 5 items**. Fewer is better than padding. If there is nothing worth proposing, return an empty `plan` and say why in the summary.
6. **Write each item** as described below, then write the result.

## Each Plan item

```json
{
  "type": "create_article",
  "payload": {},
  "reason": "Articles drive most of the measured views and none was published this month.",
  "figures": [
    { "label": "Articles, median views (30 days)", "value": 1200 },
    { "label": "Reels, median views (30 days)", "value": 310 }
  ]
}
```

- `type`: a Mission type from `list_mission_types`.
- `payload`: what a person would fill in to create that Mission by hand. When you do not know a field, leave it out: the Mission type's own defaults apply. Do not invent publishing channels, dates or identifiers.
- `reason`: one sentence a human can judge, in the Project's language.
- `figures`: at least one, taken from the tools' answers, never estimated. `label` says what the number is and over which period; `value` is a number or a short string.

OpenGroow checks each item with the rules of a manual Mission creation (active type, publishable channels, scheduling) and sends back the ones that fail, with their position: correct those items and write the result again.

## Result

Write the RunResult with the Plan next to the summary. The Plan is always reviewed by a human, so the status is `needs_human_review`:

```json
{
  "status": "needs_human_review",
  "summary": "Two sentences: what the data shows, and what you propose.",
  "reviewQuestions": [],
  "plan": [ { "type": "...", "payload": {}, "reason": "...", "figures": [ { "label": "...", "value": 0 } ] } ]
}
```

Never write `status: "success"` for a Plan, and never put more than 5 items in `plan`.
