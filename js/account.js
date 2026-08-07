/* Odznak účtu v liště a dialogy nad ním.

   Do .rail-actions přidá jedno tlačítko s iniciálami a přezdívkou aktivního
   profilu. Skupinu si nese v data-rail-group, takže se ve sbalené nabídce
   (js/nav.js) samo zařadí pod vlastní nadpis — v liště nic dalšího nastavovat
   nemusíme.

   Skript musí být načtený PŘED js/nav.js: nav.js si obsah .rail-actions
   přebere do panelu a co přijde později, už by do nabídky nespadlo. */
(function () {
  'use strict';

  var slot = null;
  var chip = null;

  function iconMarkup(name) {
    if (window.MPIcons) {
      return window.MPIcons.markup(name);
    }
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function store() {
    return window.MPStore;
  }

  /* ------------------------------------------------------------- odznak */

  function render() {
    if (!chip) {
      return;
    }
    var profile = store() ? store().active() : null;
    var name = profile ? profile.name : 'Host';
    var mark = profile ? store().initials(profile.name) : '?';

    chip.classList.toggle('is-anon', !profile);
    chip.innerHTML =
      '<span class="account-avatar">' + escapeHTML(mark) + '</span>' +
      '<span class="account-name">' + escapeHTML(name) + '</span>' +
      iconMarkup('chevronDown');
    chip.setAttribute('aria-label', profile
      ? 'Účet ' + name + ' — otevřít nabídku'
      : 'Zatím žádný profil — otevřít nabídku');
    chip.title = chip.getAttribute('aria-label');
  }

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function mount() {
    var actions = document.querySelector('.rail-actions');
    if (!actions || document.querySelector('.account-slot')) {
      return;
    }

    slot = document.createElement('div');
    slot.className = 'account-slot';
    slot.setAttribute('data-rail-group', 'Účet');

    chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'account-chip';
    chip.addEventListener('click', openMenu);

    slot.appendChild(chip);
    actions.appendChild(slot);
    render();
  }

  /* ------------------------------------------------------------ dialogy */

  function summary(profile) {
    var s = profile.stats;
    var parts = [s.games + ' ' + plural(s.games, 'hra', 'hry', 'her')];
    if (s.best > 0) {
      parts.push('nejlépe ' + s.best + ' b.');
    }
    return parts.join(' · ');
  }

  function plural(count, one, few, many) {
    if (count === 1) {
      return one;
    }
    return count >= 2 && count <= 4 ? few : many;
  }

  function openMenu() {
    if (!store() || !window.MPUI) {
      return;
    }
    var profiles = store().list();
    var activeId = store().activeId();
    var persists = store().persists();

    window.MPUI.open({
      icon: 'user',
      title: 'Účet',
      text: profiles.length
        ? 'Statistiky se počítají tomu profilu, který je vybraný.'
        : 'Založ si lokální profil a hra si začne pamatovat tvoje výsledky.',
      dismissible: true,
      actions: [
        { label: 'Profil a statistiky', value: 'page', autofocus: true },
        { label: 'Nový profil', value: 'new', variant: 'quiet' },
        { label: 'Zavřít', value: undefined, variant: 'ghost' }
      ],
      onBody: function (body, done) {
        if (!persists) {
          var note = document.createElement('div');
          note.className = 'note note--warn';
          note.innerHTML = iconMarkup('alert') +
            '<p>Ukládání je vypnuté, takže se profil i statistiky ztratí se zavřením karty. ' +
            'Zapnout jde v <a href="privacy.html">nastavení soukromí</a>.</p>';
          body.appendChild(note);
        }
        if (!profiles.length) {
          return;
        }
        var list = document.createElement('div');
        list.className = 'picker-list';
        profiles.forEach(function (profile) {
          var row = document.createElement('button');
          row.type = 'button';
          row.className = 'picker-row';
          row.setAttribute('aria-current', profile.id === activeId ? 'true' : 'false');
          row.innerHTML =
            '<span class="account-avatar">' + escapeHTML(store().initials(profile.name)) + '</span>' +
            '<span class="picker-copy">' +
            '<span class="picker-name">' + escapeHTML(profile.name) + '</span>' +
            '<span class="picker-meta">' + escapeHTML(summary(profile)) + '</span>' +
            '</span>' +
            (profile.id === activeId ? iconMarkup('check') : '');
          row.addEventListener('click', function () {
            store().setActive(profile.id);
            done('switched');
          });
          list.appendChild(row);
        });
        body.appendChild(list);
      }
    }).then(function (choice) {
      if (choice === 'page') {
        window.location.href = 'account.html';
      } else if (choice === 'new') {
        promptNewProfile();
      } else if (choice === 'switched') {
        var current = store().active();
        window.MPUI.toast('Hraje ' + (current ? current.name : 'host') + '.', null, 0, 'user');
      }
    });
  }

  /** Dialog s textovým polem pro přezdívku. Vrací Promise s názvem. */
  function promptName(config) {
    return window.MPUI.open({
      icon: config.icon || 'user',
      title: config.title,
      text: config.text,
      dismissible: true,
      actions: [{ label: 'Zpět', value: undefined, variant: 'quiet' }],
      onBody: function (body, done) {
        var form = document.createElement('form');
        form.className = 'name-form';
        form.noValidate = true;

        var input = document.createElement('input');
        input.type = 'text';
        input.className = 'field-text';
        input.maxLength = store().limits.nameMax;
        input.placeholder = config.placeholder || 'Přezdívka';
        input.value = config.value || '';
        input.setAttribute('aria-label', 'Přezdívka');
        input.autocomplete = 'off';

        var submit = document.createElement('button');
        submit.type = 'submit';
        submit.className = 'btn';
        submit.textContent = config.submitLabel || 'Uložit';

        form.appendChild(input);
        form.appendChild(submit);
        form.addEventListener('submit', function (event) {
          event.preventDefault();
          var value = input.value.trim();
          if (!value) {
            input.focus();
            return;
          }
          done(value);
        });
        body.appendChild(form);
      }
    });
  }

  function promptNewProfile() {
    if (store().list().length >= store().limits.profilesMax) {
      window.MPUI.toast(
        'Víc než ' + store().limits.profilesMax + ' profilů na jednom prohlížeči nejde.',
        'warn', 0, 'alert'
      );
      return;
    }
    promptName({
      title: 'Nový profil',
      text: 'Stačí přezdívka — žádný e‑mail ani heslo. Zůstane jen v tomhle prohlížeči.',
      submitLabel: 'Založit'
    }).then(function (name) {
      if (typeof name !== 'string') {
        return;
      }
      var profile = store().create(name);
      if (profile) {
        window.MPUI.toast('Profil ' + profile.name + ' je připravený.', null, 0, 'check');
      }
    });
  }

  /* --------------------------------------------------------------- start */

  function init() {
    mount();
    if (store()) {
      store().onChange(render);
      // Stránka Profil má na poškozený zápis vlastní vysvětlující poznámku,
      // jinde se to hráč jinak než hláškou nedozví.
      if (store().tampered() && window.MPUI && !document.getElementById('statsWarning')) {
        window.MPUI.toast('Uložené statistiky neseděly — vynulovaly se.', 'warn', 4200, 'alert');
      }
    }
    if (window.MPConsent) {
      window.MPConsent.onChange(render);
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  window.MPAccount = {
    promptName: promptName,
    promptNewProfile: promptNewProfile,
    openMenu: openMenu,
    refresh: render
  };
})();
