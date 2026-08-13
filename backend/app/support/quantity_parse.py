"""Parse customer quantity replies in chat sales flows."""

from __future__ import annotations

import re

MAX_QUANTITY = 999

QUANTITY_RE = re.compile(r"\b([1-9][0-9]{0,2})\b")

WORD_QUANTITIES: dict[str, int] = {
    "one": 1,
    "two": 2,
    "three": 3,
    "four": 4,
    "five": 5,
    "six": 6,
    "seven": 7,
    "eight": 8,
    "nine": 9,
    "ten": 10,
    "a": 1,
    "an": 1,
    "single": 1,
    "moja": 1,
    "mbili": 2,
    "tatu": 3,
    "nne": 4,
    "tano": 5,
}


def parse_quantity(text: str | None) -> int | None:
    """Return a quantity between 1 and MAX_QUANTITY, or None if not understood."""
    raw = (text or "").strip().lower()
    if not raw:
        return None

    if raw in WORD_QUANTITIES:
        return WORD_QUANTITIES[raw]

    if re.fullmatch(r"\d{1,3}", raw):
        value = int(raw)
        return value if 1 <= value <= MAX_QUANTITY else None

    match = QUANTITY_RE.search(raw)
    if match:
        value = int(match.group(1))
        return value if 1 <= value <= MAX_QUANTITY else None

    for word, qty in WORD_QUANTITIES.items():
        if len(word) <= 1:
            continue
        if re.search(rf"\b{re.escape(word)}\b", raw):
            return qty

    return None


def clamp_quantity(value: int, *, max_quantity: int | None = None) -> int:
    upper = MAX_QUANTITY if max_quantity is None else min(MAX_QUANTITY, max_quantity)
    return max(1, min(int(value or 1), upper))
