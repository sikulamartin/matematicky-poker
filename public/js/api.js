/* Komunikace se serverem — jediné místo, kde web sahá na síť.

   Web je pořád především offline hra. Server přibyl kvůli žebříčku a kvůli
   statistikám profilu, a všechno, co s ním souvisí, se musí umět elegantně
   nekonat: na file://, při výpadku sítě nebo když si někdo stáhne jen složku
   public/, API prostě není a stránky to mají poznat, ne spadnout. Proto
   `available()` a proto každé volání vrací chybu jako hodnotu, ne jako výjimku.

   Identita hráče
   --------------
   Server vydá při první partii dvojici id + tajemství. Uloží se do
   localStorage a posílá se při zakládání každé další partie, aby se výsledky
   připsaly témuž hráči. Ukládá se jenom se souhlasem — bez něj dostane hráč
   pokaždé novou identitu a v žebříčku i ve statistikách se objeví jako nový.

   Identit je víc, jedna na každý místní profil
   --------------------------------------------
   V jednom prohlížeči může být až osm profilů (js/store.js) — rodina nebo
   třída u jednoho notebooku. Kdyby na ně na všechny připadala jedna serverová
   identita, sečetla by se dvěma sourozencům skóre dohromady a v žebříčku by
   se překrývali. Proto se pod klíčem `mp-player` drží mapa
   profileId → { id, secret }.

   Starší zápis (jediná dvojice bez mapy) se při prvním použití převezme pro
   profil, který si o ni řekne — hráč tím nepřijde o svoje místo v žebříčku
   ani o napočítané statistiky. */
(function () {
  'use strict';

  var BASE = '/api';
  var KEY = 'mp-player';
  var TIMEOUT_MS = 12000;

  var reachable = null;      // null = ještě nezkoušeno

  /* ------------------------------------------------------- identita */

  function allowed() {
    return Boolean(window.MPConsent && window.MPConsent.granted());
  }

  /** Profil, kterému se výsledky připisují, když volající neřekne jinak. */
  function activeProfileId(profileId) {
    if (typeof profileId === 'string' && profileId) {
      return profileId;
    }
    return window.MPStore ? window.MPStore.activeId() : null;
  }

  /** Celá mapa profileId → identita. Starý tvar se cestou převede. */
  function readAll() {
    if (!allowed()) {
      return {};
    }
    var raw;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      return {};
    }
    if (!raw) {
      return {};
    }
    try {
      var parsed = JSON.parse(raw);
      if (!parsed || typeof parsed !== 'object') {
        return {};
      }
      if (parsed.byProfile && typeof parsed.byProfile === 'object') {
        return parsed.byProfile;
      }
      // starý tvar { id, secret } — drží se stranou, dokud si ho profil nepřevezme
      if (typeof parsed.id === 'string' && typeof parsed.secret === 'string') {
        return { '': { id: parsed.id, secret: parsed.secret } };
      }
    } catch (err) {
      /* poškozený nebo nedostupný záznam — hráč bude nový */
    }
    return {};
  }

  function writeAll(map) {
    if (!allowed()) {
      return;
    }
    try {
      localStorage.setItem(KEY, JSON.stringify({ v: 2, byProfile: map }));
    } catch (err) {
      /* bez uložení se hráč příště zapíše jako nový */
    }
  }

  function valid(entry) {
    return Boolean(entry && typeof entry.id === 'string' && typeof entry.secret === 'string');
  }

  /**
   * Identita jednoho profilu, nebo null.
   * Osiřelou identitu ze staršího zápisu si první ptající se profil převezme.
   */
  function readPlayer(profileId) {
    var id = activeProfileId(profileId);
    var map = readAll();
    if (id && valid(map[id])) {
      return map[id];
    }
    if (id && valid(map[''])) {
      var adopted = map[''];
      delete map[''];
      map[id] = adopted;
      writeAll(map);
      return adopted;
    }
    return null;
  }

  function writePlayer(profileId, player) {
    var id = activeProfileId(profileId);
    if (!id || !player || !player.id || !player.secret) {
      return;
    }
    var map = readAll();
    delete map[''];      // převzatá identita už má svůj profil
    map[id] = { id: player.id, secret: player.secret };
    writeAll(map);
  }

  /**
   * Zahodí identitu. Bez parametru všechny.
   *
   * Pozor: s identitou mizí i přístup ke statistikám, které pod ní server
   * vede. Nová partie založí nového hráče, který začíná od nuly.
   */
  function forgetPlayer(profileId) {
    if (profileId === undefined) {
      try {
        localStorage.removeItem(KEY);
      } catch (err) {
        /* nic k mazání */
      }
      return;
    }
    var map = readAll();
    delete map[profileId];
    writeAll(map);
  }

  /* ---------------------------------------------------------- volání */

  /**
   * Vrací vždy { ok, data, error }. Žádné výjimky ven — volající se má
   * starat o hru, ne o odchytávání sítě.
   */
  function call(path, options) {
    var controller = new AbortController();
    var timer = window.setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);

    return fetch(BASE + path, Object.assign({ signal: controller.signal }, options))
      .then(function (response) {
        return response.json().catch(function () {
          return {};
        }).then(function (data) {
          window.clearTimeout(timer);
          reachable = true;
          if (!response.ok) {
            return { ok: false, error: data.error || 'http_' + response.status, data: data };
          }
          return { ok: true, data: data };
        });
      })
      .catch(function (err) {
        window.clearTimeout(timer);
        reachable = false;
        return { ok: false, error: err.name === 'AbortError' ? 'timeout' : 'offline' };
      });
  }

  function postTo(path, body) {
    return call(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body)
    });
  }

  function post(body) {
    return postTo('/hra', body);
  }

  /* ------------------------------------------------------------ akce */

  /**
   * Založí partii. Server vrátí stav, případně novou identitu hráče
   * a jeho dosavadní statistiky.
   * @param {Object} options { profileId, mode, seconds, name, publish }
   */
  function startRun(options) {
    var profileId = activeProfileId(options.profileId);
    var player = readPlayer(profileId);
    return post({
      action: 'start',
      mode: options.mode,
      seconds: options.seconds,
      name: options.name,
      publish: Boolean(options.publish),
      stackJokers: options.stackJokers === true,
      playerId: player ? player.id : undefined,
      playerSecret: player ? player.secret : undefined
    }).then(function (result) {
      if (result.ok && result.data.player && result.data.player.secret) {
        writePlayer(profileId, result.data.player);
      }
      return result;
    });
  }

  function act(runId, body) {
    return post(Object.assign({ runId: runId }, body));
  }

  /**
   * Skupinová hra. Vlastní endpoint, protože lobby nemá s partií o žebříček
   * nic společného — jiný stav, jiná identita, jiná životnost.
   * @param {Object} body { action, code, playerId, token, … }
   */
  function lobby(body) {
    return postTo('/skupina', body);
  }

  function leaderboard(period) {
    return call('/zebricek?obdobi=' + encodeURIComponent(period || 'all'), {
      method: 'GET'
    });
  }

  /* --------------------------------------------------------- statistiky */

  /* Statistiky se čtou POSTem, protože k nim je potřeba tajemství hráče —
     v adrese by skončilo v historii prohlížeče a v logu serveru. */

  function statsCall(profileId, action) {
    var player = readPlayer(profileId);
    if (!player) {
      // profil, který ještě neodehrál serverovou partii, žádná čísla nemá
      return Promise.resolve({ ok: false, error: 'no_identity' });
    }
    return postTo('/profil', {
      playerId: player.id,
      playerSecret: player.secret,
      action: action
    });
  }

  /** Ověřené statistiky profilu ze serveru. */
  function stats(profileId) {
    return statsCall(profileId, undefined);
  }

  /** Vynuluje ověřené statistiky. Identita ani přezdívka nemizí. */
  function resetStats(profileId) {
    return statsCall(profileId, 'reset');
  }

  /**
   * Je server vůbec k dispozici? Zjišťuje se prvním skutečným voláním.
   *
   * Nestačí, že něco odpovědělo. Když si někdo nahraje složku public/ na
   * obyčejný statický hosting, odpoví na /api/zebricek jeho 404 stránka —
   * a hra by se pak pokusila hrát přes server, který neexistuje. Za živé
   * API se proto počítá jenom odpověď, která vypadá jako od něj: buď platný
   * žebříček, nebo chyba s vlastním kódem v těle (to umí jen naše funkce).
   */
  function probe() {
    if (reachable !== null) {
      return Promise.resolve(reachable);
    }
    return leaderboard('all').then(function (result) {
      reachable = result.ok || Boolean(result.data && result.data.error);
      return reachable;
    });
  }

  window.MPApi = {
    startRun: startRun,
    act: act,
    lobby: lobby,
    leaderboard: leaderboard,
    stats: stats,
    resetStats: resetStats,
    probe: probe,
    available: function () { return reachable; },
    player: readPlayer,
    forgetPlayer: forgetPlayer
  };
})();
