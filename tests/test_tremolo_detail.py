from copy import deepcopy
import pytest
from lib.song import note_from_wire, note_to_wire


def example():
    return {'t':1.123456,'s':2,'f':7,'sus':1.234567,'tr':True,
        'tremolo_marks':[{'start':.123456,'end':1.234567,'rate':[1,16],
                          'period':.125,'phase':.25,'mode':'specified'}]}


def test_wire_preserves_timing_and_scored_duration():
    raw=example(); note=note_from_wire(raw); out=note_to_wire(note)
    for key,value in raw.items():assert out[key]==value
    assert note.tremolo and note.sustain==raw['sus']
    assert not note.ignore


@pytest.mark.parametrize('fault',['negative','outside','phase','rate','period','overlap','mode'])
def test_malformed_expression_rejected(fault):
    raw=example(); m=raw['tremolo_marks'][0]
    if fault=='negative':m['start']=-1
    if fault=='outside':m['end']=2
    if fault=='phase':m['phase']=1
    if fault=='rate':m['rate']=[True,16]
    if fault=='period':m['period']=0
    if fault=='overlap':raw['tremolo_marks'].append(deepcopy(m))
    if fault=='mode':m['mode']='unknown'
    with pytest.raises(ValueError):note_from_wire(raw)


def test_legacy_and_empty_are_distinct():
    raw=example();raw.pop('tremolo_marks')
    assert note_from_wire(raw).tremolo_marks is None
    raw['tremolo_marks']=[]
    assert note_to_wire(note_from_wire(raw))['tremolo_marks']==[]
