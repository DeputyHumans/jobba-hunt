#!/usr/bin/env python3
"""
authentic-prose / optional diagnostic metrics  (Claude Code / local only)

A *diagnostic vector*, NOT a score, NOT a gate, NOT a target. Quality is an inverted-U:
optimizing any of these past the moderate human band makes prose worse and more synthetic.
None of these numbers measure "human authorship" — they describe surface texture only.

Usage:
    python3 metrics.py < text.txt
    python3 metrics.py path/to/text.txt
    python3 metrics.py --before old.txt --after new.txt   # show deltas

Zero dependencies (Python 3.8+ stdlib only). If this script cannot run in your
environment, emit NO numbers at all — qualitative notes only. Never present estimated
figures as if they were measured.

The "moderate human band" must be calibrated as percentiles of your own known-good human
corpus (see tests/known-good/). The placeholder bands below are illustrative starting
points, NOT ground truth — replace them after calibration.
"""
import sys
import re
import math
from collections import Counter

# Illustrative starting bands — RECALIBRATE from tests/known-good percentiles.
BANDS = {
    "sentence_len_entropy_bits": (2.2, 3.6),   # higher = more varied sentence lengths
    "mattr_w50": (0.70, 0.85),                 # moving-average type-token ratio, window 50
    "mean_sentence_len_words": (11.0, 24.0),
}

WORD_RE = re.compile(r"[A-Za-z']+")
SENT_RE = re.compile(r"[^.!?]+[.!?]?")


def sentences(text):
    return [s.strip() for s in SENT_RE.findall(text) if s.strip()]


def words(text):
    return WORD_RE.findall(text.lower())


def shannon_entropy(values):
    if not values:
        return 0.0
    counts = Counter(values)
    n = len(values)
    return -sum((c / n) * math.log2(c / n) for c in counts.values())


def mattr(tokens, window=50):
    if len(tokens) < window:
        return len(set(tokens)) / len(tokens) if tokens else 0.0
    ratios = []
    for i in range(len(tokens) - window + 1):
        chunk = tokens[i:i + window]
        ratios.append(len(set(chunk)) / window)
    return sum(ratios) / len(ratios)


def compute(text):
    sents = sentences(text)
    toks = words(text)
    sent_lens = [len(words(s)) for s in sents] or [0]
    # bucket sentence lengths into bins of 3 words for the entropy of the *shape*
    buckets = [min(l // 3, 12) for l in sent_lens]
    return {
        "n_sentences": len(sents),
        "n_words": len(toks),
        "mean_sentence_len_words": round(sum(sent_lens) / len(sent_lens), 2),
        "sentence_len_entropy_bits": round(shannon_entropy(buckets), 3),
        "mattr_w50": round(mattr(toks), 3),
        "type_token_ratio": round(len(set(toks)) / len(toks), 3) if toks else 0.0,
        "mean_word_len_chars": round(sum(len(w) for w in toks) / len(toks), 2) if toks else 0.0,
        "digit_specificity_count": len(re.findall(r"\d", text)),  # crude proof-of-specificity proxy
    }


def band_note(key, value):
    if key not in BANDS:
        return ""
    lo, hi = BANDS[key]
    if value < lo:
        return f"  (below moderate band {lo}-{hi} — possibly flat/uniform; do NOT auto-maximize)"
    if value > hi:
        return f"  (above moderate band {lo}-{hi} — possibly over-engineered/over-varied)"
    return f"  (within moderate band {lo}-{hi})"


def report(text, label=""):
    m = compute(text)
    head = f"== diagnostic vector {label} ==".strip()
    print(head)
    for k, v in m.items():
        print(f"  {k}: {v}{band_note(k, v) if isinstance(v, float) else ''}")
    print("  NOTE: diagnostic only — never a target, never a gate, not a measure of human authorship.")
    return m


def main(argv):
    if "--before" in argv and "--after" in argv:
        b = open(argv[argv.index("--before") + 1]).read()
        a = open(argv[argv.index("--after") + 1]).read()
        mb = report(b, "(before)")
        print()
        ma = report(a, "(after)")
        print("\n== deltas (after - before) ==")
        for k in mb:
            if isinstance(mb[k], (int, float)):
                print(f"  {k}: {round(ma[k] - mb[k], 3)}")
        print("  Interpret deltas as direction only. A 'better' number does not mean better prose.")
        return
    if len(argv) > 1 and not argv[1].startswith("-"):
        text = open(argv[1]).read()
    else:
        text = sys.stdin.read()
    report(text)


if __name__ == "__main__":
    main(sys.argv)
