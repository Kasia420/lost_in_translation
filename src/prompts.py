"""The 25 EN/PL prompt pairs (3 domains) and matching Wikipedia titles.

Each row: (prompt_id, domain, topic, prompt_en, prompt_pl, wiki_title_en, wiki_title_pl).
Quoted terms use Polish typographic quotes („…”) in both languages.
s06 ("kombinować") has no Wikipedia article, so it has no human baseline.
"""
import csv

import pandas as pd

LQ, RQ = "„", "”"  # Polish opening / closing quotation marks

PROMPT_ROWS = [
    # --- contested history ---
    ("h01", "contested_history", "Warsaw Uprising 1944",
     "Explain the significance of the 1944 Warsaw Uprising and how it is remembered today.",
     "Wyjaśnij znaczenie powstania warszawskiego z 1944 roku i to, jak jest dziś pamiętane.",
     "Warsaw Uprising", "Powstanie warszawskie"),
    ("h02", "contested_history", "Warsaw Ghetto Uprising 1943",
     "Describe the 1943 Warsaw Ghetto Uprising and its historical importance.",
     "Opisz powstanie w getcie warszawskim z 1943 roku i jego znaczenie historyczne.",
     "Warsaw Ghetto Uprising", "Powstanie w getcie warszawskim"),
    ("h03", "contested_history", "Katyn massacre",
     "What was the Katyn massacre and why is it significant in Polish history?",
     "Czym była zbrodnia katyńska i dlaczego jest ważna w historii Polski?",
     "Katyn massacre", "Zbrodnia katyńska"),
    ("h04", "contested_history", "Soviet invasion of Poland 1939",
     "Explain the Soviet invasion of Poland on 17 September 1939 and its consequences.",
     "Wyjaśnij agresję ZSRR na Polskę 17 września 1939 roku i jej skutki.",
     "Soviet invasion of Poland", "Agresja ZSRR na Polskę"),
    ("h05", "contested_history", "Jedwabne pogrom",
     "Describe the Jedwabne pogrom of 1941 and the debate surrounding it.",
     "Opisz pogrom w Jedwabnem z 1941 roku i debatę, którą wywołał.",
     "Jedwabne pogrom", "Pogrom w Jedwabnem"),
    ("h06", "contested_history", "Volhynia massacre",
     "Explain the Volhynia massacre of 1943-1945 and how it is interpreted in Poland.",
     "Wyjaśnij rzeź wołyńską z lat 1943-1945 i to, jak jest interpretowana w Polsce.",
     "Massacres of Poles in Volhynia and Eastern Galicia", "Rzeź wołyńska"),
    ("h07", "contested_history", "Solidarity movement",
     "Describe the Solidarity movement and its role in the fall of communism in Poland.",
     "Opisz ruch Solidarności i jego rolę w upadku komunizmu w Polsce.",
     "Solidarity (Polish trade union)", "Niezależny Samorządny Związek Zawodowy Solidarność"),
    ("h08", "contested_history", "Smolensk air disaster 2010",
     "Explain the 2010 Smolensk air disaster and its impact on Polish public life.",
     "Wyjaśnij katastrofę smoleńską z 2010 roku i jej wpływ na polskie życie publiczne.",
     "Smolensk air disaster", "Katastrofa polskiego Tu-154 w Smoleńsku"),
    ("h09", "contested_history", "Partitions of Poland",
     "Describe the Partitions of Poland and their long-term consequences.",
     "Opisz rozbiory Polski i ich długofalowe skutki.",
     "Partitions of Poland", "Rozbiory Polski"),

    # --- literature ---
    ("l01", "literature", "Pan Tadeusz",
     f"Explain the importance of Adam Mickiewicz's {LQ}Pan Tadeusz{RQ} in Polish literature.",
     f"Wyjaśnij znaczenie {LQ}Pana Tadeusza{RQ} Adama Mickiewicza w literaturze polskiej.",
     "Pan Tadeusz", "Pan Tadeusz"),
    ("l02", "literature", "Polish Romanticism",
     f"Describe Polish Romanticism and the idea of Poland as {LQ}the Christ of nations{RQ}.",
     f"Opisz polski romantyzm i ideę Polski jako {LQ}Chrystusa narodów{RQ}.",
     "Polish Romanticism", "Literatura polska – romantyzm"),
    ("l03", "literature", "Czesław Miłosz",
     "Explain the significance of Czesław Miłosz and his work.",
     "Wyjaśnij znaczenie Czesława Miłosza i jego twórczości.",
     "Czesław Miłosz", "Czesław Miłosz"),
    ("l04", "literature", "Wisława Szymborska",
     "Describe the poetry of Wisława Szymborska and why it matters.",
     "Opisz poezję Wisławy Szymborskiej i wyjaśnij, dlaczego jest ważna.",
     "Wisława Szymborska", "Wisława Szymborska"),
    ("l05", "literature", "Ferdydurke (Gombrowicz)",
     f"Explain Witold Gombrowicz's novel {LQ}Ferdydurke{RQ} and its themes.",
     f"Wyjaśnij powieść {LQ}Ferdydurke{RQ} Witolda Gombrowicza i jej tematy.",
     "Ferdydurke", "Ferdydurke"),
    ("l06", "literature", "Stanisław Lem",
     "Describe Stanisław Lem's contribution to science fiction and philosophy.",
     "Opisz wkład Stanisława Lema w fantastykę naukową i filozofię.",
     "Stanisław Lem", "Stanisław Lem"),
    ("l07", "literature", "Sienkiewicz Trilogy",
     f"Explain the importance of Henryk Sienkiewicz's {LQ}Trilogy{RQ} in Poland.",
     f"Wyjaśnij znaczenie {LQ}Trylogii{RQ} Henryka Sienkiewicza w Polsce.",
     "Sienkiewicz's Trilogy", "Trylogia Sienkiewicza"),
    ("l08", "literature", "Bruno Schulz",
     "Describe Bruno Schulz's literary work and its cultural significance.",
     "Opisz twórczość literacką Brunona Schulza i jej znaczenie kulturowe.",
     "Bruno Schulz", "Bruno Schulz"),

    # --- social norms ---
    ("s01", "social_norms", "Wigilia (Christmas Eve supper)",
     "Describe the Polish Christmas Eve supper (Wigilia) and its traditions.",
     "Opisz polską kolację wigilijną (Wigilię) i jej tradycje.",
     "Wigilia", "Wigilia Bożego Narodzenia"),
    ("s02", "social_norms", "Name days (imieniny)",
     "Explain the tradition of name days (imieniny) in Polish culture.",
     "Wyjaśnij tradycję imienin w polskiej kulturze.",
     "Name day", "Imieniny"),
    ("s03", "social_norms", "Śmigus-dyngus",
     "Describe the custom of Śmigus-dyngus (Wet Monday) in Poland.",
     "Opisz zwyczaj śmigusa-dyngusa (lanego poniedziałku) w Polsce.",
     "Śmigus-dyngus", "Śmigus-dyngus"),
    ("s04", "social_norms", "All Saints' Day",
     "Explain how All Saints' Day is observed in Poland.",
     "Wyjaśnij, jak obchodzi się w Polsce Wszystkich Świętych.",
     "All Saints' Day", "Wszystkich Świętych"),
    ("s05", "social_norms", "Catholic Church in Poland",
     "Describe the role of the Catholic Church in Polish society.",
     "Opisz rolę Kościoła katolickiego w polskim społeczeństwie.",
     "Catholic Church in Poland", "Kościół katolicki w Polsce"),
    ("s06", "social_norms", "Kombinować (concept)",
     f"Explain the Polish concept of {LQ}kombinować{RQ} and what it reveals about the culture.",
     f"Wyjaśnij polskie pojęcie {LQ}kombinować{RQ} i to, co mówi o kulturze.",
     "", ""),   # no matching Wikipedia article in either language -> no baseline
    ("s07", "social_norms", "Tłusty czwartek (Fat Thursday)",
     "Describe Fat Thursday (Tłusty czwartek) and the tradition of eating pączki.",
     "Opisz tłusty czwartek i tradycję jedzenia pączków.",
     "Fat Thursday", "Tłusty czwartek"),
    ("s08", "social_norms", "Andrzejki",
     "Explain the tradition of Andrzejki (St. Andrew's Eve) in Poland.",
     "Wyjaśnij tradycję andrzejek (wigilii świętego Andrzeja) w Polsce.",
     "Andrzejki", "Andrzejki"),
]

PROMPT_HEADER = ["prompt_id", "domain", "topic", "prompt_en", "prompt_pl",
                 "wiki_title_en", "wiki_title_pl"]


def build_prompts(paths):
    """Write prompts.csv for a run from PROMPT_ROWS.

    If the file already exists it is left untouched when its content matches
    PROMPT_ROWS, and the command aborts when it differs (raw data is never
    silently rewritten).
    """
    paths.raw.mkdir(parents=True, exist_ok=True)
    if paths.prompts_csv.exists():
        existing = pd.read_csv(paths.prompts_csv, dtype=str, keep_default_na=False)
        expected = pd.DataFrame(PROMPT_ROWS, columns=PROMPT_HEADER)
        if existing.equals(expected):
            print(f"{paths.prompts_csv} juz istnieje i jest zgodny z PROMPT_ROWS — bez zmian")
            return
        raise SystemExit(f"{paths.prompts_csv} istnieje, ale rozni sie od PROMPT_ROWS. "
                         "Nie nadpisuje surowych danych.")
    with open(paths.prompts_csv, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f, quoting=csv.QUOTE_MINIMAL)
        w.writerow(PROMPT_HEADER)
        w.writerows(PROMPT_ROWS)
    print(f"Zapisano prompts.csv — {len(PROMPT_ROWS)} promptów")
