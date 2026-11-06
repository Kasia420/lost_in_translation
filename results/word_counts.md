# Word counts (medians)

`n_words` = whitespace-separated tokens (as in the paper). `clean` = tokens containing a letter or digit, after removing line-initial list/heading/quote markers (`src/extended.py: clean_word_count`). EN−PL columns are medians of the per-topic differences.

| run | subset | n | n_words EN | n_words PL | n_words EN−PL (paired) | clean EN | clean PL | clean EN−PL (paired) |
|---|---|---|---|---|---|---|---|---|
| v1 | all | 25 | 211 | 165 | 46 | 200 | 145 | 53 |
| v1 | Contested history | 9 | 211 | 181 | 36 | 198 | 157 | 48 |
| v1 | Literature | 8 | 213.5 | 165 | 49 | 201.5 | 141.5 | 61 |
| v1 | Social norms | 8 | 208.5 | 157 | 55.5 | 196 | 137.5 | 63 |
| v2 | all | 25 | 155 | 128 | 29 | 154 | 120 | 34 |
| v2 | Contested history | 9 | 156 | 129 | 28 | 155 | 120 | 33 |
| v2 | Literature | 8 | 153.5 | 123 | 29.5 | 151.5 | 115 | 36 |
| v2 | Social norms | 8 | 155.5 | 129 | 27 | 154.5 | 122.5 | 31 |
