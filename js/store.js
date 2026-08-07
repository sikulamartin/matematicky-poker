/* Lokální účty a jejich statistiky.

   Účet je jenom přezdívka a sada čísel v prohlížeči — žádné heslo, žádný
   server, žádná registrace. Na jednom počítači jich může být víc (rodina,
   třída u jednoho notebooku) a přepínají se v liště.

   Kde data leží
   -------------
   localStorage['mp-profiles']   celý seznam profilů i se statistikami
   cookie mp_profile             přezdívka aktivního profilu
   cookie mp_stats               jeho statistiky v úsporném zápisu

   Cookie je zálohou, ne primárním úložištěm: kdo si vymaže localStorage
   (nebo mu ho vyhodí prohlížeč), dostane aktivní profil zpátky z cookie.
   Proto se zrcadlí jen aktivní profil — do 4 kB cookie se víc nevejde
   a ostatní profily nejsou to, co má smysl zachraňovat.

   Bez souhlasu (js/consent.js) se na disk nesahá vůbec: data žijí v paměti
   karty, hra funguje, po zavření zmizí. Udělení souhlasu paměť rovnou uloží,
   odvolání souhlasu uložené stopy smaže.

   Co se počítá
   ------------
   hraných her        každá dohraná i předčasně ukončená partie
   nejlepší skóre     nejvyšší celkový počet bodů (obě obtížnosti)
   lehká / těžká      nejvyšší skóre zvlášť pro každou obtížnost
   nejrychlejší hra   jen z partií se zaplněnými všemi 25 políčky. Kdyby se
                      počítaly i nedohrané, byl by rekordem první tah.

   Kontroly zápisu — a čím NEJSOU
   ------------------------------
   Tohle NENÍ zabezpečení a nikdy jím být nemůže. Celá hra běží v prohlížeči
   hráče: úložiště, cookies i tenhle modul má v konzoli na dosah ruky a klíč
   k podpisu leží o pár řádků níž ve stejném souboru. Kdo si přečte zdroják,
   podvrhne si skóre vždycky. Nepodvrhnutelnou tabulku rekordů umí jedině
   server, který sám drží balíček a sám vyhodnocuje tahy.

   Co kontroly opravdu dělají: zvedají laťku z „napiš do konzole jeden řádek“
   na „přečti si zdroják a napiš skript“, a hlavně chytají to, co se stane
   omylem — poškozený zápis, ručně přepsanou cookie, půlku uloženého objektu
   po zaplněném disku. Stojí na třech nezávislých vrstvách:

     1. žeton partie   Skóre nejde zapsat „jen tak“. Hra si na začátku vyžádá
                       žeton (beginRun) a bez něj record() nic nepřijme. Délku
                       partie i obtížnost si modul měří sám — hodnotám od
                       volajícího nevěří. Jeden žeton = jeden zápis.
     2. věrohodnost    Bodovací tabulka dává jen násobky pěti a 12 linií po
                       125 bodech dá strop 1500. Dohraná partie nemůže být
                       kratší než 5 sekund, protože samotné prodlevy mezi tahy
                       zaberou přes šest. Co se do těchhle mezí nevejde,
                       se zahodí.
     3. otisk uložení  U každého profilu leží kontrolní součet. Kdo přepíše
                       čísla v localStorage nebo v cookie a nedopočítá ho,
                       přijde o statistiky — načtou se jako vynulované
                       a stránka Profil to oznámí. */
(function () {
  'use strict';

  var KEY = 'mp-profiles';
  var COOKIE_NAME = 'mp_profile';
  var COOKIE_STATS = 'mp_stats';
  var VERSION = 1;
  var NAME_MAX = 24;
  var PROFILES_MAX = 8;

  /* Meze věrohodnosti — odvozené z pravidel hry, ne odhadnuté.
     SCORE_MAX     12 linií × 125 bodů za pětici (js/scoring.js). Skutečně
                   dosažitelné maximum je o dost níž, ale tohle je strop,
                   nad kterým je hodnota prokazatelně vymyšlená.
     SCORE_STEP    všechny kombinace v tabulce jsou násobky pěti, součet
                   dvanácti z nich tedy taky.
     MIN_FULL_MS   po každém z 25 tahů čeká hra 260 ms, než natáhne další
                   číslo (AUTO_ROLL_DELAY v js/game.js) — 24 prodlev je
                   6,2 sekundy. Pod pět sekund se dohraná partie nedostane
                   ani na nejrychlejším stroji. */
  var SCORE_MAX = 1500;
  var SCORE_STEP = 5;
  var MIN_FULL_MS = 5000;

  /* Verze otisku. Až se sada statistik rozšíří, stoupne tohle číslo a starší
     otisky se přestanou ověřovat (jinak by se celý web tvářil, že mu někdo
     přepsal data). PEPPER není tajemství — viz komentář v hlavičce. */
  var SIG_VERSION = 1;
  var PEPPER = 'mp!poker/stats';

  var state = null;
  var listeners = [];
  var run = null;          // otevřená partie: { token, mode, startedAt }
  var tamperSeen = false;  // našel se při načtení profil s rozbitým otiskem?

  /* ------------------------------------------------------------ souhlas */

  function allowed() {
    return Boolean(window.MPConsent && window.MPConsent.granted());
  }

  function cookies() {
    return window.MPConsent ? window.MPConsent.cookie : null;
  }

  /* -------------------------------------------------------------- model */

  function emptyStats() {
    return {
      games: 0,          // kolik partií hráč zahájil a dohrál nebo ukončil
      finished: 0,       // z toho těch se všemi 25 zaplněnými políčky
      best: 0,           // nejlepší skóre napříč obtížnostmi
      bestEasy: 0,
      bestHard: 0,
      fastestMs: null,   // nejrychlejší DOKONČENÁ hra
      fastestMode: null,
      lastPlayed: null
    };
  }

  function makeId() {
    return 'p' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  }

  function cleanName(name) {
    var text = String(name === undefined || name === null ? '' : name)
      .replace(/\s+/g, ' ')
      .trim();
    return text.slice(0, NAME_MAX);
  }

  function makeProfile(name) {
    return {
      id: makeId(),
      name: cleanName(name) || 'Hráč',
      created: new Date().toISOString(),
      stats: emptyStats()
    };
  }

  function emptyState() {
    return { version: VERSION, activeId: null, profiles: [] };
  }

  /* ---------------------------------------------------------- otisk dat */

  /* FNV-1a, 32 bitů. Není to kryptografie a nemá být — jde o kontrolní
     součet, který pozná přepsané číslo, ne o obranu proti útočníkovi.
     Vlastní implementace proto, že SubtleCrypto je asynchronní a načtení
     profilu musí proběhnout synchronně, než se stránka vykreslí. */
  function hash32(text) {
    var h = 0x811c9dc5;
    for (var i = 0; i < text.length; i++) {
      h ^= text.charCodeAt(i);
      h = (h + ((h << 1) + (h << 4) + (h << 7) + (h << 8) + (h << 24))) >>> 0;
    }
    return h.toString(36);
  }

  /** Otisk profilu v localStorage — přes identitu i všechna čísla. */
  function fingerprint(profile) {
    var s = profile.stats;
    return hash32([
      SIG_VERSION, profile.id, profile.name, profile.created,
      s.games, s.finished, s.best, s.bestEasy, s.bestHard,
      s.fastestMs, s.fastestMode, s.lastPlayed, PEPPER
    ].join('|'));
  }

  /** Otisk zálohy v cookie. Ta nese jiná pole, tak má i vlastní výpočet. */
  function fingerprintCookie(name, packed) {
    return hash32([SIG_VERSION, name, packed, PEPPER].join('|'));
  }

  /** Doplní chybějící klíče — starší uložený tvar se tím nerozbije. */
  function normalize(raw) {
    var next = emptyState();
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.profiles)) {
      return next;
    }
    // Otisky ověřujeme jen tam, kde souhlasí jejich verze. Po rozšíření
    // statistik by starší zápis neprošel a nešlo by o podvod, ale o migraci.
    var checkSigs = raw.sigVersion === SIG_VERSION;

    raw.profiles.forEach(function (item) {
      if (!item || typeof item !== 'object') {
        return;
      }
      var stats = emptyStats();
      var source = item.stats && typeof item.stats === 'object' ? item.stats : {};
      Object.keys(stats).forEach(function (key) {
        if (source[key] !== undefined && source[key] !== null) {
          stats[key] = source[key];
        }
      });
      var profile = {
        id: String(item.id || makeId()),
        name: cleanName(item.name) || 'Hráč',
        created: item.created || new Date().toISOString(),
        stats: stats
      };
      // Profil zůstává i s rozbitým otiskem — mizí jen čísla. Smazat rovnou
      // celý účet by z překlepu v konzoli udělalo trest, který nejde vzít zpět.
      if (checkSigs && item.sig !== fingerprint(profile)) {
        profile.stats = emptyStats();
        tamperSeen = true;
      }
      next.profiles.push(profile);
    });
    next.profiles = next.profiles.slice(0, PROFILES_MAX);
    if (raw.activeId && find(next, raw.activeId)) {
      next.activeId = raw.activeId;
    } else if (next.profiles.length) {
      next.activeId = next.profiles[0].id;
    }
    return next;
  }

  function find(source, id) {
    for (var i = 0; i < source.profiles.length; i++) {
      if (source.profiles[i].id === id) {
        return source.profiles[i];
      }
    }
    return null;
  }

  /* ----------------------------------------------------------- úložiště */

  function load() {
    if (!allowed()) {
      return emptyState();
    }
    var raw = null;
    try {
      raw = localStorage.getItem(KEY);
    } catch (err) {
      raw = null;
    }
    if (raw) {
      try {
        return normalize(JSON.parse(raw));
      } catch (err) {
        /* poškozený zápis — radši prázdno než pád při startu */
      }
    }
    return fromCookie();
  }

  /** Záchrana profilu z cookie, když localStorage nic nemá. */
  function fromCookie() {
    var jar = cookies();
    if (!jar) {
      return emptyState();
    }
    var name = jar.read(COOKIE_NAME);
    if (!name) {
      return emptyState();
    }
    var readable = decodeURIComponent(name);
    var profile = makeProfile(readable);
    var packed = jar.read(COOKIE_STATS);
    if (packed) {
      var raw = decodeURIComponent(packed);
      var parts = raw.split('.');
      // poslední pole je otisk; ověřuje se proti zbytku řetězce
      var sig = parts.pop();
      if (parts[0] === '2' && parts.length === 8) {
        if (sig === fingerprintCookie(readable, parts.join('.'))) {
          profile.stats = {
            games: toNumber(parts[1]),
            finished: toNumber(parts[2]),
            best: toNumber(parts[3]),
            bestEasy: toNumber(parts[4]),
            bestHard: toNumber(parts[5]),
            fastestMs: parts[6] === '-' ? null : toNumber(parts[6]),
            fastestMode: parts[7] === '-' ? null : parts[7],
            lastPlayed: null
          };
        } else {
          // přezdívku vrátíme, čísla ne — někdo do cookie sáhl
          tamperSeen = true;
        }
      }
    }
    var next = emptyState();
    next.profiles.push(profile);
    next.activeId = profile.id;
    return next;
  }

  function toNumber(value) {
    var number = parseInt(value, 10);
    return Number.isNaN(number) ? 0 : number;
  }

  /* Zápisový tvar. Otisk se dopočítává až tady, aby ho stav v paměti nemusel
     vláčet s sebou a nemohl se rozejít s čísly, ke kterým patří. */
  function serialize() {
    return JSON.stringify({
      version: VERSION,
      sigVersion: SIG_VERSION,
      activeId: state.activeId,
      profiles: state.profiles.map(function (profile) {
        return {
          id: profile.id,
          name: profile.name,
          created: profile.created,
          stats: profile.stats,
          sig: fingerprint(profile)
        };
      })
    });
  }

  function save() {
    if (!allowed()) {
      return;
    }
    try {
      localStorage.setItem(KEY, serialize());
    } catch (err) {
      /* plné nebo zamčené úložiště — v paměti data zůstávají */
    }
    mirror();
  }

  /** Zrcadlo aktivního profilu do cookies. */
  function mirror() {
    var jar = cookies();
    if (!jar || !allowed()) {
      return;
    }
    var profile = active();
    if (!profile) {
      jar.drop(COOKIE_NAME);
      jar.drop(COOKIE_STATS);
      return;
    }
    var s = profile.stats;
    var packed = [
      '2', s.games, s.finished, s.best, s.bestEasy, s.bestHard,
      s.fastestMs === null ? '-' : s.fastestMs,
      s.fastestMode === null ? '-' : s.fastestMode
    ].join('.');
    var signed = packed + '.' + fingerprintCookie(profile.name, packed);
    jar.set(COOKIE_NAME, encodeURIComponent(profile.name), jar.days);
    jar.set(COOKIE_STATS, encodeURIComponent(signed), jar.days);
  }

  function wipeStorage() {
    try {
      localStorage.removeItem(KEY);
    } catch (err) {
      /* nic k mazání */
    }
    var jar = cookies();
    if (jar) {
      jar.drop(COOKIE_NAME);
      jar.drop(COOKIE_STATS);
    }
  }

  function changed() {
    listeners.forEach(function (fn) {
      fn(state);
    });
  }

  function commit() {
    save();
    changed();
  }

  /* ------------------------------------------------------------------ API */

  function list() {
    return state.profiles.slice();
  }

  function active() {
    return state.activeId ? find(state, state.activeId) : null;
  }

  /** Vrátí aktivní profil; když žádný není, tiše založí první. */
  function ensure() {
    var current = active();
    if (current) {
      return current;
    }
    return create('Hráč');
  }

  function create(name) {
    if (state.profiles.length >= PROFILES_MAX) {
      return null;
    }
    var profile = makeProfile(name || ('Hráč ' + (state.profiles.length + 1)));
    // dvě stejné přezdívky v seznamu nikdo nerozezná
    if (nameTaken(profile.name, null)) {
      profile.name = uniqueName(profile.name);
    }
    state.profiles.push(profile);
    state.activeId = profile.id;
    commit();
    return profile;
  }

  function nameTaken(name, exceptId) {
    var lower = name.toLowerCase();
    return state.profiles.some(function (item) {
      return item.id !== exceptId && item.name.toLowerCase() === lower;
    });
  }

  function uniqueName(name) {
    var suffix = 2;
    while (nameTaken(name + ' ' + suffix, null) && suffix < 99) {
      suffix++;
    }
    return (name + ' ' + suffix).slice(0, NAME_MAX);
  }

  function rename(id, name) {
    var profile = find(state, id);
    var next = cleanName(name);
    if (!profile || !next) {
      return false;
    }
    if (nameTaken(next, id)) {
      return false;
    }
    profile.name = next;
    commit();
    return true;
  }

  function remove(id) {
    var index = -1;
    for (var i = 0; i < state.profiles.length; i++) {
      if (state.profiles[i].id === id) {
        index = i;
      }
    }
    if (index < 0) {
      return false;
    }
    state.profiles.splice(index, 1);
    if (state.activeId === id) {
      state.activeId = state.profiles.length ? state.profiles[0].id : null;
    }
    commit();
    return true;
  }

  function setActive(id) {
    if (!find(state, id)) {
      return false;
    }
    state.activeId = id;
    commit();
    return true;
  }

  function resetStats(id) {
    var profile = find(state, id);
    if (!profile) {
      return false;
    }
    profile.stats = emptyStats();
    commit();
    return true;
  }

  function clearAll() {
    state = emptyState();
    tamperSeen = false;   // po vymazání není na co upozorňovat
    wipeStorage();
    changed();
  }

  /**
   * Ohlásí začátek partie a vrátí žeton, kterým se pak zapisuje výsledek.
   * Bez něj record() nic nepřijme — samotné zavolání record() se skóre
   * v ruce tedy nestačí. Obtížnost i čas si odteď hlídá modul sám.
   * @param {string} mode 'easy' | 'hard'
   * @returns {string} žeton pro record()
   */
  function beginRun(mode) {
    run = {
      token: 'r' + Date.now().toString(36) + Math.random().toString(36).slice(2, 10),
      mode: mode === 'hard' ? 'hard' : 'easy',
      startedAt: Date.now()
    };
    return run.token;
  }

  /** Odpovídá skóre tomu, co bodovací tabulka vůbec umí vydat? */
  function plausibleScore(score) {
    return Number.isFinite(score) && score >= 0 && score <= SCORE_MAX &&
      score % SCORE_STEP === 0;
  }

  /**
   * Zapíše výsledek partie aktivnímu profilu.
   * @param {Object} result
   * @param {string} result.token     žeton z beginRun()
   * @param {number} result.score     celkový počet bodů
   * @param {boolean} result.complete bylo zaplněných všech 25 políček?
   * @returns {Object|null} { profile, records } nebo { rejected } při zamítnutí
   */
  function record(result) {
    result = result || {};

    // 1. žeton — jeden běh, jeden zápis
    if (!run || result.token !== run.token) {
      return { rejected: 'token', profile: null, records: [] };
    }
    var mode = run.mode;
    var duration = Date.now() - run.startedAt;
    run = null;

    // 2. věrohodnost — skóre mimo tabulku nebo nemožně rychlá dohraná partie
    var score = Math.round(Number(result.score));
    if (!plausibleScore(score)) {
      return { rejected: 'score', profile: null, records: [] };
    }
    var complete = Boolean(result.complete);
    if (complete && duration < MIN_FULL_MS) {
      return { rejected: 'duration', profile: null, records: [] };
    }

    var profile = ensure();
    if (!profile) {
      return { rejected: 'profile', profile: null, records: [] };
    }
    var stats = profile.stats;
    var records = [];

    stats.games++;
    stats.lastPlayed = new Date().toISOString();

    if (score > stats.best) {
      stats.best = score;
      records.push('best');
    }
    if (mode === 'hard') {
      if (score > stats.bestHard) {
        stats.bestHard = score;
        records.push('hard');
      }
    } else if (score > stats.bestEasy) {
      stats.bestEasy = score;
      records.push('easy');
    }

    if (complete) {
      stats.finished++;
      if (stats.fastestMs === null || duration < stats.fastestMs) {
        stats.fastestMs = duration;
        stats.fastestMode = mode;
        records.push('fastest');
      }
    }

    commit();
    return { profile: profile, records: records };
  }

  /* ------------------------------------------------------------ formáty */

  /** 4 min 12 s → „4:12“, pod minutu → „48 s“. */
  function formatDuration(ms) {
    if (ms === null || ms === undefined) {
      return '–';
    }
    var total = Math.round(ms / 1000);
    if (total < 60) {
      return total + ' s';
    }
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ':' + String(seconds).padStart(2, '0');
  }

  function formatDate(iso) {
    if (!iso) {
      return '–';
    }
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '–';
    }
    return date.toLocaleDateString('cs-CZ', {
      day: 'numeric', month: 'numeric', year: 'numeric'
    });
  }

  /** Iniciály do odznaku v liště — jedno nebo dvě písmena. */
  function initials(name) {
    var words = cleanName(name).split(' ').filter(Boolean);
    if (!words.length) {
      return '?';
    }
    if (words.length === 1) {
      return words[0].slice(0, 2).toUpperCase();
    }
    return (words[0][0] + words[1][0]).toUpperCase();
  }

  function exportJSON() {
    return JSON.stringify({
      exported: new Date().toISOString(),
      app: 'Matematický Poker',
      data: state
    }, null, 2);
  }

  /* --------------------------------------------------------------- start */

  state = load();

  // Souhlas udělený až během hry uloží to, co zatím leželo v paměti. Odvolání
  // naopak smaže disk i paměť — kdyby profil v paměti zůstal, tvrdil by web
  // v účtu něco jiného, než co hráč právě odklikl.
  if (window.MPConsent) {
    window.MPConsent.onChange(function (next) {
      if (next === 'granted') {
        if (!state.profiles.length) {
          state = load();
        }
        save();
      } else {
        wipeStorage();
        state = emptyState();
      }
      changed();
    });
  }

  // profil přepnutý na jiné kartě se promítne i sem
  window.addEventListener('storage', function (event) {
    if (event.key !== KEY || !allowed()) {
      return;
    }
    state = load();
    changed();
  });

  window.MPStore = {
    list: list,
    active: active,
    activeId: function () { return state.activeId; },
    ensure: ensure,
    create: create,
    rename: rename,
    remove: remove,
    setActive: setActive,
    resetStats: resetStats,
    clearAll: clearAll,
    beginRun: beginRun,
    record: record,
    /** Našel se při načtení profil s rozbitým otiskem? */
    tampered: function () { return tamperSeen; },
    exportJSON: exportJSON,
    onChange: function (fn) { listeners.push(fn); },
    emptyStats: emptyStats,
    formatDuration: formatDuration,
    formatDate: formatDate,
    initials: initials,
    limits: { nameMax: NAME_MAX, profilesMax: PROFILES_MAX },
    persists: allowed
  };
})();
