"""Strict optional timed finger-vibrato instruction (visual only)."""
import math


def validate_marks(note):
    if 'vibrato_marks' not in note:
        return None
    marks, sustain = note['vibrato_marks'], note.get('sus', 0)
    if (not isinstance(marks, list) or len(marks) > 100000
            or type(sustain) not in (float, int) or not math.isfinite(sustain) or sustain < 0):
        raise ValueError('Invalid timed finger vibrato.')
    previous = 0
    for mark in marks:
        if (not isinstance(mark, dict) or set(mark) != {'start', 'end', 'intensity'}
                or mark['intensity'] not in ('slight', 'wide')
                or any(type(mark[k]) not in (int, float) or not math.isfinite(mark[k]) for k in ('start', 'end'))
                or not previous <= mark['start'] < mark['end'] <= sustain + .0000011):
            raise ValueError('Invalid finger-vibrato interval.')
        previous = mark['end']
    return [dict(m) for m in marks]
