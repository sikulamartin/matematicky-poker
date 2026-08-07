/* Místní hra na stránkách /easy a /hard — záložní režim.
   ==========================================================================

   Tenhle soubor si drží vlastní balíček a sám si počítá skóre, takže se
   z něj do statistik profilu nezapisuje nic. Není to opomenutí, je to celý
   důvod, proč vedle něj stojí js/online.js: číslo spočítané v prohlížeči
   hráče si hráč přepíše v konzoli a žádná kontrola s tím nic neudělá,
   protože běží na stejném místě.

   Řízení sem předá js/online.js ve chvíli, kdy server není k dispozici nebo
   hráč nemá zapnuté ukládání. Hra funguje úplně, jen se nikam nezapisuje
   a dialog na konci to říká nahlas. Sám se tenhle modul nespouští —
   vstupní bod obou stránek je online.js.

   Opravy proti původní verzi:
   - konec hry se řídí počtem zaplněných políček (25), ne proměnnou `maxRolls`,
     kterou žolíci rozhazovali; dřív se při dvou odložených žolících jeden
     žolík tiše ztratil,
   - odložený žolík už nelze ztratit — jde uplatnit kdykoli tlačítkem
     s indikátorem, a před koncem hry na ně hra sama upozorní,
   - hodnota žolíka se vybírá z mřížky 1–13, ne volným textem (dřív šlo
     zadat cokoli včetně prázdného řetězce nebo „abc“),
   - zrušení dialogu už nevede k nekonečné smyčce ani k ukončení hry,
   - restart nepotřebuje reload stránky,
   - políčka jde ovládat i klávesnicí. */
(function () {
  'use strict';

  var CELLS_TOTAL = 25;
  var AUTO_ROLL_DELAY = 260;   // ms — po vložení se další číslo natáhne samo

  function byId(id) {
    return document.getElementById(id);
  }

  /**
   * @param {Object} [options]
   * @param {string} [options.statsNote] proč se tahle partie nezapíše —
   *   ukáže se v dialogu na konci hry, aby hráč nehádal, proč čísla stojí
   */
  function start(options) {
    var board = byId('board');
    if (!board) {
      return;
    }
    var settings = options || {};

    var mode = document.body.getAttribute('data-mode') || 'easy';
    var isHard = mode === 'hard';

    var rollButton = byId('rollButton');
    var drawValue = byId('drawValue');
    var drawOrder = byId('drawOrder');
    var drawTile = byId('drawTile');
    var totalScore = byId('totalScore');
    var placedCount = byId('placedCount');
    var jokerBadge = byId('jokerBadge');
    var jokerCount = byId('jokerCount');
    var deckCount = byId('deckCount');

    var setupRow = byId('setupRow');
    var timeInput = byId('timeInput');
    var timerTile = byId('timerTile');
    var timerValue = byId('timerValue');

    var scorer = MPScore.attach(board, totalScore);
    var deck = MPDeck.create();

    var cells = [];
    for (var r = 1; r <= 5; r++) {
      for (var c = 1; c <= 5; c++) {
        cells.push(board.rows[r].cells[c]);
      }
    }

    var pending = null;      // { value, fromJoker }
    var placed = 0;
    var jokers = 0;
    var drawNo = 0;
    var over = false;
    var busy = false;        // otevřený dialog — neběží další tah
    var jokerLock = false;   // hráč si přeje táhnout dál, žolíky nepřipomínat
    var autoRollId = null;   // naplánované automatické tažení dalšího čísla
    var started = !isHard;   // těžká obtížnost startuje až po zadání času

    var timerId = null;
    var secondsPerDraw = 0;
    var secondsLeft = 0;

    /* ------------------------------------------------------- vykreslení */

    function formatTime(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function renderDraw() {
      if (pending) {
        drawValue.textContent = String(pending.value);
        drawOrder.textContent = drawNo + '. tah' + (pending.fromJoker ? ' · žolík' : '');
        drawTile.classList.remove('is-empty');
        drawValue.classList.remove('draw-pop');
        void drawValue.offsetWidth;   // restart animace
        drawValue.classList.add('draw-pop');
      } else {
        drawValue.textContent = '–';
        drawOrder.textContent = over ? 'konec hry' : 'tah';
        drawTile.classList.add('is-empty');
      }
    }

    function renderCounters() {
      placedCount.textContent = placed + '/' + CELLS_TOTAL;
      jokerCount.textContent = String(jokers);
      jokerBadge.classList.toggle('has-jokers', jokers > 0);
      jokerBadge.disabled = !(jokers > 0 && !pending && !over && started);
      jokerBadge.classList.toggle('is-armed', mustUseJoker());
      if (deckCount) {
        deckCount.textContent = String(deck.remaining());
      }
    }

    function renderBoardState() {
      board.classList.toggle('is-placing', Boolean(pending));
      cells.forEach(function (cell) {
        if (cell.classList.contains('filled')) {
          cell.removeAttribute('tabindex');
          cell.removeAttribute('role');
        } else if (pending) {
          cell.setAttribute('tabindex', '0');
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-label', 'Prázdné políčko — vlož ' + pending.value);
          cell.dataset.ghost = pending.value;   // náhled pod kurzorem
        } else {
          cell.removeAttribute('tabindex');
          cell.removeAttribute('role');
          cell.removeAttribute('aria-label');
          delete cell.dataset.ghost;
        }
      });
    }

    function renderButton() {
      if (over) {
        rollButton.textContent = 'Hrát znovu';
        rollButton.classList.add('is-restart');
        rollButton.disabled = false;
        return;
      }
      rollButton.classList.remove('is-restart');
      if (!started) {
        rollButton.textContent = 'Start';
        rollButton.disabled = !validTime();
        return;
      }
      if (mustUseJoker()) {
        rollButton.textContent = 'Použij žolíka';
        rollButton.disabled = true;
        return;
      }
      rollButton.textContent = pending
        ? 'Vlož do pole'
        : (placed > 0 ? 'Táhnout ručně' : 'Generovat');
      rollButton.disabled = Boolean(pending) || busy;
    }

    /** Balíček došel, ale hráč má v ruce žolíky — jinak by hra stála. */
    function mustUseJoker() {
      return !over && started && !pending && !busy &&
        deck.remaining() === 0 && jokers > 0 && placed < CELLS_TOTAL;
    }

    function render() {
      renderDraw();
      renderCounters();
      renderBoardState();
      renderButton();
    }

    /* ------------------------------------------------------------ časomíra */

    function validTime() {
      if (!timeInput) {
        return true;
      }
      var value = parseInt(timeInput.value, 10);
      return !Number.isNaN(value) && value >= 3 && value <= 300;
    }

    function stopTimer() {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    }

    function cancelAutoRoll() {
      if (autoRollId !== null) {
        window.clearTimeout(autoRollId);
        autoRollId = null;
      }
    }

    function paintTimer() {
      if (!timerTile) {
        return;
      }
      timerValue.textContent = formatTime(Math.max(0, secondsLeft));
      var pct = secondsPerDraw ? (secondsLeft / secondsPerDraw) * 100 : 100;
      timerTile.classList.remove('t-good', 't-warn', 't-bad');
      timerTile.classList.add(pct > 60 ? 't-good' : pct > 30 ? 't-warn' : 't-bad');
    }

    function startTimer() {
      if (!isHard || over) {
        return;
      }
      stopTimer();
      secondsLeft = secondsPerDraw;
      paintTimer();
      timerId = window.setInterval(function () {
        if (busy) {
          return;               // během dialogu se čas nekrátí
        }
        secondsLeft--;
        paintTimer();
        if (secondsLeft <= 0) {
          stopTimer();
          onTimeout();
        }
      }, 1000);
    }

    function onTimeout() {
      if (over) {
        return;
      }
      if (pending) {
        MPUI.toast('Čas vypršel, číslo ' + pending.value + ' propadlo.', 'warn', 0, 'alert');
        pending = null;
      }
      render();
      roll();
    }

    /* ---------------------------------------------------------- tah hry */

    function roll() {
      if (over || busy || pending) {
        return;
      }
      if (placed >= CELLS_TOTAL) {
        finish();
        return;
      }

      // zbývá tolik políček, kolik má hráč žolíků — jinak by o ně přišel
      if (jokers > 0 && CELLS_TOTAL - placed <= jokers && !jokerLock) {
        offerLeftoverJokers();
        return;
      }

      var card = deck.draw();
      if (!card) {
        // balíček došel — dohrát lze už jen uschovanými žolíky
        if (jokers > 0) {
          MPUI.toast('Balíček je prázdný. Zbývají jen žolíci.', 'joker', 0, 'joker');
          render();
          return;
        }
        finish('Balíček je prázdný.');
        return;
      }

      if (card.type === 'joker') {
        askJoker();
        return;
      }

      drawNo++;
      pending = { value: card.value, fromJoker: false };
      render();
      startTimer();
    }

    function askJoker() {
      busy = true;
      render();
      MPUI.open({
        icon: 'joker',
        title: 'Vytáhl jsi žolíka',
        text: 'Můžeš mu hned určit hodnotu, nebo si ho uschovat na později.',
        actions: [
          { label: 'Použít teď', value: 'now', autofocus: true },
          { label: 'Uschovat', value: 'later', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === 'now') {
          return MPUI.pickValue({
            text: 'Vyber číslo, které žolík zastoupí.',
            dismissible: false,
            cancelLabel: 'Radši uschovat'
          }).then(function (value) {
            if (typeof value === 'number') {
              busy = false;
              drawNo++;
              pending = { value: value, fromJoker: true };
              render();
              startTimer();
            } else {
              storeJoker();
            }
          });
        }
        storeJoker();
      });
    }

    function storeJoker() {
      jokers++;
      busy = false;
      MPUI.toast('Žolík uschován. Máš jich ' + jokers + '.', 'joker', 0, 'joker');
      render();
      roll();               // žolík nezabral tah, táhne se dál
    }

    function useStoredJoker() {
      if (jokers === 0 || pending || over || busy || !started) {
        return;
      }
      busy = true;
      render();
      MPUI.pickValue({
        title: 'Uplatnit uschovaného žolíka',
        text: 'Vyber číslo, které žolík zastoupí.',
        dismissible: true,
        cancelLabel: 'Zpět'
      }).then(function (value) {
        busy = false;
        if (typeof value === 'number') {
          jokers--;
          drawNo++;
          pending = { value: value, fromJoker: true };
          render();
          startTimer();
        } else {
          render();
        }
      });
    }

    function place(cell) {
      if (!pending || cell.classList.contains('filled')) {
        return;
      }
      cell.textContent = String(pending.value);
      cell.classList.add('filled', 'just-placed');
      if (pending.fromJoker) {
        cell.classList.add('from-joker');
        cell.title = 'Žolík jako ' + pending.value;
      }
      window.setTimeout(function () {
        cell.classList.remove('just-placed');
      }, 360);

      placed++;
      pending = null;
      jokerLock = false;
      scorer.recalculate();
      render();

      if (placed >= CELLS_TOTAL) {
        finish();
        return;
      }

      // Další číslo se natáhne samo. Krátká prodleva nechá doběhnout animaci
      // vložení, aby změna v konzoli nepřišla ve stejný okamžik.
      busy = true;               // po tuhle chvíli je tlačítko neaktivní
      render();
      autoRollId = window.setTimeout(function () {
        autoRollId = null;
        busy = false;
        roll();
      }, AUTO_ROLL_DELAY);
    }

    function escapeHTML(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /* Proč se partie nikam nezapsala. Mlčet by bylo horší než to říct — hráč
       by jinak nepochopil, proč po dobré hře statistiky v profilu stojí. */
    function resultNote() {
      return '<p class="dialog-note">' + window.MPIcons.markup('info') +
        escapeHTML(settings.statsNote ||
          'Tahle partie se nezapsala do statistik — hrálo se mimo server.') +
        '</p>';
    }

    function finish(reason) {
      if (over) {
        return;
      }
      over = true;
      stopTimer();
      cancelAutoRoll();
      pending = null;
      render();

      var full = placed >= CELLS_TOTAL;
      var total = scorer.getTotal();
      var text = full
        ? 'Zaplnil jsi celé pole.'
        : (reason || 'Hra skončila.') + ' Zaplněno ' + placed + ' z ' + CELLS_TOTAL + ' políček.';
      if (jokers > 0) {
        text += ' Nevyužit' + (jokers === 1 ? 'ý zůstal 1 žolík' : 'í zůstali ' + jokers + ' žolíci') + '.';
      }

      MPUI.open({
        icon: full ? 'trophy' : 'dice',
        title: 'Konec hry',
        text: text,
        dismissible: true,
        bodyHTML:
          '<div class="dialog-score">' +
          '<span class="dialog-score-value">' + total + '</span>' +
          '<span class="dialog-score-label">celkem bodů</span>' +
          '</div>' +
          resultNote(),
        actions: [
          { label: 'Hrát znovu', value: 'again', autofocus: true },
          { label: 'Zpět na výběr', value: 'back', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === 'again') {
          restart();
        } else if (choice === 'back') {
          window.location.href = 'difficulty.html';
        }
      });
    }

    function restart() {
      stopTimer();
      cancelAutoRoll();
      deck.reset();
      cells.forEach(function (cell) {
        cell.textContent = '';
        cell.classList.remove('filled', 'from-joker', 'just-placed');
        cell.removeAttribute('title');
      });
      scorer.recalculate();
      pending = null;
      placed = 0;
      jokers = 0;
      drawNo = 0;
      over = false;
      busy = false;
      jokerLock = false;

      if (isHard) {
        started = false;
        if (setupRow) {
          setupRow.hidden = false;
        }
        if (timerTile) {
          timerTile.hidden = true;
        }
      }
      render();
    }

    /** Připomene uschované žolíky, když by jinak propadly. */
    function offerLeftoverJokers() {
      var free = CELLS_TOTAL - placed;
      busy = true;
      render();
      MPUI.open({
        icon: 'joker',
        title: 'Nezapomeň na žolíky',
        text: 'Zbývá ' + free + ' ' + (free === 1 ? 'políčko' : free < 5 ? 'políčka' : 'políček') +
          ' a máš ' + jokers + ' uschovaného žolíka. Když je nepoužiješ, propadnou.',
        dismissible: false,
        actions: [
          { label: 'Uplatnit žolíka', value: 'joker', autofocus: true },
          { label: 'Táhnout z balíčku', value: 'draw', variant: 'quiet' }
        ]
      }).then(function (choice) {
        busy = false;
        if (choice === 'joker') {
          useStoredJoker();
        } else {
          jokerLock = true;      // v tomto tahu už se znovu neptáme
          render();
          roll();
        }
      });
    }

    /* ------------------------------------------------------- posluchače */

    rollButton.addEventListener('click', function () {
      if (MPUI.isOpen()) {
        return;               // tlačítko leží pod otevřeným dialogem
      }
      if (over) {
        restart();
        return;
      }
      if (!started) {
        if (!validTime()) {
          MPUI.toast('Zadej čas 3 až 300 sekund.', 'warn', 0, 'alert');
          return;
        }
        secondsPerDraw = parseInt(timeInput.value, 10);
        started = true;
        if (setupRow) {
          setupRow.hidden = true;
        }
        if (timerTile) {
          timerTile.hidden = false;
        }
        render();
        roll();
        return;
      }
      roll();
    });

    if (timeInput) {
      timeInput.addEventListener('input', renderButton);
      timeInput.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' && validTime()) {
          rollButton.click();
        }
      });
    }

    jokerBadge.addEventListener('click', useStoredJoker);

    cells.forEach(function (cell) {
      cell.addEventListener('click', function () {
        place(cell);
      });
      cell.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          place(cell);
        }
      });
    });

    // Zkratka „g“ jen táhne. Restart chce vědomé kliknutí — jinak stačilo
    // ťuknout do klávesy nad dohranou partií a pole se smazalo.
    document.addEventListener('keydown', function (event) {
      if (!event.key || event.key.toLowerCase() !== 'g') {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) {
        return;
      }
      var target = event.target;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' ||
        target.isContentEditable)) {
        return;               // hráč píše do pole, ne zkratka
      }
      if (over || MPUI.isOpen()) {
        return;
      }
      if (!rollButton.disabled) {
        rollButton.click();
      }
    });

    if (isHard && timerTile) {
      timerTile.hidden = true;
    }
    render();
  }

  /* Spouští js/online.js, až když ví, že se serverem se hrát nedá. Kdyby se
     modul spustil sám, běžely by na stránce dvě hry naráz a klik do pole by
     obsloužily obě. */
  window.MPGame = { start: start };
})();
