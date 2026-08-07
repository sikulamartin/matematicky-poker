/* Přepínač vizuálních motivů.
   Nahrazuje původní dark-mode přepínač — místo dvou stavů nabízí tři motivy.
   Volba se ukládá do localStorage a platí pro všechny stránky.

   Motivy stály v liště vedle sebe jako řada tří tlačítek a braly šířku,
   kterou lišta potřebuje na drobečky. Teď je vidět jen ten zvolený a zbytek
   se rozbalí pod ním — spouštěč (aria-haspopup="listbox") plus seznam
   (role="listbox", role="option"). V hamburgerové nabídce se seznam rozloží
   napevno a spouštěč se schová (responsive.css); rozbalovátko uvnitř
   rozbalovátka by tam bylo o jedno patro nabídky navíc a panel má
   overflow-y: auto, takže by mu vyskakovací seznam ořízl. */
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

  var menus = [];
  var seq = 0;

  function isKnown(id) {
    return THEMES.some(function (t) {
      return t.id === id;
    });
  }

  function labelOf(id) {
    for (var i = 0; i < THEMES.length; i++) {
      if (THEMES[i].id === id) {
        return THEMES[i].label;
      }
    }
    return id;
  }

  function iconMarkup(name, className) {
    if (window.MPIcons) {
      return window.MPIcons.markup(name, className);
    }
    return '<svg class="icon ' + className + '" aria-hidden="true">' +
      '<use href="#i-' + name + '"></use></svg>';
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
    sync(id);
  }

  /** Srovná zaškrtnutí v seznamu a název na spouštěči s platným motivem. */
  function sync(id) {
    var options = document.querySelectorAll('[data-theme-set]');
    for (var i = 0; i < options.length; i++) {
      var active = options[i].getAttribute('data-theme-set') === id;
      options[i].setAttribute('aria-selected', active ? 'true' : 'false');
    }
    var labels = document.querySelectorAll('[data-theme-current]');
    for (var j = 0; j < labels.length; j++) {
      labels[j].textContent = labelOf(id);
    }
  }

  function setOpen(menu, open) {
    menu.open = open;
    menu.list.setAttribute('data-open', open ? 'true' : 'false');
    menu.trigger.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  function closeAll(except) {
    menus.forEach(function (menu) {
      if (menu !== except && menu.open) {
        setOpen(menu, false);
      }
    });
  }

  // V hamburgerové nabídce je spouštěč schovaný (display: none) a seznam
  // stojí napevno. Fokus se tam nemá kam vracet, tak se o to nepokoušíme.
  function triggerVisible(menu) {
    return menu.trigger.offsetParent !== null;
  }

  function selectedIndex(menu) {
    for (var i = 0; i < menu.options.length; i++) {
      if (menu.options[i].getAttribute('aria-selected') === 'true') {
        return i;
      }
    }
    return 0;
  }

  function focusOption(menu, index) {
    var last = menu.options.length - 1;
    var target = index < 0 ? 0 : (index > last ? last : index);
    menu.options[target].focus();
  }

  function render(host) {
    seq += 1;
    var triggerId = 'theme-trigger-' + seq;
    var listId = 'theme-list-' + seq;

    host.className = 'theme-menu';
    host.innerHTML = '';

    var trigger = document.createElement('button');
    trigger.type = 'button';
    trigger.id = triggerId;
    trigger.className = 'theme-trigger';
    trigger.setAttribute('aria-haspopup', 'listbox');
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', listId);
    trigger.setAttribute('aria-label', 'Vizuální motiv');
    trigger.title = 'Vizuální motiv';
    // Lomítko před názvem kreslí CSS (.theme-menu .theme-name::before),
    // ať se do markupu nedostane znak, který nikdo nečte.
    trigger.innerHTML = '<span class="theme-name" data-theme-current></span>' +
      iconMarkup('chevronDown', 'theme-caret');

    var list = document.createElement('div');
    list.id = listId;
    list.className = 'theme-list';
    list.setAttribute('role', 'listbox');
    list.setAttribute('aria-labelledby', triggerId);
    list.setAttribute('data-open', 'false');

    var menu = { host: host, trigger: trigger, list: list, options: [], open: false };

    THEMES.forEach(function (theme) {
      var option = document.createElement('button');
      option.type = 'button';
      option.className = 'theme-option';
      option.setAttribute('role', 'option');
      option.setAttribute('aria-selected', 'false');
      option.setAttribute('data-theme-set', theme.id);
      option.title = 'Motiv ' + theme.label;
      option.innerHTML = '<span class="theme-name">' + theme.label + '</span>' +
        iconMarkup('check', 'theme-check');
      option.addEventListener('click', function () {
        apply(theme.id);
        setOpen(menu, false);
        if (triggerVisible(menu)) {
          trigger.focus();
        }
      });
      list.appendChild(option);
      menu.options.push(option);
    });

    trigger.addEventListener('click', function () {
      var next = !menu.open;
      closeAll(menu);
      setOpen(menu, next);
      if (next) {
        focusOption(menu, selectedIndex(menu));
      }
    });

    trigger.addEventListener('keydown', function (event) {
      if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') { return; }
      event.preventDefault();
      closeAll(menu);
      setOpen(menu, true);
      focusOption(menu, event.key === 'ArrowUp'
        ? menu.options.length - 1
        : selectedIndex(menu));
    });

    list.addEventListener('keydown', function (event) {
      var index = menu.options.indexOf(document.activeElement);
      var last = menu.options.length - 1;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        focusOption(menu, index < last ? index + 1 : 0);
      } else if (event.key === 'ArrowUp') {
        event.preventDefault();
        focusOption(menu, index > 0 ? index - 1 : last);
      } else if (event.key === 'Home') {
        event.preventDefault();
        focusOption(menu, 0);
      } else if (event.key === 'End') {
        event.preventDefault();
        focusOption(menu, last);
      } else if (event.key === 'Escape' && menu.open) {
        // Escape v nabídce lišty patří panelu (nav.js) — bublinu nedusíme,
        // ale seznam si zavřeme sami, ať v něm nezůstane otevřený stav.
        setOpen(menu, false);
        if (triggerVisible(menu)) {
          event.preventDefault();
          trigger.focus();
        }
      }
    });

    // Tabulátor ven ze seznamu ho zavírá; relatedTarget je prvek, na který
    // fokus odchází (null, když odchází z okna — to seznam nechává být).
    host.addEventListener('focusout', function (event) {
      if (!menu.open) { return; }
      if (event.relatedTarget && !host.contains(event.relatedTarget)) {
        setOpen(menu, false);
      }
    });

    host.appendChild(trigger);
    host.appendChild(list);
    menus.push(menu);
  }

  function init() {
    var hosts = document.querySelectorAll('[data-theme-switch]');
    for (var i = 0; i < hosts.length; i++) {
      render(hosts[i]);
    }
    apply(read());
  }

  document.addEventListener('click', function (event) {
    menus.forEach(function (menu) {
      if (menu.open && !menu.host.contains(event.target)) {
        setOpen(menu, false);
      }
    });
  });

  // změna motivu na jiné kartě se promítne i sem
  window.addEventListener('storage', function (event) {
    if (event.key !== STORAGE_KEY) { return; }
    var next = RENAMED[event.newValue] || event.newValue;
    if (isKnown(next)) {
      document.documentElement.setAttribute('data-theme', next);
      sync(next);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MPTheme = { apply: apply, current: read, themes: THEMES };
})();
