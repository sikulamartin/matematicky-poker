/* Hra na serveru — klient, který si sám nic nepočítá.

   Jeden soubor obsluhuje tři stránky: easy.html, hard.html a ranked.html.
   Liší se jen v tom, co se s výsledkem stane, ne v tom, jak se hraje.

     easy / hard   partie se počítá do statistik profilu, do žebříčku nejde.
                   Když server není, stránka předá řízení místní hře
                   (js/game.js) a partie se nikam nezapíše.
     ranked        navíc se ptá na zveřejnění přezdívky a zapisuje do
                   žebříčku. Bez serveru nemá co dělat, takže se místo hry
                   ukáže hláška.

   Proč přes server i mimo žebříček
   --------------------------------
   Statistiky profilu byly dřív jenom čísla v localStorage, která si počítala
   tahle stránka. Takové číslo si každý přepíše v konzoli za dvě vteřiny —
   žádná kontrola v prohlížeči to nezmění, protože kontrola běží tam, kde
   se podvádí. Serverová partie ten problém nemá: balíček i pole leží
   na serveru, klient posílá jen „polož na 2,3“ a skóre nikdy neodesílá.

   Tenhle soubor proto nemá balíček, nemá bodování a neví, jaká karta přijde.
   Umí jediné — poslat serveru akci a vykreslit stav, který dostane zpátky.

   Časomíra je jediné místo, kde klient něco počítá sám — a i to jen kvůli
   plynulému odpočtu. Rozhoduje `deadline` ze serveru, takže přetočené hodiny
   v počítači na limit nemají vliv. */
(function () {
  'use strict';

  var AUTO_ROLL_DELAY = 260;   // ms — stejná prodleva jako v místní hře

  var RECORD_LABELS = {
    best: 'nejlepší skóre',
    easy: 'rekord v lehké',
    hard: 'rekord v těžké',
    fastest: 'nejrychlejší hra'
  };

  function byId(id) {
    return document.getElementById(id);
  }

  /** Co která stránka od serveru chce. Odvozeno z data-mode na <body>. */
  function readConfig() {
    var mode = document.body.getAttribute('data-mode') || 'easy';
    if (mode === 'ranked') {
      return {
        ranked: true,
        mode: null,             // vybírá se v rozhraní
        fallback: false,        // bez serveru stránka nedává smysl
        needConsent: false,     // bez souhlasu se hraje s jednorázovou identitou
        backHref: 'leaderboard.html',
        backLabel: 'Do žebříčku'
      };
    }
    return {
      ranked: false,
      mode: mode === 'hard' ? 'hard' : 'easy',
      fallback: true,
      /* Bez souhlasu s ukládáním se serverová identita nikam nezapíše, takže
         by každá partie patřila novému hráči a statistiky by se nikdy
         nesečetly. Posílat kvůli tomu tahy na server je zbytečné — hraje
         se místně. */
      needConsent: true,
      backHref: 'difficulty.html',
      backLabel: 'Zpět na výběr'
    };
  }

  function start() {
    var board = byId('board');
    if (!board) {
      return;
    }

    var CONFIG = readConfig();

    var rollButton = byId('rollButton');
    /* Popisek pro stav „ještě se nehraje“ si bere z HTML: lehká obtížnost má
       na tlačítku Generovat, těžká a žebříček Start. Zapsat sem jedno slovo
       natvrdo by jednu ze stránek přejmenovalo. */
    var idleLabel = (rollButton.textContent || 'Start').trim();
    var drawValue = byId('drawValue');
    var drawOrder = byId('drawOrder');
    var drawTile = byId('drawTile');
    var totalScore = byId('totalScore');
    var placedCount = byId('placedCount');
    var jokerBadge = byId('jokerBadge');
    var jokerCount = byId('jokerCount');
    var deckCount = byId('deckCount');
    /* Prvky nastavení nemá každá stránka: lehká obtížnost nevybírá čas ani
       režim, takže se s jejich chybějícím tvarem počítá všude níž. */
    var setupRow = byId('setupRow');
    var modeSelect = byId('modeSelect');
    var timeInput = byId('timeInput');
    var timeLabel = byId('timeLabel');
    var timerTile = byId('timerTile');
    var timerValue = byId('timerValue');
    var netBar = byId('netBar');
    var netText = byId('netText');
    var netRetry = byId('netRetry');

    var cells = [];
    var scoreOut = [];
    for (var r = 1; r <= 5; r++) {
      for (var c = 1; c <= 5; c++) {
        cells.push(board.rows[r].cells[c]);
      }
    }
    // Bodové buňky v pořadí, v jakém server posílá linie: 5 řádků, 5 sloupců,
    // úhlopříčka zleva shora, úhlopříčka zprava shora (viz shared/rules.js).
    for (var i = 0; i < 5; i++) {
      scoreOut.push(board.rows[i + 1].cells[0]);
    }
    for (var j = 0; j < 5; j++) {
      scoreOut.push(board.rows[0].cells[j + 1]);
    }
    scoreOut.push(board.rows[0].cells[0]);
    scoreOut.push(board.rows[0].cells[6]);

    var state = null;        // poslední stav ze serveru
    var runId = null;
    var profileId = null;    // komu se partie připisuje (js/store.js)
    var busy = false;        // čeká se na odpověď, dialog nebo automatické tažení
    var inFlight = false;    // právě běží požadavek — druhý se nesmí přidat
    var autoRollId = null;
    var timerId = null;
    /* Hráč si přeje táhnout dál a na uschované žolíky se ho už neptáme.
       Platí do nejbližšího položení, stejně jako v místní hře. */
    var jokerLock = false;

    /* --------------------------------------------------------- vykreslení */

    function formatTime(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function renderDraw() {
      var pending = state && state.pending;
      if (pending) {
        drawValue.textContent = String(pending.value);
        drawOrder.textContent = state.drawNo + '. tah' + (pending.fromJoker ? ' · žolík' : '');
        drawTile.classList.remove('is-empty');
        drawValue.classList.remove('draw-pop');
        void drawValue.offsetWidth;
        drawValue.classList.add('draw-pop');
      } else {
        drawValue.textContent = '–';
        drawOrder.textContent = !state ? 'tah' : (state.over ? 'konec hry' : 'tah');
        drawTile.classList.add('is-empty');
      }
    }

    function renderBoard() {
      if (!state) {
        return;
      }
      var jokerSet = {};
      state.jokerCells.forEach(function (pair) {
        jokerSet[pair[0] + ':' + pair[1]] = true;
      });

      cells.forEach(function (cell, index) {
        var row = Math.floor(index / 5);
        var col = index % 5;
        var value = state.grid[row][col];
        var wasFilled = cell.classList.contains('filled');

        if (value === null) {
          cell.textContent = '';
          cell.classList.remove('filled', 'from-joker');
          cell.removeAttribute('title');
        } else {
          cell.textContent = String(value);
          if (!wasFilled) {
            cell.classList.add('just-placed');
            window.setTimeout(function () {
              cell.classList.remove('just-placed');
            }, 360);
          }
          cell.classList.add('filled');
          if (jokerSet[row + ':' + col]) {
            cell.classList.add('from-joker');
            cell.title = 'Žolík jako ' + value;
          }
        }

        if (value === null && state.pending && !state.over) {
          cell.setAttribute('tabindex', '0');
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-label', 'Prázdné políčko — vlož ' + state.pending.value);
          cell.dataset.ghost = state.pending.value;
        } else {
          cell.removeAttribute('tabindex');
          cell.removeAttribute('role');
          cell.removeAttribute('aria-label');
          delete cell.dataset.ghost;
        }
      });

      board.classList.toggle('is-placing', Boolean(state.pending) && !state.over);

      /* Až po vyplnění buněk a popisků — náhled čte obojí z DOM. */
      if (window.MPPreview) {
        MPPreview.paint(cells, state.pending && !state.over ? state.pending.value : null);
      }

      (state.lines || []).forEach(function (points, index) {
        var out = scoreOut[index];
        if (!out) {
          return;
        }
        out.textContent = String(points);
        out.classList.toggle('is-scoring', points > 0);
      });
    }

    function renderCounters() {
      var placed = state ? state.placed : 0;
      var jokers = state ? state.jokers : 0;
      totalScore.textContent = state ? String(state.score) : '0';
      placedCount.textContent = placed + '/25';
      jokerCount.textContent = String(jokers);
      jokerBadge.classList.toggle('has-jokers', jokers > 0);
      jokerBadge.disabled = !(state && jokers > 0 && !state.pending &&
        !state.awaitingJoker && !state.over && !busy);
      if (deckCount) {
        deckCount.textContent = state ? String(state.remaining) : '–';
      }
    }

    function renderButton() {
      if (!state) {
        rollButton.textContent = idleLabel;
        rollButton.disabled = busy || !validTime();
        rollButton.classList.remove('is-restart');
        return;
      }
      if (state.over) {
        rollButton.textContent = 'Hrát znovu';
        rollButton.classList.add('is-restart');
        rollButton.disabled = busy;
        return;
      }
      rollButton.classList.remove('is-restart');
      if (state.remaining === 0 && state.jokers > 0 && !state.pending) {
        rollButton.textContent = 'Použij žolíka';
        rollButton.disabled = true;
        return;
      }
      rollButton.textContent = state.pending ? 'Vlož do pole' : 'Táhnout';
      // `busy` pokrývá i naplánované automatické tažení, takže do něj hráč
      // nemůže kliknout druhý tah.
      rollButton.disabled = Boolean(state.pending) || busy;
    }

    function renderSetup() {
      if (!setupRow) {
        return;
      }
      if (modeSelect) {
        var hard = modeSelect.value === 'hard';
        timeInput.hidden = !hard;
        if (timeLabel) {
          timeLabel.hidden = !hard;
        }
      }
      setupRow.hidden = Boolean(state) && !state.over;
    }

    function render() {
      renderDraw();
      renderBoard();
      renderCounters();
      renderButton();
      renderSetup();
    }

    /* ------------------------------------------------------------ časomíra */

    function stopTimer() {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    }

    /* Odpočet drží rozdíl mezi serverovým `deadline` a serverovým `now`
       v okamžiku odpovědi — ne mezi deadline a hodinami v počítači. */
    function syncTimer() {
      stopTimer();
      if (!timerTile) {
        return;                 // lehká obtížnost žádnou časomíru nemá
      }
      if (!state || !state.deadline || state.over) {
        timerTile.hidden = true;
        return;
      }
      var skew = Date.now() - state.now;      // rozdíl hodin klient ↔ server
      timerTile.hidden = false;

      function tick() {
        var left = Math.ceil((state.deadline + skew - Date.now()) / 1000);
        timerValue.textContent = formatTime(Math.max(0, left));
        var total = state.seconds || 1;
        var pct = (left / total) * 100;
        timerTile.classList.remove('t-good', 't-warn', 't-bad');
        timerTile.classList.add(pct > 60 ? 't-good' : pct > 30 ? 't-warn' : 't-bad');
        if (left <= 0) {
          stopTimer();
          onTimeout();
        }
      }

      tick();
      timerId = window.setInterval(tick, 250);
    }

    function onTimeout() {
      if (!state || state.over || !state.pending) {
        return;
      }
      var lost = state.pending.value;
      send({ action: 'timeout' }).then(function (ok) {
        if (ok) {
          MPUI.toast('Čas vypršel, číslo ' + lost + ' propadlo.', 'warn', 0, 'alert');
          scheduleRoll();
        }
      });
    }

    /* -------------------------------------------------------------- síť */

    function showNet(message) {
      if (!netBar) {
        MPUI.toast(message, 'warn', 0, 'alert');
        return;
      }
      netText.textContent = message;
      netBar.hidden = false;
    }

    function hideNet() {
      if (netBar) {
        netBar.hidden = true;
      }
    }

    var MESSAGES = {
      offline: 'Server neodpovídá — zkontroluj připojení.',
      timeout: 'Server odpovídá moc pomalu.',
      run_not_found: 'Partie na serveru už není. Začni novou.',
      run_over: 'Tahle partie je dohraná.',
      run_expired: 'Partie vypršela — byla otevřená moc dlouho.',
      too_fast: 'Moment, tahy jdou moc rychle za sebou.',
      too_many_runs: 'Z tvé sítě se založilo moc partií. Zkus to za chvíli.',
      cell_taken: 'Tam už číslo leží.',
      server_error: 'Serveru se něco nepovedlo. Zkus to znovu.'
    };

    function describe(code) {
      return MESSAGES[code] || 'Server odmítl tah (' + code + ').';
    }

    /**
     * Pošle akci a překlopí odpověď do stavu. Vrací Promise<boolean>.
     *
     * Jeden požadavek naráz. Zámek `inFlight` drží i přes čekání na opakovaný
     * pokus — a to je tu to podstatné: dokud se během pauzy uvolňoval, stihl
     * mezitím vyrazit další tah, server oba odmítl jako `too_fast` a ty se
     * navzájem živily dokola. Jedna partie takhle poslala přes čtyři sta
     * požadavků a hráči přes pole blikala chybová lišta.
     */
    function send(body) {
      if (!runId || inFlight) {
        return Promise.resolve(false);
      }
      inFlight = true;
      busy = true;
      render();

      /* `too_fast` není chyba hráče, ale závod tahů nebo pomalá linka —
         hráč s tím nic nenadělá, takže se místo hlášky chvíli počká. */
      function attempt(tries) {
        return MPApi.act(runId, body).then(function (result) {
          if (result.ok || result.error !== 'too_fast' || tries >= 3) {
            return result;
          }
          return new Promise(function (resolve) {
            window.setTimeout(function () {
              resolve(attempt(tries + 1));
            }, 180 * (tries + 1));
          });
        });
      }

      return attempt(0).then(function (result) {
        inFlight = false;
        busy = false;

        if (!result.ok) {
          showNet(describe(result.error));
          if (result.error === 'run_not_found' || result.error === 'run_expired') {
            // Partie na serveru není — držet její id už nemá smysl, jen by
            // se ta samá chyba opakovala u každé další akce.
            runId = null;
            state = null;
          }
          render();
          return false;
        }

        hideNet();
        state = result.data.state;
        if (state.over) {
          finish(result.data);
        } else {
          render();
          syncTimer();
        }
        return true;
      });
    }

    /* ------------------------------------------------------------- průběh */

    function chosenMode() {
      if (CONFIG.mode) {
        return CONFIG.mode;
      }
      return modeSelect && modeSelect.value === 'hard' ? 'hard' : 'easy';
    }

    function validTime() {
      if (chosenMode() !== 'hard' || !timeInput) {
        return true;
      }
      var value = parseInt(timeInput.value, 10);
      return !Number.isNaN(value) && value >= 3 && value <= 300;
    }

    function chosenSeconds() {
      if (chosenMode() !== 'hard' || !timeInput) {
        return undefined;
      }
      return parseInt(timeInput.value, 10);
    }

    function activeProfile() {
      return window.MPStore ? MPStore.ensure() : null;
    }

    /* Zveřejnění přezdívky je vlastní rozhodnutí, ne součást souhlasu
       s ukládáním — proto se na něj ptáme zvlášť a jen jednou. */
    function askPublish() {
      var stored = window.MPConsent && MPConsent.granted();
      return MPUI.open({
        icon: 'trophy',
        title: 'Ukázat se v žebříčku?',
        text: 'Do veřejné tabulky se pošle tvoje přezdívka, skóre, obtížnost ' +
          'a čas partie. Nic dalšího — žádný e‑mail, žádná IP adresa.' +
          (stored ? '' : ' Bez zapnutého ukládání navíc dostaneš při každé partii ' +
            'novou identitu, takže se výsledky nesečtou.'),
        dismissible: true,
        bodyHTML: '<p class="dialog-note">' + MPIcons.markup('shield') +
          'Rozmyslet si to jde kdykoli v profilu.</p>',
        actions: [
          { label: 'Ano, zveřejnit', value: 'yes', autofocus: true },
          { label: 'Hrát bez žebříčku', value: 'no', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === undefined) {
          return false;
        }
        MPRanked.setPublish(choice === 'yes');
        return true;
      });
    }

    function beginRun() {
      if (!validTime()) {
        MPUI.toast('Zadej čas 3 až 300 sekund.', 'warn', 0, 'alert');
        return;
      }
      if (CONFIG.ranked && !MPRanked.decided()) {
        askPublish().then(function (answered) {
          if (answered) {
            beginRun();
          }
        });
        return;
      }
      hideNet();
      busy = true;
      render();

      var profile = activeProfile();
      profileId = profile ? profile.id : null;
      var publish = CONFIG.ranked && window.MPConsent && MPConsent.granted() &&
        MPRanked.publishAllowed();

      MPApi.startRun({
        profileId: profileId,
        mode: chosenMode(),
        seconds: chosenSeconds(),
        name: profile ? profile.name : 'Hráč',
        publish: publish,
        // testovací režim (tests/server.mjs) — produkční funkce příznak ignoruje
        stackJokers: /[?&]stackJokers=1/.test(window.location.search)
      }).then(function (result) {
        busy = false;
        if (!result.ok) {
          showNet(describe(result.error));
          render();
          return;
        }
        hideNet();
        cacheStats(result.data.stats);
        state = result.data.state;
        runId = state.runId;
        render();
        scheduleRoll(0);
      });
    }

    /** Uloží ověřená čísla ze serveru do profilu, ať jdou ukázat i offline. */
    function cacheStats(stats) {
      if (stats && profileId && window.MPStore) {
        MPStore.setStats(profileId, stats);
      }
    }

    function cancelAutoRoll() {
      if (autoRollId !== null) {
        window.clearTimeout(autoRollId);
        autoRollId = null;
        busy = false;
      }
    }

    /* Po dobu čekání na automatické tažení je rozhraní zamčené — jinak by
       hráč stihl kliknout na „Táhnout“ a poslal by druhý tah do stejného
       okna. Stejně to dělá místní hra v js/game.js. */
    function scheduleRoll(delay) {
      cancelAutoRoll();
      busy = true;
      render();
      autoRollId = window.setTimeout(function () {
        autoRollId = null;
        busy = false;
        roll();
      }, delay === undefined ? AUTO_ROLL_DELAY : delay);
    }

    function roll() {
      if (!state || state.over || state.pending || state.awaitingJoker || busy) {
        return;
      }
      // Zbývá tolik políček, kolik má hráč žolíků — další karta z balíčku by
      // je připravila o poslední místo, kam se dají uplatnit.
      if (state.jokers > 0 && 25 - state.placed <= state.jokers && !jokerLock) {
        offerLeftoverJokers();
        return;
      }
      send({ action: 'draw' }).then(function (ok) {
        if (ok && state && state.awaitingJoker) {
          askJoker();
        }
      });
    }

    /**
     * Připomene uschované žolíky, když by jinak propadli.
     *
     * Kontrola musí být na klientovi a PŘED odesláním tahu: jakmile server
     * kartu vytáhne, je z balíčku pryč a políčko pro žolíka už nezbude.
     * Server tenhle případ neřeší schválně — je to nabídka hráči, ne pravidlo,
     * a táhnout dál je legitimní volba (třeba když chce vyšší číslo).
     */
    function offerLeftoverJokers() {
      var free = 25 - state.placed;
      busy = true;
      render();
      MPUI.open({
        icon: 'joker',
        title: 'Nezapomeň na žolíky',
        text: 'Zbývá ' + free + ' ' +
          (free === 1 ? 'políčko' : free < 5 ? 'políčka' : 'políček') +
          ' a máš ' + state.jokers + ' uschovaného žolíka. ' +
          'Když je nepoužiješ, propadnou.',
        dismissible: false,
        actions: [
          { label: 'Uplatnit žolíka', value: 'joker', autofocus: true },
          { label: 'Táhnout z balíčku', value: 'draw', variant: 'quiet' }
        ]
      }).then(function (choice) {
        busy = false;
        if (choice === 'joker') {
          useStoredJoker();
          return;
        }
        jokerLock = true;      // v tomhle tahu se už neptáme
        render();
        roll();
      });
    }

    function askJoker() {
      busy = true;
      render();
      MPUI.open({
        icon: 'joker',
        title: 'Vytáhl jsi žolíka',
        text: 'Můžeš mu hned určit hodnotu, nebo si ho uschovat na později.',
        actions: [
          { label: 'Použít teď', value: 'now', autofocus: true },
          { label: 'Uschovat', value: 'later', variant: 'quiet' }
        ]
      }).then(function (choice) {
        busy = false;
        if (choice === 'now') {
          return MPUI.pickValue({
            text: 'Vyber číslo, které žolík zastoupí.',
            dismissible: false,
            cancelLabel: 'Radši uschovat'
          }).then(function (value) {
            if (typeof value === 'number') {
              return send({ action: 'joker', choice: 'now', value: value });
            }
            return storeJoker();
          });
        }
        return storeJoker();
      });
    }

    function storeJoker() {
      return send({ action: 'joker', choice: 'later' }).then(function (ok) {
        if (!ok) {
          return false;
        }
        MPUI.toast('Žolík uschován. Máš jich ' + state.jokers + '.', 'joker', 0, 'joker');
        if (state.awaitingJoker) {
          askJoker();          // hned za ním přišel druhý
        }
        return true;
      });
    }

    function useStoredJoker() {
      if (!state || state.jokers === 0 || state.pending || state.over || busy) {
        return;
      }
      busy = true;
      render();
      MPUI.pickValue({
        title: 'Uplatnit uschovaného žolíka',
        text: 'Vyber číslo, které žolík zastoupí.',
        dismissible: true,
        cancelLabel: 'Zpět'
      }).then(function (value) {
        busy = false;
        if (typeof value !== 'number') {
          render();
          return;
        }
        send({ action: 'usejoker', value: value });
      });
    }

    function place(index) {
      if (!state || !state.pending || state.over || busy) {
        return;
      }
      var row = Math.floor(index / 5);
      var col = index % 5;
      if (state.grid[row][col] !== null) {
        return;
      }
      stopTimer();
      jokerLock = false;      // po položení se na žolíky ptáme zase
      send({ action: 'place', row: row, col: col }).then(function (ok) {
        if (!ok || !state || state.over) {
          return;
        }
        if (!state.pending) {
          // karta buď padla na pole, nebo propadla kvůli času
          scheduleRoll();
        }
      });
    }

    /* -------------------------------------------------------- konec hry */

    function escapeHTML(text) {
      return String(text)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
    }

    /** @param {Object} data odpověď serveru: { state, placements, stats, records } */
    function finish(data) {
      stopTimer();
      cancelAutoRoll();
      /* Dohraná partie zůstává na serveru jen jako záznam o výsledku, další
         akce už do ní nepatří — id proto zahazujeme. */
      runId = null;
      cacheStats(data.stats);
      render();

      var full = state.placed >= 25;
      var text = full
        ? 'Zaplnil jsi celé pole.'
        : (state.reason || 'Hra skončila.') + ' Zaplněno ' + state.placed + ' z 25 políček.';

      MPUI.open({
        icon: full ? 'trophy' : 'dice',
        title: 'Konec hry',
        text: text,
        dismissible: true,
        bodyHTML:
          '<div class="dialog-score">' +
          '<span class="dialog-score-value">' + state.score + '</span>' +
          '<span class="dialog-score-label">celkem bodů</span>' +
          '</div>' +
          statsNote(data) +
          (CONFIG.ranked ? placementNote(data.placements, full, data.boardFailed) : ''),
        actions: [
          { label: 'Hrát znovu', value: 'again', autofocus: true },
          { label: CONFIG.backLabel, value: 'back', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === 'again') {
          restart();
        } else if (choice === 'back') {
          window.location.href = CONFIG.backHref;
        }
      });
    }

    /** Řádek o statistikách profilu: co se překonalo, nebo kde rekord stojí. */
    function statsNote(data) {
      if (data.statsFailed) {
        return '<p class="dialog-note is-warn">' + MPIcons.markup('alert') +
          'Do statistik se partii teď nepodařilo připsat. Skóre ale platí.</p>';
      }
      if (!data.stats) {
        return '';
      }
      var profile = window.MPStore ? MPStore.active() : null;
      var name = escapeHTML(profile ? profile.name : 'Hráč');
      var records = data.records || [];
      if (records.length) {
        var labels = records.map(function (key) {
          return RECORD_LABELS[key];
        }).filter(Boolean);
        return '<p class="dialog-note is-record">' + MPIcons.markup('trophy') +
          'Nový rekord (' + name + '): ' + labels.join(', ') + '</p>';
      }
      return '<p class="dialog-note">' + MPIcons.markup('user') + name +
        ' — osobní rekord zůstává ' + data.stats.best + ' bodů.</p>';
    }

    /* Popisky mají předložku v sobě: „1. dnes, 3. za týden“ se čte líp než
       „1. za dnes“. Neznámé období se do věty nedostane vůbec. */
    var PERIOD_LABELS = { day: 'dnes', week: 'za týden', month: 'za měsíc', all: 'celkově' };

    function placementNote(placements, full, boardFailed) {
      if (!full) {
        return '<p class="dialog-note">' + MPIcons.markup('info') +
          'Do žebříčku jdou jen partie se všemi 25 zaplněnými políčky.</p>';
      }
      /* Partie se dohrála, ale tabulka zápis nepřijala. Není to totéž jako
         „nemáme souhlas“ a hráč o tom má vědět pravdu — skóre platí, jen se
         neuložilo. */
      if (boardFailed) {
        return '<p class="dialog-note is-warn">' + MPIcons.markup('info') +
          'Do žebříčku se výsledek teď nepodařilo zapsat. Partie ale platí.</p>';
      }
      if (!placements) {
        return '<p class="dialog-note">' + MPIcons.markup('info') +
          'Výsledek se do žebříčku nezapsal — nemáme souhlas se zveřejněním přezdívky.</p>';
      }
      var parts = Object.keys(placements)
        .filter(function (key) { return placements[key] && PERIOD_LABELS[key]; })
        .map(function (key) { return placements[key] + '. ' + PERIOD_LABELS[key]; });
      if (!parts.length) {
        return '<p class="dialog-note">' + MPIcons.markup('info') +
          'Na první stovku to tentokrát nestačilo.</p>';
      }
      return '<p class="dialog-note is-record">' + MPIcons.markup('trophy') +
        'V žebříčku: ' + parts.join(', ') + '.</p>';
    }

    function restart() {
      stopTimer();
      cancelAutoRoll();
      hideNet();              // hláška z minulé partie do nové nepatří
      state = null;
      runId = null;
      busy = false;
      inFlight = false;
      jokerLock = false;
      cells.forEach(function (cell) {
        cell.textContent = '';
        cell.classList.remove('filled', 'from-joker', 'just-placed');
        cell.removeAttribute('title');
      });
      /* Bez stavu se renderBoard() hned vrací, takže by náhled z minulé
         partie zůstal viset na prázdném poli. */
      if (window.MPPreview) {
        MPPreview.clear(cells);
      }
      scoreOut.forEach(function (out) {
        out.textContent = '0';
        out.classList.remove('is-scoring');
      });
      board.classList.remove('is-placing');
      if (timerTile) {
        timerTile.hidden = true;
      }
      render();
    }

    /* --------------------------------------------------------- posluchače */

    function listen() {
      rollButton.addEventListener('click', function () {
        if (MPUI.isOpen()) {
          return;
        }
        if (!state) {
          beginRun();
          return;
        }
        if (state.over) {
          restart();
          return;
        }
        roll();
      });

      if (modeSelect) {
        modeSelect.addEventListener('change', function () {
          renderSetup();
          renderButton();
        });
      }
      if (timeInput) {
        timeInput.addEventListener('input', renderButton);
        timeInput.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' && validTime() && !rollButton.disabled) {
            rollButton.click();
          }
        });
      }

      jokerBadge.addEventListener('click', useStoredJoker);

      cells.forEach(function (cell, index) {
        cell.addEventListener('click', function () {
          place(index);
        });
        cell.addEventListener('keydown', function (event) {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            place(index);
          }
        });
      });

      if (netRetry) {
        netRetry.addEventListener('click', function () {
          hideNet();
          if (runId) {
            send({ action: 'state' });
          } else {
            render();
          }
        });
      }

      // Rozehraná partie na serveru přežije zavření karty. Upozornit na to je
      // levnější než ji obnovovat — hráč stejně nejčastěji chce hrát znovu.
      window.addEventListener('beforeunload', function (event) {
        if (state && !state.over && state.placed > 0) {
          event.preventDefault();
          event.returnValue = '';
        }
      });
    }

    /* --------------------------------------------- online, nebo místně? */

    /* Do rozhodnutí je tlačítko zamčené. Kdyby se dalo mačkat, stihl by hráč
       začít místní partii ve chvíli, kdy se za ni ještě může postavit server —
       a ta by se do statistik nezapsala. */
    function waiting() {
      rollButton.disabled = true;
      rollButton.textContent = 'Připojuji…';
    }

    /** Server je pryč (nebo ho hráč nechce) — hraje se místně a bez zápisu. */
    function goLocal(reason) {
      if (!window.MPGame) {
        showNet('Server není dostupný a místní hra se nenačetla.');
        return;
      }
      /* Říct to rovnou, ne až v dialogu na konci. Hráč, který si chce
         zapsat rekord, ať se může rozhodnout dřív než po dvaceti pěti tazích.
         Tlačítko „Zkusit znovu“ je pryč — v místní hře nemá co obnovovat
         a jeho posluchač se v tomhle režimu ani nevěší. */
      if (netRetry) {
        netRetry.hidden = true;
      }
      showNet(reason);
      window.MPGame.start({ statsNote: reason });
    }

    function noServerMessage() {
      return CONFIG.ranked
        ? 'Server není dostupný. Hru bez žebříčku najdeš v sekci Hra.'
        : 'Server není dostupný — hraje se místně a partie se nezapíše do statistik.';
    }

    render();
    waiting();

    /* Bez souhlasu s ukládáním nemá serverová partie komu čísla připsat —
       identita by se nikam neuložila a každá partie by patřila novému hráči.
       Hraje se rovnou místně, ať se kvůli tomu vůbec nechodí na síť. */
    if (CONFIG.needConsent && !(window.MPConsent && MPConsent.granted())) {
      goLocal('Statistiky se počítají po zapnutí ukládání v nastavení soukromí.');
      return;
    }

    MPApi.probe().then(function (up) {
      if (up) {
        listen();
        render();
        return;
      }
      if (CONFIG.fallback) {
        goLocal('Server není dostupný, takže se tahle partie do statistik nezapíše.');
        return;
      }
      showNet(noServerMessage());
      rollButton.disabled = true;
    });
  }

  /* Souhlas se zveřejněním přezdívky je zvlášť od souhlasu s ukládáním:
     jedno je „pamatuj si mě“, druhé „ukaž mě ostatním“. Klíč čte i profil,
     kde se dá přepnout. */
  var PUBLISH_KEY = 'mp-publish';

  window.MPRanked = {
    publishAllowed: function () {
      try {
        return localStorage.getItem(PUBLISH_KEY) === '1';
      } catch (err) {
        return false;
      }
    },
    setPublish: function (allowed) {
      try {
        localStorage.setItem(PUBLISH_KEY, allowed ? '1' : '0');
      } catch (err) {
        /* bez uložení se prostě nezveřejňuje */
      }
    },
    decided: function () {
      try {
        return localStorage.getItem(PUBLISH_KEY) !== null;
      } catch (err) {
        return false;
      }
    }
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
