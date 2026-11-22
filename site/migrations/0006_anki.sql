-- Chinese Brain Plus, Stage 4: his Anki collection. One row per thing, by kind: meta, notetype, deck, conf, note, card
-- (a card's row carries its review log). data NULL = deleted (kept so other devices hear about it). mod = when it was
-- changed (the device's clock, newest wins); usn = when the server stored it (devices pull what's newer than they have).
CREATE TABLE IF NOT EXISTS anki (kind TEXT NOT NULL, id TEXT NOT NULL, data TEXT, mod INTEGER NOT NULL, usn INTEGER NOT NULL, PRIMARY KEY (kind, id));
CREATE INDEX IF NOT EXISTS anki_usn ON anki (usn);
-- Anki's media file names → where the file is kept now (/api/plus/media/...).
CREATE TABLE IF NOT EXISTS anki_media (name TEXT PRIMARY KEY, url TEXT NOT NULL);
