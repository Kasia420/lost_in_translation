# Changelog

Factual record of changes to code, data and methods. No interpretation of results.

## v2 run (2026-11)

### Collection settings (step 3a/3b)

| Setting | v1 | v2 |
|---|---|---|
| Model requested | `claude-sonnet-4-5` (alias) | `claude-sonnet-4-5-20250929` (dated snapshot) |
| temperature | 0.0 | 0.0 |
| max_tokens | 600 | 2000 |
| Prompt text | prompt only | prompt + `" Answer in about 150 words."` (EN) / `" Odpowiedz w około 150 słowach."` (PL) |
| Wikipedia baseline | fetched for v1 | same v1 files, not re-fetched |
| API version / SDK | not recorded | `anthropic-version: 2023-06-01`, `anthropic` 0.125.0 |
| Figure jitter | unseeded | seeded (`jitter_seed=2026`) |

Base prompts (`data/raw/v2/prompts.csv`) are identical to v1.

New columns logged per row in `data/raw/v2/llm_responses.csv`: `model_requested`,
`model_returned` (model id reported by the API), `stop_reason`, `input_tokens`,
`output_tokens`, `message_id`, `request_id`, `anthropic_version`, `sdk_version`,
`temperature`, `max_tokens`, `length_instruction`. In v2 `model_requested` replaces v1's
`model` column.

New option: `python -m src.run collect --run v2 --dry-run` prints the exact prompts and
settings without calling the API.

## Repository restructure (portfolio, 2026-11)

This repository was created from the course submission. The graded version is kept as
tag `v1-course-submission` (commit `31863c3`) in the original course repository, which
also holds the earlier stage-by-stage scripts.

### Moved / imported

| From (course submission) | To |
|---|---|
| `kasia_code.py` (build / collect / wiki) | `src/prompts.py`, `src/collect.py`, `src/wiki.py` |
| `kasia_code_analyze.py` | `src/analyze.py` |
| constants from both scripts | `src/config.py` |
| `prompts.csv`, `llm_responses.csv`, `wiki_articles.csv`, `wiki_missing.csv` | `data/raw/v1/` (unchanged bytes) |
| `analysis_per_prompt.csv` | `data/processed/v1/` (unchanged bytes) |
| `stats_summary.txt` | `results/v1/stats/` (unchanged bytes, Windows line endings) |
| `fig1`–`fig4` PNGs, `captions.txt` | `results/v1/figures/` (unchanged bytes) |
| paper draft PDF | `docs/lost_in_translation_paper_v1.pdf` |

Not carried over: stage scripts (`stage1_api_poc.py`, `stage2_…`, `stage3_…`,
`build_prompts.py`, `config.py`, `01_collect_llm.py`, `02_fetch_wikipedia.py`), unrelated
course files.

### Code changes (no change to computed values)

- Single entry point `python -m src.run {build,collect,wiki,analyze,all} [--run v1]`.
  `all` now also runs `analyze` (before: build, collect, wiki).
- Paths come from `src/config.py` per run (`data/raw/<run>/`, `data/processed/<run>/`,
  `results/<run>/`) instead of `data/`, `figures/` and the script folder.
  Folders are created when written to, not at import time.
- `analyze` refuses to overwrite existing results unless `--overwrite`; `--out DIR`
  writes a reproduction elsewhere.
- `build` no longer rewrites an existing `prompts.csv`: it is left as is if identical to
  the prompt list and the command stops if it differs.
- Wikipedia User-Agent contact read from `WIKI_CONTACT` (env / `.env`) instead of being
  hardcoded.
- `.env` support via `python-dotenv`; `.env.example`, `.gitignore`, pinned `requirements.txt`.
- Docstrings and comments translated to English; console messages and the text of
  `stats_summary.txt` unchanged (Polish).
- Analysis model choices, statistics and figure code unchanged.

### Reproduction check

`python -m src.run analyze --run v1 --out scratch/v1_repro` on the stored v1 data:

- `stats_summary.txt`: identical to the submitted file apart from line endings (CRLF → LF).
- `analysis_per_prompt.csv`: all text columns identical; every numeric column within 1e-6.
- `captions.txt`: identical apart from line endings.
- Figures: same values; strip-plot jitter in fig1/fig3 is unseeded, so point positions
  and anti-aliasing differ.

### Known properties of the v1 data (recorded, not changed)

- `model` column holds the requested alias `claude-sonnet-4-5`; the model id returned by
  the API, `stop_reason` and token usage were not logged.
- Two answers end mid-sentence: `l02` (en, 235 words) and `l08` (pl, 212 words). Kept in
  all analyses.
- XLM-R input over 512 tokens (truncated before scoring): 1 of 25 EN answers, 0 of 25 PL
  answers; Wikipedia lead sections: 7 of 24 EN, 4 of 24 PL.
- Answer timestamps: 2026-06-26 19:04–19:13.
