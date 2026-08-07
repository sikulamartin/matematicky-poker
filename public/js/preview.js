/* Náhled bodů před položením.
   ==========================================================================

   Do každého volného políčka se dopíše, kolik bodů by tam čekající číslo
   přineslo hned teď. Bez toho je hra na začátku hádání: hráč vidí dvanáct
   linií, ale kolik z nich položením trefí, si musí spočítat v hlavě —
   a u úhlopříček to většina lidí neudělá vůbec.

   Není to solver. Ukazuje se okamžitý zisk, ne cena za to, že políčko
   zabereš, a právě ta v téhle hře rozhoduje: nejvyšší číslo na poli bývá
   často ten nejhorší tah. Zvýrazněné maximum je proto jen pomůcka pro
   scanování očima, ne doporučení.

   Proč to smí počítat prohlížeč
   -----------------------------
   Protože nepočítá nic, co by hráč neviděl. Mřížka je na obrazovce, čekající
   číslo taky; zbytek balíčku, který server v `publicState()` schválně tají,
   do výpočtu nevstupuje. Serverové skóre to neovlivní — po položení ho
   stejně přepíše odpověď ze serveru.

   Proč se čte z DOM, a ne z herního stavu
   ---------------------------------------
   Klienti jsou tři (game.js, online.js, skupina.js) a každý si pole drží
   jinak: místní hra vůbec nemá mřížku jako pole, serverová ji dostává
   z odpovědi, skupinová ji má schovanou pod hráčem v lobby. Políčka ale
   všichni vyplňují stejně. Jeden vstup místo tří kopií téhož převodu.

   Volající proto musí zavolat `paint()` až POTÉ, co do buněk zapíše hodnoty
   a popisky — čtou se obojí.
   ========================================================================== */
(function () {
  'use strict';

  var KEY = 'mp-preview';
  var rules = window.MPRules;

  /* Výchozí stav je zapnuto. Vypínač sedí přímo nad polem, takže se dá najít;
     opačné pořadí by znamenalo, že o funkci většina hráčů nikdy nezakopne. */
  var on = read();

  /* Poslední vykreslení, aby se dalo překreslit po přepnutí vypínače bez
     toho, aby o něm musel vědět každý klient zvlášť. */
  var lastCells = null;
  var lastValue = null;

  var chips = [];

  function read() {
    try {
      return localStorage.getItem(KEY) !== '0';
    } catch (err) {
      return true;             // localStorage nedostupný — náhled prostě jede
    }
  }

  function write(value) {
    try {
      localStorage.setItem(KEY, value ? '1' : '0');
    } catch (err) {
      /* bez uložení platí volba jen do zavření karty */
    }
  }

  /* ------------------------------------------------------------- výpočet */

  /** Text buňky → číslo, nebo null když je prázdná. Stejně jako js/scoring.js. */
  function valueOf(cell) {
    var text = cell.textContent.replace(/\s+/g, '');
    if (text === '') {
      return null;
    }
    var value = parseInt(text, 10);
    return Number.isNaN(value) ? null : value;
  }

  function readGrid(cells) {
    var grid = [];
    for (var r = 0; r < 5; r++) {
      var row = [];
      for (var c = 0; c < 5; c++) {
        row.push(valueOf(cells[r * 5 + c]));
      }
      grid.push(row);
    }
    return grid;
  }

  function points(values) {
    return rules.evaluate(values).points;
  }

  /** Body linie s dočasně dosazenou hodnotou. Pole se vrátí, jak bylo. */
  function withValue(values, index, value) {
    var was = values[index];
    values[index] = value;
    var result = points(values);
    values[index] = was;
    return result;
  }

  /**
   * O kolik bodů stoupne celkové skóre, když se `value` položí na to které
   * políčko.
   *
   * Přepočítávají se jen linie, kterých se políčko dotýká — řádek, sloupec
   * a případně jedna nebo obě úhlopříčky. Zbytek pole se změnit nemůže, takže
   * celý `scoreGrid()` by byl pětadvacetkrát zbytečná práce.
   *
   * @param {Array<Array<number|null>>} grid 5×5
   * @param {number} value hodnota 1–13
   * @returns {Array<number|null>} 25 položek po řádcích; null = obsazeno
   */
  function deltas(grid, value) {
    var out = new Array(25);
    var r;
    var c;

    var rows = grid.map(function (row) {
      return row.slice();
    });
    var cols = [];
    for (c = 0; c < 5; c++) {
      cols.push(grid.map(function (row) {
        return row[c];
      }));
    }
    var diagA = grid.map(function (row, i) {
      return row[i];
    });
    var diagB = grid.map(function (row, i) {
      return row[4 - i];
    });

    var baseRow = rows.map(points);
    var baseCol = cols.map(points);
    var baseA = points(diagA);
    var baseB = points(diagB);

    for (r = 0; r < 5; r++) {
      for (c = 0; c < 5; c++) {
        if (grid[r][c] !== null) {
          out[r * 5 + c] = null;
          continue;
        }
        var gain = (withValue(rows[r], c, value) - baseRow[r]) +
          (withValue(cols[c], r, value) - baseCol[c]);
        if (r === c) {
          gain += withValue(diagA, r, value) - baseA;
        }
        if (r + c === 4) {
          gain += withValue(diagB, r, value) - baseB;
        }
        out[r * 5 + c] = gain;
      }
    }
    return out;
  }

  /* --------------------------------------------------------- vykreslení */

  function strip(cell) {
    cell.removeAttribute('data-delta');
    cell.classList.remove('is-best');
  }

  /**
   * Smaže náhled ze všech buněk. Volá se při restartu, kdy pole ještě není
   * překreslené a `paint()` by tedy četla čísla z minulé partie.
   */
  function clear(cells) {
    lastCells = null;
    lastValue = null;
    cells.forEach(strip);
  }

  /**
   * Vykreslí náhled.
   * @param {Array<HTMLElement>} cells 25 buněk po řádcích
   * @param {number|null} value čekající hodnota; null = není co pokládat
   */
  function paint(cells, value) {
    lastCells = cells;
    lastValue = typeof value === 'number' ? value : null;

    if (!on || lastValue === null || !rules) {
      cells.forEach(strip);
      return;
    }

    var list = deltas(readGrid(cells), lastValue);
    var best = 0;
    list.forEach(function (gain) {
      if (gain !== null && gain > best) {
        best = gain;
      }
    });

    cells.forEach(function (cell, index) {
      var gain = list[index];
      if (gain === null || gain <= 0) {
        strip(cell);
        return;
      }
      cell.setAttribute('data-delta', '+' + gain);
      cell.classList.toggle('is-best', gain === best);

      /* Popisek pro odečítač obrazovky. Zisk je vždycky násobek pěti (rozdíl
         dvou kombinací z bodovací tabulky) a nejmenší možný je pět, takže se
         skloňuje pokaždé „bodů“. Volající popisek nastavuje před každým
         překreslením znovu, takže se přípona nenabaluje. */
      var label = cell.getAttribute('aria-label');
      if (label) {
        cell.setAttribute('aria-label', label + ' — získáš ' + gain + ' bodů');
      }
    });
  }

  function repaint() {
    if (lastCells) {
      paint(lastCells, lastValue);
    }
  }

  /* ------------------------------------------------------------ vypínač */

  /* Jen ikona, bez popisky. Slovo „Náhled“ v konzoli zabralo tolik místa, že
     se na běžné šířce monitoru ovládání zalomilo na druhý řádek — a konzole
     má být jeden tenký pruh, aby poli zbylo co nejvíc místa. Význam nese
     ikona, barva stavu, `title` a `aria-label`. */
  function dress(chip) {
    var text = on ? 'Náhled bodů: zapnutý' : 'Náhled bodů: vypnutý';
    chip.setAttribute('aria-pressed', on ? 'true' : 'false');
    chip.setAttribute('aria-label', text);
    chip.title = text + ' — kolik bodů by čekající číslo přineslo na volných políčkách';
    chip.innerHTML = window.MPIcons.markup(on ? 'eye' : 'eyeOff');
  }

  function set(value) {
    var next = Boolean(value);
    if (next === on) {
      return;
    }
    on = next;
    write(on);
    chips.forEach(dress);
    repaint();
  }

  /**
   * Postaví vypínač do zadaného místa (nebo do každého [data-preview-switch]
   * na stránce). Stejný postup jako u přepínače motivů v js/theme.js —
   * v HTML stojí prázdný div, obsah dodává JS.
   */
  function mount(host) {
    var hosts = host ? [host]
      : Array.prototype.slice.call(document.querySelectorAll('[data-preview-switch]'));
    hosts.forEach(function (place) {
      var chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'preview-chip';
      dress(chip);
      chip.addEventListener('click', function () {
        set(!on);
      });
      place.appendChild(chip);
      chips.push(chip);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () {
      mount();
    });
  } else {
    mount();
  }

  window.MPPreview = {
    enabled: function () {
      return on;
    },
    set: set,
    deltas: deltas,
    paint: paint,
    clear: clear,
    mount: mount
  };
})();
