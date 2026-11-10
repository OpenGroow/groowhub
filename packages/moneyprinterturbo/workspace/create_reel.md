# Create reel

## Payload

Two ways this Mission's payload can arrive:

```json
{ "observationId": "..." }
```

```json
{ "prompt": "..." }
```

Exactly one of `observationId`/`prompt` is present — never both, never
neither. Which one is present tells you which workflow branch below to
follow. The payload carries no publishing settings: where the reel goes is
chosen by the human on the Mission, and you never publish.

## Workflow

1. **If `payload.observationId` is present** (routed here from
   `routing`, or a human picked an existing Observation
   to replicate): read `# Observation Production Source` first, then
   `# Brand Core`. **The source is the mould; the Brand Core only
   colours it.** The result must be recognisable as the same kind of reel
   as the source, not as a generic brand video.

   **From the source, keep (these drive the reel):**
   - `Format` / `Media structure`: same number of shots and same total
     duration (roughly). Match the cut rhythm from `Analysis > Pacing`.
   - `Creative Mechanic` and `Reproducible Elements`: same shot types
     (e.g. close-ups, montage of objects, POV), same way text/narration is
     used, same setting and light, same hook → build → payoff shape.
   - `Analysis > Hook`: reuse its *structure* only (for example "a
     contrast between two ways of saying the same thing", or "three
     parallel clauses"), never its words.

   **No lifted wording.** Everything you write must be new. Do not reuse any
   run of three or more consecutive words from the source's `Hook`,
   `Narrative structure` or quoted lines, nor its signature phrases,
   refrains, rhymes, opening formulas (for example "In X we say…, in Y we
   say…": keep the idea of a contrast between two ways of saying a thing,
   but with entirely different words and no shared opener) or images (the
   objects, places and settings its lines mention). Before calling `produce_video`, compare your `video_script`
   with the source's quoted text line by line and rewrite any line that
   echoes one. A paraphrase is an echo: do not answer the source line by
   line, do not keep its sentence openers ("Leave…", "I only ask…", "Let…"),
   and do not keep its arc or life stage (if the source follows a couple
   growing old, choose another moment such as a first meeting, a move-in or
   a long-distance wait). Keep only the structure: shot count, pacing,
   medium, text-on-screen mechanic and the shape of the payoff.

   **From the source, never use:** anything under
   `Topic-Specific Elements (do not use)` (subject matter, objects, colours,
   exact text, hashtags). Replace the topic, keep the mechanic.

   **From the Brand Core, use only:** `Audience` (who it is for), `Tone of
   Voice`, `Constraints`, and `Things to Avoid`. Treat `Offer`,
   `Positioning`, `Editorial Rules` and `Additional Notes` as background:
   they decide *which moment from the brand's world* you transpose the mechanic to,
   not the shape of the reel.

   **Transposition rule:** pick one concrete moment or object from the
   brand's world (the situations its `Audience` lives, the things they
   handle) that fits the source's mechanic. The reel does **not** have to
   show or mention the product. Do not default to writing scenes unless the
   source itself is about writing. At most, the last line may softly point to
   the brand's idea, in the brand's own words; a source with no CTA gets no
   CTA.

   **Text is not an object.** When the source's mechanic is text-driven
   (a text overlay, a poem, a quote, a "static shot of text/a page"), the
   words are an *overlay on the footage*. MPT renders your `video_script`
   as narration and subtitles over the footage, so that is where the message
   goes. The footage itself must be a plain background scene (a window with
   soft light, a quiet street at dusk, a pair of hands, a sky, a kitchen
   table…), never a depiction of the text as a
   physical thing. Wording such as "poem on a page" in the source's
   `Format` describes how the text looks, not what to film. Never put paper,
   a page, a letter, a note, a card, a book, handwriting, ink, a pen or a
   typewriter in `video_subject` or `video_terms`, unless the source's own
   footage is that object. Keep the source's camera behaviour (for example a
   single static, unmoving shot means one calm continuous scene, no cuts).

   **People on screen.** MPT generates one clip per `video_terms` entry, from
   that term alone (the `video_subject` does not drive the footage). Footage
   is therefore only as human as the terms. Every one of the `video_terms`
   must feature a person or a couple (no term about an object, a place or a
   landscape alone), each doing something specific in a specific place (for example "couple sharing coffee window", "woman
   reading by window dusk", "two people walking wet street"). Prefer figures
   seen from behind, in profile, in silhouette or as hands in close-up over
   faces looking at the camera, since generated faces often look uncanny.
   Vary the person, the action and the place from one term to the next. Show
   people living the moment, never reacting to a
   gift, a message or the product (no fake partner reactions).

   Write the fields in this order:
   - `video_subject`: describe the *visual* reel shot by shot in one dense
     paragraph: the same shot types and count as the source, applied to your
     chosen moment/object, with setting, light and mood copied from the
     source's structure. Name concrete things on screen.
   - `video_script`: MPT burns every line of this script onto the footage as
     subtitles, so it is also the **on-screen text overlay**. When the
     source's message is a text overlay, write the script as that overlay:
     short, standalone lines that read well on screen, one idea per line,
     no stage directions. A short narration mirroring the source's text
     structure and length (a ~10 s source means ~2-4 short lines, not a
     30 s pitch). Same hook grammar, same absence or presence of a payoff
     and CTA as the source. Tone from `Tone of Voice`; no product pitch.
   - `video_terms`: 3-6 visual search phrases (2-4 words each) taken from
     the source's *visual* structure (shot type, framing, light, setting,
     e.g. "close up hands", "soft outdoor light") combined with your chosen
     moment/object. Never terms about writing, paper, letters, poems on a
     page or handwriting.

   `publish` is publication metadata only: never use its title or
   description as input for `video_subject` or `video_script`.

   Before calling `produce_video`, check: if someone saw the source and your
   reel side by side, would they say "same format, different subject"? If
   they would say "this is a brand ad", rewrite.

2. **If `payload.prompt` is present** (a human-authored brief, no source to
   replicate): use it directly as `video_subject`. Write `video_script`
   yourself from the prompt — a complete spoken narration script — unless
   `payload.prompt` already reads as a word-for-word script the human wants
   spoken verbatim, in which case pass the same text as both
   `video_subject` and `video_script`. Also write `video_terms` as in step 1.

3. Call `produce_video` with `video_subject`, `video_script`, and
   `video_terms` from whichever branch above you followed, as arguments.
   Leave `video_source` and `voice_name` unset unless the human asked for
   one: the MCP applies the operator's own defaults (`MPT_DEFAULT_VIDEO_SOURCE`,
   `MPT_DEFAULT_VOICE_NAME`), which match the credentials of their MPT instance.
   Leave every other field (`video_aspect`, `bgm_type`, `subtitle_enabled`,
   etc.) unset — MPT's own defaults apply for those. The tool returns
   immediately with `{ "runId": "...", "status": "started" }`. `runId` is
   MPT's own task id — keep it, it never changes for this Mission Run.

   Write an `in_progress` RunResult and stop. `publishable` carries only the
   text of the post — `kind: "video"`, a `caption` (the post text, hashtags
   included) and a short `title` — written for this Instance's own
   product/offer. Never put a `videoUrl` or `coverUrl` in it: OpenGroow
   fetches the video from the MCP when the render completes.

   ```json
   {
     "status": "in_progress",
     "summary": "Reel generating.",
     "reviewQuestions": ["Is the reel ready to publish?"],
     "publishable": {
       "kind": "video",
       "title": "<short title>",
       "caption": "<post text>"
     },
     "job": {
       "mcpServer": "moneyprinterturbo-mcp",
       "jobId": "<the runId returned by produce_video>",
       "jobType": "produce_video"
     }
   }
   ```

4. OpenGroow polls `get_run_status(runId)` on its own schedule. When the job
   completes it calls `get_video(runId)` itself, adds the video URL to your
   `publishable` and turns the Mission into `needs_human_review`. There is
   nothing further for you to do in this Run — never call `get_run_status`
   or `get_video` yourself, and never publish; the Publisher does that after
   human approval.

## Never

- Never write a media URL in `publishable`, and never publish.
- Never leak the source Observation's specific topic into `video_subject`
  or `video_script`.
- Never call more than one `produce_video` per Mission Run.
- Never call `produce_video` without `video_script`, `video_terms`,
  `video_source`, and `voice_name` set — MPT's own script/terms generation
  and default footage source have no credentials configured and will fail
  the job.
