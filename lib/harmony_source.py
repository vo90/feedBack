"""Read-only, source-aware chart input for the harmony analyser.

This module never calls load_song(), extracts stems, or changes song files.
Times are original chart seconds. A zero-duration attack remains zero-duration:
the inference engine, not this adapter, decides how long it is useful evidence.
"""

from collections import Counter
import hashlib
import json
import math
from pathlib import Path
import zipfile

from harmony import source_revision
from jsonc import parse_jsonc
import sloppak
from song import base_open_string_midis


NORMALIZATION_VERSION = "chart-source-1"
_RS_SOURCE = "psarc-manifest2014"
_GUITAR_BASE = [40, 45, 50, 55, 59, 64]


class SourceCancelled(RuntimeError):
    """A caller cancelled a metadata read/normalization job."""


def _checkpoint(cancelled):
    if cancelled is not None and cancelled():
        raise SourceCancelled("Chart analysis cancelled")


def _number(value, default=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        return default
    try:
        value = float(value)
    except (ValueError, OverflowError):
        return default
    return value if math.isfinite(value) else default


def _integer(value, default=None):
    number = _number(value)
    return int(number) if number is not None and number.is_integer() else default


def _records(value):
    return [item for item in value if isinstance(item, dict)] if isinstance(value, list) else []


def _digest(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True, ensure_ascii=True,
                                    separators=(",", ":")).encode()).hexdigest()


def _source(data):
    ext = data.get("ext")
    source = ext.get("source") if isinstance(ext, dict) else None
    return source if isinstance(source, dict) else {}


def arrangement_pitch_metadata(data: dict, entry: dict | None = None) -> dict:
    """Describe pitches without changing existing playback/grading conventions.

    Verified RS2014/SNG semantics: positive frets are physical; only fret zero
    adds capo. See RocksmithToolkitLib/Sng/Sng2014FileWriter.cs GetMidiNote:
    https://github.com/rscustom/rocksmith-custom-song-toolkit/blob/master/
    RocksmithToolkitLib/Sng/Sng2014FileWriter.cs#L72-L93
    FeedForge passes those fret numbers through and preserves the source tag.
    Other feedpaks retain Feedback's existing relative-fret interpretation.
    """
    entry = entry or {}
    source = _source(data)
    properties = source.get("arrangement_properties") or {}
    if not isinstance(properties, dict):
        properties = {}
    name = str(entry.get("name") or data.get("name") or "").lower()
    instrument = str(entry.get("type") or data.get("type") or "").lower()
    if instrument in ("drum", "drums", "vocals", "vocal", "lyrics", "percussion"):
        role = "unpitched"
    elif instrument == "bass" or properties.get("pathBass") or "bass" in name:
        role = "bass"
    elif properties.get("pathRhythm") or "rhythm" in name or instrument == "rhythm":
        role = "rhythm"
    else:
        role = "lead"
    raw_tuning = entry.get("tuning", data.get("tuning", [0] * 6))
    tuning_valid = isinstance(raw_tuning, list) and 0 < len(raw_tuning) <= 8
    tuning_valid = tuning_valid and all(_integer(v) is not None for v in raw_tuning)
    tuning = list(raw_tuning) if tuning_valid else [0] * 6
    # The six tuning slots in RS2014 are padded even for a four-string bass.
    max_string = -1
    for note in _records(data.get("notes")):
        max_string = max(max_string, _integer(note.get("s"), -1))
    for chord in _records(data.get("chords")):
        for note in _records(chord.get("notes")):
            max_string = max(max_string, _integer(note.get("s"), -1))
    count = max(4 if role == "bass" else 6, max_string + 1,
                len(tuning) if len(tuning) != 6 else 0)
    count = min(count, 8)
    capo = max(0, min(24, _integer(entry.get("capo", data.get("capo", 0)), 0)))
    physical = source.get("format") == _RS_SOURCE
    if physical and role == "bass" and count <= 6:
        base = [pitch - 12 for pitch in _GUITAR_BASE]
    else:
        base = base_open_string_midis(count, role == "bass")
    offsets = [int(tuning[i]) if i < len(tuning) else 0 for i in range(count)]
    return {
        "role": role, "string_count": count, "tuning": offsets,
        "capo": capo, "cent_offset": _number(entry.get("centOffset", data.get("centOffset")), 0),
        "fret_semantics": "physical" if physical else "relative",
        "open_midi": [base[i] + offsets[i] for i in range(count)],
        "tuning_valid": bool(tuning_valid), "source_format": source.get("format"),
    }


def _full_events(data, diagnose, cancelled):
    """Choose one representation; never union flattened and difficulty notes."""
    fields = ("notes", "chords", "handshapes")
    flat = {field: _records(data.get(field)) for field in fields}
    phrases = _records(data.get("phrases"))
    if not phrases:
        return flat, "flat", False
    maximum = {field: [] for field in fields}
    for phrase in phrases:
        _checkpoint(cancelled)
        difficulty = _integer(phrase.get("max_difficulty"))
        selected = next((level for level in _records(phrase.get("levels"))
                         if difficulty is not None and _integer(level.get("difficulty")) == difficulty), None)
        if selected is None:
            diagnose("missing_maximum_difficulty", "Declared maximum level missing; flattened evidence is unverified.")
            return flat, "flat_unverified", True
        for field in fields:
            maximum[field].extend(_records(selected.get(field)))
    # Handshapes may be repeated across phrase boundaries. Keep one exact event.
    maximum["handshapes"] = list({_digest(h): h for h in maximum["handshapes"]}.values())
    matches = all(Counter(_digest(event) for event in flat[field]) ==
                  Counter(_digest(event) for event in maximum[field]) for field in fields)
    if matches:
        return flat, "flat_verified_maximum", False
    diagnose("maximum_difficulty_reconstructed", "Flattened chart differs; using only each phrase's declared maximum level.")
    return maximum, "phrase_maximum", False


def _pitch(metadata, string, fret):
    if string is None or fret is None or not 0 <= string < metadata["string_count"] or not 0 <= fret <= 36:
        return None
    capo = metadata["capo"]
    if metadata["fret_semantics"] == "physical":
        if 0 < fret <= capo:
            return None
        return metadata["open_midi"][string] + (capo if fret == 0 else fret)
    return metadata["open_midi"][string] + capo + fret


def _normal_note(raw, metadata, *, time=None, duration=0, evidence_id="", uncertain=False):
    # A scoring ignore or palm mute does not remove pitched evidence.
    if raw.get("mt") or raw.get("fhm"):
        return None
    time = _number(raw.get("t"), time)
    if time is None or time < 0 or (duration and time >= duration):
        return None
    string, fret = _integer(raw.get("s")), _integer(raw.get("f"))
    midi = _pitch(metadata, string, fret)
    if midi is None:
        return None
    sustain = max(0, _number(raw.get("sus"), 0))
    end = min(time + sustain, duration) if duration else time + sustain
    techniques = [field for field in ("bn", "bc", "hm", "hp", "slu") if raw.get(field)]
    if _integer(raw.get("sl"), -1) >= 0:
        techniques.append("sl")
    uncertain = bool(uncertain or techniques or not metadata["tuning_valid"])
    return {
        "t": time, "end": end, "midi": midi, "pc": midi % 12,
        "string": string, "fret": fret, "weight": 0.25 if uncertain else 1.0,
        "uncertain": uncertain, "techniques": techniques, "pitched": True,
        "link_next": bool(raw.get("ln")), "evidence_id": evidence_id,
        "correlation_id": _digest([round(time, 5), round(end, 5), midi])[:20],
    }


def _link_holds(notes, duration):
    """Only connect explicit links to a nearby, same-pitch following note.

    A link is not permission to sustain across an arbitrary chart gap. Changed
    pitches (slides/bends) keep their separate uncertain contributions.
    """
    by_string = {}
    for note in notes:
        by_string.setdefault(note["string"], []).append(note)
    for events in by_string.values():
        events.sort(key=lambda event: event["t"])
        for index in range(len(events) - 2, -1, -1):
            note, following = events[index:index + 2]
            if (note["link_next"] and note["midi"] == following["midi"]
                    and 0 <= following["t"] - note["end"] <= 0.1):
                note["end"] = min(following["end"], duration) if duration else following["end"]
                following["weight"] *= 0.25
                following["linked_from"] = note["evidence_id"]


def _beats(data):
    values = []
    for beat in data if isinstance(data, list) else []:
        time = _number(beat.get("time", beat.get("t"))) if isinstance(beat, dict) else _number(beat)
        if time is not None and time >= 0:
            values.append(time)
    return sorted(set(values))


def _sections(data, duration):
    result = []
    for section in _records(data):
        time = _number(section.get("time", section.get("start_time", section.get("t"))))
        if time is not None and time >= 0 and (not duration or time < duration):
            result.append({"t": time, "name": str(section.get("name") or "")})
    result.sort(key=lambda item: item["t"])
    for index, section in enumerate(result):
        section["end"] = result[index + 1]["t"] if index + 1 < len(result) else duration
    return result


def _member_identity(path, relative, archive_index):
    """Audio identity without opening the member or following an escaping path."""
    key = sloppak._zip_member_key(relative)
    if key is None:
        return [relative, "outside"]
    if archive_index is not None:
        return [relative, archive_index.get(key, "missing")]
    target = sloppak.safe_join(path.resolve(), relative)
    if target is None:
        return [relative, "outside"]
    if not target.is_file():
        return [relative, "missing"]
    stat = target.stat()
    return [relative, stat.st_size, stat.st_mtime_ns]


def _audio_files(path, manifest, archive_index):
    """Exactly the audio list playback uses for its revision, without reading it."""
    # Playback normalizes descriptor strings, then removes duplicate reserved
    # full mixes. Matching that contract matters: clients compare revisions.
    stems = []
    for entry in _records(manifest.get("stems")):
        identity, filename = str(entry.get("id", "")), str(entry.get("file", ""))
        if identity and filename:
            stems.append({"id": identity, "file": filename})
    full_mix, layers = sloppak.partition_stems(stems)
    files = [entry["file"] for entry in layers]
    if full_mix is not None:
        files.append(full_mix["file"])
    elif sloppak.find_full_mix(layers) is None:
        legacy = manifest.get("original_audio")
        if isinstance(legacy, str) and legacy.strip():
            identity = _member_identity(path, legacy.strip(), archive_index)
            if identity[-1] not in ("missing", "outside"):
                files.append(legacy.strip())
    return files


def load_harmony_source(path: Path, cancelled=None) -> dict:
    """Read all fretted arrangements at full difficulty, without audio reads.

    Returns JSON-compatible versioned input. Cancellation is cooperative; it is
    checked between reads, phrases and every 128 events. Missing/malformed
    arrangements are diagnosed rather than preventing useful sibling evidence.
    """
    path = Path(path)
    _checkpoint(cancelled)
    manifest_files = ["manifest.yaml", "manifest.yml"]
    # Capture before parsing. Otherwise a file replaced just after its read
    # could be assigned the replacement's revision, blessing stale evidence.
    manifest_revision = source_revision(path, manifest_files)
    manifest = sloppak.load_manifest(path)
    if not isinstance(manifest, dict):
        raise ValueError("Song manifest must be an object")
    diagnostics, arrangements, hashes = [], [], []
    duration = max(0, _number(manifest.get("duration"), 0))
    revision_files = list(manifest_files)
    for field in ("keys", "harmony", "song_timeline"):
        relative = manifest.get(field)
        if isinstance(relative, str) and relative:
            revision_files.append(relative)
    entries = _records(manifest.get("arrangements"))
    for entry in entries:
        for field in ("file", "notation", "drum_tab"):
            relative = entry.get(field)
            if isinstance(relative, str) and relative:
                revision_files.append(relative)

    archive_index = None
    if path.is_file():
        with zipfile.ZipFile(path) as archive:
            archive_index = {sloppak._zip_member_key(info.filename): [info.CRC, info.file_size]
                             for info in archive.infolist()}
    audio_files = _audio_files(path, manifest, archive_index)
    initial_revision = source_revision(path, revision_files, audio_files)
    if not initial_revision or manifest_revision != source_revision(path, manifest_files):
        raise ValueError("Song changed while reading its manifest; analyse again")
    audio_identity = [_member_identity(path, relative, archive_index) for relative in sorted(set(audio_files))]

    def read_json(relative):
        _checkpoint(cancelled)
        if not isinstance(relative, str) or not relative.strip():
            return None
        payload = sloppak.read_member_bytes(path, relative)
        hashes.append([relative, hashlib.sha256(payload).hexdigest() if payload is not None else "missing"])
        if payload is None:
            return None
        try:
            value = (parse_jsonc(payload.decode("utf-8")) if relative.lower().endswith(".jsonc")
                     else json.loads(payload))
        except (UnicodeError, ValueError):
            return None
        return value if isinstance(value, dict) else None

    beats, sections = [], []
    for index, entry in enumerate(entries):
        _checkpoint(cancelled)
        if str(entry.get("type", "")).lower() in ("drum", "drums", "vocals", "vocal", "lyrics", "percussion"):
            continue
        identity = str(entry.get("id") or f"arrangement-{index}")

        def diagnose(code, message):
            diagnostics.append({"code": code, "message": message, "arrangement_id": identity})

        raw = read_json(entry.get("file"))
        if raw is None:
            diagnose("missing_chart", "No readable fretted chart JSON; notation-only sources are not analysed yet.")
            continue
        events, representation, unverified = _full_events(raw, diagnose, cancelled)
        metadata = arrangement_pitch_metadata({**raw, **events}, entry)
        if metadata["role"] == "unpitched":
            continue
        if metadata["capo"] and metadata["fret_semantics"] != "physical":
            diagnose("legacy_capo_semantics", "No verified RS source marker; preserving Feedback's relative-fret convention.")
            unverified = True
        if not metadata["tuning_valid"]:
            diagnose("invalid_tuning", "Invalid tuning; fallback pitches are uncertain.")
        arrangement = {
            "id": identity, "name": str(entry.get("name") or raw.get("name") or identity),
            **metadata, "representation": representation,
            # Alternatives of a role share one vote; engine also caps exact
            # cross-role duplicates using per-event correlation IDs.
            "correlation_group": metadata["role"],
            "notes": [], "chords": [], "handshapes": [],
        }
        # Template IDs are positional; malformed entries must not shift IDs.
        templates = raw.get("templates") if isinstance(raw.get("templates"), list) else []

        def template_at(template_id):
            if template_id is not None and 0 <= template_id < len(templates) and isinstance(templates[template_id], dict):
                return templates[template_id]
            return {}

        for number, note in enumerate(events["notes"]):
            if number % 128 == 0:
                _checkpoint(cancelled)
            normal = _normal_note(note, metadata, duration=duration,
                                  evidence_id=f"{identity}:note:{number}", uncertain=unverified)
            if normal:
                arrangement["notes"].append(normal)
        for field in ("chords", "handshapes"):
            for number, event in enumerate(events[field]):
                if number % 128 == 0:
                    _checkpoint(cancelled)
                template_id = _integer(event.get("id" if field == "chords" else "chord_id"))
                template = template_at(template_id)
                time = _number(event.get("t" if field == "chords" else "start_time"))
                if time is None or time < 0 or (duration and time >= duration):
                    continue
                if event.get("mt") or event.get("fhm"):
                    continue
                children = _records(event.get("notes")) if field == "chords" else []
                from_template = not children
                if from_template:
                    frets = template.get("frets") if isinstance(template.get("frets"), list) else []
                    children = [{"s": s, "f": f} for s, f in enumerate(frets)]
                normal_notes = []
                for child in children:
                    normal = _normal_note(child, metadata, time=time, duration=duration,
                                          evidence_id=f"{identity}:{field}:{number}:{child.get('s')}",
                                          uncertain=unverified)
                    if normal:
                        normal_notes.append(normal)
                # An all-muted chord must not leak its named template as evidence.
                if not normal_notes:
                    continue
                label = event.get("name") or template.get("name") or template.get("displayName") or ""
                label = label if isinstance(label, str) else ""
                end = max(note["end"] for note in normal_notes)
                if field == "handshapes":
                    end = _number(event.get("end_time"), time)
                    if duration:
                        end = min(duration, end)
                    if end <= time:
                        continue
                pitches = sorted(set(note["midi"] for note in normal_notes if not note["uncertain"]))
                # Uncertain techniques remain visible for inspection but cannot
                # corroborate a confidently named chord.
                uncertain_pitches = sorted(set(note["midi"] for note in normal_notes if note["uncertain"]))
                clean = {
                    "t": time, "end": end, "label": label.strip(), "original_label": label,
                    "pitches": pitches, "pcs": sorted({pitch % 12 for pitch in pitches}),
                    "uncertain_pitches": uncertain_pitches, "pitched": bool(pitches),
                    "notes": normal_notes, "template_id": template_id,
                    "weight": (0.6 if field == "handshapes" or from_template else 1.0) * (0.25 if unverified else 1),
                    "uncertain": not pitches or unverified,
                    "evidence_id": f"{identity}:{field}:{number}",
                    "correlation_id": _digest([field, round(time, 5), round(end, 5), pitches])[:20],
                }
                arrangement[field].append(clean)
        all_notes = list(arrangement["notes"])
        for chord in arrangement["chords"]:
            all_notes.extend(chord["notes"])
        _link_holds(all_notes, duration)
        for chord in arrangement["chords"]:
            chord["end"] = max(note["end"] for note in chord["notes"])
        for field in ("notes", "chords", "handshapes"):
            arrangement[field].sort(key=lambda event: event["t"])
        current_beats = _beats(raw.get("beats"))
        if beats and current_beats and (len(beats) != len(current_beats) or
                any(abs(a - b) > 0.001 for a, b in zip(beats, current_beats))):
            diagnose("beat_map_disagreement", "Arrangement beat maps differ; original event seconds were retained.")
        beats = beats or current_beats
        sections = sections or _sections(raw.get("sections"), duration)
        arrangements.append(arrangement)

    timeline = read_json(manifest.get("song_timeline"))
    if timeline is not None and isinstance(timeline.get("beats"), list) and isinstance(timeline.get("sections"), list):
        beats, sections = _beats(timeline["beats"]), _sections(timeline["sections"], duration)
    if not duration:
        duration = max([0, *beats, *(event["end"] for arrangement in arrangements
                                  for field in ("notes", "chords", "handshapes") for event in arrangement[field])])
        for index, section in enumerate(sections):
            section["end"] = sections[index + 1]["t"] if index + 1 < len(sections) else duration
    _checkpoint(cancelled)
    revision = source_revision(path, revision_files, audio_files)
    if revision != initial_revision:
        raise ValueError("Song changed while reading its charts; analyse again")
    _checkpoint(cancelled)
    return {
        "version": 1, "normalization_version": NORMALIZATION_VERSION,
        "revision": revision,
        "revision_content_files": revision_files, "revision_audio_files": audio_files,
        "fingerprint": "hcs1-" + _digest([NORMALIZATION_VERSION, manifest, hashes, audio_identity]),
        "title": str(manifest.get("title") or ""), "artist": str(manifest.get("artist") or ""),
        "duration": duration, "beats": beats, "sections": sections,
        "arrangements": arrangements, "diagnostics": diagnostics,
    }
