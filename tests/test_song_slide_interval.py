from copy import deepcopy
import math
import pytest
from song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire

WIRE={'t':10.123456,'s':3,'f':7,'sus':1.876543,'sl':9,'ln':True,
      'bnv':[{'t':0,'v':0},{'t':1.876543,'v':2}],
      'slide_interval':{'start':1.123456,'end':1.876543}}

def test_note_and_chord_transport_keep_interval_and_precision():
    for chord in (False,True):
        raw=deepcopy(WIRE)
        if chord:
            source={'t':raw.pop('t'),'id':0,'notes':[raw]}
            result=chord_to_wire(chord_from_wire(source))
            assert result['t']==WIRE['t'];result=result['notes'][0]
        else:result=note_to_wire(note_from_wire(raw))
        for key in ('sus','sl','ln','bnv','slide_interval'):assert result[key]==WIRE[key]

@pytest.mark.parametrize('bad',[None,{},[],{'start':True,'end':1.8},{'start':0,'end':math.nan},
    {'start':0,'end':math.inf},{'start':1,'end':.5},{'start':-1,'end':1},
    {'start':0,'end':3},{'start':0,'end':1,'extra':1}])
def test_present_bad_interval_rejected(bad):
    with pytest.raises(ValueError,match='slide interval'):note_from_wire({**WIRE,'slide_interval':bad})

@pytest.mark.parametrize('change',[{'sl':-1},{'sl':True},{'slu':3},{'f':0},{'mt':True},{'sus':0}])
def test_interval_requires_pitched_sustaining_slide(change):
    with pytest.raises(ValueError,match='slide interval'):note_from_wire({**WIRE,**change})

def test_legacy_slide_omits_optional_data():
    n=deepcopy(WIRE);del n['slide_interval']
    assert 'slide_interval' not in note_to_wire(note_from_wire(n))
