---
name: Deep Research
slug: deep-research
description: Plan and execute multi-source web research, cross-check claims, and produce a cited synthesis. Use for "research X", "compare options", "what's the current state of Y", or any question needing several sources rather than one lookup.
triggers: research, investigate, deep dive, compare, sources, cite, literature, state of the art, survey, market
tools: web_search, browser_read, memory_search, memory_write, file_write
---
# Deep Research

Goal: an accurate, sourced answer — not a pile of search results.

## Method
1. **Frame the question.** Restate the goal in one line. List 2–4 sub-questions that must be answered.
2. **Search breadth first.** Run several distinct `web_search` queries — vary wording, not just keywords. Prefer primary sources (official docs, filings, papers) over aggregators.
3. **Read, don't skim titles.** Use `browser_read` on the most promising results. A search snippet is a lead, not evidence.
4. **Cross-check.** Any load-bearing claim needs at least two independent sources. When sources disagree, say so and explain which is more credible and why.
5. **Record as you go.** Note the URL next to each fact while reading; reconstructing citations afterwards loses accuracy.

## Output
- Lead with the direct answer in 2–3 sentences.
- Then supporting detail under short headings.
- Cite inline as markdown links: `[source](url)`.
- End with **Confidence** (high/medium/low) and **Open questions** — what you could not verify.
- Never invent a URL, statistic, date, or quote. If you could not find it, say "not found".

## Anti-patterns
- Do not present a single source as consensus.
- Do not pad with restated questions.
- Do not bury the answer under process narration.