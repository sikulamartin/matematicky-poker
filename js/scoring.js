/* Bodování hracího pole 5×5.
   Vyhodnocuje 12 linií: 5 řádků, 5 sloupců a 2 úhlopříčky.

   Každá linie se předává jako pole pěti prvků, kde prázdná buňka je `null`.
   Pozice se tedy zachovává a kombinace „vedle sebe“ se počítají správně.

   Oproti původní verzi:
   - z každé linie se bere NEJVYŠŠÍ dosažená kombinace (dřív rozhodovalo
     pořadí podmínek, takže čtveřice mimo sebe (70) přebila postupku (75)),
   - opravené počítání dvou párů (čtveřice se dřív počítala jako dva páry),
   - vypuštěna mrtvá kontrola „sestupná posloupnost v libovolném pořadí“,
     která nemohla nikdy nastat,
   - přepočet se spouští při změně, ne desetkrát za sekundu. */
(function () {
  'use strict';

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
  /* Pořadí v seznamu nerozhoduje — vybírá se kombinace s nejvyšší hodnotou. */

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

  /** Text buňky → číslo, nebo null když je prázdná / nečíselná. */
  function cellValue(cell) {
    var text = cell.textContent.replace(/\s+/g, '');
    if (text === '') {
      return null;
    }
    var value = parseInt(text, 10);
    return Number.isNaN(value) ? null : value;
  }

  /* ------------------------------------------------------- vazba na DOM */

  /**
   * Napojí bodování na tabulku.
   * @param {HTMLTableElement} table
   * @param {HTMLElement} [totalEl] prvek pro celkový součet
   */
  function attach(table, totalEl) {
    var grid = [];
    for (var r = 1; r <= 5; r++) {
      var rowCells = table.rows[r].cells;
      var row = [];
      for (var c = 1; c <= 5; c++) {
        row.push(rowCells[c]);
      }
      grid.push(row);
    }

    var lines = [];

    // řádky — výsledek do prvního th v řádku
    grid.forEach(function (row, index) {
      lines.push({ cells: row, out: table.rows[index + 1].cells[0] });
    });

    // sloupce — výsledek do záhlaví tabulky
    for (var c2 = 0; c2 < 5; c2++) {
      lines.push({
        cells: grid.map(function (row) {
          return row[c2];
        }),
        out: table.rows[0].cells[c2 + 1]
      });
    }

    // úhlopříčky — rohové buňky záhlaví
    lines.push({
      cells: grid.map(function (row, i) {
        return row[i];
      }),
      out: table.rows[0].cells[0]
    });
    lines.push({
      cells: grid.map(function (row, i) {
        return row[4 - i];
      }),
      out: table.rows[0].cells[6]
    });

    var total = 0;

    function recalculate() {
      total = 0;
      lines.forEach(function (line) {
        var values = line.cells.map(cellValue);
        var result = evaluate(values);
        total += result.points;
        line.out.textContent = String(result.points);
        line.out.classList.toggle('is-scoring', result.points > 0);
        line.out.title = result.name || 'Zatím bez kombinace';
      });

      if (totalEl) {
        totalEl.textContent = String(total);
      }
      return total;
    }

    recalculate();

    return {
      recalculate: recalculate,
      getTotal: function () {
        return total;
      },
      cells: grid,
      lines: lines
    };
  }

  window.MPScore = {
    attach: attach,
    evaluate: evaluate,
    combos: COMBOS
  };
})();
