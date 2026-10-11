"""Shared default names — kept in one place so the server, generator,
and retriever can't drift on the default document or the monument
schedule dataset."""

# Default indexed document served when the caller doesn't name one.
DEFAULT_DOCUMENT = "egyptian_history"

# Monument opening-hours CSV (times_places/<TIMES_NAME>.csv) — the
# schedule path's data source, shared by every document's retriever.
TIMES_NAME = "monument_data"
