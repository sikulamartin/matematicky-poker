/* Přepínač vizuálních motivů.
   Nahrazuje původní dark-mode přepínač — místo dvou stavů nabízí tři motivy.
   Volba se ukládá do localStorage a platí pro všechny stránky. */
(function () {
  'use strict';

  var STORAGE_KEY = 'mp-theme';
  var DEFAULT = 'academism';

  var THEMES = [
    { id: 'terminal', label: 'Terminál' },
    { id: 'academism', label: 'Academism' },
    { id: 'legacy', label: 'Legacy' }
  ];

  // Historické názvy motivů. Komu v localStorage zůstal starý klíč, toho
  // přehodíme na nástupce, ať se mu web nepřepne zpátky na výchozí motiv.
  //   papir     → nahrazen motivem academism
  //   anthropic → přejmenován na academism
  //   studio    → přejmenován na terminal
  //   noc       → přejmenován na legacy
  var RENAMED = {
    papir: 'academism',
    anthropic: 'academism',
    studio: 'terminal',
    noc: 'legacy'
  };

  function isKnown(id) {
    return THEMES.some(function (t) {
      return t.id === id;
    });
  }

  function read() {
    var stored;
    try {
      stored = localStorage.getItem(STORAGE_KEY);
    } catch (err) {
      stored = null;
    }
    if (RENAMED[stored]) {
      stored = RENAMED[stored];
    }
    return isKnown(stored) ? stored : DEFAULT;
  }

  function apply(id) {
    document.documentElement.setAttribute('data-theme', id);
    try {
      localStorage.setItem(STORAGE_KEY, id);
    } catch (err) {
      /* soukromý režim prohlížeče — motiv prostě nepřežije reload */
    }
    syncButtons(id);
  }

  function syncButtons(id) {
    var buttons = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < buttons.length; i++) {
      var active = buttons[i].getAttribute('data-theme-set') === id;
      buttons[i].setAttribute('aria-pressed', active ? 'true' : 'false');
    }
  }

  function render(host) {
    host.className = 'theme-switch';
    host.setAttribute('role', 'group');
    host.setAttribute('aria-label', 'Vizuální motiv');
    host.innerHTML = '';

    THEMES.forEach(function (theme) {
      var button = document.createElement('button');
      button.type = 'button';
      button.setAttribute('data-theme-set', theme.id);
      button.title = 'Motiv ' + theme.label;
      // Lomítko před názvem kreslí CSS (.theme-switch button::before),
      // ať se do markupu nedostane znak, který nikdo nečte.
      button.innerHTML = '<span class="theme-name">' + theme.label + '</span>';
      button.addEventListener('click', function () {
        apply(theme.id);
      });
      host.appendChild(button);
    });
  }

  function init() {
    var hosts = document.querySelectorAll('[data-theme-switch]');
    for (var i = 0; i < hosts.length; i++) {
      render(hosts[i]);
    }
    apply(read());
  }

  // změna motivu na jiné kartě se promítne i sem
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) { return; }
    var next = RENAMED[event.newValue] || event.newValue;
    if (isKnown(next)) {
      document.documentElement.setAttribute('data-theme', next);
      syncButtons(next);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MPTheme = { apply: apply, current: read, themes: THEMES };
})();