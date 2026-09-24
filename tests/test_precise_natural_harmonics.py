import pytest
from lib.song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire


def test_target_roundtrip_keeps_source_fret_and_precise_metadata():
    n={'t':1,'s':2,'f':3,'sus':2,'hm':True,'hn':3.2,'hps':31,'ghost':True}
    for value in (note_to_wire(note_from_wire(n)), chord_to_wire(chord_from_wire({'t':1,'id':0,'notes':[n]}))['notes'][0]):
        for key in ('s','f','hm','hn','hps','ghost'): assert value[key]==n[key]


@pytest.mark.parametrize('extra', [{'hn':3.2},{'hps':31},{'hn':True,'hps':31},
    {'hn':float('nan'),'hps':31},{'hn':3.2,'hps':True},{'hn':3.2,'hps':31.5},
    {'hn':3.2,'hps':31,'hm':False}])
def test_invalid_targets_cannot_turn_into_legacy_energy_only_harmonics(extra):
    with pytest.raises(ValueError): note_from_wire({'t':1,'s':0,'f':3,'hm':True,**extra})


def test_legacy_harmonics_remain_unchanged():
    assert 'hn' not in note_to_wire(note_from_wire({'t':1,'s':0,'f':7,'hm':True}))
