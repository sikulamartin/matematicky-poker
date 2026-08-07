/* Balíček: 4× hodnota 1–13 (52 karet) + 2 žolíci = 54 karet.
   Míchá se Fisherovým–Yatesovým algoritmem, karta se nikdy neopakuje. */
(function () {
  'use strict';

  var VALUES = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13];
  var COPIES = 4;
  var JOKERS = 2;

  function shuffle(array) {
    for (var i = array.length - 1; i > 0; i--) {
      var j = Math.floor(Math.random() * (i + 1));
      var tmp = array[i];
      array[i] = array[j];
      array[j] = tmp;
    }
    return array;
  }

  function buildDeck() {
    var deck = [];
    VALUES.forEach(function (value) {
      for (var i = 0; i < COPIES; i++) {
        deck.push({ type: 'number', value: value });
      }
    });
    for (var j = 0; j < JOKERS; j++) {
      deck.push({ type: 'joker', value: null });
    }
    return shuffle(deck);
  }

  function isCard(card) {
    if (!card || typeof card !== 'object') {
      return false;
    }
    if (card.type === 'joker') {
      return true;
    }
    return card.type === 'number' && VALUES.indexOf(card.value) !== -1;
  }

  function cleanCard(card) {
    return card.type === 'joker'
      ? { type: 'joker', value: null }
      : { type: 'number', value: card.value };
  }

  function create() {
    var deck = [];
    var drawn = [];

    function reset() {
      deck = buildDeck();
      drawn = [];
    }

    reset();

    return {
      /** Vytáhne kartu, nebo null když je balíček prázdný. */
      draw: function () {
        if (!deck.length) {
          return null;
        }
        var card = deck.pop();
        drawn.push(card);
        return card;
      },
      remaining: function () {
        return deck.length;
      },
      drawn: function () {
        return drawn.slice();
      },
      /** Kolik kusů každé hodnoty ještě v balíčku zbývá. */
      remainingByValue: function () {
        var map = {};
        VALUES.forEach(function (value) {
          map[value] = 0;
        });
        map.joker = 0;
        deck.forEach(function (card) {
          if (card.type === 'joker') {
            map.joker++;
          } else {
            map[card.value]++;
          }
        });
        return map;
      },
      reset: reset,
      /** Stav balíčku pro uložení — přežije reload stránky. */
      snapshot: function () {
        return { deck: deck.slice(), drawn: drawn.slice() };
      },
      /** Obnoví uložený stav. Vrací false, když jsou data poškozená. */
      restore: function (state) {
        if (!state || !Array.isArray(state.deck) || !Array.isArray(state.drawn)) {
          return false;
        }
        if (!state.deck.every(isCard) || !state.drawn.every(isCard)) {
          return false;
        }
        if (state.deck.length + state.drawn.length !== VALUES.length * COPIES + JOKERS) {
          return false;
        }
        deck = state.deck.map(cleanCard);
        drawn = state.drawn.map(cleanCard);
        return true;
      },
      size: VALUES.length * COPIES + JOKERS,
      values: VALUES.slice(),
      copies: COPIES,
      jokers: JOKERS
    };
  }

  window.MPDeck = { create: create, VALUES: VALUES, COPIES: COPIES, JOKERS: JOKERS };
})();
