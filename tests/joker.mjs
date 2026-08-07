/* Scénář, na který si stěžoval hráč: uschovaný žolík propadl a hra sama
   vylosovala 25. kartu.

   Testuje se přesně to pravidlo, které v js/ranked.js chybělo — než se
   natáhne další karta, musí se ověřit, jestli zbývá dost volných políček
   i pro žolíky v ruce. Rozhodnutí je klientské, ale spočítat se dá
   ze stavu, který posílá server, takže ho jde otestovat i tady. */

import assert from 'node:assert/strict';
import {
  emptyRun, publicState, apply, draw, place, answerJoker, useStoredJoker, rules
} from '../netlify/functions/lib/run.mjs';

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

function unpace(run) {
  run.lastMoveAt = 0;
  return run;
}

/** Balíček se dvěma žolíky na vrchu — pop() je vytáhne jako první dva. */
function runWithJokersOnTop() {
  const run = emptyRun({ id: 't', mode: 'easy', playerId: 'p' });
  const jokers = run.deck.filter((card) => card.type === 'joker');
  run.deck = run.deck.filter((card) => card.type !== 'joker').concat(jokers);
  return run;
}

function firstFreeCell(run) {
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 5; c++) {
      if (run.grid[r][c] === null) {
        return [r, c];
      }
    }
  }
  return null;
}

/** Pravidlo z js/ranked.js — zbývá tolik políček, kolik mám žolíků? */
function jokersWouldBeLost(state) {
  return state.jokers > 0 && rules.CELLS_TOTAL - state.placed <= state.jokers;
}

test('uschované žolíky se dají uplatnit až do posledního políčka', () => {
  const run = runWithJokersOnTop();

  // dva žolíky hned na začátku, oba do ruky
  unpace(run);
  draw(run);
  assert.equal(run.awaitingJoker, true, 'první karta má být žolík');
  unpace(run);
  answerJoker(run, 'later');
  assert.equal(run.awaitingJoker, true, 'druhá karta má být taky žolík');
  unpace(run);
  answerJoker(run, 'later');
  assert.equal(run.jokers, 2, 'v ruce mají být dva žolíci');
  assert.ok(run.pending, 'po uschování se má rovnou táhnout dál');

  let prompts = 0;
  let guard = 0;
  while (!run.over && guard++ < 200) {
    unpace(run);

    if (run.pending) {
      const cell = firstFreeCell(run);
      place(run, cell[0], cell[1]);
      continue;
    }

    // tady se klient ptá, jestli neuplatnit žolíka
    if (jokersWouldBeLost(publicState(run))) {
      prompts++;
      useStoredJoker(run, 7);
      continue;
    }

    draw(run);
    if (run.awaitingJoker) {
      answerJoker(run, 'now', 7);
    }
  }

  assert.equal(run.over, true);
  assert.equal(run.placed, rules.CELLS_TOTAL, 'pole má být plné');
  assert.equal(run.jokers, 0, 'v ruce nesmí zůstat nevyužitý žolík');
  assert.equal(prompts, 2, 'na oba žolíky se má hra zeptat');
  assert.equal(run.jokerCells.length, 2, 'oba žolíci mají ležet na poli');
});

test('bez připomenutí by poslední žolík propadl', () => {
  const run = runWithJokersOnTop();
  unpace(run);
  draw(run);
  unpace(run);
  answerJoker(run, 'later');
  unpace(run);
  answerJoker(run, 'later');

  // tentýž průběh, ale kontrola se schválně vynechá — takhle se hra chovala
  let guard = 0;
  while (!run.over && guard++ < 200) {
    unpace(run);
    if (run.pending) {
      const cell = firstFreeCell(run);
      place(run, cell[0], cell[1]);
      continue;
    }
    draw(run);
    if (run.awaitingJoker) {
      answerJoker(run, 'now', 7);
    }
  }

  assert.equal(run.placed, rules.CELLS_TOTAL);
  assert.equal(run.jokers, 2, 'oba žolíci propadli — přesně ten nahlášený bug');
});

test('pravidlo se spustí přesně tehdy, když volná políčka dojdou žolíkům', () => {
  const state = { jokers: 1, placed: 23 };
  assert.equal(jokersWouldBeLost(state), false, 'při 2 volných a 1 žolíku ještě ne');
  assert.equal(jokersWouldBeLost({ jokers: 1, placed: 24 }), true, 'při 1 volném a 1 žolíku ano');
  assert.equal(jokersWouldBeLost({ jokers: 2, placed: 23 }), true, 'při 2 volných a 2 žolících ano');
  assert.equal(jokersWouldBeLost({ jokers: 0, placed: 24 }), false, 'bez žolíků nikdy');
});

/* --------------------------------------------------- náhrobek dohrané partie */

/* Simulace toho, co dělá netlify/functions/hra.mjs — bez Netlify a bez Blobs.
   Ověřuje se chování, na které si hráč stěžoval: klik s poslední kartou
   vrátil „Partie na serveru už není“, protože se partie hned po dohrání
   z úložiště mazala a opožděný nebo zopakovaný požadavek narazil na prázdno. */
function makeServer() {
  const store = new Map();
  return {
    store,
    /** zápis do žebříčku — v testu se dá vyměnit za takový, co spadne */
    submit() {
      return { all: 1 };
    },
    start() {
      const run = emptyRun({ id: 'r1', mode: 'easy', playerId: 'p1' });
      run.publish = true;
      run.name = 'Tester';
      store.set(run.id, run);
      return run;
    },
    step(id, body) {
      const stored = store.get(id);
      if (!stored) {
        return { status: 404, error: 'run_not_found' };
      }
      if (stored.tombstone) {
        return { status: 200, state: stored.state, placements: stored.placements };
      }
      stored.lastMoveAt = 0;
      apply(stored, body);
      if (!stored.over) {
        return { status: 200, state: publicState(stored) };
      }
      /* Stejné pořadí jako v netlify/functions/hra.mjs: náhrobek první,
         žebříček až po něm — a jeho selhání partii nezruší. */
      const state = publicState(stored);
      store.set(id, { id, tombstone: true, state, placements: null, finishedAt: stored.finishedAt });

      let placements = null;
      let boardFailed = false;
      try {
        placements = this.submit();
        store.set(id, { id, tombstone: true, state, placements, finishedAt: stored.finishedAt });
      } catch (err) {
        boardFailed = true;
      }
      return { status: 200, state, placements, boardFailed: boardFailed || undefined };
    }
  };
}

function playToLastCell(server, run) {
  let guard = 0;
  while (run.placed < rules.CELLS_TOTAL - 1 && guard++ < 300) {
    run.lastMoveAt = 0;
    if (!run.pending) {
      draw(run);
      if (run.awaitingJoker) {
        answerJoker(run, 'now', 7);
      }
      continue;
    }
    const cell = firstFreeCell(run);
    place(run, cell[0], cell[1]);
  }
  // poslední karta zůstane v ruce
  if (!run.pending) {
    run.lastMoveAt = 0;
    draw(run);
    if (run.awaitingJoker) {
      answerJoker(run, 'now', 7);
    }
  }
  return run;
}

test('poslední karta: opakovaný požadavek nespadne na run_not_found', () => {
  const server = makeServer();
  const run = server.start();
  playToLastCell(server, run);
  assert.equal(run.placed, rules.CELLS_TOTAL - 1, 'má zbývat poslední políčko');
  assert.ok(run.pending, 'poslední karta má být v ruce');

  const cell = firstFreeCell(run);
  const first = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  assert.equal(first.status, 200);
  assert.equal(first.state.over, true, 'partie má skončit');
  assert.equal(first.state.placed, rules.CELLS_TOTAL);

  // tentýž tah znovu — výpadek linky, druhý klik, opakování prohlížečem
  const again = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  assert.equal(again.status, 200, 'opakování nesmí vrátit 404');
  assert.equal(again.error, undefined);
  assert.equal(again.state.over, true);
  assert.equal(again.state.score, first.state.score, 'skóre musí sedět s prvním pokusem');
});

test('náhrobek neobsahuje karty, takže se z něj nedá nic přehrát', () => {
  const server = makeServer();
  const run = server.start();
  playToLastCell(server, run);
  const cell = firstFreeCell(run);
  server.step('r1', { action: 'place', row: cell[0], col: cell[1] });

  const tomb = server.store.get('r1');
  assert.equal(tomb.tombstone, true);
  assert.equal(tomb.deck, undefined, 'v náhrobku nesmí zůstat balíček');
  assert.equal(JSON.stringify(tomb).includes('"type":"number"'), false);

  // další akce vrací pořád tentýž koncový stav, ne novou hru
  const after = server.step('r1', { action: 'draw' });
  assert.equal(after.status, 200);
  assert.equal(after.state.over, true);
  assert.equal(after.state.placed, rules.CELLS_TOTAL);
});

test('žebříček se zapíše jednou, ne při každém opakování', () => {
  const server = makeServer();
  const run = server.start();
  playToLastCell(server, run);
  const cell = firstFreeCell(run);
  const first = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  const again = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  // druhé volání jen přečte uložený náhrobek — nový zápis nevzniká
  assert.deepEqual(again.placements, first.placements);
});

test('partie se dohraje i tehdy, když žebříček zápis odmítne', () => {
  const server = makeServer();
  server.submit = function () {
    throw new Error('board_busy');      // přesně to, co dělalo úložiště bez ETagu
  };
  const run = server.start();
  playToLastCell(server, run);
  const cell = firstFreeCell(run);

  const result = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  assert.equal(result.status, 200, 'selhání žebříčku nesmí shodit poslední tah');
  assert.equal(result.state.over, true, 'partie je dohraná');
  assert.equal(result.state.placed, rules.CELLS_TOTAL, 'poslední karta leží na poli');
  assert.equal(result.boardFailed, true, 'hráč se má dozvědět, že zápis nevyšel');

  // a hlavně: partie na serveru zůstala dohraná, ne rozehraná
  const again = server.step('r1', { action: 'place', row: cell[0], col: cell[1] });
  assert.equal(again.status, 200);
  assert.equal(again.state.placed, rules.CELLS_TOTAL);
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
