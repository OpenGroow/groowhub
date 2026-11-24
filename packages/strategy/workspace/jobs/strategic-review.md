# Strategic Review Job

This is a Job Run, not a Mission. You only read. Never create or change a Mission, a Production Recipe, a Publication or anything else, and never claim you did. Do not browse the web. You use exactly three kinds of tool: the read-only tools of the `opengroow` MCP server, the file read tool (to read the run file), and the file write tool (to write the result, once, at the end). Nothing else: no shell command, no script.

## Inputs

1. The run file (`jobs/<job>/run.md`) states the analysis period, as `from` and `to` in epoch milliseconds. OpenGroow fixed it when the Run started. Pass exactly these two values as `from` and `to` to every analytics call (`get_analytics_summary`, `list_publications`, `list_production_recipes`), and never `days`. Do not choose another period.
2. `get_brand_core`: the Project's brand, offer, audience, positioning and objectives. This is what "strategically relevant" means for this Project. Do not infer them from anywhere else.
3. `get_strategic_memory`: the memory this Review starts from. If `exists` is false, this is the first Review and the previous memory is empty.
4. `get_analytics_summary`, with `groupBy` `family` and `groupBy` `recipe` as needed, plus `list_publications` and `list_production_recipes`, for the measurements of the period and the Production Recipes and Creative Families in use.

Read what you need, then answer. Do not call a tool in a loop to reach completeness: if something is cut, say so.

## How to read the measurements

- Missing is not zero. A Publication with status `no_data` or `unavailable`, a metric that is absent, or a recipe never published has no measured value. Do not count it as a score of zero, and do not rank it below measured items.
- Partial, truncated, ambiguous or shared measurements are not exhaustive and not independent evidence. When a result says `partial`, `truncated`, `scanLimited` or `unattributed`, or when several Publications share one measurement or one Production Recipe, say what is missing and treat the finding as limited. A figure counted twice is one observation.
- Cumulative is not period growth. A measurement is a running total since publication. Do not present it as growth during the period unless the data gives a difference for that period.
- Overlapping periods are not independent. This Review may overlap earlier ones and reads the same Publications again. Agreement between your period and the memory is not new confirmation unless the evidence is new (new Publications, new measurements).
- Correlation is not causation. A Creative Family or Production Recipe that coincides with better numbers has not been shown to cause them. Say "coincides with", and state other plausible factors you can see (platform, format, age, volume).
- Content performance, strategic relevance and business performance are three different things. Content performance is what the platform measurements show (views, engagement). Strategic relevance is the fit with the Brand Core. Business performance is the effect on the Project's own objectives, which the measurements usually do not show. Never present one as another, and say when a conclusion rests on only one of them.
- Small volumes prove little. Say how many Publications a statement rests on.
- Do not invent a figure, an entity or an id. Every number you report comes from a tool result.

## The Performance Report (`report`)

Markdown, for a person who reads it to follow the Project. It covers this period only: what was published, what performed, what did not, what could not be measured and why, how it relates to the Brand Core objectives, and which questions the data leaves open. Name Creative Families and Production Recipes by their name as the tools return them. Keep it under 40000 characters.

## The Strategic Memory (`consolidatedMemory`)

The memory is knowledge, not decisions and not instructions to other Agents. It is Markdown you organize freely, with no fixed template: put first what matters most for the Project, keep it concise, and group it however it reads best. Distinguish what is established (backed by evidence you can cite) from what is a hypothesis, and keep that distinction visible in the text. Keep it under 16000 characters.

Consolidate the previous memory with this period's evidence:

- Preserve what stays valid. Keep established knowledge and open hypotheses that the new evidence does not contradict, in your own concise wording.
- Never promote a hypothesis to established knowledge without new evidence. Seeing the same Publications again in an overlapping period is not new evidence.
- Remove only what is obsolete, invalidated by the new evidence, or redundant. Never drop something just to make room or because this period says nothing about it.
- When nothing justifies a change, return the previous memory unchanged, character for character. A Review with nothing new still returns its report. On a first Review, an empty memory is acceptable when the evidence supports nothing yet.
- Never invent insights. If the data does not support a statement, leave it out.

## References

List the entities your report and memory rely on, by their exact ids from the tool results:

- `familyIds`: Creative Family ids.
- `recipeIds`: Production Recipe ids.
- `publicationIds`: Publication ids.

At most 200 per type. Only ids you read in this Run, or ids already listed in the references of the memory you started from. Use an empty list when there is none. Never guess an id: a wrong id fails the whole Run.

## Result

Write the result to the requested outputs path as a single bare JSON object, and nothing else: no Markdown fence, no text before or after, no RunResult wrapper (no `status`, `summary` or `additionalDetails`). It must have exactly this shape:

{"report": "<Markdown>", "consolidatedMemory": "<Markdown>", "references": {"familyIds": [], "recipeIds": [], "publicationIds": []}}

Write it directly with the file write tool, in one call, to the requested outputs path. This is a plain write, not a computation:

- Do not create temporary files or scripts, in any language, and do not use shell commands to build, serialize or check the JSON.
- Treat every entity id as an opaque string: copy it exactly from the tool results, never reformat it, never check its length or shape. OpenGroow validates the result after you finish and tells you what is wrong.
- Write the JSON string values carefully (escape quotes and newlines) rather than checking them with a tool.

`report` cannot be empty. `consolidatedMemory` is the complete memory after this Review (not a diff), and may be empty only when there is no previous memory and nothing established. Escape the JSON strings correctly. If a limit is exceeded, the Run fails, so shorten the memory first.
