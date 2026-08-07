/* Stránka „Výběr čísel“ — generátor čísel pro hru na papíře.

   Nové oproti původní verzi:
   - vypisuje všechna dosud tažená čísla včetně pořadí,
   - ukazuje, kolik kusů které hodnoty ještě v balíčku zbývá,
   - žolíka řeší vlastním dialogem místo prompt() a počítá uschované žolíky,
   - tlačítko se po vytažení nezasekne a restart nepotřebuje reload. */
(function () {
  'use strict';

  // Hra má pole 5×5, takže se táhne jen 25 čísel — zbytek balíčku se v jedné
  // hře nevyužije. Uschovaný žolík tah nespotřebuje, uplatněný ano.
  var DRAWS_TOTAL = 25;

  // Rozehraná hra přežije reload i zavření karty — maže ji jen „Zamíchat".
  var STORAGE_KEY = 'mp-picker';
  var STORAGE_VERSION = 1;

  function byId(id) {
    return document.getElementById(id);
  }

  function start() {
    var rollButton = byId('rollButton');
    if (!rollButton) {
      return;
    }

    var resetButton = byId('resetButton');
    var drawNumber = byId('drawNumber');
    var drawOrder = byId('drawOrder');
    var drawHint = byId('drawHint');
    var historyEl = byId('history');
    var historyCount = byId('historyCount');
    var deckRest = byId('deckRest');
    var deckCount = byId('deckCount');
    var jokerBadge = byId('jokerBadge');
    var jokerCount = byId('jokerCount');

    var deck = MPDeck.create();
    var history = [];     // { order, value, joker, pending }
    var jokers = 0;
    var busy = false;
    var finished = false; // konec už byl ohlášen

    function done() {
      return history.length >= DRAWS_TOTAL;
    }

    function remainingDraws() {
      return DRAWS_TOTAL - history.length;
    }

    function renderCurrent() {
      var last = history[history.length - 1];
      if (!last) {
        drawNumber.textContent = '–';
        drawNumber.className = 'draw-number is-idle';
        drawOrder.textContent = deck.remaining() ? 'zatím nic' : 'balíček došel';
        //   = nezlomitelná mezera po jednopísmenné spojce (česká sazba).
        // Musí to být znak, ne entita — text se sází přes textContent.
        drawHint.textContent = deck.remaining()
          ? 'Klikni na Generovat a balíček ti vydá kartu.'
          : 'Zamíchej balíček a hraj znovu.';
        return;
      }
      drawNumber.textContent = last.pending ? '?' : String(last.value);
      drawNumber.className = 'draw-number' + (last.joker ? ' is-joker' : '');
      drawOrder.textContent = last.order + '. číslo' + (last.joker ? ' · žolík' : '');
      if (last.pending) {
        drawHint.textContent = 'Žolík čeká na hodnotu — uplatníš ho tlačítkem se žolíkem.';
      } else if (done()) {
        drawHint.textContent = 'Pole je plné — všech ' + DRAWS_TOTAL + ' čísel padlo.';
      } else {
        drawHint.textContent = last.joker
          ? 'Žolík zastupuje hodnotu ' + last.value + '.'
          : 'Zbývá ' + remainingDraws() + ' tahů do konce hry.';
      }
    }

    function renderHistory() {
      // počítají se tahy do pole, ne karty z balíčku — uschovaný žolík
      // zabírá políčko hned, i když hodnotu dostane až později
      historyCount.textContent = history.length + ' z ' + DRAWS_TOTAL + ' čísel';

      if (!history.length) {
        historyEl.innerHTML =
          '<span class="chips-empty">Zatím nic.</span>';
        return;
      }

      var html = '';
      history.forEach(function (item, index) {
        var classes = 'chip';
        if (item.joker) {
          classes += ' chip--joker';
        }
        if (item.pending) {
          classes += ' chip--pending';
        }
        if (index === history.length - 1) {
          classes += ' chip--latest';
        }
        var title = item.order + '. tah' +
          (item.pending ? ' (uschovaný žolík — čeká na hodnotu)' : item.joker ? ' (žolík)' : '');
        html += '<span class="' + classes + '" title="' + title + '">' +
          '<span class="chip-order">' + item.order + '</span>' +
          (item.joker ? window.MPIcons.markup('joker') : '') +
          (item.pending ? '?' : item.value) +
          '</span>';
      });
      historyEl.innerHTML = html;
    }

    function renderDeck() {
      if (!deckRest) {
        return;
      }
      if (deckCount) {
        deckCount.textContent = deck.remaining() + ' karet';
      }
      var left = deck.remainingByValue();
      var html = '';
      MPDeck.VALUES.forEach(function (value) {
        var count = left[value];
        var pips = '';
        for (var i = 0; i < MPDeck.COPIES; i++) {
          pips += '<span class="deck-pip' + (i < count ? '' : ' is-used') + '"></span>';
        }
        html += '<div class="deck-slot' + (count === 0 ? ' is-out' : '') + '">' +
          '<span class="deck-slot-val">' + value + '</span>' +
          '<span class="deck-slot-pips">' + pips + '</span>' +
          '</div>';
      });
      var jokerLeft = left.joker;
      var jokerPips = '';
      for (var j = 0; j < MPDeck.JOKERS; j++) {
        jokerPips += '<span class="deck-pip' + (j < jokerLeft ? '' : ' is-used') + '"></span>';
      }
      html += '<div class="deck-slot' + (jokerLeft === 0 ? ' is-out' : '') + '">' +
        window.MPIcons.markup('joker') +
        '<span class="deck-slot-pips">' + jokerPips + '</span>' +
        '</div>';
      deckRest.innerHTML = html;
    }

    function renderControls() {
      var empty = deck.remaining() === 0;
      rollButton.disabled = busy || empty || done();
      rollButton.textContent = done()
        ? 'Hotovo — ' + DRAWS_TOTAL + ' čísel'
        : (empty ? 'Balíček je prázdný' : 'Generovat');
      jokerCount.textContent = String(jokers);
      jokerBadge.classList.toggle('has-jokers', jokers > 0);
      // uschovaný žolík jde uplatnit i po 25. tahu — políčko si už zabral
      jokerBadge.disabled = !(jokers > 0) || busy;
      if (resetButton) {
        resetButton.disabled = history.length === 0 && jokers === 0;
      }
    }

    function render() {
      renderCurrent();
      renderHistory();
      renderDeck();
      renderControls();
      save();
    }

    /* ------------------------------------------------------ uložení stavu */

    function save() {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify({
          v: STORAGE_VERSION,
          deck: deck.snapshot(),
          history: history,
          finished: finished
        }));
      } catch (err) { /* localStorage nedostupný — hra jen nepřežije reload */ }
    }

    function validEntry(item) {
      return item && typeof item === 'object' &&
        (item.value === null || MPDeck.VALUES.indexOf(item.value) !== -1) &&
        (!item.pending || item.joker);
    }

    function load() {
      var raw;
      try {
        raw = localStorage.getItem(STORAGE_KEY);
      } catch (err) {
        return;
      }
      if (!raw) {
        return;
      }
      var state;
      try {
        state = JSON.parse(raw);
      } catch (err) {
        return;
      }
      if (!state || state.v !== STORAGE_VERSION || !Array.isArray(state.history)) {
        return;
      }
      if (!state.history.every(validEntry) || !deck.restore(state.deck)) {
        return;
      }

      history = state.history.slice(0, DRAWS_TOTAL).map(function (item, index) {
        return {
          order: index + 1,
          value: item.pending ? null : item.value,
          joker: Boolean(item.joker),
          pending: Boolean(item.pending)
        };
      });

      // Reload uprostřed dialogu o žolíkovi: karta z balíčku zmizela, ale do
      // historie se nestihla zapsat. Doplní se jako uschovaný žolík.
      var missing = (deck.size - deck.remaining()) - history.length;
      while (missing > 0 && history.length < DRAWS_TOTAL) {
        history.push({ order: history.length + 1, value: null, joker: true, pending: true });
        missing--;
      }

      jokers = history.filter(function (item) {
        return item.pending;
      }).length;
      finished = Boolean(state.finished) || (done() && !firstPending());
    }

    function push(value, joker, pending) {
      history.push({
        order: history.length + 1,
        value: value,
        joker: Boolean(joker),
        pending: Boolean(pending)
      });
      checkFinish();
    }

    /** Nevyřízený uschovaný žolík — nejstarší napřed. */
    function firstPending() {
      for (var i = 0; i < history.length; i++) {
        if (history[i].pending) {
          return history[i];
        }
      }
      return null;
    }

    /** Hlásí konec, až je zaplněných 25 tahů a žádný žolík nečeká na hodnotu. */
    function checkFinish() {
      if (!done() || finished) {
        return;
      }
      if (firstPending()) {
        MPUI.toast('Zbývá určit hodnotu ' + (jokers === 1 ? 'žolíkovi' : jokers + ' žolíkům') + '.',
          'joker', 0, 'joker');
        return;
      }
      finished = true;
      MPUI.toast('Hra skončila — padlo všech ' + DRAWS_TOTAL + ' čísel.', '', 0, 'trophy');
    }

    function roll() {
      if (busy || done() || deck.remaining() === 0) {
        return;
      }
      var card = deck.draw();
      if (!card) {
        render();
        return;
      }
      if (card.type === 'joker') {
        askJoker();
        return;
      }
      push(card.value, false);
      render();
    }

    function askJoker() {
      busy = true;
      render();
      MPUI.open({
        icon: 'joker',
        title: 'Žolík',
        text: 'Urči mu hodnotu hned, nebo si ho ulož na později.',
        actions: [
          { label: 'Použít teď', value: 'now', autofocus: true },
          { label: 'Uschovat', value: 'later', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === 'now') {
          return MPUI.pickValue({
            dismissible: false,
            cancelLabel: 'Radši uschovat'
          }).then(function (value) {
            busy = false;
            if (typeof value === 'number') {
              push(value, true);
              render();
            } else {
              storeJoker();
            }
          });
        }
        busy = false;
        storeJoker();
      });
    }

    function storeJoker() {
      jokers++;
      // žolík zabírá políčko hned — do historie jde jako „?" a čeká na hodnotu
      push(null, true, true);
      MPUI.toast('Žolík uschován jako ' + history.length + '. číslo. Máš jich ' + jokers + '.',
        'joker', 0, 'joker');
      render();
    }

    function useStoredJoker() {
      if (!jokers || busy) {
        return;
      }
      var slot = firstPending();
      if (!slot) {
        return;
      }
      busy = true;
      render();
      MPUI.pickValue({
        title: 'Uplatnit uschovaného žolíka',
        dismissible: true,
        cancelLabel: 'Zpět'
      }).then(function (value) {
        busy = false;
        if (typeof value === 'number') {
          jokers--;
          slot.value = value;
          slot.pending = false;
          checkFinish();
        }
        render();
      });
    }

    function reset() {
      deck.reset();
      history = [];
      jokers = 0;
      busy = false;
      finished = false;
      render();
    }

    load();

    rollButton.addEventListener('click', roll);
    jokerBadge.addEventListener('click', useStoredJoker);

    if (resetButton) {
      resetButton.addEventListener('click', function () {
        MPUI.open({
          icon: 'shuffle',
          title: 'Zamíchat balíček',
          text: 'Historie tažených čísel se smaže a balíček se zamíchá znovu.',
          dismissible: true,
          actions: [
            { label: 'Zamíchat', value: 'yes', variant: 'danger' },
            { label: 'Zpět', value: 'no', variant: 'quiet', autofocus: true }
          ]
        }).then(function (choice) {
          if (choice === 'yes') {
            reset();
            MPUI.toast('Balíček zamíchán.', '', 0, 'shuffle');
          }
        });
      });
    }

    document.addEventListener('keydown', function (event) {
      if (event.key === ' ' || event.key.toLowerCase() === 'g') {
        if (document.activeElement === document.body && !rollButton.disabled) {
          event.preventDefault();
          roll();
        }
      }
    });

    render();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
