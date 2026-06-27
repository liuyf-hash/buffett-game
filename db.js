const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');

const DB_PATH = path.join(__dirname, 'data', 'game.sqlite');

let db;

function getDB() {
  if (!db) {
    db = new DatabaseSync(DB_PATH);
    db.exec('PRAGMA journal_mode=WAL');
    db.exec('PRAGMA foreign_keys=ON');
  }
  return db;
}

function initDB() {
  const db = getDB();

  db.exec(`
    CREATE TABLE IF NOT EXISTS universities (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      province TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      university_id INTEGER NOT NULL REFERENCES universities(id),
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      last_login_at TEXT
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id INTEGER NOT NULL REFERENCES users(id),
      asset_pct REAL NOT NULL DEFAULT 100.0,
      rounds INTEGER NOT NULL DEFAULT 10,
      current_round INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'in_progress',
      started_at TEXT NOT NULL DEFAULT (datetime('now')),
      completed_at TEXT
    );

    CREATE TABLE IF NOT EXISTS game_rounds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL REFERENCES game_sessions(id),
      round_number INTEGER NOT NULL,
      stock_code TEXT NOT NULL,
      stock_name TEXT NOT NULL,
      year INTEGER NOT NULL,
      guessed_range_id INTEGER,
      guess_correct INTEGER DEFAULT 0,
      bought INTEGER NOT NULL DEFAULT 0,
      asset_before REAL NOT NULL,
      asset_after REAL NOT NULL,
      round_return REAL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  // Seed universities (clear and re-seed to keep IDs in sync)
  db.exec('PRAGMA foreign_keys=OFF');
  db.exec('DELETE FROM universities');
  db.exec('PRAGMA foreign_keys=ON');
  const uniData = JSON.parse(fs.readFileSync(path.join(__dirname, 'data', 'universities.json'), 'utf-8'));
  const insert = db.prepare('INSERT INTO universities (id, name, province) VALUES (?, ?, ?)');
  for (const u of uniData) {
    insert.run(u.id, u.name, u.province);
  }
  console.log(`已加载 ${uniData.length} 所大学`);

  return db;
}

// User functions
function createUser(username, passwordHash, universityId) {
  const db = getDB();
  return db.prepare('INSERT INTO users (username, password_hash, university_id) VALUES (?, ?, ?)').run(username, passwordHash, universityId);
}

function getUserByUsername(username) {
  const db = getDB();
  return db.prepare('SELECT u.*, un.name as university_name FROM users u JOIN universities un ON u.university_id = un.id WHERE u.username = ?').get(username);
}

function getUserById(id) {
  const db = getDB();
  return db.prepare('SELECT u.*, un.name as university_name FROM users u JOIN universities un ON u.university_id = un.id WHERE u.id = ?').get(id);
}

// Game session functions
function createSession(userId, totalRounds) {
  const db = getDB();
  return db.prepare('INSERT INTO game_sessions (user_id, rounds) VALUES (?, ?)').run(userId, totalRounds);
}

function getSession(id) {
  const db = getDB();
  return db.prepare('SELECT * FROM game_sessions WHERE id = ?').get(id);
}

function updateSessionAsset(sessionId, assetPct) {
  const db = getDB();
  db.prepare('UPDATE game_sessions SET asset_pct = ? WHERE id = ?').run(assetPct, sessionId);
}

function completeSession(sessionId) {
  const db = getDB();
  db.prepare("UPDATE game_sessions SET status = 'completed', completed_at = datetime('now') WHERE id = ?").run(sessionId);
}

function incrementRound(sessionId) {
  const db = getDB();
  db.prepare('UPDATE game_sessions SET current_round = current_round + 1 WHERE id = ?').run(sessionId);
}

// Game rounds functions
function createRound(sessionId, roundNumber, stockCode, stockName, year, assetBefore) {
  const db = getDB();
  return db.prepare('INSERT INTO game_rounds (session_id, round_number, stock_code, stock_name, year, asset_before, asset_after) VALUES (?, ?, ?, ?, ?, ?, ?)').run(sessionId, roundNumber, stockCode, stockName, year, assetBefore, assetBefore);
}

function updateRoundGuess(roundId, rangeId, correct) {
  const db = getDB();
  db.prepare('UPDATE game_rounds SET guessed_range_id = ?, guess_correct = ? WHERE id = ?').run(rangeId, correct ? 1 : 0, roundId);
}

function updateRoundDecision(roundId, bought, assetAfter, roundReturn) {
  const db = getDB();
  db.prepare('UPDATE game_rounds SET bought = ?, asset_after = ?, round_return = ? WHERE id = ?').run(bought ? 1 : 0, assetAfter, roundReturn, roundId);
}

function getRoundBySessionAndNumber(sessionId, roundNumber) {
  const db = getDB();
  return db.prepare('SELECT * FROM game_rounds WHERE session_id = ? AND round_number = ?').get(sessionId, roundNumber);
}

function getSessionRounds(sessionId) {
  const db = getDB();
  return db.prepare('SELECT * FROM game_rounds WHERE session_id = ? ORDER BY round_number').all(sessionId);
}

// Ranking functions
function getUniversityRanking() {
  const db = getDB();
  return db.prepare(`
    SELECT un.name as university_name, un.province,
           COUNT(DISTINCT gs.user_id) as players,
           ROUND(AVG(gs.asset_pct), 1) as avg_asset,
           ROUND(MAX(gs.asset_pct), 1) as best_asset
    FROM game_sessions gs
    JOIN users u ON gs.user_id = u.id
    JOIN universities un ON u.university_id = un.id
    WHERE gs.status = 'completed'
    GROUP BY un.id
    ORDER BY avg_asset DESC
  `).all();
}

function getIndividualRanking() {
  const db = getDB();
  return db.prepare(`
    SELECT u.username, un.name as university_name,
           ROUND(gs.asset_pct, 1) as asset_pct,
           gs.rounds, gs.completed_at
    FROM game_sessions gs
    JOIN users u ON gs.user_id = u.id
    JOIN universities un ON u.university_id = un.id
    WHERE gs.status = 'completed'
    ORDER BY gs.asset_pct DESC
    LIMIT 100
  `).all();
}

function getUserRank(userId) {
  const db = getDB();
  return db.prepare(`
    SELECT ranked.* FROM (
      SELECT u.id, u.username, ROUND(gs.asset_pct, 1) as asset_pct,
             RANK() OVER (ORDER BY gs.asset_pct DESC) as rank
      FROM game_sessions gs
      JOIN users u ON gs.user_id = u.id
      WHERE gs.status = 'completed'
    ) ranked WHERE ranked.id = ?
  `).get(userId);
}

function getUserHistory(userId) {
  const db = getDB();
  return db.prepare(`
    SELECT * FROM game_sessions WHERE user_id = ? ORDER BY started_at DESC LIMIT 20
  `).all(userId);
}

function getLastFinishedAsset(userId) {
  const db = getDB();
  const row = db.prepare(`
    SELECT asset_pct FROM game_sessions WHERE user_id = ? AND status = 'completed' ORDER BY completed_at DESC LIMIT 1
  `).get(userId);
  return row ? row.asset_pct : 100.0;
}

module.exports = { initDB, getDB, createUser, getUserByUsername, getUserById,
  createSession, getSession, updateSessionAsset, completeSession, incrementRound,
  createRound, updateRoundGuess, updateRoundDecision, getRoundBySessionAndNumber,
  getSessionRounds, getUniversityRanking, getIndividualRanking, getUserRank, getUserHistory,
  getLastFinishedAsset };
