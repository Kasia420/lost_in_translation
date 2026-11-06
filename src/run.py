"""Single entry point for the pipeline.

    python -m src.run build    [--run v1]   write data/raw/<run>/prompts.csv
    python -m src.run collect  [--run v1]   collect Claude answers (needs ANTHROPIC_API_KEY)
    python -m src.run wiki     [--run v1]   fetch Wikipedia articles (needs WIKI_CONTACT)
    python -m src.run analyze  [--run v1]   similarity, sentiment, stats, figures
    python -m src.run all      [--run v1]   build -> collect -> wiki -> analyze

Collection steps are resumable: rows already collected are skipped.
`analyze` refuses to overwrite existing results unless --overwrite is given;
use --out DIR to write a reproduction somewhere else instead.

Settings (ANTHROPIC_API_KEY, WIKI_CONTACT) are read from the environment or
from a .env file in the repository root (see .env.example).
"""
import argparse
from pathlib import Path

from .config import ROOT, RUNS, RunPaths


def _load_dotenv():
    try:
        from dotenv import load_dotenv
    except ImportError:
        return
    load_dotenv(ROOT / ".env")


def _check_no_overwrite(paths):
    existing = [p for p in (paths.per_prompt_csv, paths.stats_txt, paths.captions_txt) if p.exists()]
    if existing:
        raise SystemExit("Results already exist (" + ", ".join(str(p.relative_to(ROOT)) if p.is_relative_to(ROOT)
                                                        else str(p) for p in existing)
                         + ").\nUse --out DIR to write elsewhere, or --overwrite to replace them.")


def main(argv=None):
    parser = argparse.ArgumentParser(prog="python -m src.run", description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("command", choices=["build", "collect", "wiki", "analyze", "all"])
    parser.add_argument("--run", default="v1", choices=list(RUNS),
                        help="which run's settings and data folders to use (default: v1)")
    parser.add_argument("--out", type=Path, default=None,
                        help="analyze: write processed data, stats and figures to this directory")
    parser.add_argument("--overwrite", action="store_true",
                        help="analyze: allow replacing existing results for the run")
    args = parser.parse_args(argv)

    _load_dotenv()
    paths = RunPaths(args.run)
    if args.out is not None:
        paths.with_output_dir(args.out)

    # imported lazily so `build` works without the analysis / API dependencies
    if args.command in ("build", "all"):
        from .prompts import build_prompts
        build_prompts(paths)
    if args.command in ("collect", "all"):
        from .collect import collect_llm
        collect_llm(paths)
    if args.command in ("wiki", "all"):
        from .wiki import fetch_wikipedia
        fetch_wikipedia(paths)
    if args.command in ("analyze", "all"):
        if not args.overwrite:
            _check_no_overwrite(paths)
        from .analyze import analyze
        analyze(paths, jitter_seed=RUNS[args.run].get("jitter_seed"))


if __name__ == "__main__":
    main()
