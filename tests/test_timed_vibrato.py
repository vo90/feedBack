from copy import deepcopy
import pytest
from lib.song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire


def sample():
    return {'t':12.123456,'s':3,'f':14,'sus':1.234567,'vb':True,'bn':2,
            'vibrato_marks':[{'start':.123456,'end':1.234567,'intensity':'wide'}]}


def test_note_and_chord_roundtrip_keep_timing_and_width_without_changing_pitch():
    note=sample();n=note_to_wire(note_from_wire(note))
    for key in note:assert n[key]==note[key]
    child={k:v for k,v in note.items() if k!='t'}
    chord={'t':note['t'],'id':0,'notes':[child]}
    c=chord_to_wire(chord_from_wire(chord))
    assert c['t']==note['t']
    assert c['notes'][0]['vibrato_marks']==note['vibrato_marks']


@pytest.mark.parametrize('marks',[None,{},[{'start':0,'end':1,'intensity':'future'}],
    [{'start':False,'end':1,'intensity':'slight'}],[{'start':0,'end':float('nan'),'intensity':'wide'}],
    [{'start':1,'end':1,'intensity':'wide'}],[{'start':0,'end':2,'intensity':'wide'}],
    [{'start':0,'end':1,'intensity':'wide'}]*2])
def test_invalid_timed_data_does_not_fall_back_to_whole_note_vibrato(marks):
    with pytest.raises(ValueError):note_from_wire({**sample(),'vibrato_marks':marks})


def test_legacy_and_empty_are_distinct():
    legacy=sample();del legacy['vibrato_marks']
    assert 'vibrato_marks' not in note_to_wire(note_from_wire(legacy))
    assert note_to_wire(note_from_wire({**legacy,'vibrato_marks':[]}))['vibrato_marks']==[]
