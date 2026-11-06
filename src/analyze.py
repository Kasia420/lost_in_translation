"""Similarity, sentiment, statistics and figures for one run.

Inputs:
    data/raw/<run>/llm_responses.csv   50 Claude answers (25 prompts x EN/PL)
    data/raw/v1/wiki_articles.csv      48 Wikipedia articles (24 topics x EN/PL)

What is computed:
    1. Semantic similarity (cosine on multilingual LaBSE embeddings):
         - sim_en_pl         : EN answer vs PL answer
         - sim_*_resp_*_wiki : answer vs Wikipedia lead section (all four pairings)
         - native_pull       : sim(answer, wiki in the SAME language)
                               - sim(answer, wiki in the OTHER language)
    2. Sentiment (multilingual XLM-RoBERTa): polarity = P(positive) - P(negative),
       compared EN vs PL per topic and per domain. Input is truncated to 512 tokens.
    3. Statistics: paired Wilcoxon signed-rank tests (n=25 / 24), medians,
       matched-pairs rank-biserial correlation as effect size.
    4. Figures -> results/<run>/figures/ (captions in captions.txt).

The first run downloads the embedding and sentiment models (~1-2 GB).
Heavy imports (torch, sentence-transformers, transformers) are lazy, so the
data-loading logic works without them.
"""
import sys

import numpy as np
import pandas as pd

from .config import DOMAIN_LABELS, DOMAIN_ORDER, EMBED_MODEL, SENTIMENT_MODEL


# --------------------------------------------------------------------------- #
#  Load and pair data (no heavy libraries needed)
# --------------------------------------------------------------------------- #
def load_paired(paths):
    """Return one row per prompt with EN/PL columns for the answers and,
    where available, the Wikipedia lead sections."""
    if not paths.llm_responses_csv.exists():
        sys.exit(f"Brak {paths.llm_responses_csv}. Uruchom najpierw collect/wiki.")
    r = pd.read_csv(paths.llm_responses_csv)
    w = pd.read_csv(paths.wiki_articles_csv) if paths.wiki_articles_csv.exists() else pd.DataFrame()

    resp = (r.pivot_table(index=["prompt_id", "domain", "topic"],
                          columns="language", values="response_text",
                          aggfunc="first")
              .reset_index()
              .rename(columns={"en": "resp_en", "pl": "resp_pl"}))
    resp.columns.name = None

    # answer length in words (descriptive / control variable)
    rl = (r.pivot_table(index="prompt_id", columns="language",
                        values="n_words", aggfunc="first")
            .reset_index()
            .rename(columns={"en": "words_en", "pl": "words_pl"}))
    rl.columns.name = None
    out = resp.merge(rl, on="prompt_id", how="left")

    if not w.empty:
        ws = (w.pivot_table(index="prompt_id", columns="language",
                            values="summary", aggfunc="first")
                .reset_index()
                .rename(columns={"en": "wiki_en", "pl": "wiki_pl"}))
        ws.columns.name = None
        out = out.merge(ws, on="prompt_id", how="left")
    else:
        out["wiki_en"] = np.nan
        out["wiki_pl"] = np.nan

    out["domain"] = pd.Categorical(out["domain"], categories=DOMAIN_ORDER, ordered=True)
    return out.sort_values(["domain", "prompt_id"]).reset_index(drop=True)


# --------------------------------------------------------------------------- #
#  Embeddings + similarity (lazy import)
# --------------------------------------------------------------------------- #
def _embedder():
    from sentence_transformers import SentenceTransformer
    print(f"  ladowanie modelu embeddingow: {EMBED_MODEL} ...")
    return SentenceTransformer(EMBED_MODEL)


def _encode(model, texts):
    """Return L2-normalised vectors; empty/missing text is encoded as ''."""
    texts = ["" if (t is None or (isinstance(t, float) and np.isnan(t))) else str(t)
             for t in texts]
    emb = model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
    return np.asarray(emb)


def _cos(a, b):
    """Row-wise cosine for normalised vectors (= dot product)."""
    return np.sum(a * b, axis=1)


def add_similarity(df):
    """Add the similarity and native-pull columns (one row per prompt)."""
    model = _embedder()
    e_resp_en = _encode(model, df["resp_en"])
    e_resp_pl = _encode(model, df["resp_pl"])
    e_wiki_en = _encode(model, df["wiki_en"])
    e_wiki_pl = _encode(model, df["wiki_pl"])

    df = df.copy()
    df["sim_en_pl"] = _cos(e_resp_en, e_resp_pl)
    df["sim_en_resp_en_wiki"] = _cos(e_resp_en, e_wiki_en)
    df["sim_pl_resp_pl_wiki"] = _cos(e_resp_pl, e_wiki_pl)
    df["sim_en_resp_pl_wiki"] = _cos(e_resp_en, e_wiki_pl)
    df["sim_pl_resp_en_wiki"] = _cos(e_resp_pl, e_wiki_en)

    # native pull: how much closer the answer is to the wiki article in its OWN
    # language than to the article in the other language. No baseline (s06) -> NaN.
    has_base = df["wiki_en"].notna() & df["wiki_pl"].notna()
    df["native_pull_en"] = np.where(
        has_base, df["sim_en_resp_en_wiki"] - df["sim_en_resp_pl_wiki"], np.nan)
    df["native_pull_pl"] = np.where(
        has_base, df["sim_pl_resp_pl_wiki"] - df["sim_pl_resp_en_wiki"], np.nan)
    return df


# --------------------------------------------------------------------------- #
#  Sentiment (lazy import)
# --------------------------------------------------------------------------- #
def add_sentiment(df):
    """Add sent_en, sent_pl (polarity = P(pos) - P(neg)) and sent_diff = PL - EN."""
    from transformers import pipeline
    print(f"  ladowanie modelu sentymentu: {SENTIMENT_MODEL} ...")
    clf = pipeline("sentiment-analysis", model=SENTIMENT_MODEL,
                   top_k=None, truncation=True, max_length=512)

    def polarity(text):
        if text is None or (isinstance(text, float) and np.isnan(text)) or str(text).strip() == "":
            return np.nan
        scores = {d["label"].lower(): d["score"] for d in clf(str(text))[0]}
        # model labels: negative / neutral / positive
        return scores.get("positive", 0.0) - scores.get("negative", 0.0)

    df = df.copy()
    df["sent_en"] = df["resp_en"].map(polarity)
    df["sent_pl"] = df["resp_pl"].map(polarity)
    df["sent_diff"] = df["sent_pl"] - df["sent_en"]   # +: PL answer more positive
    return df


# --------------------------------------------------------------------------- #
#  Statistics
# --------------------------------------------------------------------------- #
def _wilcoxon(a, b, label, lines):
    """Paired Wilcoxon signed-rank test of a vs b; appends one summary line.

    Effect size: matched-pairs rank-biserial correlation on a - b
    (zero differences dropped), range -1..+1.
    """
    from scipy.stats import wilcoxon
    a = np.asarray(a, float)
    b = np.asarray(b, float)
    mask = ~(np.isnan(a) | np.isnan(b))
    a, b = a[mask], b[mask]
    n = len(a)
    med_a, med_b = np.median(a), np.median(b)
    try:
        stat, p = wilcoxon(a, b)
        diff = a - b
        nz = diff[diff != 0]
        from scipy.stats import rankdata
        ranks = rankdata(np.abs(nz))
        rbc = (ranks[nz > 0].sum() - ranks[nz < 0].sum()) / ranks.sum() if len(nz) else 0.0
        lines.append(f"{label}: n={n}  median(A)={med_a:+.3f}  median(B)={med_b:+.3f}  "
                     f"W={stat:.1f}  p={p:.4f}  rank-biserial={rbc:+.3f}")
    except ValueError as e:
        lines.append(f"{label}: n={n}  median(A)={med_a:+.3f}  median(B)={med_b:+.3f}  "
                     f"(Wilcoxon nie policzony: {e})")


def run_stats(df, paths):
    """Write stats_summary.txt (homogenisation, native pull, sentiment, length)."""
    lines = ["LOST IN TRANSLATION — podsumowanie statystyczne",
             "=" * 52, ""]

    lines.append("[1] HOMOGENIZACJA: cosine(EN-odpowiedz, PL-odpowiedz)")
    lines.append(f"    cala proba: median={df['sim_en_pl'].median():.3f}  "
                 f"mean={df['sim_en_pl'].mean():.3f}  sd={df['sim_en_pl'].std():.3f}")
    for d in DOMAIN_ORDER:
        s = df.loc[df["domain"] == d, "sim_en_pl"]
        lines.append(f"    {DOMAIN_LABELS[d]:<18}: median={s.median():.3f} (n={len(s)})")
    lines.append("")

    if "native_pull_en" in df:
        lines.append("[2] ANGIELSKA SOCZEWKA: native_pull(EN) vs native_pull(PL)")
        lines.append("    native_pull = sim(odpowiedz, wiki-wlasny-jezyk) - sim(odpowiedz, wiki-obcy-jezyk)")
        lines.append(f"    median native_pull(EN)={df['native_pull_en'].median():+.3f}  "
                     f"native_pull(PL)={df['native_pull_pl'].median():+.3f}")
        _wilcoxon(df["native_pull_en"], df["native_pull_pl"],
                  "    Wilcoxon native_pull EN vs PL", lines)
        lines.append("")

    if "sent_en" in df:
        lines.append("[3] SENTYMENT: polarity = P(pos)-P(neg)")
        lines.append(f"    median EN={df['sent_en'].median():+.3f}  "
                     f"PL={df['sent_pl'].median():+.3f}")
        _wilcoxon(df["sent_pl"], df["sent_en"], "    Wilcoxon sentyment PL vs EN", lines)
        for d in DOMAIN_ORDER:
            s = df.loc[df["domain"] == d]
            lines.append(f"    {DOMAIN_LABELS[d]:<18}: EN={s['sent_en'].median():+.3f}  "
                         f"PL={s['sent_pl'].median():+.3f}  diff={s['sent_diff'].median():+.3f}")
        lines.append("")

    lines.append("[4] DLUGOSC ODPOWIEDZI (kontrola):")
    lines.append(f"    median slow EN={df['words_en'].median():.0f}  "
                 f"PL={df['words_pl'].median():.0f}")

    text = "\n".join(lines)
    paths.stats.mkdir(parents=True, exist_ok=True)
    paths.stats_txt.write_text(text, encoding="utf-8")
    print("\n" + text + f"\n\n-> zapisano {paths.stats_txt}")


# --------------------------------------------------------------------------- #
#  Figures
# --------------------------------------------------------------------------- #
def make_figures(df, paths, jitter_seed=None):
    """Write fig1-fig4 and captions.txt.

    jitter_seed: seed for the horizontal jitter of strip-plot points. v1 used no
    seed (positions differ slightly between runs; values are unaffected).
    """
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    import seaborn as sns
    sns.set_theme(style="whitegrid", context="talk")
    if jitter_seed is not None:
        np.random.seed(jitter_seed)   # seaborn's stripplot jitter uses numpy's global RNG

    paths.figures.mkdir(parents=True, exist_ok=True)
    captions = []
    dlab = df.assign(domain_label=df["domain"].map(DOMAIN_LABELS))

    # FIG 1 — EN<->PL answer similarity by domain
    fig, ax = plt.subplots(figsize=(9, 6))
    sns.boxplot(data=dlab, x="domain_label", y="sim_en_pl", ax=ax,
                order=[DOMAIN_LABELS[d] for d in DOMAIN_ORDER], color="#cfe3f2")
    sns.stripplot(data=dlab, x="domain_label", y="sim_en_pl", ax=ax,
                  order=[DOMAIN_LABELS[d] for d in DOMAIN_ORDER],
                  color="#1f4e79", size=7, jitter=0.18, alpha=0.8)
    ax.set_xlabel(""); ax.set_ylabel("Cosine(EN response, PL response)")
    ax.set_title("Cross-lingual response homogenization by domain")
    fig.tight_layout(); fig.savefig(paths.figures / "fig1_homogenization.png", dpi=150)
    plt.close(fig)
    captions.append("Figure 1. Cosine similarity between the English and Polish answers to the "
                    "same prompt, per domain (each point = one topic, n=25). Higher = the model "
                    "delivers more nearly identical content regardless of question language.")

    # FIG 2 — sentiment EN vs PL (paired scatter with y = x line)
    if "sent_en" in df:
        fig, ax = plt.subplots(figsize=(7.5, 7))
        for d in DOMAIN_ORDER:
            s = dlab[dlab["domain"] == d]
            ax.scatter(s["sent_en"], s["sent_pl"], s=90, alpha=0.85,
                       label=DOMAIN_LABELS[d])
        lim = [-1, 1]
        ax.plot(lim, lim, "--", color="grey", lw=1.5, label="EN = PL")
        ax.set_xlim(lim); ax.set_ylim(lim)
        ax.set_xlabel("Sentiment polarity (EN response)")
        ax.set_ylabel("Sentiment polarity (PL response)")
        ax.set_title("Per-topic sentiment: English vs Polish")
        ax.legend(fontsize=12, loc="lower right")
        fig.tight_layout(); fig.savefig(paths.figures / "fig2_sentiment.png", dpi=150)
        plt.close(fig)
        captions.append("Figure 2. Sentiment polarity (P(pos)-P(neg)) of each topic's English vs "
                        "Polish answer. Points above the dashed EN=PL line are more positive in "
                        "Polish; below, more positive in English.")

    # FIG 3 — native pull EN vs PL
    if "native_pull_en" in df:
        np_long = df.melt(id_vars=["prompt_id", "domain"],
                          value_vars=["native_pull_en", "native_pull_pl"],
                          var_name="side", value_name="native_pull").dropna()
        np_long["side"] = np_long["side"].map(
            {"native_pull_en": "English answers", "native_pull_pl": "Polish answers"})
        fig, ax = plt.subplots(figsize=(8, 6))
        sns.boxplot(data=np_long, x="side", y="native_pull", ax=ax,
                    palette=["#d9d2e9", "#f2cfcf"])
        sns.stripplot(data=np_long, x="side", y="native_pull", ax=ax,
                      color="#333333", size=6, jitter=0.15, alpha=0.7)
        ax.axhline(0, color="grey", lw=1, ls="--")
        ax.set_xlabel(""); ax.set_ylabel("Native pull\n(own-language − other-language wiki sim)")
        ax.set_title("Anchoring to native-language discourse")
        fig.tight_layout(); fig.savefig(paths.figures / "fig3_native_pull.png", dpi=150)
        plt.close(fig)
        captions.append("Figure 3. 'Native pull' = how much closer an answer is to the Wikipedia "
                        "article in its OWN language than to the article in the other language "
                        "(n=24; s06 has no baseline). If Polish answers show less native pull than "
                        "English answers, Polish output is comparatively less anchored in Polish "
                        "discourse — the English-lens signal.")

    # FIG 4 — answer length (control)
    fig, ax = plt.subplots(figsize=(8, 6))
    wl = df.melt(id_vars=["domain"], value_vars=["words_en", "words_pl"],
                 var_name="lang", value_name="words")
    wl["lang"] = wl["lang"].map({"words_en": "EN", "words_pl": "PL"})
    wl["domain_label"] = wl["domain"].map(DOMAIN_LABELS)
    sns.barplot(data=wl, x="domain_label", y="words", hue="lang", ax=ax,
                order=[DOMAIN_LABELS[d] for d in DOMAIN_ORDER], errorbar="sd")
    ax.set_xlabel(""); ax.set_ylabel("Response length (words)")
    ax.set_title("Response length by language and domain")
    ax.legend(title="Prompt language")
    fig.tight_layout(); fig.savefig(paths.figures / "fig4_length.png", dpi=150)
    plt.close(fig)
    if paths.cfg.get("length_instruction"):
        # runs that set the length in the prompt: describe the actual settings
        captions.append("Figure 4. Mean response length (words) by domain and prompt language; error "
                        "bars = SD. Length requested in the prompt (\"about 150 words\"); "
                        f"max_tokens={paths.cfg['max_tokens']}.")
    else:
        captions.append("Figure 4. Mean response length (words) by domain and prompt language; error "
                        "bars = SD. Control check that the matched max-token cap kept lengths "
                        "comparable across languages.")

    paths.captions_txt.write_text("\n\n".join(captions), encoding="utf-8")
    print(f"-> zapisano {len(captions)} rysunkow do {paths.figures} (+ captions.txt)")


# --------------------------------------------------------------------------- #
#  Pipeline
# --------------------------------------------------------------------------- #
def analyze(paths, jitter_seed=None):
    """Run the full analysis for one run and write all outputs."""
    print("Wczytuje i paruje dane ...")
    df = load_paired(paths)
    print(f"  {len(df)} promptow sparowanych "
          f"({df[['wiki_en','wiki_pl']].notna().all(axis=1).sum()} z baseline Wikipedii)")

    print("Licze podobienstwo semantyczne ...")
    df = add_similarity(df)

    print("Licze sentyment ...")
    df = add_sentiment(df)

    paths.processed.mkdir(parents=True, exist_ok=True)
    df.to_csv(paths.per_prompt_csv, index=False, encoding="utf-8")
    print(f"-> zapisano metryki per prompt: {paths.per_prompt_csv}")

    run_stats(df, paths)
    make_figures(df, paths, jitter_seed=jitter_seed)
    print("\nGotowe.")
