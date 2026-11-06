"""Combined results table, word-count table and step-3 figures (step 3e).

Reads (per run): data/processed/<run>/analysis_per_prompt.csv
                 data/processed/<run>/sentiment_extended.csv
           and:  data/processed/calibration/tatoeba_scored.csv
Writes:          results/results_table.{csv,md}
                 results/word_counts.{csv,md}
                 results/baseline/fig5_wiki_sentiment.png
                 results/calibration/fig6_calibration.png
                 results/comparison/fig7_word_counts.png

Every test is a paired Wilcoxon signed-rank test (scipy defaults, as in v1);
effect size = matched-pairs rank-biserial correlation of A - B (zero
differences dropped). No interpretation is written to any output.
"""
import numpy as np
import pandas as pd

from .calibration import SCORED_CSV as CALIBRATION_CSV
from .config import DOMAIN_LABELS, DOMAIN_ORDER, RESULTS, RUNS, RunPaths
from .extended import MAX_LEN

FLAGS = {
    "v1": "v1: l02-en and l08-pl end mid-sentence (stop_reason not logged); kept",
    "v2": "v2: all 50 answers stop_reason=end_turn",
}


def paired_test(a, b):
    """Wilcoxon signed-rank on paired a, b (NaN pairs dropped); same maths as v1."""
    from scipy.stats import rankdata, wilcoxon
    a, b = np.asarray(a, float), np.asarray(b, float)
    m = ~(np.isnan(a) | np.isnan(b))
    a, b = a[m], b[m]
    diff = a - b
    res = {"n": len(a), "median_A": np.median(a), "median_B": np.median(b),
           "median_diff": np.median(diff), "W": np.nan, "p": np.nan, "rank_biserial": np.nan}
    try:
        stat, p = wilcoxon(a, b)
        nz = diff[diff != 0]
        ranks = rankdata(np.abs(nz))
        rbc = (ranks[nz > 0].sum() - ranks[nz < 0].sum()) / ranks.sum() if len(nz) else 0.0
        res.update(W=stat, p=p, rank_biserial=rbc)
    except ValueError:
        pass
    return res


def _describe(a, b=None):
    a = np.asarray(a, float)
    out = {"n": int((~np.isnan(a)).sum()), "median_A": np.nanmedian(a)}
    if b is not None:
        b = np.asarray(b, float)
        m = ~(np.isnan(a) | np.isnan(b))
        out.update(n=int(m.sum()), median_B=np.median(b[m]), median_diff=np.median(a[m] - b[m]))
    return out


def _n_trunc(tokens):
    return int((np.asarray(tokens, float) > MAX_LEN).sum())


def load_run(run):
    paths = RunPaths(run)
    core = pd.read_csv(paths.per_prompt_csv)
    ext = pd.read_csv(paths.processed / "sentiment_extended.csv")
    df = core.merge(ext[[c for c in ext.columns if c not in core.columns or c == "prompt_id"]],
                    on="prompt_id")
    df["domain"] = pd.Categorical(df["domain"], categories=DOMAIN_ORDER, ordered=True)
    return df.sort_values(["domain", "prompt_id"]).reset_index(drop=True)


def run_rows(run, df):
    rows = []
    flag = FLAGS.get(run, "")
    trunc_resp = f"answers >{MAX_LEN} XLM-R tokens: EN {_n_trunc(df.tokens_resp_en)}, PL {_n_trunc(df.tokens_resp_pl)}"
    base = df[df.wiki_en.notna() & df.wiki_pl.notna()]
    trunc_wiki = f"Wikipedia leads >{MAX_LEN} tokens: EN {_n_trunc(base.tokens_wiki_en)}, PL {_n_trunc(base.tokens_wiki_pl)}"

    def add(section, measure, subset, A, B, stats, notes=""):
        rows.append({"run": run, "section": section, "measure": measure, "subset": subset,
                     "A": A, "B": B, **stats, "notes": notes})

    # 1. homogenisation (descriptive, as in v1)
    s = df.sim_en_pl
    add("homogenisation", "cosine(EN answer, PL answer)", "all", "cosine", "",
        _describe(s), f"mean={s.mean():.3f} sd={s.std():.3f}; {flag}")
    for d in DOMAIN_ORDER:
        add("homogenisation", "cosine(EN answer, PL answer)", DOMAIN_LABELS[d], "cosine", "",
            _describe(df.loc[df.domain == d, "sim_en_pl"]))

    # 2. native pull
    add("native pull", "sim(own-lang wiki) - sim(other-lang wiki)", "all", "EN answers", "PL answers",
        paired_test(df.native_pull_en, df.native_pull_pl), f"s06 has no Wikipedia baseline; {flag}")

    # 3. answer sentiment
    add("answer sentiment", "polarity, 512-token truncation (primary)", "all", "PL answer", "EN answer",
        paired_test(df.sent_pl, df.sent_en), f"{trunc_resp}; {flag}")
    for d in DOMAIN_ORDER:
        x = df[df.domain == d]
        add("answer sentiment", "polarity, 512-token truncation (primary)", DOMAIN_LABELS[d],
            "PL answer", "EN answer", _describe(x.sent_pl, x.sent_en))
    add("answer sentiment", "polarity, chunk-and-average (sensitivity)", "all", "PL answer", "EN answer",
        paired_test(df.sent_chunk_pl, df.sent_chunk_en), f"510-token windows, length-weighted mean; {flag}")

    # 4. Wikipedia baseline sentiment (four-condition design)
    add("Wikipedia sentiment", "polarity, 512-token truncation (primary)", "all", "PL wiki lead", "EN wiki lead",
        paired_test(base.wiki_sent_pl, base.wiki_sent_en), f"same Wikipedia data in every run; {trunc_wiki}")
    for d in DOMAIN_ORDER:
        x = base[base.domain == d]
        add("Wikipedia sentiment", "polarity, 512-token truncation (primary)", DOMAIN_LABELS[d],
            "PL wiki lead", "EN wiki lead", _describe(x.wiki_sent_pl, x.wiki_sent_en))
    add("Wikipedia sentiment", "polarity, chunk-and-average (sensitivity)", "all", "PL wiki lead", "EN wiki lead",
        paired_test(base.wiki_sent_chunk_pl, base.wiki_sent_chunk_en),
        "same Wikipedia data in every run; 510-token windows, length-weighted mean")

    # 5. answer gap vs Wikipedia gap
    add("gap: answers vs Wikipedia", "PL - EN polarity, 512-token truncation (primary)", "all",
        "answer gap", "wiki gap", paired_test(base.sent_gap, base.wiki_sent_gap),
        f"n=24 topics with a baseline; {trunc_wiki}; {flag}")
    add("gap: answers vs Wikipedia", "PL - EN polarity, chunk-and-average (sensitivity)", "all",
        "answer gap", "wiki gap", paired_test(base.sent_chunk_gap, base.wiki_sent_chunk_gap),
        f"n=24 topics with a baseline; {flag}")

    # 6. length (descriptive, as in v1)
    for col, label in (("words", "n_words (whitespace tokens)"), ("words_clean", "words without markdown")):
        add("length", label, "all", "EN answer", "PL answer",
            _describe(df[f"{col}_en"], df[f"{col}_pl"]), flag)
        for d in DOMAIN_ORDER:
            x = df[df.domain == d]
            add("length", label, DOMAIN_LABELS[d], "EN answer", "PL answer",
                _describe(x[f"{col}_en"], x[f"{col}_pl"]))
    return rows


def calibration_rows(cal):
    stats = paired_test(cal.sent_pl, cal.sent_en)
    over = f"sentences >{MAX_LEN} tokens: EN {_n_trunc(cal.tokens_en)}, PL {_n_trunc(cal.tokens_pl)}"
    labels = ", ".join(
        f"{lang.upper()} " + "/".join(f"{k} {int((cal[f'label_{lang}'] == k).sum())}"
                                      for k in ("negative", "neutral", "positive"))
        for lang in ("en", "pl"))
    same = int((cal.label_en == cal.label_pl).sum())
    return [{"run": "calibration", "section": "classifier calibration (Tatoeba)",
             "measure": "polarity, 512-token truncation", "subset": "all",
             "A": "PL sentence", "B": "EN sentence", **stats,
             "notes": f"{over}; top labels {labels}; same top label in {same}/{len(cal)} pairs"}]


# --------------------------------------------------------------------------- #
#  Output
# --------------------------------------------------------------------------- #
def _fmt(x, nd=3, signed=True):
    if x is None or (isinstance(x, float) and np.isnan(x)) or x == "":
        return ""
    return f"{x:+.{nd}f}" if signed else f"{x:.{nd}f}"


def _md_results(t):
    head = ("| run | section | measure | subset | n | A | median A | B | median B | median(A−B) "
            "| W | p | rank-biserial (A−B) | notes |\n|" + "---|" * 14)
    lines = [head]
    for r in t.itertuples():
        is_len = r.section == "length"
        nd = 1 if is_len else 3
        lines.append("| " + " | ".join([
            r.run, r.section, r.measure, r.subset, str(int(r.n)), r.A,
            _fmt(r.median_A, nd, signed=not is_len and r.section != "homogenisation"),
            r.B or "", _fmt(r.median_B, nd, signed=not is_len), _fmt(r.median_diff, nd),
            "" if np.isnan(r.W) else f"{r.W:.1f}", "" if np.isnan(r.p) else f"{r.p:.4f}",
            _fmt(r.rank_biserial), r.notes if isinstance(r.notes, str) else ""]) + " |")
    return "\n".join(lines)


def word_count_table(data):
    rows = []
    for run, df in data.items():
        for subset, x in [("all", df)] + [(DOMAIN_LABELS[d], df[df.domain == d]) for d in DOMAIN_ORDER]:
            rows.append({
                "run": run, "subset": subset, "n": len(x),
                "n_words_en": x.words_en.median(), "n_words_pl": x.words_pl.median(),
                "n_words_gap_en_minus_pl": (x.words_en - x.words_pl).median(),
                "words_clean_en": x.words_clean_en.median(), "words_clean_pl": x.words_clean_pl.median(),
                "words_clean_gap_en_minus_pl": (x.words_clean_en - x.words_clean_pl).median(),
            })
    return pd.DataFrame(rows)


def _md_words(w):
    lines = ["| run | subset | n | n_words EN | n_words PL | n_words EN−PL (paired) "
             "| clean EN | clean PL | clean EN−PL (paired) |", "|" + "---|" * 9]
    for r in w.itertuples():
        lines.append(f"| {r.run} | {r.subset} | {r.n} | {r.n_words_en:g} | {r.n_words_pl:g} | "
                     f"{r.n_words_gap_en_minus_pl:g} | {r.words_clean_en:g} | {r.words_clean_pl:g} | "
                     f"{r.words_clean_gap_en_minus_pl:g} |")
    return "\n".join(lines)


def make_figures(data, cal):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    sns.set_theme(style="whitegrid", context="talk")
    markers = {"contested_history": "o", "literature": "s", "social_norms": "^"}

    # FIG 5 — Wikipedia lead sentiment EN vs PL (same layout as fig2)
    df = data["v2"]
    base = df[df.wiki_en.notna() & df.wiki_pl.notna()]
    fig, ax = plt.subplots(figsize=(7.5, 7))
    for d in DOMAIN_ORDER:
        s = base[base.domain == d]
        ax.scatter(s.wiki_sent_en, s.wiki_sent_pl, s=90, alpha=0.85, marker=markers[d],
                   label=DOMAIN_LABELS[d])
    ax.plot([-1, 1], [-1, 1], "--", color="grey", lw=1.5, label="EN = PL")
    ax.set_xlim(-1, 1); ax.set_ylim(-1, 1)
    ax.set_xlabel("Sentiment polarity (EN Wikipedia lead)")
    ax.set_ylabel("Sentiment polarity (PL Wikipedia lead)")
    ax.set_title("Per-topic sentiment: Wikipedia EN vs PL")
    ax.legend(fontsize=12, loc="lower right")
    out = RESULTS / "baseline"; out.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(); fig.savefig(out / "fig5_wiki_sentiment.png", dpi=150); plt.close(fig)
    (out / "captions.txt").write_text(
        "Figure 5. Sentiment polarity (P(pos)-P(neg), 512-token truncation) of the English vs Polish "
        "Wikipedia lead section for each topic (n=24; s06 has no article). Points above the dashed "
        "EN=PL line are more positive in Polish; below, more positive in English.", encoding="utf-8")

    # FIG 6 — calibration: PL - EN polarity per Tatoeba pair
    fig, ax = plt.subplots(figsize=(8, 6))
    ax.hist(cal.sent_gap, bins=np.linspace(-2, 2, 41), color="#4c72b0", edgecolor="white", linewidth=1)
    ax.axvline(0, color="grey", lw=1.5, ls="--")
    ax.axvline(cal.sent_gap.median(), color="#333333", lw=2, label=f"median = {cal.sent_gap.median():+.3f}")
    ax.set_xlabel("Polarity(PL sentence) − polarity(EN sentence)")
    ax.set_ylabel("Sentence pairs")
    ax.set_title(f"Classifier calibration on Tatoeba (n={len(cal)})")
    ax.legend(fontsize=12, loc="upper right")
    out = RESULTS / "calibration"; out.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(); fig.savefig(out / "fig6_calibration.png", dpi=150); plt.close(fig)
    (out / "captions.txt").write_text(
        f"Figure 6. Difference in sentiment polarity between the Polish and the English sentence of "
        f"{len(cal)} Tatoeba translation pairs (same classifier and settings as for the answers). "
        "Dashed line = no difference; solid line = median.", encoding="utf-8")

    # FIG 7 — median word counts, v1 vs v2, two counting rules
    w = word_count_table(data)
    w = w[w.subset == "all"]
    long = pd.concat([
        pd.DataFrame({"run": w.run, "lang": "EN", "count": "n_words", "words": w.n_words_en}),
        pd.DataFrame({"run": w.run, "lang": "PL", "count": "n_words", "words": w.n_words_pl}),
        pd.DataFrame({"run": w.run, "lang": "EN", "count": "without markdown", "words": w.words_clean_en}),
        pd.DataFrame({"run": w.run, "lang": "PL", "count": "without markdown", "words": w.words_clean_pl}),
    ])
    fig, axes = plt.subplots(1, 2, figsize=(12, 6), sharey=True)
    for ax, cnt in zip(axes, ["n_words", "without markdown"]):
        sub = long[long["count"] == cnt]
        sns.barplot(data=sub, x="run", y="words", hue="lang", ax=ax, order=list(data))
        for c in ax.containers:
            ax.bar_label(c, fmt="%g", fontsize=12, padding=3)
        ax.set_title(cnt); ax.set_xlabel(""); ax.set_ylabel("Median words per answer")
        ax.legend(title="Prompt language", fontsize=12, title_fontsize=12, loc="upper right")
    fig.suptitle("Answer length: v1 vs v2 (n=25 per language)")
    out = RESULTS / "comparison"; out.mkdir(parents=True, exist_ok=True)
    fig.tight_layout(); fig.savefig(out / "fig7_word_counts.png", dpi=150); plt.close(fig)
    (out / "captions.txt").write_text(
        "Figure 7. Median words per answer by run and prompt language. Left: n_words (whitespace-"
        "separated tokens, as in the paper). Right: tokens containing a letter or digit, after removing "
        "line-initial list/heading markers. v1: max_tokens=600, no length instruction; v2: \"about 150 "
        "words\" in the prompt, max_tokens=2000.", encoding="utf-8")


def build_tables():
    data = {run: load_run(run) for run in RUNS}
    # the Wikipedia baseline is shared, so its scores must be identical across runs
    w1, w2 = data["v1"], data["v2"]
    for c in ("wiki_sent_en", "wiki_sent_pl", "wiki_sent_chunk_en", "wiki_sent_chunk_pl"):
        if not np.allclose(w1[c], w2[c], equal_nan=True):
            raise SystemExit(f"{c} differs between v1 and v2")
    cal = pd.read_csv(CALIBRATION_CSV)

    rows = sum((run_rows(run, df) for run, df in data.items()), []) + calibration_rows(cal)
    t = pd.DataFrame(rows)
    t.to_csv(RESULTS / "results_table.csv", index=False, encoding="utf-8")
    (RESULTS / "results_table.md").write_text(
        "# Results table\n\nGenerated by `python -m src.run table`. Paired Wilcoxon signed-rank tests "
        "(scipy defaults); rank-biserial = matched-pairs rank-biserial correlation of A − B. "
        "Rows without W/p are descriptive (as in v1).\n\n" + _md_results(t) + "\n", encoding="utf-8")

    wc = word_count_table(data)
    wc.to_csv(RESULTS / "word_counts.csv", index=False, encoding="utf-8")
    (RESULTS / "word_counts.md").write_text(
        "# Word counts (medians)\n\n`n_words` = whitespace-separated tokens (as in the paper). "
        "`clean` = tokens containing a letter or digit, after removing line-initial list/heading/quote "
        "markers (`src/extended.py: clean_word_count`). EN−PL columns are medians of the per-topic "
        "differences.\n\n" + _md_words(wc) + "\n", encoding="utf-8")

    make_figures(data, cal)
    print(f"-> zapisano {RESULTS / 'results_table.csv'} (+ .md), word_counts, fig5-fig7")
    return t, wc
