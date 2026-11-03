// SQLite storage for the demo shop (node:sqlite, Node >= 22.13).
import { DatabaseSync } from "node:sqlite";

const db = new DatabaseSync(process.env.SHOP_DB ?? ":memory:");
db.exec(`
  CREATE TABLE IF NOT EXISTS oauth_state (state TEXT PRIMARY KEY, created_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY, email TEXT NOT NULL, expires_at INTEGER NOT NULL);
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL, item TEXT NOT NULL,
    qty INTEGER NOT NULL, tracking TEXT, created_at INTEGER NOT NULL
  );
`);

export function saveState(state) {
  db.prepare("INSERT INTO oauth_state (state, created_at) VALUES (?, ?)").run(state, Date.now());
}

// A state value works once: the row is removed in the same statement that reads it.
export function consumeState(state) {
  return db.prepare("DELETE FROM oauth_state WHERE state = ? RETURNING state").get(state) ?? null;
}

export function saveSession(id, email, ttlMs) {
  db.prepare("INSERT INTO sessions (id, email, expires_at) VALUES (?, ?, ?)").run(id, email, Date.now() + ttlMs);
}

export function findSession(id) {
  return db.prepare("SELECT email FROM sessions WHERE id = ? AND expires_at > ?").get(id, Date.now()) ?? null;
}

export function listOrders(email) {
  return db.prepare("SELECT id, item, qty, tracking, created_at FROM orders WHERE email = ? ORDER BY id DESC LIMIT 50").all(email);
}

export function insertOrder(email, item, qty, tracking) {
  const r = db.prepare("INSERT INTO orders (email, item, qty, tracking, created_at) VALUES (?, ?, ?, ?, ?)").run(email, item, qty, tracking ?? null, Date.now());
  return Number(r.lastInsertRowid);
}
