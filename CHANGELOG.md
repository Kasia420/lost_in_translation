# Changelog

Factual record of changes to code, data and methods. No interpretation of results.

## Website data export (2026-11-07)

- New command `python -m src.run site-data [--out DIR]` (`src/site_export.py`): writes
  `site/public/data/{meta,topics,results,word_counts,embeddings3d,tatoeba}.json` for the website.
- Per-topic metrics are copied from `data/processed/<run>/`; tables from `results/`.
- LaBSE embeddings of all 100 answers and 48 Wikipedia leads recomputed with the
  `src/analyze.py` code; recomputed cosines match the stored values (max diff 4.2e-07).
  Projected to 3D with PCA for display only (explained variance 0.118 + 0.107 + 0.078 = 0.302).
- Check at the end of the export: all 51 rows of `results/results_table.csv` are rebuilt
  from the JSON files alone with the `src/tables.py` statistics code (max abs diff 9.9e-17);
  `word_counts.json` equals `results/word_counts.csv`.
- No data, results or analysis code changed.

## Documentation and licence (2026-11-07)

- `docs/portfolio_report.md`: short report (author's text).
- README: research question and hypotheses, v2 interpretation, conclusion and AI assistance
  sections (author's text) in place of the TODO placeholders; link to the report.
- `LICENSE`: MIT for the code. README states CC BY-SA 4.0 for `data/` (includes Wikipedia
  text) and CC BY 2.0 FR for the Tatoeba sentences.
- `results/social_preview.png`: 1280×640 image for the GitHub social preview, built from
  `results/v2/figures/fig2_sentiment.png`.
- No code, data or results changed.

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

### Collection (2026-11-06 17:47–17:54)

- 50/50 answers collected, no retries or failures.
- `model_returned` = `claude-sonnet-4-5-20250929` for all 50 rows.
- `stop_reason` = `end_turn` for all 50 answers (EN 25, PL 25); none `max_tokens`.
- Output tokens per answer, median (min–max): EN 243 (229–268), PL 358 (336–382).
- Length (`n_words`, median): v2 EN 155, PL 128; paired EN−PL gap 29 words (v1: EN 211,
  PL 165, gap 46).

### Analysis (steps 3a, 3c, 3d, 3e)

- `python -m src.run analyze --run v2`: same code as v1 → `results/v2/stats/stats_summary.txt`,
  `results/v2/figures/`, `data/processed/v2/analysis_per_prompt.csv`. v1 results untouched.
- Figure 4 caption is run-specific: for runs with a length instruction it states the
  instruction and `max_tokens`; the v1 caption text is unchanged.
- New word count `words_clean` (`src/extended.py: clean_word_count`): whitespace tokens that
  contain a letter or digit, after removing a line-initial heading/list/quote marker (`#`,
  `-`, `*`, `+`, `•`, `1.`/`1)`, `>`). `n_words` is kept unchanged. Reported for v1 and v2 in
  `results/word_counts.{csv,md}` and `results/comparison/fig7_word_counts.png`.
- Wikipedia baseline sentiment (3c): the same classifier and 512-token truncation applied to
  the EN and PL Wikipedia lead sections (24 topics); PL−EN gap of the answers tested against
  the PL−EN gap of the Wikipedia leads (paired, n=24). Figure: `results/baseline/fig5_wiki_sentiment.png`.
- Chunk-and-average sensitivity check (3c): texts split into consecutive 510-token windows
  (+ start/end tokens), polarity averaged weighted by window length; applied to answers and
  Wikipedia leads and reported next to the truncated (primary) values. For texts of ≤512
  tokens it equals the truncated value (checked). Texts over 512 tokens: v1 answers EN 1
  (h09), PL 0; v2 answers 0; Wikipedia leads EN 7, PL 4.
- Calibration (3d): 1000 EN–PL translation pairs from Tatoeba (exports dated 2026-10-31;
  pol→eng links, each sentence used once, sampled with seed 2026), scored with the same
  classifier settings; sample with Tatoeba ids in `data/raw/calibration/tatoeba_en_pl_sample.tsv`,
  scores in `data/processed/calibration/tatoeba_scored.csv`, figure `results/calibration/fig6_calibration.png`.
- Results table (3e): `results/results_table.{csv,md}`, all tests for v1, v2 and the
  calibration with n, medians, median of paired differences, W, p and matched-pairs
  rank-biserial. Rows involving v1 answers carry the flag "l02-en and l08-pl end
  mid-sentence (stop_reason not logged); kept".
- New commands: `extended --run <run>`, `calibrate`, `table`.
- Strip-plot jitter seeded for v2 figures (`jitter_seed=2026`); v1 figures not regenerated.

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
