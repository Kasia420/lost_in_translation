"""Fetch the matching English and Polish Wikipedia article for every topic.

The articles are the human-written reference point ("baseline") for the
similarity analysis. Topics without a title in prompts.csv (s06) or whose page
is not found are logged to wiki_missing.csv. Fetching is resumable.

Wikipedia text is licensed CC BY-SA 4.0; article URLs are stored in the
`wiki_url` column for attribution.
"""
import os

import pandas as pd

from .collect import append_row
from .config import LANGUAGES, WIKI_USER_AGENT_TEMPLATE


def wiki_user_agent():
    """Build the User-Agent from WIKI_CONTACT (required by Wikipedia's API policy)."""
    contact = os.getenv("WIKI_CONTACT")
    if not contact:
        raise SystemExit("Ustaw WIKI_CONTACT (adres kontaktowy dla API Wikipedii) w .env")
    return WIKI_USER_AGENT_TEMPLATE.format(contact=contact)


def fetch_wikipedia(paths):
    """Download the EN and PL article (lead summary + full text) for each topic."""
    import wikipediaapi

    prompts = pd.read_csv(paths.prompts_csv).fillna("")
    ua = wiki_user_agent()
    wikis = {
        "en": wikipediaapi.Wikipedia(user_agent=ua, language="en"),
        "pl": wikipediaapi.Wikipedia(user_agent=ua, language="pl"),
    }

    done = set()
    if paths.wiki_articles_csv.exists():
        prev = pd.read_csv(paths.wiki_articles_csv)
        done = set(zip(prev["prompt_id"], prev["language"]))

    n_ok, n_missing = 0, 0
    for _, p in prompts.iterrows():
        for lang in LANGUAGES:
            key = (p["prompt_id"], lang)
            if key in done:
                print(f"{p['prompt_id']} {lang}  (pomijam, już pobrane)")
                continue

            title = p["wiki_title_en"] if lang == "en" else p["wiki_title_pl"]
            title = str(title).strip()
            if not title:
                print(f"{p['prompt_id']} {lang}  (brak tytułu — zapisuję jako missing)")
                append_row(paths.wiki_missing_csv, {
                    "prompt_id": p["prompt_id"], "language": lang,
                    "topic": p["topic"], "title": "", "reason": "no_title_in_prompts_csv"})
                n_missing += 1
                continue

            page = wikis[lang].page(title)
            if not page.exists():
                print(f"{p['prompt_id']} {lang}  BRAK: '{title}'")
                append_row(paths.wiki_missing_csv, {
                    "prompt_id": p["prompt_id"], "language": lang,
                    "topic": p["topic"], "title": title, "reason": "page_not_found"})
                n_missing += 1
                continue

            text = page.text
            append_row(paths.wiki_articles_csv, {
                "prompt_id": p["prompt_id"], "domain": p["domain"], "topic": p["topic"],
                "language": lang, "wiki_title": page.title, "wiki_url": page.fullurl,
                # `summary` = the article's lead section; this is what the analysis uses.
                "summary": page.summary, "full_text": text,
                "n_chars": len(text), "n_words": len(text.split()),
            })
            print(f"{p['prompt_id']} {lang}  OK: '{page.title}' ({len(text.split())} słów)")
            n_ok += 1

    print(f"\nGotowe. {n_ok} artykułów -> {paths.wiki_articles_csv}")
    if n_missing:
        print(f"{n_missing} nierozwiązanych tytułów -> {paths.wiki_missing_csv} "
              f"(popraw w prompts.csv i uruchom ponownie)")
