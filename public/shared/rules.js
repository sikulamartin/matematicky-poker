/* Pravidla matematického pokeru — jediná verze pro obě strany.
   ==========================================================================

   Tenhle soubor běží doslova dvakrát: v prohlížeči jako klasický <script>
   (naplní window.MPRules) a v Netlify funkci jako CommonJS modul. Proto ten
   UMD obal dole — vypadá archaicky, ale je to nejlevnější způsob, jak mít
   opravdu jeden zdroj pravdy.

   Proč na tom záleží: od chvíle, kdy skóre počítá server kvůli žebříčku,
   existují dvě místa, která musí dát na stejné pole stejné číslo. Dvě kopie
   bodovací tabulky by se dřív nebo později rozešly a hráč by v žebříčku
   viděl jiné body, než mu ukázala hra. Tenhle soubor tomu předchází:
   js/scoring.js i serverový automat sahají do stejné tabulky.

   Co sem patří:  pravidla, která platí bez ohledu na to, kde se počítají —
                  složení balíčku, míchání, bodovací kombinace, vyhodnocení
                  linie a celého pole.
   Co sem nepatří: cokoli, co ví o DOM, o síti nebo o úložišti.
   ========================================================================== */
(function (root, factory) {
  'use strict';
  if (typeof module === 'object' && module.exports) {
    module.exports = factory();          // Netlify funkce (CommonJS)
  } else {
    root.MPRules = factory();            // prohlížeč
  }
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  /* ------------------------------------------------------------ balíček */

  var VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  var COPIES = 4;
  var JOKERS = 2;
  var DECK_SIZE = VALUES.length * COPIES + JOKERS;   // 54

  var CELLS_TOTAL = 25;
  var LINES_TOTAL = 12;                              // 5 řádků + 5 sloupců + 2 úhlopříčky

  /** Fisher–Yates. `rand` se dá podstrčit kvůli testům i kvůli denní výzvě. */
  function shuffle(array, rand) {
    var random = rand || Math.random;
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(random() * (i + 1));
      var tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function buildDeck(rand) {
    var deck = [];
    VALUES.forEach(function (value) {
      for (var i = 0; i < COPIES; i++) {
        deck.push({ type: 'number', value: value });
      }
    });
    for (var j = 0; j < JOKERS; j++) {
      deck.push({ type: 'joker', value: null });
    }
    return shuffle(deck, rand);
  }

  /* -------------------------------------------- deterministické míchání */

  /* Denní výzva stojí na tom, že všichni hráči dostanou týž balíček ve
     stejném pořadí. Math.random() se k tomu použít nedá — je jiný pro každý
     start funkce. Proto tenhle pár: `seedFrom` udělá z textu (datum dne)
     32bitové semínko, `randomFrom` z něj vyrobí posloupnost. Obojí je pár
     řádků bez stavu mimo vrácenou funkci a na stejný text vrátí stejné pořadí
     kdykoli — po restartu serveru i za rok.

     Není to kryptografie a nemá být. Kdo si tenhle soubor přečte, dopočítá si
     dnešní balíček dopředu; proti tomu chrání jediný pokus denně hlídaný na
     serveru (viz netlify/functions/hra.mjs), ne utajení algoritmu. */

  /** xmur3 — z řetězce 32bitové semínko. */
  function seedFrom(text) {
    var str = String(text);
    var h = 1779033703 ^ str.length;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^ (h >>> 16)) >>> 0;
  }

  /** mulberry32 — ze semínka generátor s rozhraním Math.random. */
  function randomFrom(seed) {
    var a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /** Balíček denní výzvy. Stejný klíč = stejné pořadí karet. */
  function dailyDeck(key) {
    return buildDeck(randomFrom(seedFrom(key)));
  }

  function isValue(value) {
    return VALUES.indexOf(value) !== -1;
  }

  function isCard(card) {
    if (!card || typeof card !== 'object') {
      return false;
    }
    if (card.type === 'joker') {
      return true;
    }
    return card.type === 'number' && isValue(card.value);
  }

  function cleanCard(card) {
    return card.type === 'joker'
      ? { type: 'joker', value: null }
      : { type: 'number', value: card.value };
  }

  /* ------------------------------------------------------ pomocné funkce */

  function filled(values) {
    return values.filter(function (value) {
      return value !== null;
    });
  }

  function counts(values) {
    var map = {};
    filled(values).forEach(function (value) {
      map[value] = (map[value] || 0) + 1;
    });
    return map;
  }

  /** Kolikrát se vyskytuje nejčastější hodnota. */
  function maxCount(values) {
    var map = counts(values);
    var best = 0;
    for (var key in map) {
      if (map[key] > best) {
        best = map[key];
      }
    }
    return best;
  }

  /** Nejdelší úsek stejných hodnot vedle sebe. Prázdná buňka úsek přeruší. */
  function longestRun(values) {
    var best = 0;
    var run = 0;
    for (var i = 0; i < values.length; i++) {
      if (values[i] === null) {
        run = 0;
        continue;
      }
      run = i > 0 && values[i - 1] === values[i] ? run + 1 : 1;
      if (run > best) {
        best = run;
      }
    }
    return best;
  }

  /** Počet hodnot, které se vyskytují alespoň dvakrát. */
  function distinctPairs(values) {
    var map = counts(values);
    var pairs = 0;
    for (var key in map) {
      if (map[key] >= 2) {
        pairs++;
      }
    }
    return pairs;
  }

  /** Počet nepřekrývajících se párů ležících vedle sebe. */
  function adjacentPairCount(values) {
    var pairs = 0;
    for (var i = 0; i < values.length - 1; i++) {
      if (values[i] !== null && values[i] === values[i + 1]) {
        pairs++;
        i++;
      }
    }
    return pairs;
  }

  function isComplete(values) {
    return filled(values).length === 5;
  }

  /** Přesně trojice + dvojice z různých hodnot (full house). */
  function isFullHouse(values) {
    if (!isComplete(values)) {
      return false;
    }
    var map = counts(values);
    var keys = Object.keys(map);
    if (keys.length !== 2) {
      return false;
    }
    var a = map[keys[0]];
    var b = map[keys[1]];
    return (a === 3 && b === 2) || (a === 2 && b === 3);
  }

  /** Full house, kde trojice i dvojice drží pohromadě (AAABB / AABBB). */
  function isAdjacentFullHouse(values) {
    if (!isFullHouse(values)) {
      return false;
    }
    var aabbb = values[0] === values[1] &&
      values[2] === values[3] && values[3] === values[4];
    var aaabb = values[0] === values[1] && values[1] === values[2] &&
      values[3] === values[4];
    return aabbb || aaabb;
  }

  /** Pět různých po sobě jdoucích čísel v libovolném pořadí. */
  function isStraight(values) {
    if (!isComplete(values)) {
      return false;
    }
    var seen = {};
    var min = Infinity;
    var max = -Infinity;
    for (var i = 0; i < values.length; i++) {
      if (seen[values[i]]) {
        return false;
      }
      seen[values[i]] = true;
      min = Math.min(min, values[i]);
      max = Math.max(max, values[i]);
    }
    return max - min === 4;
  }

  /** Postupka přímo seřazená vzestupně nebo sestupně. */
  function isOrderedStraight(values) {
    if (!isStraight(values)) {
      return false;
    }
    var up = true;
    var down = true;
    for (var i = 1; i < values.length; i++) {
      if (values[i] !== values[i - 1] + 1) {
        up = false;
      }
      if (values[i] !== values[i - 1] - 1) {
        down = false;
      }
    }
    return up || down;
  }

  /* ---------------------------------------------------------- kombinace */
  /* Pořadí v seznamu nerozhoduje — vybírá se kombinace s nejvyšší hodnotou.
     Všechny hodnoty jsou násobky pěti; na tom stojí kontrola věrohodnosti
     v js/store.js i na serveru. */

  var COMBOS = [
    {
      points: 125,
      name: 'Pětice',
      example: '7 7 7 7 7',
      test: function (v) {
        return maxCount(v) === 5;
      }
    },
    {
      points: 100,
      name: 'Čtveřice vedle sebe',
      example: '3 3 3 3 9',
      test: function (v) {
        return longestRun(v) >= 4;
      }
    },
    {
      points: 75,
      name: 'Seřazená postupka',
      example: '4 5 6 7 8',
      test: isOrderedStraight
    },
    {
      points: 70,
      name: 'Čtveřice',
      example: '3 3 9 3 3',
      test: function (v) {
        return maxCount(v) >= 4;
      }
    },
    {
      points: 50,
      name: 'Postupka',
      example: '6 4 8 5 7',
      test: isStraight
    },
    {
      points: 50,
      name: 'Full house vedle sebe',
      example: '2 2 2 9 9',
      test: isAdjacentFullHouse
    },
    {
      points: 40,
      name: 'Full house',
      example: '2 9 2 9 2',
      test: isFullHouse
    },
    {
      points: 35,
      name: 'Dva páry vedle sebe',
      example: '5 5 8 8 1',
      test: function (v) {
        return adjacentPairCount(v) >= 2;
      }
    },
    {
      points: 30,
      name: 'Dva páry',
      example: '5 8 5 1 8',
      test: function (v) {
        return distinctPairs(v) >= 2;
      }
    },
    {
      points: 25,
      name: 'Trojice vedle sebe',
      example: '6 6 6 2 9',
      test: function (v) {
        return longestRun(v) >= 3;
      }
    },
    {
      points: 20,
      name: 'Trojice',
      example: '6 2 6 9 6',
      test: function (v) {
        return maxCount(v) >= 3;
      }
    },
    {
      points: 15,
      name: 'Pár vedle sebe',
      example: '4 11 11 2 7',
      test: function (v) {
        return longestRun(v) >= 2;
      }
    },
    {
      points: 10,
      name: 'Pár',
      example: '4 11 2 7 11',
      test: function (v) {
        return maxCount(v) >= 2;
      }
    }
  ];

  /* Strop skóre: 12 linií po nejdražší kombinaci. Skutečně dosažitelné
     maximum je hluboko pod tím (na pětici v každé linii nejsou karty), ale
     nad touhle hodnotou je číslo prokazatelně vymyšlené. */
  var SCORE_MAX = LINES_TOTAL * COMBOS[0].points;    // 1500
  var SCORE_STEP = 5;

  /**
   * Vyhodnotí jednu linii.
   * @param {Array<number|null>} values pět hodnot, prázdná buňka = null
   * @returns {{points: number, name: string}}
   */
  function evaluate(values) {
    var best = { points: 0, name: '' };
    for (var i = 0; i < COMBOS.length; i++) {
      var combo = COMBOS[i];
      if (combo.points > best.points && combo.test(values)) {
        best = { points: combo.points, name: combo.name };
      }
    }
    return best;
  }

  /**
   * Rozloží pole 5×5 na dvanáct linií.
   * Pořadí je závazné a shodné s js/scoring.js, aby šly výsledky obou stran
   * porovnat linii po linii: 5 řádků shora, 5 sloupců zleva, úhlopříčka
   * zleva shora, úhlopříčka zprava shora.
   */
  function gridLines(grid) {
    var lines = [];
    var i;
    for (i = 0; i < 5; i++) {
      lines.push(grid[i].slice());
    }
    for (i = 0; i < 5; i++) {
      lines.push(grid.map(function (row) {
        return row[i];
      }));
    }
    lines.push(grid.map(function (row, index) {
      return row[index];
    }));
    lines.push(grid.map(function (row, index) {
      return row[4 - index];
    }));
    return lines;
  }

  /**
   * Obodovaní celého pole.
   * @param {Array<Array<number|null>>} grid 5×5
   * @returns {{total: number, lines: Array<{points: number, name: string}>}}
   */
  function scoreGrid(grid) {
    var total = 0;
    var lines = gridLines(grid).map(function (values) {
      var result = evaluate(values);
      total += result.points;
      return result;
    });
    return { total: total, lines: lines };
  }

  function emptyGrid() {
    var grid = [];
    for (var r = 0; r < 5; r++) {
      grid.push([null, null, null, null, null]);
    }
    return grid;
  }

  return {
    VALUES: VALUES,
    COPIES: COPIES,
    JOKERS: JOKERS,
    DECK_SIZE: DECK_SIZE,
    CELLS_TOTAL: CELLS_TOTAL,
    LINES_TOTAL: LINES_TOTAL,
    SCORE_MAX: SCORE_MAX,
    SCORE_STEP: SCORE_STEP,
    COMBOS: COMBOS,
    shuffle: shuffle,
    buildDeck: buildDeck,
    seedFrom: seedFrom,
    randomFrom: randomFrom,
    dailyDeck: dailyDeck,
    isValue: isValue,
    isCard: isCard,
    cleanCard: cleanCard,
    evaluate: evaluate,
    gridLines: gridLines,
    scoreGrid: scoreGrid,
    emptyGrid: emptyGrid
  };
});
