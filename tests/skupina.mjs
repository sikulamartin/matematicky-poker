/* Testy stavového automatu skupinové hry.
   Běží čistě v Node — lib/lobby.mjs schválně nesahá na síť ani na úložiště,
   takže se dá odehrát celé kolo bez Netlify.

   Spuštění: npm test */

import assert from 'node:assert/strict';
import {
  emptyLobby, addPlayer, startLobby, drawCard, placeCard, skipCard,
  storeJoker, useStoredJoker,
  leaveLobby, finishLobby, restartLobby, setHostPlaying, catchUp,
  publicLobby, standings, authPlayer, findPlayer, pendingOf, apply,
  LobbyError, MAX_PLAYERS, rules
} from '../netlify/functions/lib/lobby.mjs';

let passed = 0;
let failed = 0;

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + err.message);
  }
}

function expectError(code, fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof LobbyError, 'čekal LobbyError, přišlo: ' + err);
    assert.equal(err.code, code);
    return err;
  }
  throw new Error('čekal chybu ' + code + ', ale prošlo to');
}

/** Lobby se zadavatelem a jedním hostem, oba hrají. */
function newLobby(mode = 'easy', seconds = null) {
  const lobby = emptyLobby({
    code: 'ABCDE',
    mode,
    seconds,
    hostId: 'host',
    hostToken: 't-host',
    hostName: 'Zadavatel',
    hostPlays: true
  });
  addPlayer(lobby, { id: 'guest', name: 'Host', token: 't-guest' });
  return lobby;
}

/** Obejde brzdu MIN_DRAW_MS — testy nemají čekat čtvrt vteřiny na číslo. */
function unpace(lobby) {
  lobby.lastDrawAt = 0;
  return lobby;
}

/**
 * Vytáhne známé číslo.
 * Balíček je zamíchaný, takže „vytáhni a polož“ by jednou za čas narazilo na
 * žolíka a test by spadl na chybějící hodnotě. Karta se proto nastrčí navrch.
 */
function drawValue(lobby, value = 5) {
  lobby.deck.push({ type: 'number', value });
  unpace(lobby);
  return drawCard(lobby, host(lobby));
}

function host(lobby) {
  return findPlayer(lobby, 'host');
}

function guest(lobby) {
  return findPlayer(lobby, 'guest');
}

/** Položí hráči aktuální číslo na první volné políčko. */
function placeAnywhere(lobby, player, value = 7) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (player.grid[r][c] === null) {
        return placeCard(lobby, player, r, c, value);
      }
    }
  }
  throw new Error('pole je plné');
}

/* ------------------------------------------------------------ založení */

test('nové lobby čeká a má v sestavě zadavatele', () => {
  const lobby = newLobby();
  assert.equal(lobby.status, 'lobby');
  assert.equal(lobby.players.length, 2);
  assert.equal(host(lobby).host, true);
  assert.equal(guest(lobby).host, false);
  assert.equal(lobby.deck.length, 0, 'balíček vzniká až při spuštění');
});

test('do rozjeté hry se připojit nedá', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  expectError('already_started', () => {
    addPlayer(lobby, { id: 'pozdni', name: 'Pozdní', token: 't' });
  });
});

test('lobby má strop na počet hráčů', () => {
  const lobby = newLobby();
  for (let i = lobby.players.length; i < MAX_PLAYERS; i++) {
    addPlayer(lobby, { id: 'p' + i, name: 'Hráč ' + i, token: 't' + i });
  }
  expectError('lobby_full', () => {
    addPlayer(lobby, { id: 'navic', name: 'Navíc', token: 't' });
  });
});

test('token rozhoduje, kdo je kdo', () => {
  const lobby = newLobby();
  assert.equal(authPlayer(lobby, 'guest', 't-guest').id, 'guest');
  expectError('not_in_lobby', () => authPlayer(lobby, 'guest', 't-host'));
  expectError('not_in_lobby', () => authPlayer(lobby, 'nikdo', 't-guest'));
});

/* -------------------------------------------------------------- průběh */

test('hru spouští jenom zadavatel', () => {
  const lobby = newLobby();
  expectError('not_host', () => startLobby(lobby, guest(lobby)));
  startLobby(lobby, host(lobby));
  assert.equal(lobby.status, 'running');
  assert.equal(lobby.deck.length, rules.DECK_SIZE);
});

test('spustit hru bez hráčů nejde', () => {
  const lobby = emptyLobby({
    code: 'AAAAA', mode: 'easy', hostId: 'host', hostToken: 't',
    hostName: 'Zadavatel', hostPlays: false
  });
  expectError('no_players', () => startLobby(lobby, host(lobby)));
});

test('čísla tahá jenom zadavatel a dostanou je všichni', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  expectError('not_host', () => drawCard(lobby, guest(lobby)));

  drawCard(lobby, host(lobby));
  assert.equal(lobby.sequence.length, 1);
  assert.deepEqual(pendingOf(lobby, host(lobby)), lobby.sequence[0]);
  assert.deepEqual(pendingOf(lobby, guest(lobby)), lobby.sequence[0]);
});

test('brzda na tažení drží', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawCard(lobby, host(lobby));
  expectError('too_fast', () => drawCard(lobby, host(lobby)));
});

test('položené číslo mění jenom vlastní pole', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawValue(lobby, 11);
  const value = lobby.sequence[0].value;

  placeCard(lobby, guest(lobby), 2, 3);
  assert.equal(guest(lobby).grid[2][3], value);
  assert.equal(host(lobby).grid[2][3], null);
  assert.equal(guest(lobby).cursor, 1);
  assert.equal(host(lobby).cursor, 0);
});

test('bez vytaženého čísla se pokládat nedá', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  expectError('nothing_to_place', () => placeCard(lobby, guest(lobby), 0, 0));
});

test('obsazené políčko a políčko mimo pole se odmítnou', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawValue(lobby);
  placeCard(lobby, guest(lobby), 0, 0);
  drawValue(lobby);
  expectError('cell_taken', () => placeCard(lobby, guest(lobby), 0, 0));
  expectError('bad_cell', () => placeCard(lobby, guest(lobby), 5, 0));
});

test('pomalý hráč dohání frontu popořadě', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  for (let i = 0; i < 3; i++) {
    unpace(lobby);
    drawCard(lobby, host(lobby));
  }
  const view = publicLobby(lobby, 'guest');
  assert.equal(view.drawn, 3);
  assert.equal(view.me.pending.no, 1, 'hráč řeší první číslo, ne poslední');
  assert.equal(view.players.find((p) => p.id === 'guest').behind, 3);

  placeAnywhere(lobby, guest(lobby));
  assert.equal(pendingOf(lobby, guest(lobby)).no, 2);
});

test('žolík chodí bez hodnoty a každý si ji určí sám', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  // žolíka postavíme na vrch balíčku, ať na něj nemusíme čekat
  lobby.deck.push({ type: 'joker', value: null });
  unpace(lobby);
  drawCard(lobby, host(lobby));

  assert.equal(lobby.sequence[0].type, 'joker');
  assert.equal(lobby.sequence[0].value, null);
  expectError('bad_value', () => placeCard(lobby, guest(lobby), 0, 0));
  expectError('bad_value', () => placeCard(lobby, guest(lobby), 0, 0, 14));

  placeCard(lobby, guest(lobby), 0, 0, 9);
  placeCard(lobby, host(lobby), 1, 1, 4);
  assert.equal(guest(lobby).grid[0][0], 9);
  assert.equal(host(lobby).grid[1][1], 4);
  assert.deepEqual(guest(lobby).jokerCells, [[0, 0]]);
});

/* ------------------------------------------------------------- žolíci */

/** Nastrčí žolíka navrch balíčku a vytáhne ho pro celou skupinu. */
function drawJoker(lobby) {
  lobby.deck.push({ type: 'joker', value: null });
  unpace(lobby);
  return drawCard(lobby, host(lobby));
}

test('uschovaný žolík posune frontu, ale nezaplní políčko', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);

  storeJoker(lobby, guest(lobby));
  assertjokers(guest(lobby), 1);
  assert.equal(guest(lobby).placed, 0);
  assert.equal(guest(lobby).cursor, 1);
  assert.equal(pendingOf(lobby, guest(lobby)), null, 'žolík je vyřízený');
});

function assertjokers(player, count) {
  assert.equal(player.jokers, count, 'žolíků v ruce');
}

test('uschování nerozhodí sdílenou řadu čísel', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);

  storeJoker(lobby, guest(lobby));
  placeCard(lobby, host(lobby), 0, 0, 9);
  assert.equal(guest(lobby).cursor, host(lobby).cursor, 'oba mají vyřízený jeden tah');

  drawValue(lobby, 3);
  assert.equal(pendingOf(lobby, guest(lobby)).no, 2);
  assert.equal(pendingOf(lobby, host(lobby)).no, 2);
});

test('uschovat jde jenom žolíka', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawValue(lobby, 8);
  expectError('not_a_joker', () => storeJoker(lobby, guest(lobby)));
});

test('uschovaný žolík se uplatní na volné políčko', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);
  storeJoker(lobby, guest(lobby));

  expectError('bad_value', () => useStoredJoker(lobby, guest(lobby), 1, 1, 20));
  useStoredJoker(lobby, guest(lobby), 1, 1, 6);

  assert.equal(guest(lobby).grid[1][1], 6);
  assert.deepEqual(guest(lobby).jokerCells, [[1, 1]]);
  assert.equal(guest(lobby).placed, 1);
  assert.equal(guest(lobby).cursor, 1, 'žolík z ruky nespotřebuje číslo z fronty');
  assertjokers(guest(lobby), 0);
  expectError('no_jokers', () => useStoredJoker(lobby, guest(lobby), 2, 2, 6));
});

test('žolíka z ruky jde uplatnit i s číslem v ruce', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);
  storeJoker(lobby, guest(lobby));
  drawValue(lobby, 4);

  useStoredJoker(lobby, guest(lobby), 0, 0, 11);
  assert.equal(guest(lobby).grid[0][0], 11);
  assert.equal(pendingOf(lobby, guest(lobby)).value, 4, 'číslo ve frontě zůstalo');

  placeCard(lobby, guest(lobby), 0, 1);
  assert.equal(guest(lobby).grid[0][1], 4);
  assert.equal(guest(lobby).placed, 2);
});

test('obsazené políčko odmítne i žolíka z ruky', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);
  storeJoker(lobby, guest(lobby));
  drawValue(lobby, 4);
  placeCard(lobby, guest(lobby), 3, 3);
  expectError('cell_taken', () => useStoredJoker(lobby, guest(lobby), 3, 3, 6));
});

test('prázdný balíček nechá hráče se žolíkem ve hře', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  lobby.deck = [];
  drawJoker(lobby);                    // žolík je poslední karta
  storeJoker(lobby, guest(lobby));
  placeCard(lobby, host(lobby), 0, 0, 5);

  unpace(lobby);
  drawCard(lobby, host(lobby));        // balíček došel
  assert.equal(lobby.drained, true);
  assert.equal(host(lobby).done, true, 'zadavatel nemá co hrát');
  assert.equal(guest(lobby).done, false, 'host má ještě žolíka v ruce');
  assert.equal(lobby.status, 'running');

  useStoredJoker(lobby, guest(lobby), 4, 4, 2);
  assert.equal(lobby.status, 'over');
  assert.equal(lobby.reason, 'Balíček je prázdný.');
});

test('v těžké obtížnosti propadne i nevyřízený žolík', () => {
  const lobby = newLobby('hard', 5);
  startLobby(lobby, host(lobby));
  drawJoker(lobby);

  lobby.sequence[0].at = Date.now() - 60000;
  catchUp(lobby);
  assert.equal(guest(lobby).forfeited, 1);
  assertjokers(guest(lobby), 0);
  expectError('nothing_to_place', () => storeJoker(lobby, guest(lobby)));
});

test('nové kolo vyprázdní i ruku', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);
  storeJoker(lobby, guest(lobby));
  finishLobby(lobby, host(lobby));
  restartLobby(lobby, host(lobby));
  assertjokers(guest(lobby), 0);
});

test('žolíci v ruce jdou ven jako počet, ne jako karty', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawJoker(lobby);
  storeJoker(lobby, guest(lobby));

  const view = publicLobby(lobby, 'guest');
  assert.equal(view.me.jokers, 1);
  assert.equal(view.players.find((p) => p.id === 'guest').jokers, 1);
});

test('skóre se počítá průběžně podle sdílených pravidel', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  // řádek 0: pět stejných čísel = pětice
  for (let c = 0; c < 5; c++) {
    lobby.deck.push({ type: 'number', value: 7 });
    unpace(lobby);
    drawCard(lobby, host(lobby));
    placeCard(lobby, guest(lobby), 0, c);
  }
  assert.equal(guest(lobby).grid[0].join(','), '7,7,7,7,7');
  assert.ok(guest(lobby).score >= 125, 'pětice má dát aspoň 125 bodů');
  assert.equal(guest(lobby).lines.length, rules.LINES_TOTAL);
});

/* ------------------------------------------------------ těžká obtížnost */

test('propadlé číslo se v těžké obtížnosti přeskočí', () => {
  const lobby = newLobby('hard', 5);
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));

  // číslo vytažené před minutou už nikdo položit nemůže
  lobby.sequence[0].at = Date.now() - 60000;
  const changed = catchUp(lobby);
  assert.equal(changed, true);
  assert.equal(guest(lobby).cursor, 1);
  assert.equal(guest(lobby).forfeited, 1);
  assert.equal(guest(lobby).placed, 0);
});

test('propadlé číslo spotřebuje políčko — hráč dohraje dřív', () => {
  const lobby = newLobby('hard', 5);
  startLobby(lobby, host(lobby));

  // 24 políček zaplněných, poslední místo čeká
  const player = guest(lobby);
  for (let i = 0; i < 24; i++) {
    player.grid[Math.floor(i / 5)][i % 5] = 5;
  }
  player.placed = 24;

  unpace(lobby);
  drawCard(lobby, host(lobby));
  lobby.sequence[player.cursor].at = Date.now() - 60000;
  catchUp(lobby);

  assert.equal(player.forfeited, 1);
  assert.equal(player.placed, 24);
  assert.equal(player.done, true, 'poslední políčko propadlo, hráč dohrál');
  assert.equal(player.grid[4][4], null, 'políčko zůstává prázdné');
});

test('propadnutí před termínem server odmítne', () => {
  const lobby = newLobby('hard', 60);
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));
  expectError('too_early', () => skipCard(lobby, guest(lobby)));
});

test('v lehké obtížnosti nic nepropadá', () => {
  const lobby = newLobby('easy');
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));
  lobby.sequence[0].at = Date.now() - 600000;
  catchUp(lobby);
  assert.equal(guest(lobby).cursor, 0);
  expectError('no_time_limit', () => skipCard(lobby, guest(lobby)));
});

/* --------------------------------------------------------------- konec */

test('hra končí, když všichni zaplní pole', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  for (let i = 0; i < rules.CELLS_TOTAL; i++) {
    unpace(lobby);
    drawCard(lobby, host(lobby));
    placeAnywhere(lobby, host(lobby));
    placeAnywhere(lobby, guest(lobby));
  }
  assert.equal(lobby.status, 'over');
  assert.equal(host(lobby).placed, 25);
  assert.equal(guest(lobby).placed, 25);
  assert.equal(standings(lobby).length, 2);
});

test('prázdný balíček hru ukončí, až všichni doloží frontu', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  lobby.deck = [{ type: 'number', value: 5 }];
  unpace(lobby);
  drawCard(lobby, host(lobby));       // poslední karta z balíčku
  unpace(lobby);
  drawCard(lobby, host(lobby));       // balíček došel
  assert.equal(lobby.drained, true);
  assert.equal(lobby.status, 'running', 'hosté mají číslo ve frontě');

  placeAnywhere(lobby, host(lobby));
  assert.equal(lobby.status, 'running');
  placeAnywhere(lobby, guest(lobby));
  assert.equal(lobby.status, 'over');
  assert.equal(lobby.reason, 'Balíček je prázdný.');
});

test('zadavatel může hru ukončit dřív', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  expectError('not_host', () => finishLobby(lobby, guest(lobby)));
  finishLobby(lobby, host(lobby));
  assert.equal(lobby.status, 'over');
  assert.equal(lobby.reason, 'Zadavatel hru ukončil.');
  expectError('lobby_over', () => drawCard(lobby, host(lobby)));
});

test('odchod zadavatele hru uzavře, odchod hráče ne', () => {
  const lobby = newLobby();
  addPlayer(lobby, { id: 'treti', name: 'Třetí', token: 't3' });
  startLobby(lobby, host(lobby));

  leaveLobby(lobby, findPlayer(lobby, 'treti'));
  assert.equal(lobby.status, 'running');
  assert.equal(standings(lobby).length, 2, 'kdo odešel, do pořadí nejde');

  leaveLobby(lobby, host(lobby));
  assert.equal(lobby.status, 'over');
});

test('pořadí řadí podle bodů a shodu sdílí', () => {
  const lobby = newLobby();
  addPlayer(lobby, { id: 'treti', name: 'Třetí', token: 't3' });
  startLobby(lobby, host(lobby));
  host(lobby).score = 200;
  host(lobby).placed = 25;
  guest(lobby).score = 100;
  guest(lobby).placed = 20;
  findPlayer(lobby, 'treti').score = 100;
  findPlayer(lobby, 'treti').placed = 20;

  const table = standings(lobby);
  assert.deepEqual(table.map((row) => row.rank), [1, 2, 2]);
  assert.equal(table[0].id, 'host');
});

test('nové kolo vynuluje pole a nechá sestavu', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));
  placeAnywhere(lobby, guest(lobby));
  finishLobby(lobby, host(lobby));

  restartLobby(lobby, host(lobby));
  assert.equal(lobby.status, 'running');
  assert.equal(lobby.round, 2);
  assert.equal(lobby.players.length, 2);
  assert.equal(guest(lobby).placed, 0);
  assert.equal(guest(lobby).cursor, 0);
  assert.equal(lobby.sequence.length, 0);
  assert.equal(lobby.deck.length, rules.DECK_SIZE);
});

test('nové kolo jde spustit až po konci', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  expectError('still_running', () => restartLobby(lobby, host(lobby)));
});

test('zadavatel může jenom rozdávat', () => {
  const lobby = newLobby();
  setHostPlaying(lobby, host(lobby), false);
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));
  assert.equal(pendingOf(lobby, host(lobby)), null);
  expectError('not_playing', () => placeCard(lobby, host(lobby), 0, 0));

  for (let i = 0; i < rules.CELLS_TOTAL; i++) {
    unpace(lobby);
    if (i > 0) {
      drawCard(lobby, host(lobby));
    }
    placeAnywhere(lobby, guest(lobby));
  }
  assert.equal(lobby.status, 'over', 'stačí, že dohráli hrající');
  assert.equal(standings(lobby).length, 1);
});

/* ----------------------------------------------------------- pohled ven */

test('klient nikdy nevidí balíček', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  unpace(lobby);
  drawCard(lobby, host(lobby));
  const view = publicLobby(lobby, 'guest');
  const raw = JSON.stringify(view);

  assert.equal(view.deck, undefined);
  assert.equal(view.remaining, rules.DECK_SIZE - 1);
  assert.ok(!raw.includes('"deck"'), 'v odpovědi nesmí být balíček');
  assert.ok(!raw.includes('t-host'), 'ani cizí token');
  assert.ok(!raw.includes('t-guest'), 'ani vlastní token');
});

test('cizí pole ven nejde', () => {
  const lobby = newLobby();
  startLobby(lobby, host(lobby));
  drawValue(lobby);
  placeCard(lobby, host(lobby), 4, 4);

  const view = publicLobby(lobby, 'guest');
  assert.equal(view.me.id, 'guest');
  assert.equal(view.players.length, 2);
  assert.ok(view.players.every((player) => player.grid === undefined),
    'v sestavě je skóre, ne rozehrané pole');
});

test('rozcestník apply zná jen povolené akce', () => {
  const lobby = newLobby();
  expectError('unknown_action', () => apply(lobby, host(lobby), { action: 'hack' }));
  apply(lobby, host(lobby), { action: 'start' });
  assert.equal(lobby.status, 'running');
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
