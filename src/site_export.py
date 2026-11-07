"""Export the study's data as JSON for the interactive website (site/).

    python -m src.run site-data [--out DIR]      default DIR: site/public/data/

Reads only files that already exist in the repository (raw answers, Wikipedia
leads, per-topic metrics, Tatoeba scores, results tables) and writes:

  meta.json          run settings, models, domains, attribution, projection info
  topics.json        one entry per topic: prompts, answers (v1, v2), Wikipedia
                     leads and every per-topic metric used in the study
  results.json       results/results_table.csv as JSON (all tests, both runs)
  word_counts.json   results/word_counts.csv as JSON
  embeddings3d.json  LaBSE embeddings of all answers and Wikipedia leads,
                     projected to 3D with PCA (for display only)
  tatoeba.json       the 1000 scored Tatoeba EN-PL pairs

Nothing in data/, results/ or the analysis code is changed. Every metric in
topics.json is copied from data/processed/<run>/ (not recomputed). The LaBSE
embeddings are recomputed with the same code as src/analyze.py; the export
stops if the recomputed cosines differ from the stored ones by more than 1e-5.

At the end, verify() rebuilds every row of results/results_table.csv from the
JSON files alone (same statistics code as src/tables.py) and stops on any
mismatch, so the site cannot show a number the study does not report.
"""
import json
import math
import subprocess

import numpy as np
import pandas as pd

from .config import DOMAIN_LABELS, DOMAIN_ORDER, EMBED_MODEL, ROOT, RUNS, SENTIMENT_MODEL, RunPaths

DEFAULT_OUT = ROOT / "site" / "public" / "data"
SITE_RUNS = ("v1", "v2")
V1_TRUNCATED = {("l02", "en"), ("l08", "pl")}   # end mid-sentence; stop_reason not logged in v1
COS_TOLERANCE = 1e-5
VERIFY_TOLERANCE = 1e-12


# --------------------------------------------------------------------------- #
#  helpers
# --------------------------------------------------------------------------- #
def _num(x):
    """float/int for JSON; NaN/None -> None."""
    if x is None:
        return None
    if isinstance(x, (np.integer,)):
        return int(x)
    try:
        f = float(x)
    except (TypeError, ValueError):
        return x
    return None if math.isnan(f) else f


def _txt(x):
    return None if x is None or (isinstance(x, float) and math.isnan(x)) else str(x)


def _write(out_dir, name, obj):
    path = out_dir / name
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=1, allow_nan=False)
    print(f"-> {path.relative_to(ROOT) if path.is_relative_to(ROOT) else path} "
          f"({path.stat().st_size / 1024:.0f} KB)")


def _git_commit():
    try:
        return subprocess.check_output(["git", "-C", str(ROOT), "rev-parse", "--short", "HEAD"],
                                       text=True).strip()
    except Exception:
        return None


def _load_run(run):
    """Per-topic metrics for one run: analysis_per_prompt + sentiment_extended."""
    paths = RunPaths(run)
    core = pd.read_csv(paths.per_prompt_csv)
    ext = pd.read_csv(paths.processed / "sentiment_extended.csv")
    df = core.merge(ext[[c for c in ext.columns if c not in core.columns or c == "prompt_id"]],
                    on="prompt_id")
    return df.set_index("prompt_id")


def _responses(run):
    r = pd.read_csv(RunPaths(run).llm_responses_csv)
    return {(row.prompt_id, row.language): row for row in r.itertuples()}


# --------------------------------------------------------------------------- #
#  topics.json
# --------------------------------------------------------------------------- #
def build_topics():
    prompts = pd.read_csv(RunPaths("v1").prompts_csv)
    wiki = pd.read_csv(RunPaths("v1").wiki_articles_csv)
    wiki = {(w.prompt_id, w.language): w for w in wiki.itertuples()}
    runs = {run: _load_run(run) for run in SITE_RUNS}
    resp = {run: _responses(run) for run in SITE_RUNS}
    v1 = runs["v1"]

    topics = []
    for p in prompts.itertuples():
        pid = p.prompt_id
        t = {"id": pid, "domain": p.domain, "domain_label": DOMAIN_LABELS[p.domain],
             "topic": p.topic, "prompt": {"en": p.prompt_en, "pl": p.prompt_pl}}

        # Wikipedia lead sections (same data in every run; metrics taken from v1 files)
        w = {}
        for lang in ("en", "pl"):
            a = wiki.get((pid, lang))
            if a is None or _txt(a.summary) is None:
                continue
            w[lang] = {"title": a.wiki_title, "url": a.wiki_url, "lead": a.summary,
                       "sentiment": _num(v1.at[pid, f"wiki_sent_{lang}"]),
                       "sentiment_chunked": _num(v1.at[pid, f"wiki_sent_chunk_{lang}"]),
                       "xlmr_tokens": _num(v1.at[pid, f"tokens_wiki_{lang}"])}
        t["wikipedia"] = w if len(w) == 2 else None

        t["runs"] = {}
        for run in SITE_RUNS:
            m = runs[run].loc[pid]
            entry = {"answers": {}}
            for lang in ("en", "pl"):
                r = resp[run][(pid, lang)]
                a = {"prompt_sent": r.prompt_text, "text": r.response_text,
                     "words": _num(m[f"words_{lang}"]), "words_clean": _num(m[f"words_clean_{lang}"]),
                     "sentiment": _num(m[f"sent_{lang}"]),
                     "sentiment_chunked": _num(m[f"sent_chunk_{lang}"]),
                     "xlmr_tokens": _num(m[f"tokens_resp_{lang}"]),
                     "timestamp": r.timestamp}
                if run == "v1":
                    a["ends_mid_sentence"] = (pid, lang) in V1_TRUNCATED
                else:
                    a.update(stop_reason=r.stop_reason, model_returned=r.model_returned,
                             output_tokens=_num(r.output_tokens))
                entry["answers"][lang] = a
            entry["cosine_en_pl"] = _num(m["sim_en_pl"])
            entry["similarity_to_wikipedia"] = {
                "en_answer_en_wiki": _num(m["sim_en_resp_en_wiki"]),
                "en_answer_pl_wiki": _num(m["sim_en_resp_pl_wiki"]),
                "pl_answer_pl_wiki": _num(m["sim_pl_resp_pl_wiki"]),
                "pl_answer_en_wiki": _num(m["sim_pl_resp_en_wiki"])}
            entry["native_pull"] = {"en": _num(m["native_pull_en"]), "pl": _num(m["native_pull_pl"])}
            t["runs"][run] = entry
        topics.append(t)
    order = {d: i for i, d in enumerate(DOMAIN_ORDER)}
    return sorted(topics, key=lambda t: (order[t["domain"]], t["id"]))


# --------------------------------------------------------------------------- #
#  embeddings3d.json
# --------------------------------------------------------------------------- #
def build_embeddings(topics):
    """Recompute LaBSE embeddings exactly as src/analyze.py, check the cosines
    against the stored ones, then project all vectors to 3D with PCA."""
    from sklearn.decomposition import PCA

    from .analyze import _cos, _embedder, _encode, load_paired

    model = _embedder()
    vectors, points, max_diff = [], [], 0.0
    stored = {run: _load_run(run) for run in SITE_RUNS}
    wiki_vec = None
    for run in SITE_RUNS:
        df = load_paired(RunPaths(run))            # same row order and batching as analyze
        e = {k: _encode(model, df[k]) for k in ("resp_en", "resp_pl", "wiki_en", "wiki_pl")}
        s = stored[run].loc[df["prompt_id"]]
        checks = {"sim_en_pl": _cos(e["resp_en"], e["resp_pl"]),
                  "sim_en_resp_en_wiki": _cos(e["resp_en"], e["wiki_en"]),
                  "sim_pl_resp_pl_wiki": _cos(e["resp_pl"], e["wiki_pl"]),
                  "sim_en_resp_pl_wiki": _cos(e["resp_en"], e["wiki_pl"]),
                  "sim_pl_resp_en_wiki": _cos(e["resp_pl"], e["wiki_en"])}
        has_base = (df["wiki_en"].notna() & df["wiki_pl"].notna()).to_numpy()
        for col, val in checks.items():
            mask = has_base if "wiki" in col else np.ones(len(df), bool)
            d = float(np.max(np.abs(val[mask] - s[col].to_numpy()[mask])))
            max_diff = max(max_diff, d)
        if max_diff > COS_TOLERANCE:
            raise SystemExit(f"recomputed LaBSE cosines differ from stored ones by {max_diff}")
        for i, pid in enumerate(df["prompt_id"]):
            for lang in ("en", "pl"):
                vectors.append(e[f"resp_{lang}"][i])
                points.append({"id": f"{run}:{pid}:{lang}", "kind": "answer", "run": run,
                               "topic": pid, "lang": lang})
        if wiki_vec is None:                       # Wikipedia leads: same in both runs, add once
            wiki_vec = []
            for i, pid in enumerate(df["prompt_id"]):
                if not has_base[i]:
                    continue
                for lang in ("en", "pl"):
                    vectors.append(e[f"wiki_{lang}"][i])
                    points.append({"id": f"wiki:{pid}:{lang}", "kind": "wikipedia", "run": None,
                                   "topic": pid, "lang": lang})
    X = np.vstack(vectors)
    pca = PCA(n_components=3, random_state=0).fit(X)
    xyz = pca.transform(X)
    xyz = xyz / np.abs(xyz).max()                  # scale into [-1, 1] for display
    for p, c in zip(points, xyz):
        p.update(x=float(c[0]), y=float(c[1]), z=float(c[2]))
    info = {"method": "PCA (scikit-learn), 3 components, fitted on all points in this file",
            "input": f"L2-normalised {EMBED_MODEL} embeddings ({X.shape[1]} dimensions)",
            "n_points": len(points),
            "explained_variance_ratio": [float(v) for v in pca.explained_variance_ratio_],
            "scaling": "divided by the largest absolute coordinate",
            "note": ("For display only. Distances in 3D are approximate; the cosines reported "
                     "in the study are in topics.json."),
            "max_abs_diff_recomputed_vs_stored_cosine": max_diff}
    print(f"  LaBSE: recomputed cosines match stored values (max diff {max_diff:.2e})")
    return {"projection": info, "points": points}


# --------------------------------------------------------------------------- #
#  tables, Tatoeba, meta
# --------------------------------------------------------------------------- #
def _records(csv_path):
    df = pd.read_csv(csv_path)
    return [{k: (_num(v) if not isinstance(v, str) else v) for k, v in row.items()}
            for row in df.to_dict(orient="records")]


def build_tatoeba():
    from .calibration import SCORED_CSV
    cal = pd.read_csv(SCORED_CSV, dtype={"eng_id": str, "pol_id": str})
    pairs = [{"pair_no": int(r.pair_no), "eng_id": r.eng_id, "pol_id": r.pol_id,
              "en": r.eng_text, "pl": r.pol_text,
              "sentiment_en": float(r.sent_en), "sentiment_pl": float(r.sent_pl),
              "label_en": r.label_en, "label_pl": r.label_pl,
              "xlmr_tokens_en": int(r.tokens_en), "xlmr_tokens_pl": int(r.tokens_pl)}
             for r in cal.itertuples()]
    return {"source": "Tatoeba (https://tatoeba.org), CC BY 2.0 FR",
            "sentence_url": "https://tatoeba.org/en/sentences/show/{id}",
            "pairs": pairs}


def build_meta(projection):
    keep = ("model", "temperature", "max_tokens", "length_instruction", "jitter_seed")
    return {
        "schema_version": 1,
        "source_commit": _git_commit(),
        "title": "Lost in Translation",
        "author": "Katarzyna Frąckowiak",
        "repository": "https://github.com/Kasia420/lost_in_translation",
        "runs": {r: {k: RUNS[r].get(k) for k in keep} for r in SITE_RUNS},
        "run_notes": {"v1": "course submission; l02-en and l08-pl end mid-sentence (stop_reason not logged)",
                      "v2": "re-run; all 50 answers stop_reason=end_turn; exploratory"},
        "models": {"embedding": EMBED_MODEL, "sentiment": SENTIMENT_MODEL,
                   "sentiment_polarity": "P(positive) - P(negative); primary: input truncated at 512 tokens"},
        "domains": [{"id": d, "label": DOMAIN_LABELS[d]} for d in DOMAIN_ORDER],
        "statistics": "paired Wilcoxon signed-rank (scipy defaults); matched-pairs rank-biserial of A - B",
        "projection": projection,
        "attribution": {
            "wikipedia": "Wikipedia lead sections, CC BY-SA 4.0; titles and URLs in topics.json",
            "tatoeba": "Tatoeba sentences, CC BY 2.0 FR; sentence ids in tatoeba.json",
            "answers": "generated with Claude through the Anthropic API",
            "data_licence": "CC BY-SA 4.0"},
    }


# --------------------------------------------------------------------------- #
#  verification: rebuild results_table.csv from the JSON alone
# --------------------------------------------------------------------------- #
def _frame_from_topics(topics, run):
    rows = []
    for t in topics:
        r, w = t["runs"][run], t["wikipedia"] or {}
        row = {"prompt_id": t["id"], "domain": t["domain"],
               "wiki_en": (w.get("en") or {}).get("lead"), "wiki_pl": (w.get("pl") or {}).get("lead"),
               "sim_en_pl": r["cosine_en_pl"],
               "native_pull_en": r["native_pull"]["en"], "native_pull_pl": r["native_pull"]["pl"]}
        for lang in ("en", "pl"):
            a = r["answers"][lang]
            row.update({f"sent_{lang}": a["sentiment"], f"sent_chunk_{lang}": a["sentiment_chunked"],
                        f"tokens_resp_{lang}": a["xlmr_tokens"], f"words_{lang}": a["words"],
                        f"words_clean_{lang}": a["words_clean"]})
            wl = w.get(lang) or {}
            row.update({f"wiki_sent_{lang}": wl.get("sentiment"),
                        f"wiki_sent_chunk_{lang}": wl.get("sentiment_chunked"),
                        f"tokens_wiki_{lang}": wl.get("xlmr_tokens")})
        rows.append(row)
    df = pd.DataFrame(rows).astype({c: float for c in rows[0] if c not in
                                    ("prompt_id", "domain", "wiki_en", "wiki_pl")})
    df["sent_gap"] = df.sent_pl - df.sent_en
    df["sent_chunk_gap"] = df.sent_chunk_pl - df.sent_chunk_en
    df["wiki_sent_gap"] = df.wiki_sent_pl - df.wiki_sent_en
    df["wiki_sent_chunk_gap"] = df.wiki_sent_chunk_pl - df.wiki_sent_chunk_en
    df["domain"] = pd.Categorical(df["domain"], categories=DOMAIN_ORDER, ordered=True)
    return df.sort_values(["domain", "prompt_id"]).reset_index(drop=True)


def verify(out_dir=DEFAULT_OUT):
    from .tables import calibration_rows, run_rows

    load = lambda n: json.loads((out_dir / n).read_text(encoding="utf-8"))
    topics, tatoeba, results = load("topics.json"), load("tatoeba.json"), load("results.json")

    rebuilt = []
    for run in SITE_RUNS:
        rebuilt += run_rows(run, _frame_from_topics(topics, run))
    cal = pd.DataFrame([{"sent_en": p["sentiment_en"], "sent_pl": p["sentiment_pl"],
                         "tokens_en": p["xlmr_tokens_en"], "tokens_pl": p["xlmr_tokens_pl"],
                         "label_en": p["label_en"], "label_pl": p["label_pl"]} for p in tatoeba["pairs"]])
    rebuilt += calibration_rows(cal)

    table = pd.read_csv(ROOT / "results" / "results_table.csv")
    if len(rebuilt) != len(table) or len(results) != len(table):
        raise SystemExit(f"row count mismatch: rebuilt {len(rebuilt)}, json {len(results)}, csv {len(table)}")
    num_cols = ["n", "median_A", "median_B", "median_diff", "W", "p", "rank_biserial"]
    worst = 0.0
    for i, (want, got, js) in enumerate(zip(table.to_dict("records"), rebuilt, results)):
        for k in ("run", "section", "measure", "subset"):
            if want[k] != got[k] or want[k] != js[k]:
                raise SystemExit(f"row {i}: {k} differs ({want[k]!r} / {got[k]!r} / {js[k]!r})")
        if (want["notes"] if isinstance(want["notes"], str) else "") != (got["notes"] or ""):
            raise SystemExit(f"row {i}: notes differ\n  csv:     {want['notes']}\n  rebuilt: {got['notes']}")
        for k in num_cols:
            a, b, c = _num(want.get(k)), _num(got.get(k)), _num(js.get(k))
            if a is None and b is None and c is None:
                continue
            if None in (a, b, c):
                raise SystemExit(f"row {i} {k}: missing value ({a} / {b} / {c})")
            worst = max(worst, abs(a - b), abs(a - c))
            if worst > VERIFY_TOLERANCE:
                raise SystemExit(f"row {i} ({want['run']} {want['section']} {want['subset']}) "
                                 f"{k}: csv {a} vs rebuilt {b} vs json {c}")
    print(f"  verify: all {len(table)} rows of results/results_table.csv rebuilt from the JSON "
          f"(max abs diff {worst:.1e})")

    words = load("word_counts.json")
    wc = pd.read_csv(ROOT / "results" / "word_counts.csv")
    if words != _records(ROOT / "results" / "word_counts.csv") or len(words) != len(wc):
        raise SystemExit("word_counts.json differs from results/word_counts.csv")
    print(f"  verify: word_counts.json matches results/word_counts.csv ({len(wc)} rows)")
    return worst


# --------------------------------------------------------------------------- #
def export_site_data(out_dir=None):
    out_dir = out_dir or DEFAULT_OUT
    out_dir.mkdir(parents=True, exist_ok=True)
    topics = build_topics()
    emb = build_embeddings(topics)
    _write(out_dir, "topics.json", topics)
    _write(out_dir, "results.json", _records(ROOT / "results" / "results_table.csv"))
    _write(out_dir, "word_counts.json", _records(ROOT / "results" / "word_counts.csv"))
    _write(out_dir, "embeddings3d.json", {"points": emb["points"]})
    _write(out_dir, "tatoeba.json", build_tatoeba())
    _write(out_dir, "meta.json", build_meta(emb["projection"]))
    verify(out_dir)
