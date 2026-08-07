/* Skupinová hra — stavový automat lobby, celý na serveru.
   ==========================================================================

   Rozdíl proti lib/run.mjs: tam hraje jeden člověk proti balíčku, tady drží
   jeden balíček celá skupina. Čísla tahá zadavatel (zakladatel lobby), všichni
   ostatní dostávají tu samou řadu čísel a každý si ji skládá do vlastního
   pole. Na konci se pole obodují a seřadí do žebříčku skupiny.

   Proč sdílená řada čísel
   ----------------------
   Kdyby si každý tahal sám, byla by to jen paralelní hra a porovnat výsledky
   by nešlo — kdo dostal lepší karty, vyhrál. Sdílená řada dělá ze skupinové
   hry souboj o rozhodování: všichni mají stejná čísla, liší se jen tím, kam
   je položili.

   Klíčový pojem je `cursor`
   -------------------------
   `lobby.sequence` je seznam vytažených čísel, pořadí je závazné. Každý hráč
   má `cursor` — kolik čísel z řady už vyřídil. Jeho aktuální číslo je vždycky
   `sequence[cursor]`. Zadavatel může táhnout dál, i když někdo ještě nepoložil;
   pomalejšímu hráči se čísla jenom nakupí ve frontě a dohání je popořadě.

   V těžké obtížnosti se dohnat nedají: každé číslo má společný termín
   (`at + seconds`) a co se nestihne, propadne — viz `catchUp()`. Termín je
   společný schválně, jinak by pomalý hráč hrál s delším časem než ostatní.

   Žolík ve skupině
   ----------------
   Žolíka dostane celá skupina naráz a každý mu určí vlastní hodnotu. Uschovat
   na později jde stejně jako ve hře pro jednoho: `cursor` se posune tak jako
   tak (žolík je vyřízený, jen jinak než položením), takže sdílená řada zůstane
   srovnaná. Uschovaný žolík se pak pokládá mimo řadu — spotřebuje políčko,
   ale žádné číslo z fronty.

   Modul je čistá logika: nesahá na síť ani na úložiště. Díky tomu se dá celý
   otestovat v Node bez Netlify (viz tests/skupina.mjs). */

import rules from '../../../public/shared/rules.js';

/* Meze lobby. Nejsou to bezpečnostní hranice, jen ochrana proti zapomenutým
   partiím a proti tomu, aby jedno lobby zabralo půl úložiště. */
export const LOBBY_TTL_MS = 6 * 60 * 60 * 1000;   // 6 hodin na dohrání
export const MAX_PLAYERS = 12;
export const NAME_MAX = 24;

/* Brzda na tažení. Zadavatel tahá za celou skupinu, takže na rozdíl od hry
   pro jednoho je tady jediný zdroj tahů — stačí hlídat ho. */
export const MIN_DRAW_MS = 250;

/* Rezerva k termínu v těžké obtížnosti. Pokrývá cestu požadavku tam a zpátky,
   ať hráč na pomalé lince nepřijde o číslo, které stihl položit včas. */
export const LATE_GRACE_MS = 1500;

export const MODES = ['easy', 'hard'];

/* Kód lobby se opisuje z obrazovky a diktuje po telefonu, takže z abecedy
   ven letí všechno, co jde zaměnit: I/1, O/0. */
export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export const CODE_LENGTH = 5;

/** Chyba, kterou funkce převede na HTTP odpověď s daným kódem. */
export class LobbyError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

/* ------------------------------------------------------------- založení */

function blankBoard(player) {
  player.grid = rules.emptyGrid();
  player.jokerCells = [];
  player.placed = 0;
  player.score = 0;
  player.lines = [];
  player.cursor = 0;
  /** žolíci uschovaní v ruce — pokládají se mimo sdílenou řadu čísel */
  player.jokers = 0;
  player.forfeited = 0;
  player.done = false;
  player.finishedAt = null;
  return player;
}

export function newPlayer({ id, name, token, host, playing }) {
  return blankBoard({
    id,
    name,
    /* Kód lobby zná celá skupina, takže sám o sobě neurčuje, kdo je kdo.
       Token dostane hráč při připojení a prokazuje se jím u každé akce —
       jinak by stačilo znát cizí id a hrát za někoho jiného. */
    token,
    host: Boolean(host),
    /** Zadavatel může jenom rozdávat a nehrát — pak nemá pole ani skóre. */
    playing: playing !== false,
    left: false,
    joinedAt: Date.now(),
    lastSeenAt: Date.now(),
    lastMoveAt: 0
  });
}

export function emptyLobby({ code, mode, seconds, hostId, hostToken, hostName, hostPlays }) {
  const safeMode = MODES.includes(mode) ? mode : 'easy';
  const lobby = {
    code,
    mode: safeMode,
    /** jen v těžké obtížnosti: kolik sekund má skupina na jedno číslo */
    seconds: safeMode === 'hard' ? seconds : null,
    status: 'lobby',              // lobby → running → over
    hostId,
    /** balíček — ven se z něj posílá jenom počet zbývajících karet */
    deck: [],
    /** vytažená čísla v závazném pořadí: { no, type, value, at } */
    sequence: [],
    /** balíček došel; hra skončí, až všichni doloží frontu */
    drained: false,
    players: [],
    round: 1,
    createdAt: Date.now(),
    startedAt: null,
    finishedAt: null,
    lastDrawAt: 0,
    reason: null
  };
  lobby.players.push(newPlayer({
    id: hostId, name: hostName, token: hostToken, host: true, playing: hostPlays !== false
  }));
  return lobby;
}

/* --------------------------------------------------------------- pomocné */

export function findPlayer(lobby, id) {
  return lobby.players.find((player) => player.id === id) || null;
}

/** Hráč ověřený tokenem. Bez něj se do cizího pole nedá sáhnout. */
export function authPlayer(lobby, id, token) {
  const player = findPlayer(lobby, id);
  if (!player || !token || player.token !== token) {
    throw new LobbyError('not_in_lobby', 403);
  }
  return player;
}

function assertHost(lobby, player) {
  if (!player.host) {
    throw new LobbyError('not_host', 403);
  }
}

function assertRunning(lobby) {
  if (lobby.status === 'over') {
    throw new LobbyError('lobby_over', 409);
  }
  if (lobby.status !== 'running') {
    throw new LobbyError('not_started', 409);
  }
}

/** Do kdy musí být číslo položené. `null` = bez limitu (lehká obtížnost). */
export function deadlineOf(lobby, item) {
  if (lobby.mode !== 'hard' || !lobby.seconds || !item) {
    return null;
  }
  return item.at + lobby.seconds * 1000;
}

/** Číslo, které hráč právě řeší. `null` = čeká se na zadavatele. */
export function pendingOf(lobby, player) {
  if (!player.playing || player.done) {
    return null;
  }
  return lobby.sequence[player.cursor] || null;
}

/* Jak často se do úložiště promítne, že je hráč pořád u toho.
   Klienti se ptají na stav každou vteřinu a půl; kdyby se při každém dotazu
   zapisovalo lobby zpátky, běhal by po síti zápis za zápisem jen kvůli
   jednomu časovému razítku. Zpožděná přítomnost nikomu nevadí. */
export const PRESENCE_WRITE_MS = 10000;

/** Zaznamená, že se hráč ozval. Vrací true, když to stojí za zápis. */
export function touchSeen(player, now = Date.now()) {
  if (now - (player.lastSeenAt || 0) < PRESENCE_WRITE_MS) {
    return false;
  }
  player.lastSeenAt = now;
  return true;
}

function rescore(player) {
  const result = rules.scoreGrid(player.grid);
  player.score = result.total;
  player.lines = result.lines.map((line) => line.points);
}

function activePlayers(lobby) {
  return lobby.players.filter((player) => player.playing && !player.left);
}

function finish(lobby, reason, now = Date.now()) {
  if (lobby.status === 'over') {
    return false;
  }
  lobby.status = 'over';
  lobby.reason = reason || null;
  lobby.finishedAt = now;
  activePlayers(lobby).forEach((player) => {
    rescore(player);
    if (!player.finishedAt) {
      player.finishedAt = now;
    }
    player.done = true;
  });
  return true;
}

/* ------------------------------------------------------------ dorovnání */

/**
 * Srovná lobby s časem: nechá propadnout prošlá čísla, uzavře dohrané hráče
 * a případně ukončí celou hru.
 *
 * Volá se před každou akcí i před každým čtením stavu, takže hra dojde do
 * konce, i když si o to nikdo neřekne — třeba když poslední hráč zavře kartu
 * uprostřed odpočtu.
 *
 * @returns {boolean} změnilo se něco? (podle toho se rozhoduje, jestli má
 *   smysl stav zapisovat zpátky do úložiště)
 */
export function catchUp(lobby, now = Date.now()) {
  if (lobby.status !== 'running') {
    return false;
  }
  let changed = false;

  activePlayers(lobby).forEach((player) => {
    if (player.done) {
      return;
    }

    /* Těžká obtížnost: co se nestihlo do termínu, propadá. Cyklus schválně
       přeskočí i víc čísel naráz — hráč mohl mezitím zavřít kartu. */
    if (lobby.mode === 'hard') {
      let item = lobby.sequence[player.cursor];
      let deadline = deadlineOf(lobby, item);
      while (item && deadline !== null && now > deadline + LATE_GRACE_MS) {
        player.cursor++;
        player.forfeited++;
        changed = true;
        item = lobby.sequence[player.cursor];
        deadline = deadlineOf(lobby, item);
      }
    }

    if (player.placed >= rules.CELLS_TOTAL) {
      player.done = true;
      player.finishedAt = player.finishedAt || now;
      rescore(player);
      changed = true;
      return;
    }

    /* Balíček došel a hráč má frontu prázdnou — víc čísel už nepřijde.
       Uschovaný žolík ho ale drží ve hře: pokládá se mimo řadu čísel, takže
       ho jde uplatnit i po posledním tahu z balíčku. Bez téhle podmínky by
       hráči při dojetí balíčku propadli žolíci v ruce, přestože mu na poli
       zbývalo místo. */
    if (lobby.drained && player.cursor >= lobby.sequence.length && player.jokers <= 0) {
      player.done = true;
      player.finishedAt = player.finishedAt || now;
      rescore(player);
      changed = true;
    }
  });

  const active = activePlayers(lobby);
  if (active.length === 0) {
    return finish(lobby, 'Ve hře nikdo nezůstal.', now) || changed;
  }
  if (active.every((player) => player.done)) {
    const reason = lobby.drained ? 'Balíček je prázdný.' : 'Všichni zaplnili pole.';
    return finish(lobby, reason, now) || changed;
  }
  return changed;
}

/* ------------------------------------------------------------------ akce */

/** Připojí hráče do lobby. Vrací jeho záznam. */
export function addPlayer(lobby, { id, name, token, playing }) {
  if (lobby.status === 'over') {
    throw new LobbyError('lobby_over', 409);
  }
  /* Do rozjeté hry se nedá naskočit: nováček by měl prázdné pole a před sebou
     celou frontu už vytažených čísel, takže by hrál úplně jinou hru než
     ostatní. Zadavatel může po skončení kola dát „Hrát znovu“. */
  if (lobby.status === 'running') {
    throw new LobbyError('already_started', 409);
  }
  if (lobby.players.length >= MAX_PLAYERS) {
    throw new LobbyError('lobby_full', 409);
  }
  const player = newPlayer({ id, name, token, host: false, playing });
  lobby.players.push(player);
  return player;
}

/** Zadavatel spustí hru — teprve tady vzniká balíček. */
export function startLobby(lobby, actor, now = Date.now()) {
  assertHost(lobby, actor);
  if (lobby.status === 'running') {
    throw new LobbyError('already_started', 409);
  }
  if (lobby.status === 'over') {
    throw new LobbyError('lobby_over', 409);
  }
  if (activePlayers(lobby).length === 0) {
    throw new LobbyError('no_players');
  }

  lobby.deck = rules.buildDeck();
  lobby.sequence = [];
  lobby.drained = false;
  lobby.status = 'running';
  lobby.startedAt = now;
  lobby.finishedAt = null;
  lobby.reason = null;
  lobby.lastDrawAt = 0;
  lobby.players.forEach(blankBoard);
  return lobby;
}

/**
 * Zadavatel vytáhne další číslo pro celou skupinu.
 * Prázdný balíček není chyba — hra doběhne, až všichni doloží frontu.
 */
export function drawCard(lobby, actor, now = Date.now()) {
  assertHost(lobby, actor);
  assertRunning(lobby);

  if (now - lobby.lastDrawAt < MIN_DRAW_MS) {
    throw new LobbyError('too_fast', 429);
  }

  if (!lobby.deck.length) {
    lobby.drained = true;
    catchUp(lobby, now);
    return lobby;
  }

  const card = lobby.deck.pop();
  lobby.lastDrawAt = now;
  lobby.sequence.push({
    no: lobby.sequence.length + 1,
    type: card.type === 'joker' ? 'joker' : 'number',
    /* Žolík chodí ven bez hodnoty — tu si každý hráč určí sám při položení. */
    value: card.type === 'joker' ? null : card.value,
    at: now
  });
  catchUp(lobby, now);
  return lobby;
}

/** Smí tenhle hráč právě teď hrát? Dorovná přitom stav s časem. */
function assertLivePlayer(lobby, player, now) {
  assertRunning(lobby);
  if (!player.playing) {
    throw new LobbyError('not_playing', 403);
  }
  catchUp(lobby, now);
  if (lobby.status === 'over' || player.done) {
    throw new LobbyError('player_done', 409);
  }
}

/** Volné políčko [row, col]? Jinak vyhodí chybu. */
function assertFreeCell(player, row, col) {
  if (!Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row > 4 || col < 0 || col > 4) {
    throw new LobbyError('bad_cell');
  }
  if (player.grid[row][col] !== null) {
    throw new LobbyError('cell_taken');
  }
}

/**
 * Položí aktuální číslo na políčko [row, col], obojí 0–4.
 * U žolíka je povinná `value` (1–13) — hodnota platí jenom pro tohohle hráče.
 */
export function placeCard(lobby, player, row, col, value, now = Date.now()) {
  assertLivePlayer(lobby, player, now);

  const item = pendingOf(lobby, player);
  if (!item) {
    throw new LobbyError('nothing_to_place');
  }
  assertFreeCell(player, row, col);

  let placedValue = item.value;
  if (item.type === 'joker') {
    if (!rules.isValue(value)) {
      throw new LobbyError('bad_value');
    }
    placedValue = value;
  }

  player.lastMoveAt = now;
  player.grid[row][col] = placedValue;
  if (item.type === 'joker') {
    player.jokerCells.push([row, col]);
  }
  player.placed++;
  player.cursor++;
  rescore(player);

  catchUp(lobby, now);
  return lobby;
}

/**
 * Uschová vytaženého žolíka na později.
 *
 * Sdílenou řadu čísel to nerozhodí: `cursor` se posune stejně jako při
 * položení, žolík je prostě vyřízený jinak. Rozejde se jen počet zaplněných
 * políček — a ten se srovná ve chvíli, kdy hráč žolíka uplatní.
 */
export function storeJoker(lobby, player, now = Date.now()) {
  assertLivePlayer(lobby, player, now);

  const item = pendingOf(lobby, player);
  if (!item) {
    throw new LobbyError('nothing_to_place');
  }
  if (item.type !== 'joker') {
    throw new LobbyError('not_a_joker');
  }

  player.lastMoveAt = now;
  player.cursor++;
  player.jokers++;
  catchUp(lobby, now);
  return lobby;
}

/**
 * Uplatní uschovaného žolíka na políčko [row, col] s hodnotou `value`.
 *
 * Nespotřebuje číslo z fronty, takže jde uplatnit kdykoli — i když hráč právě
 * drží číslo, i když už balíček došel. Termín těžké obtížnosti se na něj
 * nevztahuje: patří k číslu z řady, a to tenhle žolík není.
 */
export function useStoredJoker(lobby, player, row, col, value, now = Date.now()) {
  assertLivePlayer(lobby, player, now);

  if (player.jokers <= 0) {
    throw new LobbyError('no_jokers');
  }
  if (!rules.isValue(value)) {
    throw new LobbyError('bad_value');
  }
  assertFreeCell(player, row, col);

  player.lastMoveAt = now;
  player.jokers--;
  player.grid[row][col] = value;
  player.jokerCells.push([row, col]);
  player.placed++;
  rescore(player);

  catchUp(lobby, now);
  return lobby;
}

/**
 * Číslo propadlo, protože vypršel čas.
 * Klient si o to říká sám, ale termín si server ověří — jinak by šlo
 * nepohodlná čísla odhazovat a čekat na lepší.
 */
export function skipCard(lobby, player, now = Date.now()) {
  assertRunning(lobby);
  if (!player.playing || player.done) {
    throw new LobbyError('player_done', 409);
  }
  const item = pendingOf(lobby, player);
  if (!item) {
    throw new LobbyError('nothing_to_place');
  }
  const deadline = deadlineOf(lobby, item);
  if (deadline === null) {
    throw new LobbyError('no_time_limit');
  }
  if (now < deadline) {
    throw new LobbyError('too_early');
  }
  player.cursor++;
  player.forfeited++;
  catchUp(lobby, now);
  return lobby;
}

/**
 * Hráč odchází.
 *
 * Odchod zadavatele hru ukončí: čísla by neměl kdo tahat a předávat roli
 * uprostřed rozehrané partie je horší než ji poctivě uzavřít a ukázat pořadí.
 */
export function leaveLobby(lobby, player, now = Date.now()) {
  if (player.host) {
    if (lobby.status === 'running') {
      finish(lobby, 'Zadavatel hru opustil.', now);
    } else {
      lobby.status = 'over';
      lobby.reason = 'Zadavatel lobby zrušil.';
      lobby.finishedAt = now;
    }
    player.left = true;
    return lobby;
  }

  player.left = true;
  if (lobby.status === 'lobby') {
    // v čekárně po odchodu nezůstává ani řádek v seznamu
    lobby.players = lobby.players.filter((item) => item.id !== player.id);
    return lobby;
  }
  if (lobby.status === 'running') {
    rescore(player);
    player.done = true;
    player.finishedAt = player.finishedAt || now;
    catchUp(lobby, now);
  }
  return lobby;
}

/** Zadavatel ukončí hru dřív — body se počítají z toho, co kdo stihl. */
export function finishLobby(lobby, actor, now = Date.now()) {
  assertHost(lobby, actor);
  if (lobby.status !== 'running') {
    throw new LobbyError('not_started', 409);
  }
  finish(lobby, 'Zadavatel hru ukončil.', now);
  return lobby;
}

/** Nové kolo se stejnou sestavou. Kdo odešel, do něj nejde. */
export function restartLobby(lobby, actor, now = Date.now()) {
  assertHost(lobby, actor);
  if (lobby.status !== 'over') {
    throw new LobbyError('still_running', 409);
  }
  if (actor.left) {
    throw new LobbyError('not_in_lobby', 403);
  }
  lobby.players = lobby.players.filter((player) => !player.left);
  lobby.round++;
  lobby.status = 'lobby';
  lobby.finishedAt = null;
  lobby.reason = null;
  lobby.sequence = [];
  lobby.deck = [];
  lobby.drained = false;
  lobby.players.forEach(blankBoard);
  return startLobby(lobby, actor, now);
}

/** Zadavatel přepne, jestli sám hraje, nebo jenom rozdává. */
export function setHostPlaying(lobby, actor, playing) {
  assertHost(lobby, actor);
  if (lobby.status !== 'lobby') {
    throw new LobbyError('already_started', 409);
  }
  actor.playing = playing !== false;
  return lobby;
}

/* ------------------------------------------------------------- výsledky */

/**
 * Pořadí skupiny. Rozhoduje skóre, pak počet zaplněných políček a nakonec
 * čas dokončení. Shodné výsledky sdílí místo — dvě stejná skóre na druhém
 * místě znamenají dvě druhá místa, ne druhé a třetí.
 */
export function standings(lobby) {
  const list = activePlayers(lobby)
    .map((player) => ({
      id: player.id,
      name: player.name,
      score: player.score,
      placed: player.placed,
      forfeited: player.forfeited,
      host: player.host,
      durationMs: (player.finishedAt || lobby.finishedAt || Date.now()) -
        (lobby.startedAt || lobby.createdAt)
    }))
    .sort((a, b) => {
      if (a.score !== b.score) {
        return b.score - a.score;
      }
      if (a.placed !== b.placed) {
        return b.placed - a.placed;
      }
      return a.durationMs - b.durationMs;
    });

  let rank = 0;
  let previous = null;
  return list.map((entry, index) => {
    if (!previous || previous.score !== entry.score || previous.placed !== entry.placed) {
      rank = index + 1;
    }
    previous = entry;
    return Object.assign({ rank }, entry);
  });
}

/* ------------------------------------------------------------- pohled ven */

/**
 * Co smí vidět klient. Balíček tu schválně není — ven jde jenom počet
 * zbývajících karet, aby nikdo nemohl hrát se znalostí toho, co přijde.
 *
 * @param {Object} lobby
 * @param {string} [viewerId] pro koho se stav skládá — jeho pole je v `me`
 */
export function publicLobby(lobby, viewerId) {
  const viewer = viewerId ? findPlayer(lobby, viewerId) : null;
  const now = Date.now();
  const last = lobby.sequence[lobby.sequence.length - 1] || null;

  const view = {
    code: lobby.code,
    status: lobby.status,
    mode: lobby.mode,
    seconds: lobby.seconds,
    hostId: lobby.hostId,
    round: lobby.round,
    drawn: lobby.sequence.length,
    remaining: lobby.deck.length,
    drained: lobby.drained,
    /* Poslední vytažené číslo — zadavatel podle něj vidí, co právě rozdal,
       i když sám nehraje. */
    last: last ? {
      no: last.no,
      type: last.type,
      value: last.value,
      at: last.at,
      deadline: deadlineOf(lobby, last)
    } : null,
    players: lobby.players.map((player) => ({
      id: player.id,
      name: player.name,
      host: player.host,
      playing: player.playing,
      left: player.left,
      placed: player.placed,
      score: player.score,
      jokers: player.jokers || 0,
      forfeited: player.forfeited,
      done: player.done,
      /* Čeká hráč na další číslo, nebo ještě dohání frontu? Zadavatel podle
         toho pozná, jestli má smysl táhnout dál. */
      behind: player.playing && !player.done
        ? Math.max(0, lobby.sequence.length - player.cursor)
        : 0
    })),
    now,
    startedAt: lobby.startedAt,
    finishedAt: lobby.finishedAt,
    reason: lobby.reason,
    standings: lobby.status === 'over' ? standings(lobby) : null
  };

  if (viewer) {
    const item = pendingOf(lobby, viewer);
    view.me = {
      id: viewer.id,
      name: viewer.name,
      host: viewer.host,
      playing: viewer.playing,
      grid: viewer.grid,
      jokerCells: viewer.jokerCells,
      placed: viewer.placed,
      score: viewer.score,
      lines: viewer.lines,
      jokers: viewer.jokers || 0,
      cursor: viewer.cursor,
      forfeited: viewer.forfeited,
      done: viewer.done,
      pending: item ? { no: item.no, type: item.type, value: item.value } : null,
      /* Odpočet řídí server: klient jen dopočítá rozdíl proti `now` výše,
         takže přetočené hodiny v počítači na termín nemají vliv. */
      deadline: deadlineOf(lobby, item)
    };
  }

  return view;
}

/* ------------------------------------------------------------- rozcestník */

/**
 * Provede akci nad stavem lobby.
 * @param {Object} lobby  stav z úložiště (mutuje se)
 * @param {Object} player ověřený hráč (viz authPlayer)
 * @param {Object} body   { action, row, col, value, playing }
 */
export function apply(lobby, player, body) {
  const now = Date.now();
  switch (body.action) {
    case 'start':
      return startLobby(lobby, player, now);
    case 'draw':
      return drawCard(lobby, player, now);
    case 'place':
      return placeCard(lobby, player, body.row, body.col, body.value, now);
    case 'storejoker':
      return storeJoker(lobby, player, now);
    case 'usejoker':
      return useStoredJoker(lobby, player, body.row, body.col, body.value, now);
    case 'timeout':
      return skipCard(lobby, player, now);
    case 'leave':
      return leaveLobby(lobby, player, now);
    case 'finish':
      return finishLobby(lobby, player, now);
    case 'restart':
      return restartLobby(lobby, player, now);
    case 'hostplaying':
      return setHostPlaying(lobby, player, body.playing);
    case 'state':
      catchUp(lobby, now);
      return lobby;
    default:
      throw new LobbyError('unknown_action');
  }
}

export { rules };
