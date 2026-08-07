/* Testy náhledu bodů (public/js/preview.js).

   Modul je klientský a hlavně kreslí, ale jádro `deltas()` je čistá funkce
   nad mřížkou a jedním číslem — a právě ta hráči tvrdí, kolik bodů dostane.
   Když se splete, hra o tom mlčí a hráč hraje podle špatných čísel, takže
   se vyplatí ji hlídat i mimo prohlížeč.

   Soubor se sem načítá jako text a spouští v obalu s podstrčeným `window`,
   `document` a `localStorage`. Alternativa by byla vytáhnout výpočet do
   dalšího UMD modulu vedle shared/rules.js, ale ten obal existuje kvůli
   serveru — a náhled na server nepatří.

   Spuštění: npm test */

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const require = createRequire(import.meta.url);
const here = dirname(fileURLToPath(import.meta.url));
const rules = require(join(here, '../public/shared/rules.js'));

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

/* --------------------------------------------------------------- načtení */

/**
 * Spustí preview.js nad falešným prohlížečem.
 * `document` stačí takhle chudé: bez hostitelů pro vypínač se `mount()`
 * projde naprázdno a zbytek modulu se o DOM nezajímá.
 */
function load(storage) {
  const source = readFileSync(join(here, '../public/js/preview.js'), 'utf8');
  const window = { MPRules: rules };
  const document = {
    readyState: 'complete',
    addEventListener() {},
    querySelectorAll: () => []
  };
  const run = new Function('window', 'document', 'localStorage', source);
  run(window, document, storage);
  return window.MPPreview;
}

const MPPreview = load(undefined);

/* -------------------------------------------------------------- pomocné */

function emptyGrid() {
  return rules.emptyGrid();
}

/** Kopie mřížky s dosazenou hodnotou — referenční výpočet pro srovnání. */
function placed(grid, row, col, value) {
  const next = grid.map((line) => line.slice());
  next[row][col] = value;
  return next;
}

/* ----------------------------------------------------------------- testy */

test('na prázdném poli nepřinese první číslo nikde nic', () => {
  const list = MPPreview.deltas(emptyGrid(), 7);
  assert.equal(list.length, 25);
  assert.ok(list.every((gain) => gain === 0), 'čekalo se 25 nul');
});

test('obsazená políčka mají null, ne nulu', () => {
  const grid = emptyGrid();
  grid[2][3] = 9;
  const list = MPPreview.deltas(grid, 9);
  assert.equal(list[2 * 5 + 3], null);
  assert.notEqual(list[2 * 5 + 4], null);
});

test('páté číslo do řádku dopočítá rozdíl mezi čtveřicí a pěticí', () => {
  const grid = emptyGrid();
  [0, 1, 2, 3].forEach((col) => {
    grid[0][col] = 7;
  });
  const list = MPPreview.deltas(grid, 7);
  // řádek 100 → 125, sloupec i úhlopříčka zůstávají na nule
  assert.equal(list[0 * 5 + 4], 25);
});

test('sloupec se počítá stejně jako řádek', () => {
  const grid = emptyGrid();
  grid[0][0] = 7;
  const list = MPPreview.deltas(grid, 7);
  // pod sedmičkou vznikne pár vedle sebe (15), řádek 1 zůstává bez kombinace
  assert.equal(list[1 * 5 + 0], 15);
});

test('políčko na úhlopříčce načítá i ji', () => {
  const grid = emptyGrid();
  [0, 1, 2, 3].forEach((i) => {
    grid[i][i] = 5;
  });
  const list = MPPreview.deltas(grid, 5);
  // jenom úhlopříčka: 100 → 125, řádek 4 i sloupec 4 jsou prázdné
  assert.equal(list[4 * 5 + 4], 25);
});

test('střed pole sčítá obě úhlopříčky naráz', () => {
  const grid = emptyGrid();
  grid[0][0] = 4;
  grid[0][4] = 4;
  const list = MPPreview.deltas(grid, 4);
  // (2,2) leží na obou úhlopříčkách; na každé vznikne pár (10), řádek
  // a sloupec zůstávají bez kombinace
  assert.equal(list[2 * 5 + 2], 20);
});

/* Tohle je ten podstatný test. `deltas()` schválně nepřepočítává celé pole,
   jen linie, kterých se políčko dotýká — a tahle zkratka je celá plocha,
   kde se dá udělat chyba. Porovnává se proti poctivému `scoreGrid()`. */
test('zkratka přes dotčené linie souhlasí s přepočtem celého pole', () => {
  let random = 12345;
  const next = () => {
    random = (random * 1103515245 + 12345) % 2147483648;
    return random / 2147483648;
  };

  for (let round = 0; round < 200; round++) {
    const grid = emptyGrid();
    const fill = Math.floor(next() * 20);
    for (let i = 0; i < fill; i++) {
      const row = Math.floor(next() * 5);
      const col = Math.floor(next() * 5);
      grid[row][col] = 1 + Math.floor(next() * 13);
    }

    const value = 1 + Math.floor(next() * 13);
    const list = MPPreview.deltas(grid, value);
    const base = rules.scoreGrid(grid).total;

    for (let row = 0; row < 5; row++) {
      for (let col = 0; col < 5; col++) {
        const gain = list[row * 5 + col];
        if (grid[row][col] !== null) {
          assert.equal(gain, null, `obsazené ${row},${col} má mít null`);
          continue;
        }
        const real = rules.scoreGrid(placed(grid, row, col, value)).total - base;
        assert.equal(gain, real, `kolo ${round}, políčko ${row},${col}`);
        assert.ok(gain >= 0, 'položení nemůže skóre snížit');
      }
    }
  }
});

/* -------------------------------------------------------------- vypínač */

test('bez localStorage je náhled zapnutý a přepnutí nespadne', () => {
  const module = load(undefined);
  assert.equal(module.enabled(), true);
  module.set(false);
  assert.equal(module.enabled(), false);
});

test('uložená nula náhled vypne, cokoli jiného ne', () => {
  const off = load({ getItem: () => '0', setItem() {} });
  assert.equal(off.enabled(), false);

  const on = load({ getItem: () => null, setItem() {} });
  assert.equal(on.enabled(), true);
});

test('přepnutí se ukládá', () => {
  const written = [];
  const module = load({
    getItem: () => null,
    setItem: (key, value) => written.push([key, value])
  });
  module.set(false);
  module.set(true);
  assert.deepEqual(written, [['mp-preview', '0'], ['mp-preview', '1']]);
});

console.log('\n' + passed + ' prošlo, ' + failed + ' selhalo');
process.exit(failed ? 1 : 0);
