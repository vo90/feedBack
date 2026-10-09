import pytest
from lib.song import note_from_wire,note_to_wire


def test_visual_ringing_round_trip_does_not_extend_scored_duration():
    raw={'t':2,'s':0,'f':0,'sus':.455,'lr':True,'let_ring_sus':2.73}
    n=note_from_wire(raw)
    assert n.sustain==.455 and n.let_ring_sustain==2.73
    wire=note_to_wire(n)
    assert all(wire[k]==v for k,v in raw.items())


@pytest.mark.parametrize('value',[True,-1,0,.2,float('nan'),float('inf'),'4'])
def test_reject_malformed_ringing_span(value):
    with pytest.raises(ValueError):note_from_wire({'sus':.5,'let_ring_sus':value})


def test_dead_notes_cannot_gain_pitched_trail():
    with pytest.raises(ValueError):note_from_wire({'mt':True,'sus':.5,'let_ring_sus':2})
