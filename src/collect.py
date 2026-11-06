"""Collect Claude's answers to every prompt in English and in Polish.

Writes one row per (prompt, language) to data/raw/<run>/llm_responses.csv.
Collection is resumable: rows already present are skipped, and each answer is
appended as soon as it arrives, so an interrupted run can simply be restarted.

The API key is read from the ANTHROPIC_API_KEY environment variable
(or a .env file in the repository root, see .env.example).
"""
import datetime as dt
import os
import sys
import time

import pandas as pd

from .config import LANGUAGES, MAX_RETRIES, RETRY_BACKOFF_SEC


def get_anthropic_caller(cfg):
    """Return (model_id, call) for the run's settings, or None if no key / SDK.

    `call(prompt_text)` returns the answer text, or, for runs with
    extended_logging, a dict with the text plus the API's response metadata.
    """
    if not os.getenv("ANTHROPIC_API_KEY"):
        return None
    try:
        import anthropic
    except ImportError:
        print("  ! brak SDK anthropic (pip install anthropic) — pomijam Claude")
        return None
    client = anthropic.Anthropic()

    def call(prompt_text):
        msg = client.messages.create(
            model=cfg["model"],
            max_tokens=cfg["max_tokens"],
            temperature=cfg["temperature"],
            messages=[{"role": "user", "content": prompt_text}],
        )
        text = "".join(b.text for b in msg.content
                       if getattr(b, "type", None) == "text").strip()
        if not cfg.get("extended_logging"):
            return text
        return {
            "text": text,
            "model_returned": msg.model,          # exact model id reported by the API
            "stop_reason": msg.stop_reason,       # "end_turn" or "max_tokens" (= cut off)
            "input_tokens": msg.usage.input_tokens,
            "output_tokens": msg.usage.output_tokens,
            "message_id": msg.id,
            "request_id": getattr(msg, "_request_id", None),
            "anthropic_version": client.default_headers.get("anthropic-version"),
            "sdk_version": anthropic.__version__,
        }

    return (cfg["model"], call)


def build_prompt_text(p, lang, cfg):
    """Prompt sent to the model: the prompt in `lang`, plus the run's length instruction."""
    text = p["prompt_en"] if lang == "en" else p["prompt_pl"]
    instr = cfg.get("length_instruction")
    return f"{text} {instr[lang]}" if instr else text


def call_with_retry(fn, prompt_text):
    """Call the API with exponential back-off; return None after MAX_RETRIES failures."""
    delay = RETRY_BACKOFF_SEC
    for attempt in range(1, MAX_RETRIES + 1):
        try:
            return fn(prompt_text)
        except Exception as e:
            if attempt == MAX_RETRIES:
                print(f"    x nieudane po {attempt} próbach: {e}")
                return None
            print(f"    . ponawiam {attempt}/{MAX_RETRIES - 1} za {delay}s ({type(e).__name__})")
            time.sleep(delay)
            delay *= 2
    return None


def append_row(path, row):
    """Append one row to a CSV, writing the header if the file is new."""
    df = pd.DataFrame([row])
    header = not path.exists()
    df.to_csv(path, mode="a", header=header, index=False, encoding="utf-8")


def collect_llm(paths, dry_run=False):
    """Ask Claude every prompt in EN and PL; append answers to llm_responses.csv.

    dry_run: print the exact prompts and settings that would be sent, call nothing.
    """
    cfg = paths.cfg
    prompts = pd.read_csv(paths.prompts_csv)

    if dry_run:
        print(f"[dry run] run={paths.run} model={cfg['model']} temperature={cfg['temperature']} "
              f"max_tokens={cfg['max_tokens']} -> {paths.llm_responses_csv}")
        for _, p in prompts.iterrows():
            for lang in LANGUAGES:
                print(f"  {p['prompt_id']} {lang}: {build_prompt_text(p, lang, cfg)}")
        return

    caller = get_anthropic_caller(cfg)
    if not caller:
        print("Brak ANTHROPIC_API_KEY (albo SDK). Ustaw klucz i uruchom ponownie.")
        sys.exit(1)
    model_id, call = caller

    done = set()
    if paths.llm_responses_csv.exists():
        prev = pd.read_csv(paths.llm_responses_csv)
        done = set(zip(prev["prompt_id"], prev["provider"], prev["language"]))

    total = len(prompts) * len(LANGUAGES)
    n = 0
    print(f"Zbieram: claude | prompty: {len(prompts)} | języki: {LANGUAGES} "
          f"| temp={cfg['temperature']} max_tokens={cfg['max_tokens']}\n")

    for _, p in prompts.iterrows():
        for lang in LANGUAGES:
            n += 1
            key = (p["prompt_id"], "claude", lang)
            tag = f"[{n}/{total}] {p['prompt_id']} claude {lang}"
            if key in done:
                print(f"{tag}  (pomijam, już zebrane)")
                continue
            prompt_text = build_prompt_text(p, lang, cfg)
            print(f"{tag}  pytam...")
            result = call_with_retry(call, prompt_text)
            if result is None:
                continue

            meta = result if isinstance(result, dict) else {"text": result}
            text = meta.pop("text")
            row = {
                "prompt_id": p["prompt_id"], "domain": p["domain"], "topic": p["topic"],
                "provider": "claude",
                "model": model_id, "language": lang,
                "prompt_text": prompt_text, "response_text": text,
                "n_chars": len(text), "n_words": len(text.split()),
                "timestamp": dt.datetime.now().isoformat(timespec="seconds"),
            }
            if cfg.get("extended_logging"):
                row["model_requested"] = row.pop("model")
                row.update({
                    "temperature": cfg["temperature"], "max_tokens": cfg["max_tokens"],
                    "length_instruction": (cfg.get("length_instruction") or {}).get(lang, ""),
                    **meta,
                })
            append_row(paths.llm_responses_csv, row)

    print(f"\nGotowe. Odpowiedzi zapisane w {paths.llm_responses_csv}")
