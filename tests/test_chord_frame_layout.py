"""Authored archive geometry must not opt generated Songsterr charts into lane sizing."""
from copy import deepcopy

import pytest

from lib.song import arrangement_from_wire, arrangement_to_wire


@pytest.mark.parametrize("ext,expected", [
    ({"source": {"format": "psarc-manifest2014"}}, "lane"),
    ({"source": {"format": "songsterr"}}, "shape"),
    ({"source": {"format": "gp"}}, "shape"),
    ({}, "shape"),
    (None, "shape"),
    ({"source": None}, "shape"),
    ({"source": {"format": "psarc-manifest2014"}, "chartGuidance": {
        "policy": "feedforge-chart-guidance-v2", "sourceAuthored": False,
        "positionPolicy": "slide-follow-v1"}}, "shape"),
])
def test_playback_policy_does_not_rewrite_chart(ext, expected):
    chart = {"name": "Lead", "ext": ext,
             "anchors": [{"time": 0, "fret": 2, "width": 4}],
             "chords": [{"t": 72, "id": 0, "notes": [{"s": 0, "f": 3}, {"s": 4, "f": 3}]}]}
    original = deepcopy(chart)
    arr = arrangement_from_wire(chart)
    assert arr.chord_frame_layout == expected
    assert chart == original
    assert [(a.fret, a.width) for a in arr.anchors] == [(2, 4)]
    assert [(n.string, n.fret) for n in arr.chords[0].notes] == [(0, 3), (4, 3)]
    assert "chordFrameLayout" not in arrangement_to_wire(arr)
