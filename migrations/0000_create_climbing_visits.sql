CREATE TABLE IF NOT EXISTS climbing_visits (
  day_key TEXT PRIMARY KEY,
  gym_id TEXT NOT NULL,
  gym_name TEXT NOT NULL,
  lat REAL,
  lng REAL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS climbing_visits_updated_at_idx
ON climbing_visits(updated_at DESC);