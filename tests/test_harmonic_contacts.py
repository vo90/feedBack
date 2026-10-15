from copy import deepcopy
import pytest
from lib.song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire


def contact():
    return {'t':1.123456,'s':2,'f':14,'sus':2.123456,'harmonic_changes':{'version':1,'events':[
        {'start':.123456,'end':2.123456,'target':{'kind':'artificial','node':7,'interval':19,'policy':'harmonic'},
         'source_id':'songsterr:0:1:0:3:0'}]}}


def test_contact_roundtrip_keeps_timing_identity_and_initial_target():
    n=contact();before=deepcopy(n)
    for out in [note_to_wire(note_from_wire(n)),chord_to_wire(chord_from_wire({'t':n['t'],'id':0,'notes':[n]}))['notes'][0]]:
        for key in ('s','f','sus','harmonic_changes'):assert out[key]==n[key]
        assert 'harmonic_target' not in out and not out['hp']
    note=note_from_wire(n);note.harmonic_changes['events'][0]['start']=1
    assert n==before


@pytest.mark.parametrize('fault',['nan','start','end','target','source','shape','count','initial','mute'])
def test_invalid_extension_never_silently_becomes_ordinary(fault):
    n=contact();e=n['harmonic_changes']['events'][0]
    if fault=='nan':e['start']=float('nan')
    if fault=='start':e['start']=0
    if fault=='end':e['end']=9
    if fault=='target':e['target']['interval']=12
    if fault=='source':e['source_id']=''
    if fault=='shape':e['invented']=True
    if fault=='count':n['harmonic_changes']['events'].append(deepcopy(e))
    if fault=='initial':n['harmonic_target']=deepcopy(e['target'])
    if fault=='mute':n['mt']=True
    with pytest.raises(ValueError):note_from_wire(n)


def test_playback_fallback_cannot_invent_a_delayed_physical_contact():
    n=contact()
    n['harmonic_changes']['events'][0]['target']={
        'kind':'artificial','node':None,'interval':24,'policy':'harmonic',
        'basis':'source-playback-fallback'}
    with pytest.raises(ValueError):note_from_wire(n)
    del n['harmonic_changes']['events'][0]['target']['basis']
    with pytest.raises(ValueError):note_from_wire(n)


def sliding_contact():
    n = contact()
    n.update(f=4, sl=7, sus=7.75, slide_interval={'start':7.5, 'end':7.75})
    n['harmonic_changes']['events'][0].update(start=2, end=7.75)
    return n


def test_timed_contact_slide_roundtrips_without_adding_an_attack():
    n = sliding_contact()
    for out in [note_to_wire(note_from_wire(n)),
                chord_to_wire(chord_from_wire({'t':n['t'], 'id':0, 'notes':[n]}))['notes'][0]]:
        for key in ('f', 'sl', 'sus', 'slide_interval', 'harmonic_changes'):
            assert out[key] == n[key]
        assert not out['hp'] and 'harmonic_target' not in out


@pytest.mark.parametrize('patch', [
    {'sl':0}, {'sl':25}, {'sl':4}, {'sl':'7'}, {'sl':float('nan')},
    {'f':0}, {'f':25}, {'slu':9}, {'slide_interval':None},
    {'slide_interval':{'start':2, 'end':7.75}},
    {'slide_interval':{'start':7.5, 'end':8}},
    *[{k:True} for k in ('ho','po','vb','tr','bn','bt')],
    {'bnv':[{'t':0, 'v':1}]}, {'slide_out':'up'},
    {'slide_in_marks':[{'direction':'up','time':0}]},
])
def test_unsupported_contact_slide_is_rejected(patch):
    with pytest.raises(ValueError):
        note_from_wire({**sliding_contact(), **patch})


def test_contact_touch_position_does_not_move_the_fretting_hand_lane():
    from lib.generated_hand_positions import generate_positions
    n = sliding_contact()
    n['harmonic_changes']['events'][0]['target'].update(node=24, interval=24)
    chart = {'notes':[n], 'chords':[], 'templates':[], 'beats':[], 'tuning':[0]*6}
    plain = deepcopy(chart)
    del plain['notes'][0]['harmonic_changes']
    assert generate_positions(chart) == generate_positions(plain)
