/* Hamburgerová nabídka v liště.

   Drobečky vlevo, odkaz a přepínač motivů vpravo — na úzkém displeji se to
   vedle sebe nevejde a lišta se lámala do dvou řádků. Tenhle skript proto
   obsah .rail-actions rozdělí do pojmenovaných skupin, zabalí je do panelu
   a přidá před něj hamburger.

   Nad zlomem (860 px, viz responsive.css) je panel obyčejná řada a hamburger
   je schovaný — markup je v obou případech stejný, přepíná se jen CSS.
   Bez JS zůstane .rail-actions tak, jak přišla z HTML; přepínač motivů se
   stejně vykresluje až v theme.js, takže se tím nic navíc neztratí.

   Zařazení do skupiny
   -------------------
   Položka lišty si název své sekce nese v atributu data-rail-group. Bez něj
   spadne odkaz pod „Navigace“ a přepínač motivů pod „Motiv“. Sousední
   položky se stejným názvem sdílí jednu sekci, pořadí zůstává podle HTML.
   Přidat do lišty další ovládání tedy znamená jen napsat ho do
   .rail-actions — nabídka se přeskládá sama. */
(function () {
  'use strict';

  var NARROW = '(max-width: 860px)';
  var GROUP_DEFAULT = 'Navigace';
  var GROUP_THEME = 'Motiv';

  var media = window.matchMedia(NARROW);
  var menus = [];
  var seq = 0;

  function iconMarkup(name) {
    if (window.MPIcons) {
      return window.MPIcons.markup(name);
    }
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function setOpen(menu, open) {
    menu.open = open;
    menu.panel.setAttribute('data-open', open ? 'true' : 'false');
    menu.burger.setAttribute('aria-expanded', open ? 'true' : 'false');
    // ikona se překlopí na křížek, ať je zavření čitelné i bez animace
    var use = menu.burger.querySelector('use');
    if (use) {
      use.setAttribute('href', open ? '#i-close' : '#i-menu');
    }
  }

  function closeAll(except) {
    menus.forEach(function (menu) {
      if (menu !== except && menu.open) {
        setOpen(menu, false);
      }
    });
  }

  function groupNameOf(item) {
    var declared = item.getAttribute('data-rail-group');
    if (declared) {
      return declared;
    }
    return item.hasAttribute('data-theme-switch') ? GROUP_THEME : GROUP_DEFAULT;
  }

  /** Založí v panelu novou sekci a vrátí místo, kam se sypou položky. */
  function addGroup(panel, name, index) {
    var group = document.createElement('div');
    group.className = 'rail-group';
    group.setAttribute('role', 'group');

    var label = document.createElement('span');
    label.className = 'rail-group-label';
    label.id = panel.id + '-group-' + index;
    label.textContent = name;
    group.setAttribute('aria-labelledby', label.id);

    var items = document.createElement('div');
    items.className = 'rail-group-items';

    group.appendChild(label);
    group.appendChild(items);
    panel.appendChild(group);

    return { name: name, items: items };
  }

  function build(actions) {
    seq += 1;

    var panel = document.createElement('div');
    panel.className = 'rail-panel';
    panel.id = 'rail-panel-' + seq;

    var group = null;
    var count = 0;
    Array.prototype.slice.call(actions.children).forEach(function (item) {
      var name = groupNameOf(item);
      if (!group || group.name !== name) {
        count += 1;
        group = addGroup(panel, name, count);
      }
      group.items.appendChild(item);
    });
    // v .rail-actions zůstaly po přesunu jen bílé znaky mezi značkami
    actions.textContent = '';

    var burger = document.createElement('button');
    burger.type = 'button';
    burger.className = 'rail-burger';
    burger.setAttribute('aria-label', 'Nabídka');
    burger.setAttribute('aria-expanded', 'false');
    burger.setAttribute('aria-controls', panel.id);
    burger.innerHTML = iconMarkup('menu');

    // Hamburger stojí v DOM před panelem, ať tabulátor pokračuje z něj rovnou
    // do otevřené nabídky. Fokus se do panelu neposílá programově: prohlížeč
    // by ho vyhodnotil jako klávesový a orámoval by první položku i při
    // otevření myší.
    actions.appendChild(burger);
    actions.appendChild(panel);
    actions.setAttribute('data-nav', '');

    var menu = { actions: actions, panel: panel, burger: burger, open: false };
    setOpen(menu, false);

    burger.addEventListener('click', function () {
      var next = !menu.open;
      closeAll(menu);
      setOpen(menu, next);
    });

    // Odkaz nabídku zavírá; tlačítka motivů schválně ne, ať jde motiv
    // přepínat a rovnou vidět, jak se stránka mění.
    panel.addEventListener('click', function (event) {
      if (event.target.closest('a')) {
        setOpen(menu, false);
      }
    });

    menus.push(menu);
  }

  function init() {
    var hosts = document.querySelectorAll('.rail-actions');
    for (var i = 0; i < hosts.length; i++) {
      if (!hosts[i].hasAttribute('data-nav')) {
        build(hosts[i]);
      }
    }
  }

  document.addEventListener('click', function (event) {
    menus.forEach(function (menu) {
      if (menu.open && !menu.actions.contains(event.target)) {
        setOpen(menu, false);
      }
    });
  });

  document.addEventListener('keydown', function (event) {
    if (event.key !== 'Escape') { return; }
    menus.forEach(function (menu) {
      if (menu.open) {
        setOpen(menu, false);
        menu.burger.focus();
      }
    });
  });

  // Po roztažení okna je panel zase řada v liště — otevřený stav by pak
  // zůstal viset v aria-expanded a po zúžení by nabídka naskočila sama.
  function onMediaChange() {
    if (!media.matches) {
      closeAll(null);
    }
  }

  if (media.addEventListener) {
    media.addEventListener('change', onMediaChange);
  } else if (media.addListener) {
    media.addListener(onMediaChange);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
