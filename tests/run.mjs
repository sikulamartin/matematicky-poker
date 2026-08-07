/* Testy serverového automatu partie.
   Běží čistě v Node — lib/run.mjs schválně nesahá na síť ani na úložiště,
   takže se dá odehrát celá partie bez Netlify.

   Spuštění: npm test */

import assert from 'node:assert/strict';
import {
  emptyRun, publicState, apply, draw, place, answerJoker, useStoredJoker,
  RunError, rules
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

function newRun(mode = 'easy') {
  const run = emptyRun({ id: 'test', mode, playerId: 'p1' });
  run.name = 'Tester';
  run.publish = true;
  return run;
}

/** Obejde brzdu MIN_MOVE_MS — testy nemají čekat 120 ms na každý tah. */
function unpace(run) {
  run.lastMoveAt = 0;
  return run;
}

function expectError(code, fn) {
  try {
    fn();
  } catch (err) {
    assert.ok(err instanceof RunError, 'čekal RunError, přišlo: ' + err);
    assert.equal(err.code, code);
    return err;
  }
  throw new Error('čekal chybu ' + code + ', ale prošlo to');
}

/** Odehraje celou partii: táhne a pokládá na první volné políčko. */
function playThrough(run) {
  let guard = 0;
  while (!run.over && guard++ < 400) {
    unpace(run);
    if (run.awaitingJoker) {
      answerJoker(run, 'now', 7);
      continue;
    }
    if (!run.pending) {
      if (run.deck.length === 0 && run.jokers > 0) {
        useStoredJoker(run, 7);
        continue;
      }
      draw(run);
      continue;
    }
    let done = false;
    for (let r = 0; r < 5 && !done; r++) {
      for (let c = 0; c < 5 && !done; c++) {
        if (run.grid[r][c] === null) {
          place(run, r, c);
          done = true;
        }
      }
    }
  }
  return run;
}

/* ------------------------------------------------------ balíček a pole */

test('nová partie má 54 karet a prázdné pole', () => {
  const run = newRun();
  assert.equal(run.deck.length, rules.DECK_SIZE);
  assert.equal(run.placed, 0);
  assert.equal(run.score, 0);
  assert.equal(run.grid.flat().filter((v) => v !== null).length, 0);
});

test('balíček má 4× každou hodnotu a 2 žolíky', () => {
  const run = newRun();
  const counts = {};
  run.deck.forEach((card) => {
    const key = card.type === 'joker' ? 'joker' : card.value;
    counts[key] = (counts[key] || 0) + 1;
  });
  assert.equal(counts.joker, rules.JOKERS);
  rules.VALUES.forEach((value) => assert.equal(counts[value], rules.COPIES));
});

/* --------------------------------------------------- co klient nevidí */

test('publicState neposílá zbytek balíčku', () => {
  const run = newRun();
  const state = publicState(run);
  assert.equal(state.deck, undefined);
  assert.equal(typeof state.remaining, 'number');
  assert.equal(JSON.stringify(state).includes('"type":"number"'), false);
});

test('publicState neposílá ani identitu hráče', () => {
  const run = newRun();
  assert.equal(publicState(run).playerId, undefined);
});

/* --------------------------------------------------------- tah a položení */

test('tah vydá čekající kartu', () => {
  const run = unpace(newRun());
  draw(run);
  assert.ok(run.pending || run.awaitingJoker);
  assert.equal(run.deck.length, rules.DECK_SIZE - 1);
});

test('dva tahy za sebou bez položení neprojdou', () => {
  const run = unpace(newRun());
  draw(run);
  if (run.awaitingJoker) {
    answerJoker(run, 'now', 5);
  }
  expectError('already_pending', () => draw(unpace(run)));
});

test('položit se nedá bez vytažené karty', () => {
  const run = unpace(newRun());
  expectError('nothing_to_place', () => place(run, 0, 0));
});

test('obsazené políčko se nepřepíše', () => {
  const run = unpace(newRun());
  draw(run);
  if (run.awaitingJoker) { answerJoker(run, 'now', 5); }
  place(run, 2, 2);
  const value = run.grid[2][2];
  unpace(run);
  draw(run);
  if (run.awaitingJoker) { answerJoker(unpace(run), 'now', 5); }
  expectError('cell_taken', () => place(unpace(run), 2, 2));
  assert.equal(run.grid[2][2], value);
});

test('políčko mimo pole neprojde', () => {
  const run = unpace(newRun());
  draw(run);
  if (run.awaitingJoker) { answerJoker(run, 'now', 5); }
  expectError('bad_cell', () => place(unpace(run), 5, 0));
  expectError('bad_cell', () => place(unpace(run), -1, 0));
  expectError('bad_cell', () => place(unpace(run), 1.5, 0));
});

/* ------------------------------------------------------------- žolíci */

test('žolík mimo hodnoty 1–13 neprojde', () => {
  const run = newRun();
  run.awaitingJoker = true;
  expectError('bad_value', () => answerJoker(run, 'now', 99));
  run.awaitingJoker = true;
  expectError('bad_value', () => answerJoker(run, 'now', 0));
});

test('uschovaný žolík nespotřebuje tah a jde uplatnit později', () => {
  const run = newRun();
  run.awaitingJoker = true;
  unpace(run);
  answerJoker(run, 'later');
  assert.equal(run.jokers, 1);
  assert.ok(run.pending || run.awaitingJoker, 'po uschování se má hned táhnout dál');
});

test('žolíka z ruky nejde uplatnit, když žádný není', () => {
  const run = unpace(newRun());
  expectError('no_jokers', () => useStoredJoker(run, 7));
});

/* ------------------------------------------------------- konec partie */

test('celá partie skončí na 25 políčkách a skóre sedí s pravidly', () => {
  const run = playThrough(newRun());
  assert.equal(run.over, true);
  assert.equal(run.placed, rules.CELLS_TOTAL);
  assert.equal(run.score, rules.scoreGrid(run.grid).total);
  assert.ok(run.score > 0);
  assert.ok(run.score <= rules.SCORE_MAX);
  assert.equal(run.score % rules.SCORE_STEP, 0);
});

test('dohraná partie už nepřijme další tah', () => {
  const run = playThrough(newRun());
  expectError('run_over', () => draw(unpace(run)));
  expectError('run_over', () => place(unpace(run), 0, 0));
});

/* ---------------------------------------------------------- podvrhy */

test('skóre nejde nastavit akcí zvenčí', () => {
  const run = unpace(newRun());
  expectError('unknown_action', () => apply(run, { action: 'setScore', score: 9999 }));
  // ani propašované v těle jiné akce
  apply(unpace(run), { action: 'draw', score: 9999, grid: 'cokoli' });
  assert.equal(run.score, 0);
});

test('cizí pole v těle požadavku se ignorují', () => {
  const run = unpace(newRun());
  apply(run, { action: 'draw' });
  if (run.awaitingJoker) { answerJoker(run, 'now', 9); }
  apply(unpace(run), { action: 'place', row: 0, col: 0, score: 1500, placed: 25 });
  assert.equal(run.placed, 1);
  assert.equal(run.score, rules.scoreGrid(run.grid).total);
});

test('neznámá akce je chyba, ne tichý průchod', () => {
  const run = unpace(newRun());
  expectError('unknown_action', () => apply(run, { action: 'finish' }));
  expectError('unknown_action', () => apply(run, {}));
});

test('brzda nepustí dva tahy ve stejné milisekundě', () => {
  const run = newRun();
  run.lastMoveAt = Date.now();
  expectError('too_fast', () => draw(run));
});

test('vzdaná partie se boduje z toho, co leží na poli', () => {
  const run = unpace(newRun());
  draw(run);
  if (run.awaitingJoker) { answerJoker(run, 'now', 5); }
  place(unpace(run), 0, 0);
  apply(unpace(run), { action: 'giveup' });
  assert.equal(run.over, true);
  assert.equal(run.placed, 1);
  assert.equal(run.score, rules.scoreGrid(run.grid).total);
});

/* ------------------------------------------- časový limit těžké hry */

/** Připraví těžkou partii s čekající kartou vytaženou před `agoMs`. */
function hardWithPending(agoMs, seconds = 10) {
  const run = emptyRun({ id: 'test', mode: 'hard', seconds, playerId: 'p1' });
  run.pending = { value: 7, fromJoker: false };
  run.pendingAt = Date.now() - agoMs;
  run.drawNo = 1;
  return unpace(run);
}

test('včasné položení v těžké obtížnosti projde', () => {
  const run = hardWithPending(2000);
  place(run, 0, 0);
  assert.equal(run.grid[0][0], 7);
  assert.equal(run.placed, 1);
});

test('pozdní položení kartu nepoloží — propadne', () => {
  const run = hardWithPending(30000);
  place(run, 0, 0);
  assert.equal(run.grid[0][0], null, 'políčko musí zůstat prázdné');
  assert.equal(run.placed, 0);
  assert.equal(run.pending, null);
  assert.equal(run.forfeited, 1);
});

test('rezerva na přenos pozdní tah ještě promine', () => {
  const run = hardWithPending(10000 + 800);   // limit 10 s, rezerva 1,5 s
  place(run, 1, 1);
  assert.equal(run.grid[1][1], 7);
});

test('kartu nejde odhodit před vypršením limitu', () => {
  const run = hardWithPending(2000);
  expectError('too_early', () => apply(run, { action: 'timeout' }));
  assert.ok(run.pending, 'karta musí zůstat v ruce');
});

test('po vypršení limitu jde karta odhodit', () => {
  const run = hardWithPending(11000);
  apply(run, { action: 'timeout' });
  assert.equal(run.pending, null);
  assert.equal(run.forfeited, 1);
});

test('v lehké obtížnosti se karta odhodit nedá', () => {
  const run = unpace(newRun('easy'));
  draw(run);
  if (run.awaitingJoker) { answerJoker(run, 'now', 5); }
  expectError('no_time_limit', () => apply(run, { action: 'timeout' }));
});

test('deadline v publicState sedí s limitem', () => {
  const run = hardWithPending(0, 15);
  const state = publicState(run);
  assert.equal(state.deadline, run.pendingAt + 15000);
  assert.equal(publicState(unpace(newRun('easy'))).deadline, null);
});

/* ------------------------------------------------- shoda s klientem */

test('sdílená pravidla dají stejné skóre jako součet linií', () => {
  const grid = [
    [7, 7, 7, 7, 7],
    [1, 2, 3, 4, 5],
    [9, 9, 2, 2, 4],
    [3, 6, 3, 6, 3],
    [11, 12, 13, 1, 8]
  ];
  const result = rules.scoreGrid(grid);
  const sum = result.lines.reduce((total, line) => total + line.points, 0);
  assert.equal(result.total, sum);
  assert.equal(result.lines.length, rules.LINES_TOTAL);
  assert.equal(result.lines[0].points, 125, 'první řádek je pětice');
  assert.equal(result.lines[1].points, 75, 'druhý řádek je seřazená postupka');
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
