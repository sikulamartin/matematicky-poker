/* Zápis do žebříčku — ta část, kvůli které nešlo dohrát partii.
   ==========================================================================

   Žebříček je jeden klíč v úložišti, do kterého píše každý, kdo dohraje.
   Souběžné zápisy se hlídají podmíněným zápisem přes ETag. Jenže ETag
   nemusí dorazit: lokální náhrada Netlify Blobs v `netlify dev` vrací tělo
   bez téhle hlavičky. Dokud se v tom případě zapisovalo „jen když záznam
   ještě neexistuje“, odpovědělo úložiště 412, cyklus to zopakoval šestkrát
   a skončil výjimkou — a s ní padla celá odpověď na poslední tah.

   Testy proto pouštějí skutečný `submitScore()` proti dvěma napodobeninám
   úložiště: jedné s ETagy (ostré Netlify) a jedné bez nich (netlify dev). */

import assert from 'node:assert/strict';
import { submitScore, writeOptions, periodKey } from '../netlify/functions/lib/store.mjs';

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

/** Úložiště, které ETagy posílá — takhle se chová ostré Netlify. */
function storeWithETags() {
  const data = new Map();
  const etags = new Map();
  let counter = 0;
  return {
    data,
    writes: 0,
    async getWithMetadata(key) {
      if (!data.has(key)) {
        return null;
      }
      return { data: data.get(key), etag: etags.get(key) };
    },
    async setJSON(key, value, options = {}) {
      this.writes++;
      if (options.onlyIfNew && data.has(key)) {
        return { modified: false };
      }
      if (options.onlyIfMatch && options.onlyIfMatch !== etags.get(key)) {
        return { modified: false };
      }
      data.set(key, value);
      etags.set(key, 'e' + (++counter));
      return { modified: true, etag: etags.get(key) };
    }
  };
}

/** Úložiště bez ETagů — takhle se chová `netlify dev`. */
function storeWithoutETags() {
  const data = new Map();
  return {
    data,
    writes: 0,
    async getWithMetadata(key) {
      if (!data.has(key)) {
        return null;
      }
      return { data: data.get(key), etag: undefined };
    },
    async setJSON(key, value, options = {}) {
      this.writes++;
      if (options.onlyIfNew && data.has(key)) {
        return { modified: false };          // 412 — záznam už existuje
      }
      if (options.onlyIfMatch) {
        return { modified: false };          // 412 — nemá se čím shodnout
      }
      data.set(key, value);
      return { modified: true, etag: '' };
    }
  };
}

function entry(playerId, score, at) {
  return {
    playerId,
    name: playerId,
    score,
    mode: 'easy',
    durationMs: 60000,
    at: at || '2026-08-07T10:00:00.000Z'
  };
}

/* ------------------------------------------------------ volba způsobu zápisu */

await test('se známým ETagem se zapisuje podmíněně', () => {
  assert.deepEqual(writeOptions({ etag: 'abc', exists: true }), { onlyIfMatch: 'abc' });
});

await test('neexistující období se zakládá přes onlyIfNew', () => {
  assert.deepEqual(writeOptions({ etag: null, exists: false }), { onlyIfNew: true });
});

await test('existující období bez ETagu se zapisuje bez podmínky', () => {
  // právě tady se dřív posílalo onlyIfNew a úložiště vracelo věčné 412
  assert.equal(writeOptions({ etag: null, exists: true }), undefined);
});

/* ------------------------------------------------------------ celý zápis */

await test('druhý výsledek projde i do úložiště bez ETagů', async () => {
  const store = storeWithoutETags();
  const first = await submitScore(entry('hrac-1', 200), store);
  assert.equal(first.all, 1, 'první zápis zakládá žebříček');

  // tohle padalo na board_busy a hráč nemohl položit poslední kartu
  const second = await submitScore(entry('hrac-2', 300), store);
  assert.equal(second.all, 1, 'lepší skóre má být první');

  const list = store.data.get(periodKey('all'));
  assert.equal(list.length, 2, 'v žebříčku mají být oba hráči');
});

await test('s ETagy zápis pořád běží přes podmínku', async () => {
  const store = storeWithETags();
  await submitScore(entry('hrac-1', 200), store);
  const second = await submitScore(entry('hrac-2', 100), store);
  assert.equal(second.all, 2, 'horší skóre patří na druhé místo');
  assert.equal(store.data.get(periodKey('all')).length, 2);
});

await test('souběžný zápis se zopakuje s novou verzí, nic se neztratí', async () => {
  const store = storeWithETags();
  await submitScore(entry('hrac-1', 200), store);

  /* Mezi čtením a zápisem stihne zapsat někdo jiný: první pokus dostane
     modified: false a cyklus si musí přečíst jeho verzi. */
  const original = store.setJSON.bind(store);
  let intercepted = false;
  store.setJSON = async function (key, value, options) {
    if (!intercepted && key === periodKey('all')) {
      intercepted = true;
      await original(key, [...(store.data.get(key) || []), entry('hrac-3', 50)], {});
      return { modified: false };
    }
    return original(key, value, options);
  };

  await submitScore(entry('hrac-2', 100), store);
  const list = store.data.get(periodKey('all'));
  const ids = list.map((item) => item.playerId).sort();
  assert.deepEqual(ids, ['hrac-1', 'hrac-2', 'hrac-3'], 'nikdo nesmí zmizet');
});

/* --------------------------------------------------------------- období */

/* Hranice dne se počítá v českém čase. Testy proto sedí na okamžicích těsně
   kolem půlnoci v Praze — právě tam se UTC a české datum rozcházejí. */

await test('denní klíč nese kalendářní datum', () => {
  assert.equal(periodKey('day', new Date('2026-08-07T09:00:00Z')), 'd-2026-08-07');
});

await test('večerní partie patří do dneška, ne do včerejška', () => {
  // 23:30 v Praze = 21:30 UTC téhož dne
  assert.equal(periodKey('day', new Date('2026-08-07T21:30:00Z')), 'd-2026-08-07');
});

await test('po půlnoci začíná nový den, i když je v UTC pořád včerejšek', () => {
  // 00:30 v Praze 8. srpna = 22:30 UTC 7. srpna
  assert.equal(periodKey('day', new Date('2026-08-07T22:30:00Z')), 'd-2026-08-08');
});

await test('v zimě platí posun o hodinu', () => {
  // 00:30 v Praze 16. ledna = 23:30 UTC 15. ledna
  assert.equal(periodKey('day', new Date('2026-01-15T23:30:00Z')), 'd-2026-01-16');
});

await test('stejnou hranici má i měsíc a týden', () => {
  const newYearEve = new Date('2026-08-31T22:30:00Z');    // 1. září 00:30 v Praze
  assert.equal(periodKey('month', newYearEve), 'm-2026-09');
  // 1. září 2026 je úterý, tedy 36. ISO týden
  assert.equal(periodKey('week', newYearEve), 'w-2026-W36');
});

await test('výsledek ze včerejška dnešní tabulku neovlivní', async () => {
  const store = storeWithoutETags();
  await submitScore(entry('hrac-1', 300, '2026-08-06T12:00:00Z'), store);
  await submitScore(entry('hrac-2', 100, '2026-08-07T12:00:00Z'), store);

  const yesterday = store.data.get('d-2026-08-06').map((item) => item.playerId);
  const today = store.data.get('d-2026-08-07').map((item) => item.playerId);
  assert.deepEqual(yesterday, ['hrac-1'], 'včerejšek má svůj vlastní záznam');
  assert.deepEqual(today, ['hrac-2'], 'dnešek taky');
  assert.equal(store.data.get('all').length, 2, 'celkově jsou vidět oba');
});

await test('jeden hráč drží v žebříčku jen svůj nejlepší výsledek', async () => {
  const store = storeWithoutETags();
  await submitScore(entry('hrac-1', 100), store);
  await submitScore(entry('hrac-1', 300), store);
  await submitScore(entry('hrac-1', 200), store);

  const list = store.data.get(periodKey('all'));
  assert.equal(list.length, 1, 'jeden záznam na hráče');
  assert.equal(list[0].score, 300, 'a to ten nejlepší');
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
