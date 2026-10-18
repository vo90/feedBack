"""Song-wide teaching harmony and source revisions for local guide edits."""

import hashlib
import json
import logging
import math
import os
import zipfile
from pathlib import Path


log = logging.getLogger("feedBack.lib.harmony")


def sanitize_harmony(raw) -> dict | None:
    """Keep the optional feedpak §7.8 event track safe for the wire.

    An absent root is N.C., just like an explicit null. A malformed root is
    dropped rather than fabricated into either a chord or a no-chord event.
    Unknown quality tokens are retained: the spec vocabulary is not closed.
    """
    if not isinstance(raw, dict) or not isinstance(raw.get("events"), list):
        return None
    events = []
    for event in raw["events"]:
        if not isinstance(event, dict):
            continue
        time = event.get("t")
        if not isinstance(time, (int, float)) or isinstance(time, bool):
            continue
        try:
            time = float(time)
        except (OverflowError, ValueError):
            continue
        if not math.isfinite(time):
            continue
        root = event.get("root")
        if root is not None and (not isinstance(root, str) or not root.strip()):
            continue
        clean = {"t": time, "root": root.strip() if root is not None else None}
        # Unknown is distinct from the feedpak null-root N.C. convention.
        if event.get("unknown") is True:
            clean["unknown"] = True
        if "end" in event:
            end = event["end"]
            if (not isinstance(end, (int, float)) or isinstance(end, bool)
                    or not math.isfinite(end) or end <= time):
                continue
            clean["end"] = float(end)
        for field in ("quality", "rn", "bass"):
            value = event.get(field)
            if isinstance(value, str) and value.strip():
                clean[field] = value.strip()
        events.append(clean)
    events.sort(key=lambda event: event["t"])
    version = raw.get("version")
    return {
        "version": version if isinstance(version, int) and not isinstance(version, bool)
                   and version >= 1 else 1,
        "events": events,
    }


def source_revision(source: Path, content_files=(), audio_files=()) -> str | None:
    """A local-edit revision, computed once at load, never during rendering.

    Include original source identity so matching filenames in different
    libraries cannot share edits. Zip central-directory CRCs describe source
    contents independently of extraction-cache timestamps. Directory charts
    are hashed; audio uses size/mtime_ns without reading its (large) contents.
    This detects normal audio replacement, not deliberately preserved stats.
    The result is application metadata, never a new feedpak manifest field.
    """
    digest = hashlib.sha256()

    def add(value):
        digest.update(json.dumps(value, ensure_ascii=True, separators=(",", ":")).encode("utf-8"))
        digest.update(b"\0")

    try:
        root = source.resolve()
        add(["harmonic-guide-source-v1", os.path.normcase(str(root))])
        if root.is_file():
            with zipfile.ZipFile(root) as archive:
                for entry in sorted(archive.infolist(), key=lambda item: item.filename):
                    add([entry.filename, entry.CRC, entry.file_size])
        else:
            for kind, paths in (("content", content_files), ("audio", audio_files)):
                for relative in sorted(set(paths)):
                    path = (root / relative).resolve()
                    # As with the loader, never follow a manifest path or
                    # symlink beyond the source song directory.
                    try:
                        path.relative_to(root)
                    except ValueError:
                        add([kind, relative, "outside"])
                        continue
                    add([kind, relative])
                    if not path.is_file():
                        add("missing")
                    elif kind == "audio":
                        stat = path.stat()
                        add([stat.st_size, stat.st_mtime_ns])
                    else:
                        file_digest = hashlib.sha256()
                        with path.open("rb") as handle:
                            for chunk in iter(lambda: handle.read(128 * 1024), b""):
                                file_digest.update(chunk)
                        add(file_digest.hexdigest())
        return "hg1-" + digest.hexdigest()
    except (OSError, RuntimeError, ValueError, zipfile.BadZipFile) as error:
        log.warning("harmony: source revision unavailable: %s", error)
        # Playback is unaffected; clients must not reuse persistent edits
        # without a trustworthy revision.
        return None
