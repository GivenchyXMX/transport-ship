'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const SHANGHAI_OFFSET = 8 * HOUR;
const PERIODS = new Set(['all', 'month', 'week', 'day', 'live']);

function periodStart(period, time) {
  if (period === 'all') return 0;
  const date = new Date(time + SHANGHAI_OFFSET);
  const year = date.getUTCFullYear();
  const month = date.getUTCMonth();
  const day = date.getUTCDate();
  if (period === 'month') return Date.UTC(year, month, 1) - SHANGHAI_OFFSET;
  const midnight = Date.UTC(year, month, day) - SHANGHAI_OFFSET;
  if (period === 'week') return midnight - ((date.getUTCDay() + 6) % 7) * DAY;
  return midnight;
}

function boardsFrom(rows) {
  const data = rows.filter((row) => row.kills || row.deaths).map((row) => ({
    accountId: row.accountId,
    name: row.name,
    kills: Number(row.kills) || 0,
    headshots: Number(row.headshots) || 0,
    deaths: Number(row.deaths) || 0,
    kd: (Number(row.kills) || 0) / Math.max(Number(row.deaths) || 0, 1),
  }));
  const rank = (compare) => [...data].sort(compare).slice(0, 50).map((row, index) => ({ rank: index + 1, ...row }));
  return {
    kills: rank((a, b) => b.kills - a.kills || b.headshots - a.headshots || a.deaths - b.deaths || a.name.localeCompare(b.name)),
    headshots: rank((a, b) => b.headshots - a.headshots || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)),
    kd: rank((a, b) => b.kd - a.kd || b.kills - a.kills || a.deaths - b.deaths || a.name.localeCompare(b.name)),
    deaths: rank((a, b) => b.deaths - a.deaths || b.kills - a.kills || a.name.localeCompare(b.name)),
  };
}

function makeLeaderboard() {
  const dbPath = process.env.AUTH_DB_PATH || path.resolve(__dirname, '../.runtime/accounts.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS combat_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT, happened_at INTEGER NOT NULL,
      killer_id TEXT NOT NULL, victim_id TEXT NOT NULL,
      headshot INTEGER NOT NULL CHECK(headshot IN (0,1))
    );
    CREATE INDEX IF NOT EXISTS combat_events_time ON combat_events(happened_at);
    CREATE INDEX IF NOT EXISTS combat_events_killer ON combat_events(killer_id, happened_at);
    CREATE INDEX IF NOT EXISTS combat_events_victim ON combat_events(victim_id, happened_at);`);
  const insert = db.prepare('INSERT INTO combat_events (happened_at,killer_id,victim_id,headshot) VALUES (?,?,?,?)');
  const historical = db.prepare(`SELECT a.id AS accountId, a.name,
      COALESCE(k.kills,0) AS kills, COALESCE(k.headshots,0) AS headshots,
      COALESCE(d.deaths,0) AS deaths
    FROM accounts a
    LEFT JOIN (SELECT killer_id,COUNT(*) kills,SUM(headshot) headshots
      FROM combat_events WHERE happened_at>=? GROUP BY killer_id) k ON k.killer_id=a.id
    LEFT JOIN (SELECT victim_id,COUNT(*) deaths
      FROM combat_events WHERE happened_at>=? GROUP BY victim_id) d ON d.victim_id=a.id
    WHERE COALESCE(k.kills,0)+COALESCE(d.deaths,0)>0`);
  return {
    recordKill(killerId, victimId, headshot, time = Date.now()) {
      insert.run(time, killerId, victimId, headshot ? 1 : 0);
    },
    getHistorical(period, time = Date.now()) {
      if (!PERIODS.has(period) || period === 'live') throw new Error('无效的排行榜周期');
      const start = periodStart(period, time);
      return { period, windowStart: start || null, updatedAt: time, boards: boardsFrom(historical.all(start, start)) };
    },
    getLive(rooms, time = Date.now()) {
      const rows = [];
      for (const room of rooms.values()) {
        if (room.state !== 'playing') continue;
        for (const player of room.players.values()) {
          const stats = player.matchStats;
          if (stats) rows.push({ accountId: player.accountId, name: player.name, ...stats });
        }
      }
      return { period: 'live', windowStart: null, updatedAt: time, boards: boardsFrom(rows) };
    },
    close() { db.close(); },
  };
}

module.exports = { makeLeaderboard, PERIODS };
