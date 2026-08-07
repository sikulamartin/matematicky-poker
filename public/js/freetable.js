/* Stránka „Tabulka“ — ruční vyplňování pole a průběžné bodování.

   Opravy proti původní verzi:
   - skript už nespadne na chybějícím tlačítku (dřív TypeError zabil zbytek
     souboru a tabulka se přepočítávala jen díky inline oninput),
   - do buňky projde jen číslo 1–13, ne libovolný text ani vložené HTML,
   - přepočet běží na změnu, ne v intervalu 10× za sekundu,
   - přibyl posun šipkami a tlačítko pro vymazání. */
(function () {
  'use strict';

  function start() {
    var board = document.getElementById('board');
    if (!board) {
      return;
    }

    var totalScore = document.getElementById('totalScore');
    var filledCount = document.getElementById('filledCount');
    var clearButton = document.getElementById('clearButton');
    var scorer = MPScore.attach(board, totalScore);

    var cells = [];
    for (var r = 1; r <= 5; r++) {
      for (var c = 1; c <= 5; c++) {
        cells.push(board.rows[r].cells[c]);
      }
    }

    function sanitize(cell) {
      var digits = cell.textContent.replace(/[^0-9]/g, '').slice(0, 2);
      if (digits !== '') {
        var value = parseInt(digits, 10);
        if (value > 13) {
          digits = digits.slice(0, 1);   // 14 → 1, ať se dá dopsat 1..3
        } else if (value === 0) {
          digits = '';
        }
      }
      if (cell.textContent !== digits) {
        cell.textContent = digits;
        placeCaretAtEnd(cell);
      }
      cell.classList.toggle('filled', digits !== '');
    }

    function placeCaretAtEnd(el) {
      var range = document.createRange();
      var selection = window.getSelection();
      range.selectNodeContents(el);
      range.collapse(false);
      selection.removeAllRanges();
      selection.addRange(range);
    }

    function refresh() {
      var filled = cells.filter(function (cell) {
        return cell.textContent.trim() !== '';
      }).length;
      if (filledCount) {
        filledCount.textContent = filled + '/25';
      }
      scorer.recalculate();
    }

    cells.forEach(function (cell, index) {
      cell.addEventListener('input', function () {
        sanitize(cell);
        refresh();
      });

      cell.addEventListener('paste', function (event) {
        event.preventDefault();
        var text = (event.clipboardData || window.clipboardData).getData('text');
        document.execCommand('insertText', false, text.replace(/[^0-9]/g, ''));
      });

      cell.addEventListener('keydown', function (event) {
        var step = 0;
        if (event.key === 'ArrowRight') {
          step = 1;
        } else if (event.key === 'ArrowLeft') {
          step = -1;
        } else if (event.key === 'ArrowDown') {
          step = 5;
        } else if (event.key === 'ArrowUp') {
          step = -5;
        } else if (event.key === 'Enter') {
          event.preventDefault();
          cell.blur();
          return;
        }
        if (step !== 0) {
          var next = cells[index + step];
          if (next) {
            event.preventDefault();
            next.focus();
            placeCaretAtEnd(next);
          }
        }
      });
    });

    if (clearButton) {
      clearButton.addEventListener('click', function () {
        MPUI.open({
          icon: 'eraser',
          title: 'Vymazat tabulku',
          text: 'Všechna zapsaná čísla zmizí.',
          dismissible: true,
          actions: [
            { label: 'Vymazat', value: 'yes', variant: 'danger' },
            { label: 'Zpět', value: 'no', variant: 'quiet', autofocus: true }
          ]
        }).then(function (choice) {
          if (choice !== 'yes') {
            return;
          }
          cells.forEach(function (cell) {
            cell.textContent = '';
            cell.classList.remove('filled');
          });
          refresh();
          MPUI.toast('Tabulka vymazána.', '', 0, 'check');
        });
      });
    }

    refresh();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
