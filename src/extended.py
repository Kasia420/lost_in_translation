"""Step 3 additions on top of the core analysis (src/analyze.py, unchanged).

For one run (reads data/processed/<run>/analysis_per_prompt.csv):

  * words_clean    - word count without markdown tokens (see clean_word_count)
  * sentiment of the Wikipedia lead sections (EN and PL), same classifier and
    the same 512-token truncation as for the answers  ("four-condition design")
  * chunk-and-average sentiment for answers and Wikipedia leads as a
    sensitivity check next to the 512-token truncation

Writes data/processed/<run>/sentiment_extended.csv (one row per prompt).
Nothing written by src/analyze.py is modified.
"""
import re

import numpy as np
import pandas as pd

from .config import SENTIMENT_MODEL

# line-initial markdown markers: headings, bullets, numbered items, block quotes
_MD_PREFIX = re.compile(r"^\s*(?:#{1,6}|[-*+•]|\d+[.)]|>)\s+")
_HAS_ALNUM = re.compile(r"[^\W_]")   # a letter or digit (any script); not "_"

MAX_LEN = 512   # XLM-R input limit incl. the two special tokens


def clean_word_count(text):
    """Whitespace-separated tokens, excluding markdown.

    Per line: a leading heading/list/quote marker ("#", "-", "*", "+", "•",
    "1." / "1)", ">") is removed; then every token that contains at least one
    letter or digit is counted. Tokens without any letter or digit ("**", "-",
    "---", "—", "|") are not counted. A word with markdown attached
    ("**Warsaw**") counts as one word.
    """
    if text is None or (isinstance(text, float) and np.isnan(text)):
        return np.nan
    n = 0
    for line in str(text).splitlines():
        line = _MD_PREFIX.sub("", line, count=1)
        n += sum(1 for tok in line.split() if _HAS_ALNUM.search(tok))
    return n


class SentimentScorer:
    """XLM-R sentiment: polarity = P(positive) - P(negative).

    truncated(): identical to src/analyze.py (pipeline, truncation at 512 tokens).
    chunked():   text split into consecutive 510-token windows (+ <s> and </s>),
                 each window scored, polarities averaged weighted by window length.
                 For texts of <= 512 tokens this equals truncated().
    """

    def __init__(self):
        import torch
        from transformers import pipeline
        print(f"  ladowanie modelu sentymentu: {SENTIMENT_MODEL} ...")
        self.torch = torch
        self.pipe = pipeline("sentiment-analysis", model=SENTIMENT_MODEL,
                             top_k=None, truncation=True, max_length=MAX_LEN)
        self.tok = self.pipe.tokenizer
        self.model = self.pipe.model.eval()
        labels = {i: l.lower() for i, l in self.model.config.id2label.items()}
        self.i_pos = next(i for i, l in labels.items() if l == "positive")
        self.i_neg = next(i for i, l in labels.items() if l == "negative")

    @staticmethod
    def _empty(text):
        return text is None or (isinstance(text, float) and np.isnan(text)) or str(text).strip() == ""

    def n_tokens(self, text):
        """XLM-R tokens including the two special tokens."""
        if self._empty(text):
            return np.nan
        return len(self.tok(str(text))["input_ids"])

    def scores(self, text):
        """Class probabilities {negative, neutral, positive} (512-token truncation)."""
        return {d["label"].lower(): d["score"] for d in self.pipe(str(text))[0]}

    def truncated(self, text):
        if self._empty(text):
            return np.nan
        scores = self.scores(text)
        return scores.get("positive", 0.0) - scores.get("negative", 0.0)

    def top_label(self, text):
        """Most probable class (512-token truncation)."""
        if self._empty(text):
            return None
        s = self.scores(text)
        return max(s, key=s.get)

    def chunked(self, text):
        if self._empty(text):
            return np.nan
        ids = self.tok(str(text), add_special_tokens=False)["input_ids"]
        body = MAX_LEN - 2
        pols, weights = [], []
        for start in range(0, len(ids), body):
            chunk = ids[start:start + body]
            inp = self.torch.tensor([[self.tok.cls_token_id] + chunk + [self.tok.sep_token_id]])
            with self.torch.no_grad():
                logits = self.model(input_ids=inp, attention_mask=self.torch.ones_like(inp)).logits[0]
            p = self.torch.softmax(logits, dim=-1)
            pols.append(float(p[self.i_pos] - p[self.i_neg]))
            weights.append(len(chunk))
        return float(np.average(pols, weights=weights))


def extend_run(paths, scorer=None):
    """Compute the step-3 per-prompt columns for one run."""
    if not paths.per_prompt_csv.exists():
        raise SystemExit(f"Brak {paths.per_prompt_csv}. Uruchom najpierw: python -m src.run analyze --run {paths.run}")
    df = pd.read_csv(paths.per_prompt_csv)
    scorer = scorer or SentimentScorer()

    out = df[["prompt_id", "domain", "topic", "words_en", "words_pl",
              "sent_en", "sent_pl"]].copy()
    for lang in ("en", "pl"):
        resp, wiki = df[f"resp_{lang}"], df[f"wiki_{lang}"]
        out[f"words_clean_{lang}"] = resp.map(clean_word_count)
        out[f"tokens_resp_{lang}"] = resp.map(scorer.n_tokens)
        out[f"sent_chunk_{lang}"] = resp.map(scorer.chunked)
        out[f"tokens_wiki_{lang}"] = wiki.map(scorer.n_tokens)
        out[f"wiki_sent_{lang}"] = wiki.map(scorer.truncated)
        out[f"wiki_sent_chunk_{lang}"] = wiki.map(scorer.chunked)

    # consistency check: the scorer reproduces src/analyze.py's truncated polarity
    for lang in ("en", "pl"):
        recomputed = df[f"resp_{lang}"].map(scorer.truncated)
        dmax = float(np.nanmax(np.abs(recomputed - df[f"sent_{lang}"])))
        if dmax > 1e-5:
            raise SystemExit(f"truncated sentiment ({lang}) differs from analysis_per_prompt.csv by {dmax}")

    out["sent_gap"] = out["sent_pl"] - out["sent_en"]                     # answers, PL - EN
    out["sent_chunk_gap"] = out["sent_chunk_pl"] - out["sent_chunk_en"]
    out["wiki_sent_gap"] = out["wiki_sent_pl"] - out["wiki_sent_en"]      # Wikipedia, PL - EN
    out["wiki_sent_chunk_gap"] = out["wiki_sent_chunk_pl"] - out["wiki_sent_chunk_en"]

    path = paths.processed / "sentiment_extended.csv"
    out.to_csv(path, index=False, encoding="utf-8")
    print(f"-> zapisano {path}")
    return out
