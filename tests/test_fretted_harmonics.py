from copy import deepcopy
import pytest
from lib.song import note_from_wire, note_to_wire, chord_from_wire, chord_to_wire


@pytest.mark.parametrize('kind,policy', [('pinch','harmonic'),('artificial','harmonic'),
    ('tapped','harmonic'),('semi','mixed'),('feedback','attack_either')])
def test_roundtrip_keeps_one_attack_and_original_identity(kind,policy):
    n={'t':1.25,'s':2,'f':12,'sus':2,'ghost':True,'hp':kind in ('pinch','semi'),
       'harmonic_target':{'kind':kind,'node':7,'interval':19,'policy':policy}}
    before=deepcopy(n)
    decoded=note_from_wire(n)
    decoded.harmonic_target['node']=12
    assert n==before  # no shared mutable source object
    outputs=[note_to_wire(note_from_wire(n)),
        chord_to_wire(chord_from_wire({'t':1.25,'id':0,'notes':[n]}))['notes'][0]]
    for value in outputs:
        for key in ('s','f','sus','ghost','hp','harmonic_target'):
            assert value[key]==n[key]
    assert len(chord_from_wire({'t':1.25,'id':0,'notes':[n]}).notes)==1


@pytest.mark.parametrize('field,value', [('interval',True),('interval',24),('node',float('nan')),
    ('node',15),('policy','unscored'),('kind','natural')])
def test_invalid_target_fails_instead_of_becoming_an_ordinary_note(field,value):
    n={'f':7,'harmonic_target':{'kind':'artificial','node':12,'interval':12,'policy':'harmonic'}}
    n['harmonic_target'][field]=value
    with pytest.raises(ValueError):note_from_wire(n)


@pytest.mark.parametrize('extra',[{'hm':True},{'mt':True},{'fhm':True},{'hp':True},
    {'hn':12},{'hps':12},{'f':True},{'f':49}])
def test_conflicting_flags_fail(extra):
    n={'f':7,'harmonic_target':{'kind':'artificial','node':12,'interval':12,'policy':'harmonic'},**extra}
    with pytest.raises(ValueError):note_from_wire(n)


def test_alias_and_legacy_pinch_roundtrip():
    n={'f':15,'hm':True,'hn':14.7,'hps':34,'harmonic_alias':'songsterr-natural-15'}
    assert note_to_wire(note_from_wire(n))['harmonic_alias']==n['harmonic_alias']
    n['hn']=15
    with pytest.raises(ValueError):note_from_wire(n)
    assert 'harmonic_target' not in note_to_wire(note_from_wire({'f':7,'hp':True}))
