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
