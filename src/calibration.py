"""Classifier calibration on EN-PL parallel sentences from Tatoeba (step 3d).

Same meaning, two languages: scores each English sentence and its Polish
translation with the same sentiment classifier and setting as the answers
(src.extended.SentimentScorer.truncated) and tests PL vs EN polarity.

Data: Tatoeba (https://tatoeba.org), CC BY 2.0 FR. The weekly per-language
exports are downloaded to data/external/tatoeba/ (git-ignored); the sampled
pairs, with Tatoeba sentence ids for attribution, are committed to
data/raw/calibration/tatoeba_en_pl_sample.tsv so the check is reproducible
without the export.

Sampling: all pol->eng translation links whose two sentences exist in the
exports; pairs are de-duplicated so each Polish and each English sentence is
used at most once (first link kept, export order); then N_PAIRS pairs are
drawn uniformly at random with SEED.
"""
import bz2
import urllib.request

import pandas as pd

from .config import DATA_PROCESSED, DATA_RAW, ROOT

TATOEBA_BASE = "https://downloads.tatoeba.org/exports/per_language"
EXPORT_FILES = {
    "links": "pol/pol-eng_links.tsv.bz2",
    "pol": "pol/pol_sentences.tsv.bz2",
    "eng": "eng/eng_sentences.tsv.bz2",
}
EXTERNAL_DIR = ROOT / "data" / "external" / "tatoeba"
SAMPLE_TSV = DATA_RAW / "calibration" / "tatoeba_en_pl_sample.tsv"
SCORED_CSV = DATA_PROCESSED / "calibration" / "tatoeba_scored.csv"

N_PAIRS = 1000
SEED = 2026


def _download():
    EXTERNAL_DIR.mkdir(parents=True, exist_ok=True)
    for rel in EXPORT_FILES.values():
        dest = EXTERNAL_DIR / rel.split("/")[-1]
        if not dest.exists():
            print(f"  pobieram {TATOEBA_BASE}/{rel}")
            urllib.request.urlretrieve(f"{TATOEBA_BASE}/{rel}", dest)


def _read_tsv(name, columns):
    path = EXTERNAL_DIR / EXPORT_FILES[name].split("/")[-1]
    with bz2.open(path, "rt", encoding="utf-8") as f:
        return pd.read_csv(f, sep="\t", header=None, names=columns, quoting=3,
                           dtype=str, keep_default_na=False)


def build_sample():
    """Create the committed sample file (only if it does not exist yet)."""
    if SAMPLE_TSV.exists():
        print(f"{SAMPLE_TSV} juz istnieje — bez zmian")
        return pd.read_csv(SAMPLE_TSV, sep="\t", dtype={"pol_id": str, "eng_id": str})
    _download()
    links = _read_tsv("links", ["pol_id", "eng_id"])
    pol = _read_tsv("pol", ["pol_id", "lang", "pol_text"])[["pol_id", "pol_text"]]
    eng = _read_tsv("eng", ["eng_id", "lang", "eng_text"])[["eng_id", "eng_text"]]
    pairs = links.merge(pol, on="pol_id").merge(eng, on="eng_id")
    pairs = pairs.drop_duplicates("pol_id").drop_duplicates("eng_id")
    print(f"  {len(links)} linkow pol->eng, {len(pairs)} unikalnych par")
    sample = pairs.sample(n=N_PAIRS, random_state=SEED).reset_index(drop=True)
    sample.insert(0, "pair_no", range(1, len(sample) + 1))
    SAMPLE_TSV.parent.mkdir(parents=True, exist_ok=True)
    sample[["pair_no", "eng_id", "eng_text", "pol_id", "pol_text"]].to_csv(
        SAMPLE_TSV, sep="\t", index=False, encoding="utf-8")
    print(f"-> zapisano {SAMPLE_TSV} ({len(sample)} par)")
    return sample


def calibrate(scorer=None):
    """Score the sample; write data/processed/calibration/tatoeba_scored.csv."""
    from .extended import SentimentScorer
    sample = build_sample()
    scorer = scorer or SentimentScorer()
    out = sample.copy()
    out["tokens_en"] = out["eng_text"].map(scorer.n_tokens)
    out["tokens_pl"] = out["pol_text"].map(scorer.n_tokens)
    out["sent_en"] = out["eng_text"].map(scorer.truncated)
    out["sent_pl"] = out["pol_text"].map(scorer.truncated)
    out["sent_gap"] = out["sent_pl"] - out["sent_en"]
    out["label_en"] = out["eng_text"].map(scorer.top_label)
    out["label_pl"] = out["pol_text"].map(scorer.top_label)
    SCORED_CSV.parent.mkdir(parents=True, exist_ok=True)
    out.to_csv(SCORED_CSV, index=False, encoding="utf-8")
    print(f"-> zapisano {SCORED_CSV}")
    return out
