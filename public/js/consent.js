/* Souhlas s ukládáním dat do prohlížeče.

   Web běží bez serveru — všechno, co si o hráči pamatuje, leží v jeho vlastním
   prohlížeči. Přesto se ukládání dělí na dvě kategorie a jenom jedna z nich je
   podmíněná souhlasem:

     nezbytné   volba motivu a záznam o samotném souhlasu. Bez nich by web
                nefungoval tak, jak si ho hráč nastavil. Jde výhradně
                o localStorage, žádná cookie.
     volitelné  lokální účty a jejich statistiky. Ukládají se do localStorage
                a zrcadlí do cookies, aby profil přežil i vymazání
                localStorage. Zapíšou se až po souhlasu.

   Bez souhlasu si js/store.js drží data jen v paměti karty — hra funguje,
   ale po zavření se nic nezachová. Odvolání souhlasu uložená data smaže.

   Stav souhlasu:
     'granted'   hráč ukládání povolil
     'rejected'  hráč chce jen nezbytné
     null        hráč se zatím nerozhodl → ukazuje se lišta

   Skript musí být načtený DŘÍV než js/store.js, který se ho ptá, jestli smí
   sáhnout na disk. */
(function () {
  'use strict';

  var KEY = 'mp-consent';
  var COOKIE = 'mp_consent';
  var VERSION = 1;
  var COOKIE_DAYS = 180;

  var state = null;         // 'granted' | 'rejected' | null
  var listeners = [];
  var bar = null;

  /* ------------------------------------------------------------ úložiště */

  function read() {
    var raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      return null;
    }
    if (!raw) {
      return null;
    }
    try {
      var parsed = JSON.parse(raw);
      if (parsed && (parsed.state === 'granted' || parsed.state === 'rejected')) {
        return parsed.state;
      }
    } catch (err) {
      /* poškozený záznam — bereme, jako by hráč nerozhodl */
    }
    return null;
  }

  function write(next) {
    try {
      localStorage.setItem(KEY, JSON.stringify({
        version: VERSION,
        state: next,
        at: new Date().toISOString()
      }));
    } catch (err) {
      /* soukromý režim — souhlas platí jen do zavření karty */
    }
  }

  /* Cookie je tu proto, aby byl souhlas doložitelný i tam, kde se maže
     localStorage, a aby si ho stránka mohla přečíst bez JS úložiště. */
  function writeCookie(next) {
    if (next === 'granted') {
      setCookie(COOKIE, '1', COOKIE_DAYS);
    } else {
      dropCookie(COOKIE);
    }
  }

  function setCookie(name, value, days) {
    var expires = new Date(Date.now() + days * 864e5).toUTCString();
    var secure = location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = name + '=' + value + '; expires=' + expires +
      '; path=/; SameSite=Lax' + secure;
  }

  function dropCookie(name) {
    document.cookie = name + '=; expires=Thu, 01 Jan 1970 00:00:00 GMT; path=/; SameSite=Lax';
  }

  function readCookie(name) {
    var parts = document.cookie ? document.cookie.split('; ') : [];
    for (var i = 0; i < parts.length; i++) {
      var eq = parts[i].indexOf('=');
      if (eq > -1 && parts[i].slice(0, eq) === name) {
        return parts[i].slice(eq + 1);
      }
    }
    return null;
  }

  /* --------------------------------------------------------------- lišta */

  function iconMarkup(name) {
    if (window.MPIcons) {
      return window.MPIcons.markup(name);
    }
    return '<svg class="icon" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  function buildBar() {
    if (bar) {
      return bar;
    }
    bar = document.createElement('div');
    bar.className = 'consent';
    bar.setAttribute('role', 'region');
    bar.setAttribute('aria-label', 'Nastavení ukládání dat');
    bar.innerHTML =
      '<div class="consent-card corner-dots">' +
      '<span class="consent-icon">' + iconMarkup('cookie') + '</span>' +
      '<div class="consent-body">' +
      '<h2 class="consent-title">Ukládání dat a cookies</h2>' +
      '<p class="consent-text">Hra běží celá ve tvém prohlížeči a nic neposílá na server. ' +
      'Abychom si zapamatovali tvůj lokální profil a statistiky, potřebujeme je uložit ' +
      'do <strong>localStorage</strong> a zrcadlit do <strong>cookies</strong>. ' +
      'Bez souhlasu si hru zahraješ stejně, jen se výsledky nikam nezapíšou.</p>' +
      '</div>' +
      '<div class="consent-actions">' +
      '<button type="button" class="btn" data-consent="granted">Povolit ukládání</button>' +
      '<button type="button" class="btn btn--quiet" data-consent="rejected">Jen nezbytné</button>' +
      '<a class="btn btn--ghost" href="privacy.html">Podrobnosti</a>' +
      '</div>' +
      '</div>';

    bar.addEventListener('click', function (event) {
      var button = event.target.closest('[data-consent]');
      if (button) {
        set(button.getAttribute('data-consent'));
      }
    });

    document.body.appendChild(bar);
    return bar;
  }

  /**
   * Řekne stránce, kolik místa dole lišta zabírá.
   *
   * Lišta leží napevno u spodní hrany okna, takže si nebere místo v toku
   * stránky — a co je pod ní, to překrývá. Na hrací stránce to je spodní
   * řada políček: klik do ní nedopadl na políčko, ale na lištu, a hráč
   * nemohl položit kartu právě tam, kam se často pokládá ta poslední.
   *
   * Naměřená výška jde do `--consent-space`, ze které `base.css` počítá
   * velikost pole (`--chrome`). Pole se o tu výšku zmenší a celé zůstane
   * nad lištou; po rozhodnutí se proměnná zase odstraní.
   */
  function measureBar() {
    var root = document.documentElement;
    if (!bar || bar.hidden) {
      root.style.removeProperty('--consent-space');
      return;
    }
    root.style.setProperty('--consent-space', bar.offsetHeight + 'px');
  }

  function showBar() {
    buildBar().hidden = false;
    measureBar();
  }

  function hideBar() {
    if (bar) {
      bar.hidden = true;
    }
    measureBar();
  }

  // Lišta se při užším okně zalomí do víc řádků, takže se musí přeměřit.
  window.addEventListener('resize', measureBar);

  /* ------------------------------------------------------------------ API */

  function set(next) {
    if (next !== 'granted' && next !== 'rejected') {
      return;
    }
    state = next;
    write(next);
    writeCookie(next);
    hideBar();
    listeners.forEach(function (fn) {
      fn(next);
    });
    if (window.MPUI) {
      window.MPUI.toast(
        next === 'granted' ? 'Ukládání zapnuto.' : 'Ukládáme jen nezbytné.',
        next === 'granted' ? null : 'warn',
        0,
        next === 'granted' ? 'check' : 'info'
      );
    }
  }

  /** Znovu otevře lištu — volá se z profilu i ze stránky se zásadami. */
  function reopen() {
    showBar();
    var first = bar.querySelector('[data-consent]');
    if (first) {
      first.focus();
    }
  }

  // Kterékoli tlačítko s data-consent-reopen lištu vrátí zpátky — používá to
  // stránka se zásadami i profil, aby o tom nemusely vědět vlastní skripty.
  document.addEventListener('click', function (event) {
    if (event.target.closest('[data-consent-reopen]')) {
      reopen();
    }
  });

  function init() {
    state = read();
    // Souhlas smazaný jen z localStorage se dá obnovit z cookie a naopak.
    if (state === null && readCookie(COOKIE) === '1') {
      state = 'granted';
      write(state);
    } else if (state === 'granted' && readCookie(COOKIE) !== '1') {
      writeCookie(state);
    }
    if (state === null) {
      showBar();
    }
  }

  if (document.body) {
    init();
  } else {
    document.addEventListener('DOMContentLoaded', init);
  }

  window.MPConsent = {
    state: function () { return state; },
    granted: function () { return state === 'granted'; },
    decided: function () { return state !== null; },
    set: set,
    reopen: reopen,
    onChange: function (fn) { listeners.push(fn); },
    /* pomocníci pro store.js, ať se práce s cookies píše jen jednou */
    cookie: { set: setCookie, read: readCookie, drop: dropCookie, days: COOKIE_DAYS }
  };
})();
