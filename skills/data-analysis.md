---
name: Data Analysis
slug: data-analysis
description: Load, inspect, compute over, and interpret data with real code execution, then report findings tied to the numbers. Use for "analyze this data", "what's the trend", "compute statistics", or spreadsheet/CSV/JSON work.
triggers: data, csv, dataset, analyze, statistics, trend, correlation, spreadsheet, metrics, aggregate, chart
tools: file_read, file_list, code_exec, file_write
---
# Data Analysis

Compute with code; never eyeball numbers or estimate a total by hand.

## Method
1. **Inspect first.** Read the file, print the shape: rows, columns, dtypes, head, null counts. Never assume the schema from the filename.
2. **Check quality before analysis.** Missing values, duplicates, mixed types, outliers, inconsistent units or date formats. Report what you found and how you handled it — this materially changes conclusions.
3. **Compute with `code_exec`.** Use pandas/numpy (or plain Python). Print intermediate results so the arithmetic is auditable.
4. **Validate the result.** Sanity-check against a simpler independent calculation (row counts, a manual subset, a known total). If the two disagree, the analysis is wrong until explained.
5. **Interpret carefully.** Correlation is not causation. State the sample size. Distinguish a real trend from noise, and say when the data cannot support a conclusion.

## Output
- **Headline finding** with the actual number.
- **Method** — what you computed and any cleaning decisions.
- **Caveats** — data limits, missingness, assumptions.
- Show the code you ran so results are reproducible.
- For repeated work, save the script or a cleaned dataset with `file_write`.