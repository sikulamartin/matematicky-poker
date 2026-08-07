/* Statistiky profilu — počítání i zápis do úložiště.
   ==========================================================================

   Dvě věci, které se testují zvlášť:

     lib/stats.mjs   čistý výpočet nad objektem. Sem se nedostane nic zvenčí,
                     takže stačí ověřit, že rekordy padají tam, kam mají.
     lib/store.mjs   zápis do záznamu hráče. Ten je podmíněný přes ETag,
                     protože do stejného klíče píše i zakládání partie —
                     hráč se dvěma otevřenými kartami tím dřív přišel
                     o dohranou partii. */

import assert from 'node:assert/strict';
import { emptyStats, normalizeStats, applyRun } from '../netlify/functions/lib/stats.mjs';
import { recordPlayerStats, resetPlayerStats, updatePlayer }
  from '../netlify/functions/lib/store.mjs';

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

function run(overrides) {
  return Object.assign({
    score: 300,
    mode: 'easy',
    durationMs: 60000,
    complete: true,
    at: '2026-08-07T10:00:00.000Z'
  }, overrides);
}

/** Úložiště hráčů s ETagy — takhle se chová ostré Netlify. */
function playerStore(initial) {
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
      if (options.onlyIfMatch && options.onlyIfMatch !== etags.get(key)) {
        return { modified: false };
      }
      data.set(key, value);
      etags.set(key, 'e' + (++counter));
      return { modified: true, etag: etags.get(key) };
    }
  };
}

/* ---------------------------------------------------------------- výpočet */

await test('prázdná sada je samá nula', () => {
  const stats = emptyStats();
  assert.equal(stats.games, 0);
  assert.equal(stats.best, 0);
  assert.equal(stats.fastestMs, null);
});

await test('starý záznam hráče bez statistik se doplní, ne odmítne', () => {
  // hráči založení dřív, než statistiky existovaly, mají `stats` undefined
  assert.deepEqual(normalizeStats(undefined), emptyStats());
  assert.deepEqual(normalizeStats({ best: 500 }).best, 500);
  assert.deepEqual(normalizeStats({ best: 500 }).games, 0);
});

await test('první partie zapíše všechny rekordy najednou', () => {
  const { stats, records } = applyRun(emptyStats(), run({ score: 300 }));
  assert.equal(stats.games, 1);
  assert.equal(stats.finished, 1);
  assert.equal(stats.best, 300);
  assert.equal(stats.bestEasy, 300);
  assert.equal(stats.fastestMs, 60000);
  assert.deepEqual(records.sort(), ['best', 'easy', 'fastest']);
});

await test('horší partie se započítá, ale rekord nepřepíše', () => {
  const first = applyRun(emptyStats(), run({ score: 300 })).stats;
  const { stats, records } = applyRun(first, run({ score: 100 }));
  assert.equal(stats.games, 2, 'hraných her přibylo');
  assert.equal(stats.best, 300, 'rekord zůstal');
  assert.deepEqual(records, [], 'nic se nepřekonalo');
});

await test('lehká a těžká mají vlastní rekord', () => {
  let stats = applyRun(emptyStats(), run({ score: 300, mode: 'easy' })).stats;
  stats = applyRun(stats, run({ score: 200, mode: 'hard' })).stats;
  assert.equal(stats.bestEasy, 300);
  assert.equal(stats.bestHard, 200);
  assert.equal(stats.best, 300, 'celkové skóre je to vyšší z obou');
});

await test('nedohraná partie nezvýší dohrané ani nejrychlejší', () => {
  const { stats, records } = applyRun(emptyStats(), run({ complete: false, durationMs: 1000 }));
  assert.equal(stats.games, 1, 'ukončená partie se pořád počítá');
  assert.equal(stats.finished, 0);
  assert.equal(stats.fastestMs, null, 'jinak by rekordem byl první tah');
  assert.ok(!records.includes('fastest'));
});

await test('nejrychlejší hra si drží i obtížnost', () => {
  let stats = applyRun(emptyStats(), run({ durationMs: 90000, mode: 'easy' })).stats;
  stats = applyRun(stats, run({ durationMs: 40000, mode: 'hard' })).stats;
  assert.equal(stats.fastestMs, 40000);
  assert.equal(stats.fastestMode, 'hard');
});

await test('výpočet nemutuje vstup', () => {
  // CAS cyklus volá applyRun znovu nad čerstvou verzí — nesmí si sáhnout
  // na to, co dostal napoprvé
  const before = emptyStats();
  applyRun(before, run({ score: 700 }));
  assert.deepEqual(before, emptyStats());
});

await test('neznámá obtížnost padá do lehké, ne mimo', () => {
  const { stats } = applyRun(emptyStats(), run({ mode: 'kdovico', score: 55 }));
  assert.equal(stats.bestEasy, 55);
  assert.equal(stats.bestHard, 0);
});

/* -------------------------------------------------------------- úložiště */

await test('zápis přičte partii k záznamu hráče', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  const outcome = await recordPlayerStats('h1', run({ score: 250 }), store);
  assert.equal(outcome.stats.best, 250);
  assert.equal(store.data.get('h1').stats.best, 250);
  assert.equal(store.data.get('h1').secretHash, 'x', 'zbytek záznamu zůstává');
});

await test('neznámý hráč se nezaloží potichu', async () => {
  const store = playerStore({});
  assert.equal(await recordPlayerStats('nikdo', run(), store), null);
  assert.equal(store.data.size, 0);
});

await test('souběžný zápis se zopakuje a nic se neztratí', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč' } });
  await recordPlayerStats('h1', run({ score: 100 }), store);

  /* Mezi čtením a zápisem stihne druhá karta zapsat svoji partii. První
     pokus dostane modified: false a cyklus si musí přečíst její verzi —
     jinak by se ta partie ztratila. */
  const original = store.setJSON.bind(store);
  let intercepted = false;
  store.setJSON = async function (key, value, options) {
    if (!intercepted) {
      intercepted = true;
      const other = await store.getWithMetadata(key);
      other.data.stats = applyRun(other.data.stats, run({ score: 400 })).stats;
      await original(key, other.data, {});
      return { modified: false };
    }
    return original(key, value, options);
  };

  const outcome = await recordPlayerStats('h1', run({ score: 200 }), store);
  const stats = store.data.get('h1').stats;
  assert.equal(stats.games, 3, 'všechny tři partie musí být napočítané');
  assert.equal(stats.best, 400, 'cizí rekord se nesmí přepsat');
  assert.deepEqual(outcome.records, [], 'a naše 200 rekord není');
});

await test('nulování nechá identitu i přezdívku být', async () => {
  const store = playerStore({ h1: { id: 'h1', secretHash: 'x', name: 'Hráč', runs: 9 } });
  await recordPlayerStats('h1', run({ score: 250 }), store);
  const stats = await resetPlayerStats('h1', store);
  assert.deepEqual(stats, emptyStats());
  const record = store.data.get('h1');
  assert.equal(record.secretHash, 'x');
  assert.equal(record.name, 'Hráč');
  assert.equal(record.runs, 9);
});

await test('úprava neexistujícího hráče vrací null, ne výjimku', async () => {
  const store = playerStore({});
  assert.equal(await updatePlayer('nikdo', (p) => p, store), null);
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
