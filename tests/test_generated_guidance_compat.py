"""Old imports gain local positions without changing their archive or music."""
from copy import deepcopy
import hashlib
import json

import pytest

from lib.generated_guidance_compat import refresh_generated_positions
from lib.song import arrangement_from_wire


def digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=False,
                                    allow_nan=False, separators=(",", ":")).encode()).hexdigest()


def seal(chart):
    proof = chart.setdefault("ext", {}).setdefault("chartGuidance", {})
    proof.update(policy="feedforge-chart-guidance-v2", sourceAuthored=False,
                 fields=["anchors", "handshapes"], slidePolicy="known-corridor",
                 legatoPolicy="compact-explicit-hopo", fingeringAssessed=False)
    proof["musicSha256"] = digest({k: chart[k] for k in
        ("tuning", "capo", "centOffset", "notes", "chords", "templates") if k in chart})
    proof["guidanceSha256"] = digest({k: chart[k] for k in proof["fields"]})


def rats():
    chart = {"name": "Rats regression", "tuning": [0]*6, "capo": 0,
        "notes": [{"t": 105.5375, "s": 0, "f": 3, "sl": 8, "sus": .24875}],
        "chords": [], "templates": [], "handshapes": [],
        "anchors": [{"time": 0., "fret": 3, "width": 6}]}
    for i, (t, frets, sus) in enumerate([(105.78625, [8,7], 1.24375),
            (107.03, [3,5,5], .72375), (107.75375, [5,7,7], 1.20625)]):
        chart["chords"].append({"t": t, "id": i,
            "notes": [{"s": s, "f": f, "sus": sus} for s, f in enumerate(frets)]})
        chart["templates"].append({"frets": frets+[-1]*(6-len(frets))})
    seal(chart)
    return chart


def test_load_refreshes_rats_at_chord_boundaries_without_mutating_wire_music():
    chart = rats()
    before = deepcopy(chart)
    result = arrangement_from_wire(chart)
    assert (result.anchors[0].fret, result.anchors[0].width) == (3, 4)
    assert [(a.time, a.fret, a.width) for a in result.anchors][-3:] == [
        (105.78625,7,4), (107.03,3,4), (107.75375,5,4)]
    assert chart == before
    assert [n.fret for n in result.chords[0].notes] == [8,7]
    assert result.notes[0].slide_to == 8


@pytest.mark.parametrize("edit", ["music", "guidance", "authored", "unknown", "current", "future_position", "no_ownership", "bad_hash", "bad_ext"])
def test_edited_authored_and_unknown_guidance_is_preserved(edit):
    chart = rats()
    proof = chart["ext"]["chartGuidance"]
    if edit == "music": chart["chords"][0]["notes"][0]["f"] = 9
    if edit == "guidance": chart["anchors"][0]["width"] = 7
    if edit == "authored": proof["sourceAuthored"] = True
    if edit == "unknown": proof["policy"] = "other"
    if edit == "current": proof["positionPolicy"] = "slide-follow-v1"
    if edit == "future_position": proof["positionPolicy"] = "future-position-policy"
    if edit == "no_ownership": proof["fields"] = ["handshapes"]
    if edit == "bad_hash": proof["musicSha256"] = "bad"
    if edit == "bad_ext": chart["ext"] = None
    before = deepcopy(chart)
    assert refresh_generated_positions(chart) == before
    assert chart == before


def test_difficulty_levels_use_inherited_music_identity_and_phrase_window():
    chart = rats()
    level = deepcopy(chart)
    level["anchors"][0]["time"] = 105
    seal(level)
    level["ext"]["chartGuidance"]["window"] = [105, 109]
    for key in ("name", "tuning", "capo", "templates"):
        level.pop(key)
    level["difficulty"] = 1
    chart["phrases"] = [{"start_time": 105, "end_time": 109, "levels": [level]}]
    before = deepcopy(chart)
    result = refresh_generated_positions(chart)
    anchors = result["phrases"][0]["levels"][0]["anchors"]
    assert anchors[0] == {"time":105,"fret":3,"width":4}
    assert anchors[-3] == {"time":105.78625,"fret":7,"width":4}
    assert all(105 <= a["time"] < 109 for a in anchors)
    assert chart == before


@pytest.mark.parametrize('policy', [None, 'chord-local-v1', 'open-preparation-v1'])
def test_existing_open_pickup_uses_new_position_in_memory_only(policy):
    chart = {'name':'Open pickup','tuning':[0]*6,'capo':0,'templates':[],
        'chords':[{'t':0,'notes':[{'s':s,'f':f,'sus':2} for s,f in enumerate([5,7,7])]}],
        'notes':[{'t':2,'s':0,'f':0,'sus':.25},{'t':2.25,'s':0,'f':2,'sus':.25}],
        'handshapes':[], 'anchors':[{'time':0.,'fret':5,'width':4},{'time':2.25,'fret':2,'width':4}]}
    seal(chart)
    chart['ext']['chartGuidance']['positionPolicy'] = policy
    before = deepcopy(chart)
    refreshed = refresh_generated_positions(chart)
    assert refreshed['anchors'] == [{'time':0.,'fret':5,'width':4},{'time':2.,'fret':2,'width':4}]
    assert refreshed['notes'] == before['notes'] and refreshed['chords'] == before['chords']
    assert chart == before
    chart['anchors'][0]['width'] = 5
    assert refresh_generated_positions(chart) == chart


@pytest.mark.parametrize('policy', [None, 'chord-local-v1', 'open-preparation-v1'])
def test_long_open_group_upgrades_existing_archives_and_inherits_phrase_beats(policy):
    chart = {'tuning':[0]*6,'capo':0,'templates':[], 'chords':[], 'handshapes':[],
        'notes':[{'t':0,'s':0,'f':2,'sus':.1},
            *[{'t':10+i*.6,'s':i%2,'f':0,'sus':.05} for i in range(3)],
            {'t':11.8,'s':1,'f':15,'sus':.25}],
        'beats':[{'time':i*.6} for i in range(25)],
        'anchors':[{'time':0.,'fret':2,'width':4},{'time':11.8,'fret':12,'width':4}]}
    seal(chart)
    chart['ext']['chartGuidance']['positionPolicy'] = policy
    level = {k:deepcopy(v) for k,v in chart.items() if k not in ('beats','tuning','capo','templates')}
    level['ext']['chartGuidance']['window'] = [0,13]
    chart['phrases'] = [{'levels':[level]}]
    before = deepcopy(chart)
    loaded = refresh_generated_positions(chart)
    assert loaded['anchors'] == [{'time':0.,'fret':2,'width':4},{'time':10.,'fret':12,'width':4}]
    assert loaded['phrases'][0]['levels'][0]['anchors'] == loaded['anchors']
    assert chart == before


@pytest.mark.parametrize('policy', [None, 'chord-local-v1', 'open-preparation-v1', 'open-preparation-v2'])
def test_existing_cirice_slide_moves_only_verified_generated_positions(policy):
    chart = {'tuning':[0]*6, 'capo':0, 'templates':[], 'chords':[], 'handshapes':[],
        'notes':[{'t':266.7175,'s':5,'f':12,'sus':.165625},
                 {'t':267.38,'s':3,'f':13,'sus':5.34,'sl':0,'bn':1,'vb':True},
                 {'t':272.72,'s':3,'f':0,'sus':2.69,'mt':True}],
        'anchors':[{'time':0.,'fret':12,'width':4}]}
    seal(chart)
    chart['ext']['chartGuidance']['positionPolicy'] = policy
    before = deepcopy(chart)
    loaded = arrangement_from_wire(chart)
    assert loaded.anchors[0].fret == 12
    assert loaded.anchors[-1].fret == 1
    assert all(a.width == 4 for a in loaded.anchors)
    assert all(a.fret >= b.fret for a,b in zip(loaded.anchors, loaded.anchors[1:]))
    assert loaded.notes[1].slide_to == 0 and loaded.notes[1].sustain == 5.34
    assert chart == before
    chart['anchors'][0]['fret'] = 11
    assert refresh_generated_positions(chart) == chart
