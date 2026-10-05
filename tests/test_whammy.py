from copy import deepcopy
import pytest
from lib.song import Note, note_to_wire, note_from_wire, Chord, chord_to_wire, chord_from_wire


def expression():
    return {'version':1,'policy':'optional','segments':[
        {'start':0,'end':1,'source_id':'songsterr:0:0:0:0','group':'songsterr:0:0:0:0@0',
         'curve':[{'t':0,'v':-2},{'t':.5,'v':-16},{'t':1,'v':8}], 'vibrato':'wide'}]}


def test_model_roundtrip_is_exact_and_detached():
    n=Note(time=1,string=0,fret=7,sustain=1,whammy=expression())
    wire=note_to_wire(n)
    assert wire['whammy']==expression()
    restored=note_from_wire(wire)
    assert restored==n
    wire['whammy']['segments'][0]['curve'][0]['v']=0
    assert restored.whammy==n.whammy==expression()
    chord=Chord(time=1,chord_id=0,notes=[n])
    assert chord_from_wire(chord_to_wire(chord))==chord


@pytest.mark.parametrize('fault',['policy','negative_time','overlap','out_of_bounds','pitch','field','version'])
def test_invalid_extensions_do_not_silently_become_ordinary_notes(fault):
    e=expression(); segment=e['segments'][0]
    if fault=='policy':e['policy']='required'
    if fault=='negative_time':segment['start']=-1
    if fault=='overlap':e['segments'].append(deepcopy(segment))
    if fault=='out_of_bounds':segment['end']=2
    if fault=='pitch':segment['curve'][0]['v']=-17
    if fault=='field':segment['foo']=1
    if fault=='version':e['version']=True
    with pytest.raises(ValueError):note_from_wire({'t':0,'s':0,'f':7,'sus':1,'whammy':e})


def test_old_notes_have_no_extension():
    assert 'whammy' not in note_to_wire(Note(time=0,string=0,fret=7))


def test_submillisecond_sustain_roundtrip_keeps_the_curve_in_bounds():
    w=expression();s=w['segments'][0];s['end']=1.0004;s['curve'][-1]['t']=1.0004
    n=Note(time=.0004,string=0,fret=7,sustain=1.0004,whammy=w)
    assert note_from_wire(note_to_wire(n)) == n
