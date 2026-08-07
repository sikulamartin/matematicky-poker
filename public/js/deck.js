/* Balíček pro hru v prohlížeči — tahání, historie, obnovení stavu.

   Složení balíčku a míchání leží v shared/rules.js: od zavedení žebříčku
   staví balíček i server a obě strany musí mít stejný. Tady zůstává jenom
   práce s ním. */
(function () {
  'use strict';

  var rules = window.MPRules;
  var VALUES = rules.VALUES;
  var COPIES = rules.COPIES;
  var JOKERS = rules.JOKERS;
  var buildDeck = rules.buildDeck;
  var isCard = rules.isCard;
  var cleanCard = rules.cleanCard;

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
        if (state.deck.length + state.drawn.length !== rules.DECK_SIZE) {
          return false;
        }
        deck = state.deck.map(cleanCard);
        drawn = state.drawn.map(cleanCard);
        return true;
      },
      size: rules.DECK_SIZE,
      values: VALUES.slice(),
      copies: COPIES,
      jokers: JOKERS
    };
  }

  window.MPDeck = { create: create, VALUES: VALUES, COPIES: COPIES, JOKERS: JOKERS };
})();
