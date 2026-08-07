/* Vlastní dialogy a hlášky.
   Nahrazuje nativní alert() / confirm() / prompt(), které blokovaly stránku,
   nešly stylovat a u žolíků umožňovaly zadat libovolný nesmysl. */
(function () {
  'use strict';

  var overlay = null;
  var lastFocused = null;
  var closeCurrent = null;

  /* Ochranná lhůta, než dialog začne přijímat volbu.

     Dialog se otvírá synchronně uvnitř obsluhy stisku nebo kliknutí a hned
     zaostří výchozí tlačítko. Bez téhle lhůty na něj dopadl dojezd téhož
     stisku: tlačítko se aktivuje na `keyup` mezerníku, takže vložení
     posledního políčka mezerníkem rovnou potvrdilo „Hrát znovu“ a hra se
     restartovala, aniž hráč dialog stačil vidět. Stejně dopadl druhý klik
     dvojkliknutí do hracího pole, protože dialog naskočí pod kurzor. */
  var ARM_DELAY = 400;   // ms

  function ensureOverlay() {
    if (overlay) {
      return overlay;
    }
    overlay = document.createElement('div');
    overlay.className = 'overlay';
    overlay.hidden = true;
    document.body.appendChild(overlay);
    return overlay;
  }

  function trapFocus(dialog, event) {
    var focusable = dialog.querySelectorAll(
      'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])'
    );
    if (!focusable.length) {
      return;
    }
    var first = focusable[0];
    var last = focusable[focusable.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  /**
   * Otevře dialog a vrátí Promise s hodnotou zvoleného tlačítka.
   * @param {Object} config
   * @param {string} [config.icon]        název ikony nad nadpisem
   * @param {string} config.title         nadpis
   * @param {string} [config.text]        popisek
   * @param {string} [config.bodyHTML]    vlastní obsah nad tlačítky
   * @param {Array}  [config.actions]     [{ label, value, variant, autofocus }]
   * @param {boolean}[config.dismissible] lze zavřít klávesou Esc / klikem mimo
   * @param {Function}[config.onBody]     callback(bodyEl, resolve)
   */
  function open(config) {
    var host = ensureOverlay();

    // otevřený dialog nahradíme novým, ať se nehromadí
    if (closeCurrent) {
      closeCurrent(undefined);
    }

    return new Promise(function (resolve) {
      lastFocused = document.activeElement;

      var dialog = document.createElement('div');
      dialog.className = 'dialog';
      dialog.setAttribute('role', 'dialog');
      dialog.setAttribute('aria-modal', 'true');

      var html = '';
      if (config.icon) {
        html += '<div class="dialog-icon">' + window.MPIcons.markup(config.icon) + '</div>';
      }
      html += '<h2 class="dialog-title">' + config.title + '</h2>';
      if (config.text) {
        html += '<p class="dialog-text">' + config.text + '</p>';
      }
      html += '<div class="dialog-body">' + (config.bodyHTML || '') + '</div>';
      html += '<div class="dialog-actions"></div>';
      dialog.innerHTML = html;

      dialog.setAttribute('aria-label', dialog.querySelector('.dialog-title').textContent);

      var body = dialog.querySelector('.dialog-body');
      var actionsEl = dialog.querySelector('.dialog-actions');

      (config.actions || []).forEach(function (action) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'btn' + (action.variant ? ' btn--' + action.variant : '');
        button.textContent = action.label;
        button.addEventListener('click', function () {
          activate(action.value);
        });
        actionsEl.appendChild(button);
        if (action.autofocus) {
          button.setAttribute('data-autofocus', 'true');
        }
      });

      if (!actionsEl.children.length) {
        actionsEl.remove();
      }

      if (config.onBody) {
        config.onBody(body, activate);
      }

      /** Volba hráče. Během ochranné lhůty se zahodí — viz ARM_DELAY. */
      function activate(value) {
        if (!armed) {
          return;
        }
        finish(value);
      }

      function isActivationKey(key) {
        return key === 'Enter' || key === ' ' || key === 'Spacebar';
      }

      function onKeyDown(event) {
        if (!armed && isActivationKey(event.key)) {
          event.preventDefault();       // ruší i aktivaci tlačítka na keyup
          event.stopPropagation();
          return;
        }
        if (event.key === 'Escape' && config.dismissible) {
          event.preventDefault();
          activate(undefined);
        } else if (event.key === 'Tab') {
          trapFocus(dialog, event);
        }
      }

      function onKeyUp(event) {
        if (!armed && isActivationKey(event.key)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }

      function onOverlayClick(event) {
        if (event.target === host && config.dismissible) {
          activate(undefined);
        }
      }

      var armed = false;
      var armId = window.setTimeout(function () {
        armed = true;
      }, ARM_DELAY);

      var settled = false;
      function finish(value) {
        if (settled) {
          return;
        }
        settled = true;
        window.clearTimeout(armId);
        closeCurrent = null;
        document.removeEventListener('keydown', onKeyDown, true);
        document.removeEventListener('keyup', onKeyUp, true);
        host.removeEventListener('click', onOverlayClick);
        host.hidden = true;
        host.innerHTML = '';
        if (lastFocused && typeof lastFocused.focus === 'function') {
          lastFocused.focus();
        }
        resolve(value);
      }

      closeCurrent = finish;

      host.innerHTML = '';
      host.appendChild(dialog);
      host.hidden = false;
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      host.addEventListener('click', onOverlayClick);

      var target =
        dialog.querySelector('[data-autofocus]') ||
        dialog.querySelector('button, input');
      if (target) {
        target.focus();
      }
    });
  }

  /** Mřížka hodnot 1–13 pro žolíka. Vrací číslo, nebo undefined při zrušení. */
  function pickValue(config) {
    config = config || {};
    return open({
      icon: config.icon || 'joker',
      title: config.title || 'Jakou hodnotu má žolík?',
      text: config.text || 'Vyber číslo, které žolík zastoupí.',
      dismissible: config.dismissible !== false,
      actions: config.cancelLabel
        ? [{ label: config.cancelLabel, value: undefined, variant: 'quiet' }]
        : [],
      onBody: function (body, done) {
        var grid = document.createElement('div');
        grid.className = 'value-grid';
        for (var value = 1; value <= 13; value++) {
          (function (v) {
            var button = document.createElement('button');
            button.type = 'button';
            button.className = 'value-btn';
            button.textContent = String(v);
            button.addEventListener('click', function () {
              done(v);
            });
            grid.appendChild(button);
          })(value);
        }
        body.appendChild(grid);
      }
    });
  }

  var toastHost = null;

  function toast(message, variant, duration, iconName) {
    if (!toastHost) {
      toastHost = document.createElement('div');
      toastHost.className = 'toasts';
      toastHost.setAttribute('role', 'status');
      toastHost.setAttribute('aria-live', 'polite');
      document.body.appendChild(toastHost);
    }

    var el = document.createElement('div');
    el.className = 'toast' + (variant ? ' toast--' + variant : '');
    if (iconName) {
      el.innerHTML = window.MPIcons.markup(iconName);
    }
    el.appendChild(document.createTextNode(message));
    toastHost.appendChild(el);

    window.setTimeout(function () {
      el.classList.add('is-leaving');
      window.setTimeout(function () {
        if (el.parentNode) {
          el.parentNode.removeChild(el);
        }
      }, 280);
    }, duration || 2400);
  }

  /** Je otevřený nějaký dialog? Stránka pod ním nesmí reagovat na klávesy. */
  function isOpen() {
    return Boolean(closeCurrent);
  }

  window.MPUI = { open: open, pickValue: pickValue, toast: toast, isOpen: isOpen };
})();
