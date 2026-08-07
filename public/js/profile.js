/* Stránka Profil — statistiky, správa lokálních účtů a nakládání s daty.

   Všechno kreslí JS, protože obsah závisí na tom, co je v úložišti. Statická
   kostra v HTML by při prvním načtení blikla prázdnými čísly.

   Odkud jsou čísla
   ----------------
   Statistiky vede server (netlify/functions/lib/stats.mjs) — připisuje si je
   sám po partii, kterou sám odehrál. Prohlížeč je jenom zrcadlí, aby se
   stránka dala otevřít i bez spojení. Proto se při načtení zkusí stáhnout
   čerstvá čísla a teprve když to nevyjde, ukáže se poslední známý stav
   s poznámkou, že je z mezipaměti. */
(function () {
  'use strict';

  var grid, who, warning, listHost, countEl, consentPill, consentButton, consentDesc;
  var publishButton, publishDesc, sourceNote, sourceText;

  /* Stav posledního pokusu o stažení: 'fresh' | 'cached' | 'none' | 'loading' */
  var source = 'loading';

  function icon(name) {
    return window.MPIcons.markup(name);
  }

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function plural(count, one, few, many) {
    if (count === 1) {
      return one;
    }
    return count >= 2 && count <= 4 ? few : many;
  }

  /* --------------------------------------------------------- statistiky */

  function cards(profile) {
    var s = profile ? profile.stats : MPStore.emptyStats();
    var modeLabel = s.fastestMode === 'hard' ? 'těžká obtížnost'
      : s.fastestMode === 'easy' ? 'lehká obtížnost' : 'zatím žádná dohraná hra';

    return [
      {
        icon: 'star',
        label: 'Nejlepší skóre',
        value: s.best,
        meta: 'napříč oběma obtížnostmi',
        empty: s.best === 0
      },
      {
        icon: 'gauge',
        label: 'Rekord — lehká',
        value: s.bestEasy,
        meta: 'hra bez časomíry',
        empty: s.bestEasy === 0
      },
      {
        icon: 'timer',
        label: 'Rekord — těžká',
        value: s.bestHard,
        meta: 'hra s odpočtem na tah',
        empty: s.bestHard === 0
      },
      {
        icon: 'dice',
        label: 'Hraných her',
        value: s.games,
        meta: s.finished + ' ' + plural(s.finished, 'dohraná', 'dohrané', 'dohraných') +
          ' do posledního políčka',
        empty: s.games === 0
      },
      {
        icon: 'bolt',
        label: 'Nejrychlejší hra',
        value: MPStore.formatDuration(s.fastestMs),
        meta: modeLabel,
        empty: s.fastestMs === null
      }
    ];
  }

  function renderStats(profile) {
    grid.innerHTML = cards(profile).map(function (card) {
      return '<div class="stat-card' + (card.empty ? ' is-empty' : '') + '">' +
        '<span class="stat-card-head">' + icon(card.icon) +
        escapeHTML(card.label) + '</span>' +
        '<span class="stat-card-value">' + escapeHTML(String(card.value)) + '</span>' +
        '<span class="stat-card-meta">' + escapeHTML(card.meta) + '</span>' +
        '</div>';
    }).join('');

    who.textContent = profile ? profile.name : 'zatím žádný profil';
    warning.hidden = !MPStore.tampered();
    renderSource(profile);
  }

  var SOURCE_TEXT = {
    loading: 'Načítám ověřená čísla ze serveru…',
    fresh: 'Čísla právě přišla ze serveru. Počítá si je sám z partií, které ' +
      'odehrál — v prohlížeči je nejde přepsat.',
    cached: 'Server je teď nedostupný, tohle je poslední známý stav. Ověřená ' +
      'čísla drží server a při dalším spojení se srovnají.',
    none: 'Zatím tu nic není. Statistiky se počítají z partií odehraných ' +
      'v sekci Hra se zapnutým ukládáním — místní partie bez serveru se do nich nepočítají.'
  };

  function renderSource(profile) {
    if (!sourceNote) {
      return;
    }
    var key = profile ? source : 'none';
    sourceText.textContent = SOURCE_TEXT[key] || SOURCE_TEXT.none;
    sourceNote.hidden = false;
  }

  /**
   * Stáhne ověřené statistiky aktivního profilu a uloží je do mezipaměti.
   * Bez serveru nebo bez identity se nic nemaže — zůstane poslední známý stav.
   */
  function refreshStats() {
    var profile = MPStore.active();
    if (!profile || !window.MPApi) {
      source = 'none';
      renderSource(profile);
      return;
    }
    source = 'loading';
    renderSource(profile);
    MPApi.stats(profile.id).then(function (result) {
      // profil se mezitím mohl přepnout — odpověď na starý dotaz zahazujeme
      var current = MPStore.active();
      if (!current || current.id !== profile.id) {
        return;
      }
      if (result.ok && result.data.stats) {
        source = 'fresh';
        // setStats sám překreslí přes MPStore.onChange
        MPStore.setStats(profile.id, result.data.stats);
        renderSource(current);
        return;
      }
      source = result.error === 'no_identity' ? 'none' : 'cached';
      renderSource(current);
    });
  }

  /* ------------------------------------------------------------- profily */

  function renderProfiles() {
    var profiles = MPStore.list();
    var activeId = MPStore.activeId();
    countEl.textContent = profiles.length + ' z ' + MPStore.limits.profilesMax;

    if (!profiles.length) {
      listHost.innerHTML =
        '<p class="list-empty">Zatím tu není žádný profil. Založ si ho a hra si ' +
        'začne pamatovat skóre, počet her i nejrychlejší partii.</p>';
      return;
    }

    listHost.innerHTML = profiles.map(function (profile) {
      var s = profile.stats;
      var active = profile.id === activeId;
      return '<div class="profile-row' + (active ? ' is-active' : '') + '">' +
        '<span class="account-avatar">' + escapeHTML(MPStore.initials(profile.name)) + '</span>' +
        '<span class="profile-copy">' +
        '<span class="profile-name">' + escapeHTML(profile.name) +
        (active ? '<span class="pill pill--on">aktivní</span>' : '') + '</span>' +
        '<span class="profile-meta">' + s.games + ' ' +
        plural(s.games, 'hra', 'hry', 'her') + ' · nejlépe ' + s.best + ' b. · ' +
        'naposledy ' + MPStore.formatDate(s.lastPlayed) + '</span>' +
        '</span>' +
        '<span class="profile-actions">' +
        (active ? '' : '<button type="button" class="btn btn--ghost" data-act="use" data-id="' +
          profile.id + '">Přepnout</button>') +
        '<button type="button" class="btn btn--icon" data-act="rename" data-id="' + profile.id +
        '" title="Přejmenovat" aria-label="Přejmenovat ' + escapeHTML(profile.name) + '">' +
        icon('pencil') + '</button>' +
        '<button type="button" class="btn btn--icon btn--danger" data-act="delete" data-id="' +
        profile.id + '" title="Smazat profil" aria-label="Smazat ' + escapeHTML(profile.name) +
        '">' + icon('trash') + '</button>' +
        '</span>' +
        '</div>';
    }).join('');
  }

  function onListClick(event) {
    var button = event.target.closest('[data-act]');
    if (!button) {
      return;
    }
    var id = button.getAttribute('data-id');
    var act = button.getAttribute('data-act');
    var profile = MPStore.list().filter(function (item) {
      return item.id === id;
    })[0];
    if (!profile) {
      return;
    }

    if (act === 'use') {
      MPStore.setActive(id);
      MPUI.toast('Hraje ' + profile.name + '.', null, 0, 'user');
      return;
    }

    if (act === 'rename') {
      MPAccount.promptName({
        icon: 'pencil',
        title: 'Přejmenovat profil',
        text: 'Nová přezdívka nahradí ' + profile.name + '. Statistiky zůstávají.',
        value: profile.name,
        submitLabel: 'Přejmenovat'
      }).then(function (name) {
        if (typeof name !== 'string') {
          return;
        }
        if (!MPStore.rename(id, name)) {
          MPUI.toast('Takovou přezdívku už jiný profil má.', 'warn', 0, 'alert');
        }
      });
      return;
    }

    if (act === 'delete') {
      MPUI.open({
        icon: 'trash',
        title: 'Smazat profil?',
        text: 'Profil ' + profile.name + ' i jeho statistiky zmizí. Vrátit to nejde.',
        dismissible: true,
        actions: [
          { label: 'Smazat', value: 'yes', variant: 'danger' },
          { label: 'Nechat', value: undefined, variant: 'quiet', autofocus: true }
        ]
      }).then(function (choice) {
        if (choice === 'yes') {
          MPStore.remove(id);
          MPUI.toast('Profil smazán.', null, 0, 'check');
        }
      });
    }
  }

  /* ------------------------------------------------------ data a soukromí */

  function renderConsent() {
    var granted = window.MPConsent && MPConsent.granted();
    var decided = window.MPConsent && MPConsent.decided();

    consentPill.textContent = granted ? 'zapnuto' : 'vypnuto';
    consentPill.className = 'pill ' + (granted ? 'pill--on' : 'pill--off');
    consentButton.textContent = granted ? 'Vypnout ukládání' : 'Zapnout ukládání';
    consentButton.className = 'btn' + (granted ? ' btn--quiet' : '');
    consentDesc.textContent = granted
      ? 'Profily a statistiky se ukládají do localStorage a zrcadlí do cookies mp_profile a mp_stats.'
      : (decided
        ? 'Ukládáme jen volbu motivu a záznam o tomhle rozhodnutí. Výsledky her se nikam nezapisují.'
        : 'Zatím ses nerozhodl. Dokud ukládání nepovolíš, statistiky se po zavření karty ztratí.');
  }

  /* Zveřejnění přezdívky v žebříčku je vlastní rozhodnutí, ne součást
     souhlasu s ukládáním: jedno znamená „pamatuj si mě“, druhé „ukaž mě
     ostatním“. Klíč mp-publish drží js/online.js. */
  function publishAllowed() {
    try {
      return localStorage.getItem('mp-publish') === '1';
    } catch (err) {
      return false;
    }
  }

  function renderPublish() {
    var on = publishAllowed();
    publishButton.textContent = on ? 'Vypnout' : 'Zapnout';
    publishButton.className = 'btn' + (on ? ' btn--quiet' : '');
    publishDesc.textContent = on
      ? 'Dohrané partie o žebříček posílají na server přezdívku, skóre, obtížnost a čas.'
      : 'Hrát o žebříček jde dál, ale výsledek se do veřejné tabulky nezapíše. ' +
        'Statistiky profilu běží dál — ty nejsou veřejné.';
  }

  /* Vypnutí zveřejnění dřív zahodilo i serverovou identitu. Od chvíle, kdy pod
     ní leží statistiky profilu, by to znamenalo smazat hráči čísla za trest
     za změnu názoru na veřejnou tabulku. Identita se proto zahazuje jenom
     tam, kde o to hráč vysloveně stojí — tlačítkem Smazat všechna data. */
  function togglePublish() {
    var on = publishAllowed();
    try {
      localStorage.setItem('mp-publish', on ? '0' : '1');
    } catch (err) {
      MPUI.toast('Nastavení nejde uložit — prohlížeč nedovoluje ukládání.', 'warn', 0, 'alert');
      return;
    }
    renderPublish();
    MPUI.toast(on ? 'Do žebříčku se už nic neposílá.' : 'Výsledky půjdou do žebříčku.',
      on ? 'warn' : null, 0, on ? 'info' : 'check');
  }

  function toggleConsent() {
    if (!window.MPConsent) {
      return;
    }
    if (!MPConsent.granted()) {
      MPConsent.set('granted');
      return;
    }
    MPUI.open({
      icon: 'alert',
      title: 'Vypnout ukládání?',
      text: 'Uložené profily i statistiky se z prohlížeče smažou a cookies mp_profile ' +
        'a mp_stats zmizí. Rozehraná karta dohraje, ale výsledek se nikam nezapíše.',
      dismissible: true,
      actions: [
        { label: 'Vypnout a smazat', value: 'yes', variant: 'danger' },
        { label: 'Nechat zapnuté', value: undefined, variant: 'quiet', autofocus: true }
      ]
    }).then(function (choice) {
      if (choice === 'yes') {
        MPConsent.set('rejected');
      }
    });
  }

  function exportData() {
    var blob = new Blob([MPStore.exportJSON()], { type: 'application/json' });
    var url = URL.createObjectURL(blob);
    var link = document.createElement('a');
    link.href = url;
    link.download = 'maticky-poker-profily.json';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.setTimeout(function () {
      URL.revokeObjectURL(url);
    }, 1000);
    MPUI.toast('Záloha stažena.', null, 0, 'download');
  }

  function resetStats() {
    var profile = MPStore.active();
    if (!profile) {
      MPUI.toast('Není co nulovat — žádný profil.', 'warn', 0, 'alert');
      return;
    }
    MPUI.open({
      icon: 'alert',
      title: 'Vynulovat statistiky?',
      text: 'Profil ' + profile.name + ' zůstane, ale všechna čísla se vrátí na nulu — ' +
        'v prohlížeči i na serveru. Zápisy v žebříčku to nemaže.',
      dismissible: true,
      actions: [
        { label: 'Vynulovat', value: 'yes', variant: 'danger' },
        { label: 'Zpět', value: undefined, variant: 'quiet', autofocus: true }
      ]
    }).then(function (choice) {
      if (choice !== 'yes') {
        return;
      }
      /* Nulovat se musí na obou stranách. Kdyby se smazala jen mezipaměť,
         vrátila by čísla první úspěšná odpověď ze serveru — a hráči by to
         připadalo, že tlačítko nefunguje. */
      MPStore.resetStats(profile.id);
      if (!window.MPApi) {
        MPUI.toast('Statistiky vynulovány.', null, 0, 'check');
        return;
      }
      MPApi.resetStats(profile.id).then(function (result) {
        if (result.ok || result.error === 'no_identity') {
          MPUI.toast('Statistiky vynulovány.', null, 0, 'check');
          return;
        }
        MPUI.toast('Na serveru se vynulovat nepodařilo — zkus to znovu.', 'warn', 0, 'alert');
        refreshStats();
      });
    });
  }

  function wipeAll() {
    MPUI.open({
      icon: 'trash',
      title: 'Smazat všechna data?',
      text: 'Zmizí všechny profily, statistiky i cookies, které je nesou. ' +
        'Volba motivu a záznam o souhlasu zůstávají.',
      dismissible: true,
      actions: [
        { label: 'Smazat vše', value: 'yes', variant: 'danger' },
        { label: 'Zpět', value: undefined, variant: 'quiet', autofocus: true }
      ]
    }).then(function (choice) {
      if (choice === 'yes') {
        MPStore.clearAll();
        MPUI.toast('Hotovo, prohlížeč je čistý.', null, 0, 'check');
      }
    });
  }

  /* --------------------------------------------------------------- start */

  /* Poslední profil, pro který se čísla stahovala. Přepnout profil jde
     odsud i z odznaku v liště, takže se změna hlídá tady — v jediném místě,
     kterým projdou obě cesty. */
  var lastProfileId;

  function renderAll() {
    var profile = MPStore.active();
    var id = profile ? profile.id : null;
    var switched = id !== lastProfileId;
    lastProfileId = id;

    renderStats(profile);
    renderProfiles();
    renderConsent();
    renderPublish();

    if (switched) {
      // až po vykreslení, ať stránka nečeká na síť s tím, co už umí ukázat
      window.setTimeout(refreshStats, 0);
    }
  }

  function init() {
    grid = document.getElementById('statsGrid');
    if (!grid) {
      return;
    }
    who = document.getElementById('statsWho');
    warning = document.getElementById('statsWarning');
    listHost = document.getElementById('profileList');
    countEl = document.getElementById('profileCount');
    consentPill = document.getElementById('consentState');
    consentButton = document.getElementById('consentToggle');
    consentDesc = document.getElementById('consentDesc');
    publishButton = document.getElementById('publishToggle');
    publishDesc = document.getElementById('publishDesc');
    sourceNote = document.getElementById('statsSource');
    sourceText = document.getElementById('statsSourceText');

    listHost.addEventListener('click', onListClick);
    document.getElementById('newProfile').addEventListener('click', MPAccount.promptNewProfile);
    consentButton.addEventListener('click', toggleConsent);
    publishButton.addEventListener('click', togglePublish);
    document.getElementById('exportData').addEventListener('click', exportData);
    document.getElementById('resetStats').addEventListener('click', resetStats);
    document.getElementById('wipeAll').addEventListener('click', wipeAll);

    MPStore.onChange(renderAll);
    if (window.MPConsent) {
      MPConsent.onChange(renderAll);
    }
    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
