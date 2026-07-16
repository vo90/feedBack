"""Regression: the GP→arrangement-XML writers must pin UTF-8.

A bare ``Path.write_text(xml_str)`` uses the platform's *default* text
encoding. On Windows that is cp1252, which encodes a non-ASCII metadata
character — e.g. the © in an album name like "Chrysalis©1982" — as the lone
byte 0xA9. The XML is then read back as UTF-8 (expat's default), where 0xA9
is an invalid start byte, so parsing dies with

    not well-formed (invalid token): line N, column 22

CI runs on Linux (UTF-8 default), so the bug is invisible there and a plain
functional test would pass on the old code too. These assertions instead pin
the locale-independent contract directly.
"""

import ast
import inspect
import xml.etree.ElementTree as ET

import gp2rs
import gp2rs_gpx


def test_arrangement_xml_writes_specify_utf8():
    # Every write of the arrangement XML string must pass encoding="utf-8"
    # so non-ASCII metadata survives regardless of the host locale.
    writes = []
    for mod in (gp2rs, gp2rs_gpx):
        tree = ast.parse(inspect.getsource(mod))
        for node in ast.walk(tree):
            if not (
                isinstance(node, ast.Call)
                and isinstance(node.func, ast.Attribute)
                and node.func.attr == "write_text"
                and node.args
                and isinstance(node.args[0], ast.Name)
                and node.args[0].id == "xml_str"
            ):
                continue

            encoding = next(
                (kw.value for kw in node.keywords if kw.arg == "encoding"), None
            )
            assert (
                isinstance(encoding, ast.Constant)
                and encoding.value.lower().replace("_", "-") == "utf-8"
            ), (
                f"{mod.__name__}:{node.lineno}: arrangement XML write must pass "
                'encoding="utf-8"; the platform default corrupts non-ASCII '
                "metadata on Windows"
            )
            writes.append((mod.__name__, node.lineno))

    # One writer in gp2rs and two in gp2rs_gpx (vocal and instrument paths).
    # Pin the count so a newly added output path cannot silently evade this test.
    assert len(writes) == 3


def test_utf8_write_round_trips_non_ascii_album(tmp_path):
    # The behavioural end of the contract: a © album name written as UTF-8
    # parses cleanly and reads back intact (the cp1252 write does not).
    xml_str = (
        '<?xml version="1.0"?>\n<song>\n'
        "  <albumName>Chrysalis©1982</albumName>\n</song>\n"
    )
    path = tmp_path / "arr.xml"
    path.write_text(xml_str, encoding="utf-8")
    root = ET.parse(path).getroot()
    assert root.findtext("albumName") == "Chrysalis©1982"
