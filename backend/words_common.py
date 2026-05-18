# -*- coding: utf-8 -*-
"""
Vocabulary helpers shared between backend modules.

Both backend/app.py and backend/bot.py need to derive image filenames from
en_word and to know where custom-word indices start. Keeping the spec here
prevents subtle drift (e.g. one side stripping apostrophes and the other
not), which would break image lookups.
"""

import re as _re

# Custom-word indices (in `custom_words` table) start at this base, leaving room
# for the static catalog (words_of_day.py) to grow below it. word_progress rows
# reference idx by value, so this boundary must stay stable forever.
CUSTOM_IDX_BASE = 10000


def img_key(en_word: str) -> str:
    """Normalize an English word to a safe image filename key.

    Rules:
      - lowercase
      - spaces and hyphens → underscore (so "ice cream" → "ice_cream")
      - apostrophes / punctuation stripped (so "don't" → "dont")
      - keep only [a-z0-9_]

    Used as `/static/words/<img_key>.jpg`. The image is shared between the
    English and Russian sides of the same word pair, so keying on en_word
    gives one stable identifier per concept regardless of learning mode.
    """
    if not en_word:
        return ""
    s = en_word.lower().strip()
    s = _re.sub(r"[\s\-]+", "_", s)
    s = _re.sub(r"[^a-z0-9_]", "", s)
    return s
