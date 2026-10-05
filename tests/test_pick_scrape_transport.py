from copy import deepcopy
import pytest
from lib.song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire


def wire():
    return {'t': 3, 's': 1, 'f': 34, 'mt': True, 'sus': 2,
            'pick_scrape_marks': [{'direction': 'down', 'start': 0, 'end': 1},
                                 {'direction': 'up', 'start': 1, 'end': 2}]}


def test_solo_and_mixed_chord_roundtrip_without_invented_positions():
    src = wire(); before = deepcopy(src)
    solo = note_to_wire(note_from_wire(src))
    chord = chord_to_wire(chord_from_wire({'t': 3, 'id': 0, 'notes': [src, {'s': 2, 'f': 7, 'sus': 1}]}))
    for output in (solo, chord['notes'][0]):
        for key in ('s', 'f', 'mt', 'sus', 'pick_scrape_marks'): assert output[key] == src[key]
        assert 'ig' not in output  # no general scoring opt-out in the source
    assert not chord['notes'][1].get('mt') and 'pick_scrape_marks' not in chord['notes'][1]
    assert src == before


@pytest.mark.parametrize('mutate', [
    lambda n: n.update(mt=False), lambda n: n.update(pick_scrape_marks=[]),
    lambda n: n['pick_scrape_marks'][0].update(direction='left'),
    lambda n: n['pick_scrape_marks'][0].update(end=3),
    lambda n: n['pick_scrape_marks'][0].update(start=-1),
    lambda n: n['pick_scrape_marks'][0].update(start=True),
    lambda n: n['pick_scrape_marks'][0].update(end=float('nan')),
    lambda n: n['pick_scrape_marks'][1].update(start=.5),
])
def test_invalid_gestures_cannot_silently_become_ordinary_notes(mutate):
    n = wire(); mutate(n)
    with pytest.raises(ValueError): note_from_wire(n)


def test_legacy_unpitched_mute_does_not_become_a_scrape():
    n = note_to_wire(note_from_wire({'s': 0, 'f': 127, 'mt': True}))
    assert 'pick_scrape_marks' not in n


def test_fractional_interval_endpoints_remain_valid_after_two_wire_roundtrips():
    n=wire();n['sus']=2.123456;n['pick_scrape_marks'][-1]['end']=n['sus']
    first=note_to_wire(note_from_wire(n))
    assert note_to_wire(note_from_wire(first))==first
