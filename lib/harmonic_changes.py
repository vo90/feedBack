"""Validated delayed AH contact; it never creates another picked note."""
from copy import deepcopy
import math
from lib.harmonic_target import validate_target


def validate_changes(note):
    if 'harmonic_changes' not in note:
        return None
    value = note['harmonic_changes']
    finite = lambda x: type(x) in (int, float) and math.isfinite(x)
    if (not isinstance(value, dict) or set(value) != {'version','events'}
            or type(value['version']) is not int or value['version'] != 1
            or not isinstance(value['events'], list) or len(value['events']) != 1
            or any(note.get(k) for k in ('hm','hp','mt','fhm'))
            or any(k in note for k in ('harmonic_target','hn','hps','harmonic_alias'))
            or not finite(note.get('sus')) or note['sus'] <= 0):
        raise ValueError('Invalid delayed harmonic contact')
    event = value['events'][0]
    if (not isinstance(event, dict) or set(event) != {'start','end','target','source_id'}
            or not all(finite(event[k]) for k in ('start','end'))
            or not 0 < event['start'] < event['end']
            or abs(event['end'] - note['sus']) > .0000011
            or not isinstance(event['source_id'], str) or not 0 < len(event['source_id']) <= 512
            or not isinstance(event['target'], dict) or event['target'].get('kind') != 'artificial'
            # A timed physical contact requires an actual touch position.
            # Playback-only pitch fallback cannot establish that gesture.
            or not finite(event['target'].get('node'))):
        raise ValueError('Invalid delayed harmonic interval or target')
    validate_target({'f':note.get('f'), 'harmonic_target':event['target']})
    if (note.get('sl', -1) != -1 or note.get('slu', -1) != -1 or 'slide_interval' in note):
        interval = note.get('slide_interval')
        if (not isinstance(interval, dict) or set(interval) != {'start', 'end'}
                or not all(finite(interval[k]) for k in interval)
                or type(note.get('sl')) is not int or not 0 < note['sl'] <= 24
                or not 0 < note['f'] <= 24 or note['sl'] == note['f']
                or note.get('slu', -1) != -1
                or not event['start'] < interval['start'] < interval['end'] <= note['sus'] + .0000011
                or any(note.get(k) for k in ('bn', 'bt', 'bnv', 'ho', 'po', 'vb', 'tr',
                       'whammy', 'vibrato_marks', 'tremolo_marks', 'pick_scrape_marks',
                       'slide_out', 'slide_out_marks', 'slide_in_marks'))):
            raise ValueError('Invalid delayed harmonic contact slide')
    return deepcopy(value)
