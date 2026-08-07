/* Napojení bodování na hrací tabulku v DOM.

   Samotná pravidla — bodovací kombinace i vyhodnocení linie — leží
   v shared/rules.js, protože je od zavedení žebříčku potřebuje i server.
   Tady zůstává jenom to, co ví o tabulce: které buňky tvoří kterou linii
   a kam se zapíše výsledek.

   Oproti původní verzi:
   - z každé linie se bere NEJVYŠŠÍ dosažená kombinace (dřív rozhodovalo
     pořadí podmínek, takže čtveřice mimo sebe (70) přebila postupku (75)),
   - opravené počítání dvou párů (čtveřice se dřív počítala jako dva páry),
   - vypuštěna mrtvá kontrola „sestupná posloupnost v libovolném pořadí“,
     která nemohla nikdy nastat,
   - přepočet se spouští při změně, ne desetkrát za sekundu. */
(function () {
  'use strict';

  var rules = window.MPRules;

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
        var result = rules.evaluate(values);
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

  // Zpětná vazba pro stránku Pravidla a testy — pravidla samotná jen
  // přeposíláme dál, ať se na ně nikdo nemusí ptát dvakrát.
  window.MPScore = {
    attach: attach,
    evaluate: rules.evaluate,
    combos: rules.COMBOS
  };
})();
