from copy import deepcopy
import pytest
from lib.song import arrangement_from_wire, arrangement_to_wire


def event():return dict(t=1,state='open',strings=[0,2],source_id='songsterr:0:0:0:0',source_ids=[],occurrence=1)


def test_guidance_roundtrip_does_not_change_notes():
    data=dict(name='Lead',notes=[dict(t=1,s=0,f=3,sus=2)],wah=[event()])
    arr=arrangement_from_wire(data)
    assert arrangement_to_wire(arr)['wah']==data['wah']
    assert arr.notes[0].time==1 and arr.notes[0].sustain==2 and not arr.notes[0].ignore
    out=arrangement_to_wire(arr);out['wah'][0]['state']='closed'
    assert arr.wah[0]['state']=='open'


@pytest.mark.parametrize('key,value',[('t',-1),('t',float('nan')),('t',True),('state','off'),('strings',[9]),('strings',[0,0]),('occurrence',False)])
def test_bad_guidance_is_rejected(key,value):
    e=event();e[key]=value
    with pytest.raises(ValueError):arrangement_from_wire(dict(name='Lead',wah=[e]))


def test_legacy_arrangements_do_not_gain_guidance():
    assert 'wah' not in arrangement_to_wire(arrangement_from_wire(dict(name='Lead')))
