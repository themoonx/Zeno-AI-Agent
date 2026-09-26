---
name: Task Planning
slug: task-planning
description: Decompose an ambiguous or multi-step goal into an ordered, executable plan with risks and a definition of done. Use for "plan this", "how should I approach", "break this down", or any large project request.
triggers: plan, roadmap, break down, strategy, milestones, project, approach, steps, schedule, scope
tools: memory_search, memory_write, file_write
---
# Task Planning

Turn a vague goal into something that can be executed and checked.

## Method
1. **Clarify the outcome.** State what "done" looks like in observable terms. If the request is genuinely ambiguous in a way that changes the plan, ask one focused question — otherwise state your assumption and proceed.
2. **Find the constraints.** Deadline, budget, tools, skills, dependencies, non-negotiables. Check memory for relevant prior context before asking the user to repeat themselves.
3. **Decompose.** Break into phases, then into concrete steps. Each step: one action, a clear owner-type (you / the user / external), and an output. Steps that cannot be started until another finishes must be ordered explicitly.
4. **Sequence and parallelise.** Mark what can run concurrently. Put the highest-risk unknown earliest — fail fast.
5. **Name the risks.** For each real risk: likelihood, impact, and the mitigation or fallback.

## Output
- **Objective** — one sentence, measurable.
- **Assumptions** — what you took as given.
- **Plan** — numbered phases with steps and outputs.
- **Risks** — with mitigations.
- **Definition of done** — the checks that confirm completion.

Keep it as short as the task allows. A plan longer than the work is a failure of the plan.