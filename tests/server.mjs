/* Lokální náhrada Netlify funkcí — bez Netlify a bez Blobs.

   Slouží ke dvěma věcem:
     1. `node tests/server.mjs` rozjede celou hru včetně žebříčku na
        http://localhost:8788, takže se dá zkoušet ranked.html bez instalace
        netlify-cli. Data drží v paměti a po vypnutí zmizí.
     2. běží pod ním automatizované testy klienta (tests/ranked-client.mjs)

   Nesmí se v něm objevit ŽÁDNÁ herní logika — všechno jde přes stejné
   lib/run.mjs jako produkce. Jinak by testy ověřovaly tenhle soubor,
   ne to, co se nasazuje. */

import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { emptyRun, publicState, apply, RunError, MODES, rules }
  from '../netlify/functions/lib/run.mjs';
import {
  emptyLobby, publicLobby, apply as applyLobby, authPlayer, addPlayer,
  catchUp, touchSeen, LobbyError, MODES as LOBBY_MODES, NAME_MAX,
  CODE_ALPHABET, CODE_LENGTH
} from '../netlify/functions/lib/lobby.mjs';
import { emptyStats, applyRun } from '../netlify/functions/lib/stats.mjs';

const ROOT = new URL('../public/', import.meta.url).pathname;
const PORT = Number(process.argv[2] || 8788);

const runs = new Map();
const boards = { day: [], week: [], month: [], all: [] };
const players = new Map();
const lobbies = new Map();

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon'
};

function send(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store'
  });
  res.end(body);
}

function submit(entry) {
  const placements = {};
  for (const period of Object.keys(boards)) {
    const list = boards[period].filter((item) => item.playerId !== entry.playerId);
    const previous = boards[period].find((item) => item.playerId === entry.playerId);
    const keep = previous && previous.score >= entry.score ? previous : entry;
    list.push(keep);
    list.sort((a, b) => b.score - a.score || a.durationMs - b.durationMs);
    boards[period] = list.slice(0, 100);
    const rank = boards[period].findIndex((item) => item.playerId === entry.playerId);
    placements[period] = rank === -1 ? null : rank + 1;
  }
  return placements;
}

/** Ověří dvojici id + tajemství. Vrací záznam hráče, nebo null. */
function authenticate(id, secret) {
  const player = players.get(id);
  if (!player || !secret || player.secret !== secret) {
    return null;
  }
  return player;
}

async function handleHra(body, res) {
  if (body.action === 'start') {
    const mode = MODES.includes(body.mode) ? body.mode : 'easy';
    let playerId = body.playerId;
    let issued = null;
    if (!authenticate(playerId, body.playerSecret)) {
      playerId = randomUUID();
      issued = { id: playerId, secret: randomUUID() };
      players.set(playerId, { secret: issued.secret, stats: emptyStats() });
    }
    const run = emptyRun({
      id: randomUUID(),
      mode,
      seconds: mode === 'hard' ? parseInt(body.seconds, 10) : null,
      playerId
    });
    /* Testovací berlička: `stackJokers` posune oba žolíky na vrch balíčku,
       aby šel spolehlivě nacvičit scénář s uschovanými žolíky. Existuje jen
       tady v tests/ — produkční netlify/functions/hra.mjs ji nemá. */
    if (body.stackJokers) {
      const jokers = run.deck.filter((card) => card.type === 'joker');
      run.deck = run.deck.filter((card) => card.type !== 'joker').concat(jokers);
    }
    run.name = String(body.name || 'Hráč').slice(0, 24);
    run.publish = body.publish === true;
    runs.set(run.id, run);
    return send(res, 200, {
      state: publicState(run),
      player: issued || { id: playerId },
      stats: players.get(playerId).stats
    });
  }

  const stored = runs.get(body.runId);
  if (!stored) {
    return send(res, 404, { error: 'run_not_found' });
  }
  if (stored.tombstone) {
    return send(res, 200, {
      state: stored.state,
      placements: stored.placements || null,
      stats: stored.stats || null,
      records: stored.records || []
    });
  }
  const run = stored;
  if (run.over) {
    return send(res, 200, { state: publicState(run) });
  }

  if (process.env.MP_TRACE) {
    console.log('%s dt=%dms pending=%s', body.action,
      Date.now() - run.lastMoveAt, run.pending ? run.pending.value : '-');
  }
  try {
    apply(run, body);
  } catch (err) {
    if (err instanceof RunError) {
      return send(res, err.status, { error: err.code });
    }
    throw err;
  }

  if (!run.over) {
    return send(res, 200, { state: publicState(run) });
  }

  const state = publicState(run);
  // stejné pořadí jako v netlify/functions/hra.mjs: nejdřív náhrobek, potom
  // statistiky a žebříček — a jejich selhání partii nezruší
  runs.set(run.id, { id: run.id, tombstone: true, state, placements: null, stats: null, records: [] });

  const finishedAt = new Date(run.finishedAt).toISOString();
  const complete = run.placed >= rules.CELLS_TOTAL;

  let stats = null;
  let records = [];
  const player = players.get(run.playerId);
  if (player) {
    const outcome = applyRun(player.stats, {
      score: run.score,
      mode: run.mode,
      durationMs: state.durationMs,
      complete,
      at: finishedAt
    });
    player.stats = outcome.stats;
    stats = outcome.stats;
    records = outcome.records;
  }

  let placements = null;
  let boardFailed = false;
  if (run.publish && complete) {
    try {
      placements = submit({
        playerId: run.playerId,
        name: run.name,
        score: run.score,
        mode: run.mode,
        durationMs: state.durationMs,
        at: finishedAt
      });
    } catch (err) {
      console.error('zebricek:', err);
      boardFailed = true;
    }
  }
  runs.set(run.id, { id: run.id, tombstone: true, state, placements, stats, records });
  return send(res, 200, { state, placements, stats, records, boardFailed: boardFailed || undefined });
}

/* Náhrada netlify/functions/profil.mjs — čtení a nulování ověřených statistik. */
function handleProfil(body, res) {
  const player = authenticate(body.playerId, body.playerSecret);
  if (!player) {
    return send(res, 403, { error: 'unknown_player' });
  }
  if (body.action === 'reset') {
    player.stats = emptyStats();
  }
  return send(res, 200, { stats: player.stats });
}

/* ---------------------------------------------------------- skupinová hra */

/* Proti netlify/functions/skupina.mjs chybí jenom úložiště: lobby leží
   v paměti a zápis je obyčejné přiřazení, takže odpadá podmíněný cyklus
   kolem ETagu. Pravidla i tady jdou přes lib/lobby.mjs. */

function lobbyCode() {
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function seatToken() {
  return randomUUID().replace(/-/g, '');
}

function playerName(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX) || 'Hráč';
}

function handleSkupina(body, res) {
  try {
    if (body.action === 'create') {
      const mode = LOBBY_MODES.includes(body.mode) ? body.mode : 'easy';
      const hostId = randomUUID();
      const hostToken = seatToken();
      let code = lobbyCode();
      while (lobbies.has(code)) {
        code = lobbyCode();
      }
      const lobby = emptyLobby({
        code,
        mode,
        seconds: mode === 'hard' ? parseInt(body.seconds, 10) : null,
        hostId,
        hostToken,
        hostName: playerName(body.name),
        hostPlays: body.hostPlays !== false
      });
      lobbies.set(code, lobby);
      return send(res, 200, {
        lobby: publicLobby(lobby, hostId),
        seat: { code, playerId: hostId, token: hostToken }
      });
    }

    const code = String(body.code || '').toUpperCase();
    const lobby = lobbies.get(code);
    if (!lobby) {
      return send(res, 404, { error: 'lobby_not_found' });
    }

    if (body.action === 'join') {
      const playerId = randomUUID();
      const token = seatToken();
      addPlayer(lobby, { id: playerId, name: playerName(body.name), token, playing: true });
      return send(res, 200, {
        lobby: publicLobby(lobby, playerId),
        seat: { code, playerId, token }
      });
    }

    const player = authPlayer(lobby, body.playerId, body.token);
    if (body.action === 'state') {
      catchUp(lobby);
      touchSeen(player);
    } else {
      touchSeen(player, Date.now());
      applyLobby(lobby, player, body);

      /* Testovací berlička: `stackJokers` posune oba žolíky na vrch balíčku,
         aby šel spolehlivě nacvičit scénář s uschovanými žolíky. Existuje jen
         tady v tests/ — produkční netlify/functions/skupina.mjs ji nemá. */
      if (body.stackJokers && body.action === 'start') {
        const jokers = lobby.deck.filter((card) => card.type === 'joker');
        lobby.deck = lobby.deck.filter((card) => card.type !== 'joker').concat(jokers);
      }
    }
    return send(res, 200, { lobby: publicLobby(lobby, player.id) });
  } catch (err) {
    if (err instanceof LobbyError) {
      return send(res, err.status, { error: err.code });
    }
    throw err;
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');

  if (url.pathname === '/api/hra' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    try {
      return await handleHra(JSON.parse(raw || '{}'), res);
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'server_error' });
    }
  }

  if (url.pathname === '/api/profil' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    try {
      return handleProfil(JSON.parse(raw || '{}'), res);
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'server_error' });
    }
  }

  if (url.pathname === '/api/skupina' && req.method === 'POST') {
    let raw = '';
    for await (const chunk of req) {
      raw += chunk;
    }
    try {
      return handleSkupina(JSON.parse(raw || '{}'), res);
    } catch (err) {
      console.error(err);
      return send(res, 500, { error: 'server_error' });
    }
  }

  // Kanál pro hlášení z testovacího prohlížeče — jen pro tests/.
  if (url.pathname === '/api/log' && req.method === 'GET') {
    console.log('KLIENT: ' + url.searchParams.get('msg'));
    return send(res, 200, { ok: true });
  }

  if (url.pathname === '/api/zebricek' && req.method === 'GET') {
    const period = url.searchParams.get('obdobi') || 'all';
    const list = boards[period] || [];
    return send(res, 200, {
      period,
      label: period,
      limit: 50,
      count: list.length,
      entries: list.map((entry, index) => ({ rank: index + 1, ...entry }))
    });
  }

  // statické soubory z public/
  let file = decodeURIComponent(url.pathname);
  if (file === '/') {
    file = '/index.html';
  }
  const full = path.join(ROOT, file);
  if (!full.startsWith(ROOT)) {
    res.writeHead(403);
    return res.end();
  }
  try {
    const data = await fs.readFile(full);
    res.writeHead(200, { 'content-type': TYPES[path.extname(full)] || 'application/octet-stream' });
    res.end(data);
  } catch (err) {
    res.writeHead(404);
    res.end('nenalezeno');
  }
});

server.listen(PORT, () => {
  console.log('hra i žebříček běží na http://localhost:' + PORT);
});

export { server, runs, boards, lobbies };
