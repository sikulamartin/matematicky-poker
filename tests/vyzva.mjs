/* Denní výzva — balíček z data, jeden pokus na den, tabulka dne.
   ==========================================================================

   Celá výzva stojí na dvou tvrzeních a obě se dají ověřit bez Netlify:

     1. balíček je funkcí data — stejný den dá stejné pořadí karet komukoli
        a kdykoli, jiný den jiné. Kdyby se to rozešlo, hráli by lidé různé
        hry a společná tabulka by neznamenala nic.
     2. pokus je jeden na den. Druhý pokus je hra se znalostí pořadí karet,
        takže by měřil paměť, ne hru.

   Zápis do tabulky dne se testuje proti napodobenině úložiště, stejně jako
   žebříček v tests/zebricek.mjs — včetně partie rozehrané před půlnocí. */

import assert from 'node:assert/strict';
import rules from '../public/shared/rules.js';
import { emptyRun, draw, publicState } from '../netlify/functions/lib/run.mjs';
import {
  dailyDay, dailyKey, dailySeed, dailyDeck, submitDaily, readDaily,
  claimDaily, finishDaily, dailyOf
} from '../netlify/functions/lib/store.mjs';

let passed = 0;
let failed = 0;

async function test(name, fn) {
  try {
    await fn();
    passed++;
    console.log('PASS  ' + name);
  } catch (err) {
    failed++;
    console.log('FAIL  ' + name + '\n      ' + err.message);
  }
}

/** Úložiště s ETagy — takhle se chová ostré Netlify. */
function storeWithETags(initial) {
  const data = new Map(Object.entries(initial || {}));
  const etags = new Map();
  let counter = 0;
  for (const key of data.keys()) {
    etags.set(key, 'e' + (++counter));
  }
  return {
    data,
    async getWithMetadata(key) {
      if (!data.has(key)) {
        return null;
      }
      return { data: JSON.parse(JSON.stringify(data.get(key))), etag: etags.get(key) };
    },
    async setJSON(key, value, options = {}) {
      if (options.onlyIfNew && data.has(key)) {
        return { modified: false };
      }
      if (options.onlyIfMatch && options.onlyIfMatch !== etags.get(key)) {
        return { modified: false };
      }
      data.set(key, JSON.parse(JSON.stringify(value)));
      etags.set(key, 'e' + (++counter));
      return { modified: true, etag: etags.get(key) };
    }
  };
}

function cardsOf(deck) {
  return deck.map((card) => (card.type === 'joker' ? 'J' : card.value)).join(',');
}

/* ---------------------------------------------------------------- balíček */

await test('stejný den dá stejné pořadí karet', () => {
  const first = dailyDeck('2026-08-08');
  const second = dailyDeck('2026-08-08');
  assert.equal(cardsOf(first), cardsOf(second));
});

await test('jiný den dá jiné pořadí', () => {
  const today = dailyDeck('2026-08-08');
  const tomorrow = dailyDeck('2026-08-09');
  assert.notEqual(cardsOf(today), cardsOf(tomorrow));
});

await test('balíček dne je pořád normální balíček', () => {
  const deck = dailyDeck('2026-08-08');
  assert.equal(deck.length, rules.DECK_SIZE, '54 karet');
  assert.equal(deck.filter((card) => card.type === 'joker').length, rules.JOKERS);
  for (const value of rules.VALUES) {
    const count = deck.filter((card) => card.type === 'number' && card.value === value).length;
    assert.equal(count, rules.COPIES, 'hodnota ' + value + ' musí být čtyřikrát');
  }
});

await test('semínko nezávisí na Math.random', () => {
  // podstrčený Math.random by prozradil, že se generátor někde protrhl
  const original = Math.random;
  Math.random = () => 0.42;
  try {
    const withStub = cardsOf(dailyDeck('2026-08-08'));
    Math.random = () => 0.99;
    assert.equal(withStub, cardsOf(dailyDeck('2026-08-08')));
  } finally {
    Math.random = original;
  }
});

await test('semínko má vlastní předponu, ne holé datum', () => {
  assert.equal(dailySeed('2026-08-08'), 'mp-vyzva-2026-08-08');
  assert.notEqual(rules.seedFrom('2026-08-08'), rules.seedFrom(dailySeed('2026-08-08')));
});

await test('dva hráči téhož dne táhnou čísla ve stejném pořadí', () => {
  const day = '2026-08-08';
  function firstFive(playerId) {
    const run = emptyRun({ id: playerId, mode: 'daily', playerId, day, deck: dailyDeck(day) });
    const seen = [];
    while (seen.length < 5) {
      run.lastMoveAt = 0;          // brzda na tempo tady jen překáží
      draw(run);
      if (run.awaitingJoker) {
        run.awaitingJoker = false;
        seen.push('J');
        continue;
      }
      seen.push(run.pending.value);
      run.pending = null;
    }
    return seen.join(',');
  }
  assert.equal(firstFive('hrac-1'), firstFive('hrac-2'));
});

await test('partie si den nese s sebou i ven ke klientovi', () => {
  const run = emptyRun({ id: 'r1', mode: 'daily', playerId: 'h1', day: '2026-08-08' });
  assert.equal(publicState(run).day, '2026-08-08');
  // běžná partie žádný den nemá
  assert.equal(publicState(emptyRun({ id: 'r2', mode: 'easy', playerId: 'h1' })).day, null);
});

await test('balíček se ven neposílá ani v denní výzvě', () => {
  const run = emptyRun({ id: 'r1', mode: 'daily', playerId: 'h1', day: '2026-08-08' });
  assert.equal(publicState(run).deck, undefined, 'jinak by hráč znal pořadí dopředu');
});

/* -------------------------------------------------------------- den v ČR */

await test('den se počítá v českém čase, ne v UTC', () => {
  // 23:30 v Praze = 21:30 UTC téhož dne
  assert.equal(dailyDay(new Date('2026-08-07T21:30:00Z')), '2026-08-07');
  // 00:30 v Praze 8. srpna = 22:30 UTC 7. srpna
  assert.equal(dailyDay(new Date('2026-08-07T22:30:00Z')), '2026-08-08');
});

await test('klíč tabulky dne se nepotká s klíči žebříčku', () => {
  // žebříček používá d- / w- / m- / all, výzva c-
  assert.equal(dailyKey('2026-08-08'), 'c-2026-08-08');
});

/* ------------------------------------------------------------ tabulka dne */

function entry(playerId, score, day, at) {
  return {
    playerId,
    name: playerId,
    score,
    mode: 'daily',
    day,
    durationMs: 60000,
    at: at || '2026-08-08T10:00:00.000Z'
  };
}

await test('první výsledek dne je rovnou rekord', async () => {
  const store = storeWithETags();
  const result = await submitDaily(entry('hrac-1', 240, '2026-08-08'), store);
  assert.equal(result.rank, 1);
  assert.equal(result.record, 240);
  assert.equal(result.count, 1);
});

await test('lepší výsledek přebírá rekord, horší se zařadí pod něj', async () => {
  const store = storeWithETags();
  await submitDaily(entry('hrac-1', 240, '2026-08-08'), store);
  const second = await submitDaily(entry('hrac-2', 300, '2026-08-08'), store);
  assert.equal(second.rank, 1);
  assert.equal(second.record, 300);

  const third = await submitDaily(entry('hrac-3', 100, '2026-08-08'), store);
  assert.equal(third.rank, 3);
  assert.equal(third.record, 300, 'rekord dne drží pořád nejlepší');
});

await test('rozhoduje den balíčku, ne okamžik dohrání', async () => {
  const store = storeWithETags();
  /* Partie rozehraná před půlnocí a dokončená po ní. Podle času by spadla
     k dalšímu dni, kde by hrála proti jinému balíčku. */
  await submitDaily(entry('nocni', 300, '2026-08-08', '2026-08-08T22:10:00.000Z'), store);
  assert.deepEqual(
    (store.data.get('c-2026-08-08') || []).map((item) => item.playerId),
    ['nocni']
  );
  assert.equal(store.data.has('c-2026-08-09'), false, 'dalšího dne se to netýká');
});

await test('zápis bez dne se neprovede potichu', async () => {
  const store = storeWithETags();
  await assert.rejects(() => submitDaily(entry('hrac-1', 200, undefined), store));
});

await test('tabulka se čte pod klíčem svého dne', async () => {
  const store = storeWithETags();
  await submitDaily(entry('hrac-1', 200, '2026-08-08'), store);
  assert.equal((await readDaily('2026-08-08', store)).length, 1);
  assert.equal((await readDaily('2026-08-09', store)).length, 0);
});

/* --------------------------------------------------------- pokus na den */

function playerStore(initial) {
  return storeWithETags(initial);
}

await test('první start dne pokus zamluví', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  const claim = await claimDaily('h1', '2026-08-08', 'run-1', store);
  assert.equal(claim.fresh, true);
  assert.equal(claim.runId, 'run-1');
  assert.equal(store.data.get('h1').daily.day, '2026-08-08');
});

await test('druhý start téhož dne vrací tu samou partii, ne novou', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  await claimDaily('h1', '2026-08-08', 'run-1', store);
  const again = await claimDaily('h1', '2026-08-08', 'run-2', store);
  assert.equal(again.fresh, false);
  assert.equal(again.runId, 'run-1', 'jinak by se hrálo znovu se znalostí karet');
});

await test('další den je pokus zase volný', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  await claimDaily('h1', '2026-08-08', 'run-1', store);
  await finishDaily('h1', '2026-08-08', { score: 300, at: 'x', rank: 1 }, store);
  const tomorrow = await claimDaily('h1', '2026-08-09', 'run-2', store);
  assert.equal(tomorrow.fresh, true);
  assert.equal(tomorrow.runId, 'run-2');
});

await test('dohraný pokus si pamatuje výsledek', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  await claimDaily('h1', '2026-08-08', 'run-1', store);
  await finishDaily('h1', '2026-08-08', { score: 265, at: '2026-08-08T10:00:00Z', rank: 2 }, store);

  const again = await claimDaily('h1', '2026-08-08', 'run-9', store);
  assert.equal(again.fresh, false);
  assert.equal(again.score, 265, 'podle skóre se pozná vyčerpaný pokus');
  assert.equal(again.rank, 2);
});

await test('výsledek se nedopisuje ke včerejšímu pokusu', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  await claimDaily('h1', '2026-08-08', 'run-1', store);
  // partie z 8. srpna se hlásí až 9. — dopisovat není kam
  assert.equal(await finishDaily('h1', '2026-08-09', { score: 300 }, store), null);
  assert.equal(store.data.get('h1').daily.score, null);
});

await test('zápis pokusu nechá zbytek záznamu hráče být', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč', runs: 4 } });
  await claimDaily('h1', '2026-08-08', 'run-1', store);
  const record = store.data.get('h1');
  assert.equal(record.secretHash, 'x');
  assert.equal(record.runs, 4);
});

await test('neznámý hráč se pokusem nezaloží', async () => {
  const store = playerStore({});
  assert.equal(await claimDaily('nikdo', '2026-08-08', 'run-1', store), null);
  assert.equal(store.data.size, 0);
});

await test('dailyOf pozná jenom dnešní pokus', () => {
  const player = { daily: { day: '2026-08-08', score: 100 } };
  assert.equal(dailyOf(player, '2026-08-08').score, 100);
  assert.equal(dailyOf(player, '2026-08-09'), null);
  assert.equal(dailyOf({}, '2026-08-08'), null);
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
