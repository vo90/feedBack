"""Cached desktop tone opt-in, with no filesystem access or worker at import."""

import logging
import threading

log = logging.getLogger("feedBack.amp_sims_policy")


class AmpSimsPolicy:
    """Settings writers prepare under their lock, then notify outside it.

    Subscribers must only invalidate work/wake their worker; they must not wait
    for a scan to finish. Every worker checks generation before publishing work.
    """

    def __init__(self, *, applicable=False):
        self._lock = threading.RLock()
        self._handlers = set()
        self._state = dict(ready=False, enabled=False, generation=0,
                           applicable=bool(applicable), error=None)

    def snapshot(self):
        with self._lock:
            return dict(self._state)

    def prepare(self, settings):
        """Update cache in commit order; caller delivers the returned notification."""
        valid = isinstance(settings, dict)
        value = dict(ready=valid, enabled=valid and settings.get("use_amp_sims") is True,
                     applicable=self._state["applicable"],
                     error=None if valid else "Amp simulation settings unavailable")
        with self._lock:
            previous = {key: self._state[key] for key in value}
            if previous == value:
                return None
            self._state = dict(value, generation=self._state["generation"] + 1)
            return dict(self._state)

    def notify(self, value):
        if value is None:
            return
        with self._lock:
            handlers = tuple(self._handlers)
        for handler in handlers:
            with self._lock:
                if value["generation"] != self._state["generation"]:
                    return  # A newer commit superseded this delayed notification.
                if handler not in self._handlers:
                    continue
            self._invoke(handler, value)

    @staticmethod
    def _invoke(handler, value):
        try:
            handler(dict(value))
        except Exception:
            log.exception("Amp simulation policy subscriber failed")

    def subscribe(self, handler):
        if not callable(handler):
            raise TypeError("A policy subscriber must be callable")
        with self._lock:
            self._handlers.add(handler)
            value = dict(self._state)
        self._invoke(handler, value)

        def unsubscribe():
            with self._lock:
                self._handlers.discard(handler)
        return unsubscribe

    def context(self):
        return {"snapshot": self.snapshot, "subscribe": self.subscribe}
