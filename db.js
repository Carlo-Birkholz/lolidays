// db.js
import Database from 'better-sqlite3';

const db = new Database('routes.db');           // creates routes.db in your project folder
db.pragma('journal_mode = WAL');                // safer/faster writes

// Create tables if they don't exist
db.exec(`
CREATE TABLE IF NOT EXISTS vacations (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  start_date TEXT,
  end_date TEXT,
  created_by TEXT,
  created_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS stops (
  id TEXT PRIMARY KEY,
  vacation_id TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  album_url TEXT,
  lat REAL,
  lon REAL,
  idx INTEGER NOT NULL,
  FOREIGN KEY(vacation_id) REFERENCES vacations(id)
);
`);

// ---- Queries ----

// NOTE: SQLite doesn't support "NULLS LAST" syntax.
// This trick orders rows with NULL start_date *after* non-NULL ones:
//   (start_date IS NULL) asc  -> false(0)=non-null first, true(1)=null last
export const getVacations = db.prepare(`
  SELECT * FROM vacations
  ORDER BY (start_date IS NULL) ASC, start_date ASC, created_at DESC
`);

export const getStopsForVacation = db.prepare(`
  SELECT * FROM stops
  WHERE vacation_id = ?
  ORDER BY idx ASC
`);

export const insertVacation = db.prepare(`
  INSERT INTO vacations (id, title, start_date, end_date, created_by)
  VALUES (@id, @title, @start_date, @end_date, @created_by)
`);

export const insertStop = db.prepare(`
  INSERT INTO stops (id, vacation_id, name, date, album_url, lat, lon, idx)
  VALUES (@id, @vacation_id, @name, @date, @album_url, @lat, @lon, @idx)
`);

export const getAllVacationsWithStops = () => {
  const vacations = getVacations.all();
  return vacations.map(v => ({ ...v, stops: getStopsForVacation.all(v.id) }));
};

export const deleteStop = db.prepare(`
  DELETE FROM stops WHERE id = ?
`);

export const getStopsFlat = db.prepare(`
  SELECT id, vacation_id, name, date, idx
  FROM stops
  WHERE vacation_id = ?
  ORDER BY idx ASC
`);

export default db;
