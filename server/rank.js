'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { DatabaseSync } = require('node:sqlite');

const RANKS = ['列兵', '二等兵', '一等兵', '上等兵', '下士', '中士', '上士',
  '少尉', '中尉', '上尉', '少校', '中校', '上校', '大校', '少将', '中将', '上将', '元帅'];
const RULES_VERSION = 1;
const DAY_MS = 24 * 60 * 60 * 1000;
const THRESHOLDS = [0];
for (let level = 1; level < RANKS.length; level++) {
  THRESHOLDS.push(THRESHOLDS.at(-1) + 100 + 40 * (level - 1) + 10 * (level - 1) ** 2);
}

function rankOf(xp) {
  const total = Math.max(0, Number(xp) || 0);
  let index = 0;
  while (index + 1 < THRESHOLDS.length && total >= THRESHOLDS[index + 1]) index++;
  const next = THRESHOLDS[index + 1] ?? null;
  return { xpTotal: total, level: index + 1, name: RANKS[index],
    levelStart: THRESHOLDS[index], nextLevelAt: next,
    progress: total - THRESHOLDS[index], nextLevelNeed: next === null ? null : next - total };
}

function makeRank() {
  const dbPath = process.env.AUTH_DB_PATH || path.resolve(__dirname, '../.runtime/accounts.sqlite');
  fs.mkdirSync(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS rank_profiles (
      account_id TEXT PRIMARY KEY REFERENCES accounts(id),
      xp_total INTEGER NOT NULL DEFAULT 0 CHECK(xp_total>=0), updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS matches (
      match_id TEXT PRIMARY KEY, room_id TEXT NOT NULL, started_at INTEGER NOT NULL,
      ended_at INTEGER, reason TEXT, winner TEXT, status TEXT NOT NULL,
      bot_count INTEGER NOT NULL, balanced_start INTEGER NOT NULL,
      xp_enabled INTEGER NOT NULL, one_vs_one_pair TEXT, rules_version INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS matches_pair_time ON matches(one_vs_one_pair, started_at);
    CREATE TABLE IF NOT EXISTS match_participants (
      match_id TEXT NOT NULL REFERENCES matches(match_id),
      account_id TEXT NOT NULL REFERENCES accounts(id), team TEXT NOT NULL,
      first_spawn_at INTEGER, active_seconds INTEGER NOT NULL DEFAULT 0,
      kills INTEGER NOT NULL DEFAULT 0, headshots INTEGER NOT NULL DEFAULT 0,
      deaths INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY(match_id,account_id)
    );
    CREATE INDEX IF NOT EXISTS match_participants_account ON match_participants(account_id);
    CREATE TABLE IF NOT EXISTS rank_settlements (
      match_id TEXT NOT NULL REFERENCES matches(match_id),
      account_id TEXT NOT NULL REFERENCES accounts(id),
      xp_awarded INTEGER NOT NULL CHECK(xp_awarded>=0), breakdown_json TEXT NOT NULL,
      xp_before INTEGER NOT NULL, xp_after INTEGER NOT NULL,
      rules_version INTEGER NOT NULL, settled_at INTEGER NOT NULL,
      PRIMARY KEY(match_id,account_id)
    );
    CREATE INDEX IF NOT EXISTS rank_settlements_account ON rank_settlements(account_id, settled_at DESC);`);

  // A process restart cannot complete a match that had not ended on the server.
  db.prepare("UPDATE matches SET status='interrupted', reason='restart', ended_at=? WHERE status='playing'").run(Date.now());

  const insertMatch = db.prepare(`INSERT INTO matches
    (match_id,room_id,started_at,status,bot_count,balanced_start,xp_enabled,one_vs_one_pair,rules_version)
    VALUES (?,?,?,'playing',?,?,?,?,?)`);
  const insertParticipant = db.prepare(`INSERT INTO match_participants
    (match_id,account_id,team,first_spawn_at,active_seconds,kills,headshots,deaths)
    VALUES (?,?,?,?,?,?,?,?)`);
  const matchRow = db.prepare('SELECT * FROM matches WHERE match_id=?');
  const participantRows = db.prepare('SELECT * FROM match_participants WHERE match_id=? ORDER BY account_id');
  const kills = db.prepare(`SELECT killer_id, victim_id, headshot FROM combat_events
    WHERE match_id=? ORDER BY id`);
  const pairMatches = db.prepare(`SELECT COUNT(DISTINCT m.match_id) AS n FROM matches m
    JOIN rank_settlements s ON s.match_id=m.match_id AND s.xp_awarded>0
    WHERE m.one_vs_one_pair=? AND m.started_at>=? AND m.started_at<?`);
  const profile = db.prepare('SELECT xp_total FROM rank_profiles WHERE account_id=?');
  const lifetimeSeconds = db.prepare(`SELECT COALESCE(SUM(active_seconds),0) AS seconds
    FROM match_participants WHERE account_id=?`);
  const insertProfile = db.prepare('INSERT OR IGNORE INTO rank_profiles(account_id,xp_total,updated_at) VALUES (?,0,?)');
  const updateProfile = db.prepare('UPDATE rank_profiles SET xp_total=?,updated_at=? WHERE account_id=?');
  const insertSettlement = db.prepare(`INSERT OR IGNORE INTO rank_settlements
    (match_id,account_id,xp_awarded,breakdown_json,xp_before,xp_after,rules_version,settled_at)
    VALUES (?,?,?,?,?,?,?,?)`);
  const alreadySettled = db.prepare('SELECT 1 FROM rank_settlements WHERE match_id=? AND account_id=?');
  const settledRows = db.prepare(`SELECT s.*,m.reason,m.winner,m.ended_at,m.room_id,p.team
    FROM rank_settlements s JOIN matches m ON m.match_id=s.match_id
    JOIN match_participants p ON p.match_id=s.match_id AND p.account_id=s.account_id
    WHERE s.account_id=? ORDER BY s.settled_at DESC,m.started_at DESC LIMIT ?`);

  function createMatch(room, t = Date.now()) {
    const initial = [...room.players.values()].filter((p) => p.team);
    const counts = { BL: initial.filter((p) => p.team === 'BL').length,
      GR: initial.filter((p) => p.team === 'GR').length };
    const pair = initial.length === 2 && counts.BL === 1 && counts.GR === 1
      ? initial.map((p) => p.accountId).sort().join(':') : null;
    const match = { id: crypto.randomUUID(), startedAt: t, participants: new Map(),
      botCount: room.bots, balancedStart: !!(counts.BL && counts.GR),
      xpEnabled: process.env.RANK_XP_ENABLED !== '0' };
    insertMatch.run(match.id, room.id, t, room.bots, match.balancedStart ? 1 : 0,
      match.xpEnabled ? 1 : 0, pair, RULES_VERSION);
    for (const player of initial) enter(match, player);
    return match;
  }

  function enter(match, player) {
    if (!match || !player.accountId || !player.team) return;
    let participant = match.participants.get(player.accountId);
    if (!participant) {
      participant = { team: player.team, firstSpawnAt: null, activeMs: 0, activeSince: null };
      match.participants.set(player.accountId, participant);
    }
    // Rejoining the same match cannot change the team used for settlement.
    if (participant.team !== player.team) return;
    return participant;
  }

  function spawned(match, player, t = Date.now()) {
    const participant = enter(match, player);
    if (!participant) return;
    if (participant.firstSpawnAt === null) participant.firstSpawnAt = t;
    if (participant.activeSince === null) participant.activeSince = t;
  }

  function left(match, player, t = Date.now()) {
    const participant = match?.participants.get(player.accountId);
    if (!participant || participant.activeSince === null) return;
    participant.activeMs += Math.max(0, t - participant.activeSince);
    participant.activeSince = null;
  }

  function finish(match, room, reason, winner, t = Date.now()) {
    if (!match) return null;
    db.exec('BEGIN IMMEDIATE');
    try {
      const changed = db.prepare(`UPDATE matches SET status='finished',ended_at=?,reason=?,winner=?
        WHERE match_id=? AND status='playing'`).run(t, reason, winner, match.id);
      if (!changed.changes) { db.exec('ROLLBACK'); return settlementSummary(match.id); }
      for (const player of room.players.values()) left(match, player, t);
      for (const [accountId, p] of match.participants) {
        insertParticipant.run(match.id, accountId, p.team, p.firstSpawnAt,
          Math.floor(p.activeMs / 1000), 0, 0, 0);
      }
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return settle(match.id);
  }

  function settle(matchId) {
    const match = matchRow.get(matchId);
    if (!match || match.status !== 'finished') return settlementSummary(matchId);
    const people = participantRows.all(matchId);
    const events = kills.all(matchId);
    const stats = new Map(people.map((p) => [p.account_id,
      { kills: 0, headshots: 0, deaths: 0, eligibleKills: 0, eligibleHeadshots: 0, victims: new Map() }]));
    for (const event of events) {
      const killer = stats.get(event.killer_id), victim = stats.get(event.victim_id);
      if (!killer || !victim || killer === victim) continue;
      killer.kills++;
      victim.deaths++;
      if (event.headshot) killer.headshots++;
      const count = (killer.victims.get(event.victim_id) || 0) + 1;
      killer.victims.set(event.victim_id, count);
      if (count <= 3) {
        killer.eligibleKills++;
        if (event.headshot) killer.eligibleHeadshots++;
      }
    }
    const pairLimit = match.one_vs_one_pair && pairMatches.get(match.one_vs_one_pair,
      match.started_at - DAY_MS, match.started_at).n >= 3;
    db.exec('BEGIN IMMEDIATE');
    try {
      for (const p of people) {
        const s = stats.get(p.account_id);
        db.prepare(`UPDATE match_participants SET kills=?,headshots=?,deaths=?
          WHERE match_id=? AND account_id=?`).run(s.kills, s.headshots, s.deaths, matchId, p.account_id);
        if (alreadySettled.get(matchId, p.account_id)) continue;
        let reason = null;
        if (!match.xp_enabled) reason = '经验发放尚未开启';
        else if (!['goal', 'time'].includes(match.reason)) reason = '比赛未正常结束';
        else if (match.bot_count) reason = '本局含机器人';
        else if (!match.balanced_start) reason = '开局时双方无人';
        else if (p.first_spawn_at === null) reason = '未进入战斗';
        else if (p.active_seconds < 60) reason = '有效参赛不足 60 秒';
        else if (pairLimit) reason = '同一对手 24 小时内已结算 3 场 1v1';
        const breakdown = reason ? { reason, base: 0, duration: 0, result: 0, kills: 0, headshots: 0 }
          : { reason: null, base: 30, duration: 2 * Math.min(Math.floor(p.active_seconds / 60), 10),
            result: match.winner === p.team ? 20 : match.winner === null ? 10 : 0,
            kills: 8 * Math.min(s.eligibleKills, 15), headshots: 2 * Math.min(s.eligibleHeadshots, 10) };
        const award = Math.min(210, breakdown.base + breakdown.duration + breakdown.result
          + breakdown.kills + breakdown.headshots);
        insertProfile.run(p.account_id, Date.now());
        const before = profile.get(p.account_id).xp_total;
        const after = before + award;
        const inserted = insertSettlement.run(matchId, p.account_id, award, JSON.stringify(breakdown),
          before, after, match.rules_version, Date.now());
        if (inserted.changes) updateProfile.run(after, Date.now(), p.account_id);
      }
      db.prepare("UPDATE matches SET status='settled' WHERE match_id=? AND status='finished'").run(matchId);
      db.exec('COMMIT');
    } catch (error) { db.exec('ROLLBACK'); throw error; }
    return settlementSummary(matchId);
  }

  function settlementSummary(matchId) {
    const rows = db.prepare(`SELECT s.account_id,s.xp_awarded,s.xp_before,s.xp_after,s.breakdown_json,
      p.team,p.active_seconds,p.kills,p.headshots,p.deaths
      FROM rank_settlements s JOIN match_participants p
      ON p.match_id=s.match_id AND p.account_id=s.account_id WHERE s.match_id=?`).all(matchId);
    return Object.fromEntries(rows.map((row) => [row.account_id, {
      awarded: row.xp_awarded, before: rankOf(row.xp_before), after: rankOf(row.xp_after),
      breakdown: JSON.parse(row.breakdown_json), team: row.team, activeSeconds: row.active_seconds,
      kills: row.kills, headshots: row.headshots, deaths: row.deaths,
    }]));
  }

  function getProfile(accountId) { return rankOf(profile.get(accountId)?.xp_total || 0); }
  function getLifetimeSeconds(accountId) { return Number(lifetimeSeconds.get(accountId).seconds) || 0; }
  function getSettlements(accountId, limit = 20) {
    return settledRows.all(accountId, Math.min(50, Math.max(1, limit))).map((row) => ({
      matchId: row.match_id, roomId: row.room_id, endedAt: row.ended_at,
      result: !['goal', 'time'].includes(row.reason) ? 'aborted'
        : row.winner === null ? 'draw' : row.winner === row.team ? 'win' : 'loss',
      endReason: row.reason, awarded: row.xp_awarded, before: rankOf(row.xp_before),
      after: rankOf(row.xp_after), breakdown: JSON.parse(row.breakdown_json),
    }));
  }

  // Finish any match that reached a persisted end before settlement was committed.
  for (const row of db.prepare("SELECT match_id FROM matches WHERE status='finished' ORDER BY ended_at").all()) {
    try { settle(row.match_id); } catch (error) { console.error('[rank] 恢复结算失败:', row.match_id, error); }
  }

  return { createMatch, enter, spawned, left, finish, getProfile, getLifetimeSeconds, getSettlements,
    close() { db.close(); } };
}

module.exports = { makeRank, rankOf, RANKS, THRESHOLDS };
