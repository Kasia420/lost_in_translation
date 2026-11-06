"""Shared configuration: paths, run definitions and model/analysis constants.

A *run* is one complete data collection with fixed generation settings.
Each run keeps its own raw data, processed data and results, so a newer run
never overwrites an older one:

    data/raw/<run>/          prompts.csv, llm_responses.csv (+ wiki files for v1)
    data/processed/<run>/    analysis_per_prompt.csv
    results/<run>/stats/     stats_summary.txt
    results/<run>/figures/   fig1..fig4 + captions.txt

v1 is the course-submission run, reproduced unchanged.
"""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA_RAW = ROOT / "data" / "raw"
DATA_PROCESSED = ROOT / "data" / "processed"
RESULTS = ROOT / "results"

# --------------------------------------------------------------------------- #
#  Generation settings per run
# --------------------------------------------------------------------------- #
LANGUAGES = ["en", "pl"]

RUNS = {
    "v1": {
        "description": "Course submission (June 2026). Length controlled only by max_tokens.",
        # Model alias as used in v1 (resolves to whatever snapshot the alias pointed at).
        "model": "claude-sonnet-4-5",
        "temperature": 0.0,
        "max_tokens": 600,
        # v1 sent the prompt text unchanged.
        "length_instruction": None,
        # v1 logged only these columns (no stop_reason / usage / returned model id).
        "extended_logging": False,
        # Wikipedia baseline fetched together with v1.
        "wiki_dir": "v1",
    },
    "v2": {
        "description": ("Length set in the prompt itself; max_tokens high enough not to cut "
                        "answers; dated model snapshot; extended per-row logging."),
        # Dated snapshot behind the v1 alias (deprecated; retires 2026-11-30).
        "model": "claude-sonnet-4-5-20250929",
        "temperature": 0.0,
        "max_tokens": 2000,
        # Appended to the prompt after a single space.
        "length_instruction": {
            "en": "Answer in about 150 words.",
            "pl": "Odpowiedz w około 150 słowach.",
        },
        # Also log returned model id, stop_reason, token usage, message/request ids.
        "extended_logging": True,
        # Same Wikipedia baseline as v1 (not re-fetched), so only the answers change.
        "wiki_dir": "v1",
        # Seed for strip-plot jitter in figures (v1 had none).
        "jitter_seed": 2026,
    },
}

# --------------------------------------------------------------------------- #
#  API politeness / retries
# --------------------------------------------------------------------------- #
MAX_RETRIES = 4
RETRY_BACKOFF_SEC = 5

# Wikipedia asks API clients to identify themselves with a contact address.
# Set WIKI_CONTACT in .env (see .env.example); it is not stored in the code.
WIKI_USER_AGENT_TEMPLATE = "LostInTranslation-MAresearch/1.0 (academic; contact: {contact})"

# --------------------------------------------------------------------------- #
#  Analysis models
# --------------------------------------------------------------------------- #
# LaBSE is designed for cross-lingual sentence similarity (translation pairs),
# so it suits EN<->PL comparisons. Lighter alternative:
#   "sentence-transformers/paraphrase-multilingual-mpnet-base-v2"
EMBED_MODEL = "sentence-transformers/LaBSE"
SENTIMENT_MODEL = "cardiffnlp/twitter-xlm-roberta-base-sentiment"

DOMAIN_ORDER = ["contested_history", "literature", "social_norms"]
DOMAIN_LABELS = {
    "contested_history": "Contested history",
    "literature": "Literature",
    "social_norms": "Social norms",
}


class RunPaths:
    """All file locations for one run."""

    def __init__(self, run: str):
        if run not in RUNS:
            raise SystemExit(f"Unknown run '{run}'. Known runs: {', '.join(RUNS)}")
        self.run = run
        self.cfg = RUNS[run]
        self.raw = DATA_RAW / run
        self.processed = DATA_PROCESSED / run
        self.stats = RESULTS / run / "stats"
        self.figures = RESULTS / run / "figures"

        self.prompts_csv = self.raw / "prompts.csv"
        self.llm_responses_csv = self.raw / "llm_responses.csv"

        wiki_dir = DATA_RAW / self.cfg["wiki_dir"]
        self.wiki_articles_csv = wiki_dir / "wiki_articles.csv"
        self.wiki_missing_csv = wiki_dir / "wiki_missing.csv"

        self.per_prompt_csv = self.processed / "analysis_per_prompt.csv"
        self.stats_txt = self.stats / "stats_summary.txt"
        self.captions_txt = self.figures / "captions.txt"

    def with_output_dir(self, out: Path) -> "RunPaths":
        """Redirect analysis outputs (processed CSV, stats, figures) to `out`.

        Used for reproduction checks so committed results are not touched.
        """
        out = Path(out)
        self.processed = out / "processed"
        self.stats = out / "stats"
        self.figures = out / "figures"
        self.per_prompt_csv = self.processed / "analysis_per_prompt.csv"
        self.stats_txt = self.stats / "stats_summary.txt"
        self.captions_txt = self.figures / "captions.txt"
        return self
