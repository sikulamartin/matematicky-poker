/* Skupinová hra — klient, který si sám nic nepočítá.

   Stejný řez jako u hry na serveru (js/online.js): tenhle soubor nemá balíček,
   nemá bodování a neví, jaké číslo přijde. Umí jediné — poslat serveru akci
   a vykreslit stav, který dostane zpátky.

   Navíc proti hře pro jednoho je tu čekání na druhé. Čísla tahá zadavatel,
   takže ostatním musí přijít sama od sebe: klient se každou chvíli ptá na
   stav (`state`) a jakmile v odpovědi přibude číslo, objeví se na obrazovce.
   Dotazování je schválně hloupé a krátké — žádné WebSockety, protože celý
   web běží na statickém hostingu a jedna funkce navíc by kvůli tomu musela
   držet spojení.

   Tři obrazovky, jeden stav
   ------------------------
   vstup     založit lobby / připojit se kódem
   čekárna   kód, sestava, zadavatel spouští
   hra       konzole, pole a průběžné pořadí vedle něj

   Co se kdy ukáže, rozhoduje `view.status` ze serveru — ne klikání. Díky tomu
   se stránka po obnovení vrátí přesně tam, kde hráč skončil. */
(function () {
  'use strict';

  /* Jak často se klient ptá na stav. Rychlost se platí voláním funkce, takže
     se zrychluje jenom tam, kde je zpoždění opravdu vidět — když hráč čeká na
     další číslo. Kdo právě drží číslo v ruce nebo sedí v čekárně, o nic
     nepřijde, když se zeptá za dvě vteřiny. */
  var POLL_WAITING_MS = 700;   // čekám na číslo od zadavatele
  var POLL_HOST_MS = 1200;     // zadavatel sleduje, kdo už položil
  var POLL_IDLE_MS = 2200;     // čekárna, rozmýšlení nad vlastním tahem
  var POLL_OVER_MS = 3000;     // dohráno — čeká se, jestli zadavatel rozdá znovu

  var SEAT_KEY = 'mp-seat';    // rozehrané místo v lobby (jen se souhlasem)

  function byId(id) {
    return document.getElementById(id);
  }

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* -------------------------------------------------------------- místo */

  /* Místo v lobby je dvojice id + token. Ukládá se jenom se souhlasem —
     bez něj se po obnovení stránky hráč do rozehrané hry nevrátí a musí se
     připojit znovu (a začíná s prázdným polem). Radši to říct dopředu než
     ukládat identifikátor někomu, kdo si to nepřál. */

  function readSeat() {
    if (!window.MPConsent || !MPConsent.granted()) {
      return null;
    }
    try {
      var parsed = JSON.parse(localStorage.getItem(SEAT_KEY) || 'null');
      if (parsed && parsed.code && parsed.playerId && parsed.token) {
        return parsed;
      }
    } catch (err) {
      /* poškozený záznam — hráč se připojí znovu */
    }
    return null;
  }

  function writeSeat(seat) {
    if (!window.MPConsent || !MPConsent.granted()) {
      return;
    }
    try {
      localStorage.setItem(SEAT_KEY, JSON.stringify(seat));
    } catch (err) {
      /* bez uložení se místo neobnoví, hra tím netrpí */
    }
  }

  function clearSeat() {
    try {
      localStorage.removeItem(SEAT_KEY);
    } catch (err) {
      /* nic k mazání */
    }
  }

  /* ---------------------------------------------------------------- start */

  function start() {
    var board = byId('board');
    if (!board) {
      return;
    }

    var el = {
      entry: byId('entryView'),
      room: byId('roomView'),
      game: byId('gameView'),
      netBar: byId('netBar'),
      netText: byId('netText'),
      netRetry: byId('netRetry'),

      createForm: byId('createForm'),
      hostName: byId('hostName'),
      modeSelect: byId('modeSelect'),
      timeInput: byId('timeInput'),
      timeLabel: byId('timeLabel'),
      hostPlays: byId('hostPlays'),
      createBtn: byId('createBtn'),

      joinForm: byId('joinForm'),
      codeInput: byId('codeInput'),
      joinName: byId('joinName'),
      joinBtn: byId('joinBtn'),

      roomCode: byId('roomCode'),
      roomMode: byId('roomMode'),
      roomMeta: byId('roomMeta'),
      roomParty: byId('roomParty'),
      roomHint: byId('roomHint'),
      startBtn: byId('startBtn'),
      leaveRoom: byId('leaveRoom'),
      copyCode: byId('copyCode'),
      copyLink: byId('copyLink'),

      drawTile: byId('drawTile'),
      drawValue: byId('drawValue'),
      drawOrder: byId('drawOrder'),
      totalScore: byId('totalScore'),
      placedCount: byId('placedCount'),
      timerTile: byId('timerTile'),
      timerValue: byId('timerValue'),
      turnHint: byId('turnHint'),
      drawBtn: byId('drawBtn'),
      jokerBadge: byId('jokerBadge'),
      jokerCount: byId('jokerCount'),

      sideTitle: byId('sideTitle'),
      sideMeta: byId('sideMeta'),
      sideParty: byId('sideParty'),
      sideHint: byId('sideHint'),
      restartBtn: byId('restartBtn'),
      finishBtn: byId('finishBtn'),
      leaveGame: byId('leaveGame')
    };

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

    var seat = readSeat();
    var view = null;         // poslední stav ze serveru
    var busy = false;        // čeká se na odpověď nebo na dialog
    var inFlight = false;    // právě běží požadavek — druhý se nesmí přidat
    var pollId = null;
    var timerId = null;
    var queue = Promise.resolve();   // fronta akcí hráče, viz send()
    var lastDrawn = 0;       // kolik čísel bylo naposled vidět (kvůli animaci)
    var endShown = false;
    var serverDown = false;  // bez serveru se lobby nedá ani založit
    /* Hodnota natažená z uschovaného žolíka: hráč ji vybral a teď klikne do
       pole. Pokládá se mimo sdílenou řadu, takže se to nedá schovat pod
       `pending` ze serveru a musí to čekat tady. */
    var armedJoker = null;
    var jokerAsked = 0;      // pro které číslo v řadě jsme se už na žolíka ptali

    /* ---------------------------------------------------------------- síť */

    var MESSAGES = {
      offline: 'Server neodpovídá — zkontroluj připojení.',
      timeout: 'Server odpovídá moc pomalu.',
      bad_code: 'Kód lobby vypadá divně.',
      bad_seconds: 'Zadej čas 3 až 300 sekund.',
      bad_value: 'Vyber žolíkovi hodnotu 1 až 13.',
      lobby_not_found: 'Lobby s tímhle kódem neexistuje.',
      lobby_full: 'Lobby je plné.',
      lobby_over: 'Tahle hra už skončila.',
      already_started: 'Hra už běží — do rozjeté partie se naskočit nedá.',
      not_started: 'Hra ještě neběží.',
      not_host: 'Tohle může udělat jenom zadavatel.',
      not_in_lobby: 'V tomhle lobby už tvoje místo není.',
      not_playing: 'Rozdáváš čísla, ale sám nehraješ.',
      no_players: 'Nikdo nehraje — přepni se zpátky mezi hráče nebo počkej na ostatní.',
      player_done: 'Máš dohráno.',
      cell_taken: 'Tam už číslo leží.',
      nothing_to_place: 'Zatím nemáš co položit.',
      not_a_joker: 'Uschovat jde jenom žolík.',
      no_jokers: 'Žádného uschovaného žolíka nemáš.',
      too_early: 'Číslo ještě neprošlo.',
      too_fast: 'Moment, čísla jdou moc rychle za sebou.',
      too_many_runs: 'Z tvé sítě se založilo moc her. Zkus to za chvíli.',
      still_running: 'Hra ještě běží.',
      server_error: 'Serveru se něco nepovedlo. Zkus to znovu.'
    };

    function describe(code) {
      return MESSAGES[code] || 'Server odmítl akci (' + code + ').';
    }

    function showNet(message) {
      el.netText.textContent = message;
      el.netBar.hidden = false;
    }

    function hideNet() {
      el.netBar.hidden = true;
    }

    /**
     * Jedno volání serveru. Vrací Promise<boolean>.
     * Přímo se volá jenom u dotazu na stav; akce hráče chodí přes `send()`.
     */
    function request(body, quiet) {
      inFlight = true;
      if (!quiet) {
        busy = true;
        render();
      }

      return MPApi.lobby(body).then(function (result) {
        inFlight = false;
        busy = false;

        if (!result.ok) {
          /* Dotaz na stav padá potichu: krátký výpadek sítě nemá zaplavit
             obrazovku hláškou, když se za vteřinu zeptáme znovu. Chyba
             „tvoje místo tu není“ je ale konečná i na pozadí. */
          if (result.error === 'not_in_lobby' || result.error === 'lobby_not_found') {
            forget(describe(result.error));
            return false;
          }
          if (!quiet) {
            showNet(describe(result.error));
            render();
          }
          return false;
        }

        hideNet();
        if (result.data.seat) {
          seat = result.data.seat;
          writeSeat(seat);
        }
        adopt(result.data.lobby);
        return true;
      });
    }

    /**
     * Akce hráče. Zařadí se do fronty za to, co zrovna běží.
     *
     * Fronta tu není pro pořádek, ale kvůli tomu, že na pozadí pořád běhá
     * dotaz na stav. Dokud se akce při obsazené lince rovnou zahazovala,
     * mizela hráči kliknutí: stisk „Ukončit hru“ nebo položení čísla se
     * trefil do právě běžícího dotazu a neprovedl se vůbec — bez chyby,
     * bez hlášky, prostě se nic nestalo.
     */
    function send(body, quiet) {
      if (!quiet) {
        busy = true;              // rozhraní zamkne hned, ne až se linka uvolní
        render();
      }
      var run = function () {
        return request(body, quiet);
      };
      queue = queue.then(run, run);
      return queue;
    }

    /** Místo v lobby padlo — zpátky na vstupní obrazovku. */
    function forget(message) {
      stopPoll();
      stopTimer();
      seat = null;
      view = null;
      endShown = false;
      armedJoker = null;
      jokerAsked = 0;
      clearSeat();
      render();
      if (message) {
        MPUI.toast(message, 'warn', 0, 'alert');
      }
    }

    /* ------------------------------------------------------------- stav */

    function adopt(next) {
      var previous = view;
      var before = previous && previous.me ? previous.me.forfeited : null;
      view = next;

      // O propadlé číslo se hráč dozví z toho, co se stalo na serveru —
      // klientský odpočet je jenom ciferník, rozhoduje termín u čísla.
      if (before !== null && view.me && view.me.forfeited > before) {
        MPUI.toast('Čas vypršel, číslo propadlo.', 'warn', 0, 'alert');
      }

      /* Nové kolo se stejnou sestavou: zadavatel ho spustí sám a ostatním
         se má hra objevit pod rukama. Proto se po konci dotazuje dál (jen
         líněji) a při přechodu zpátky do hry se uklidí obrazovka i dialog
         s pořadím z minulého kola. */
      if (previous && previous.round !== view.round) {
        MPUI.close();
        resetBoard();
      }

      render();
      syncTimer();

      if (view.status === 'over' && !endShown) {
        endShown = true;
        showEnd();
      }
      if (view.status !== 'over') {
        endShown = false;
      }
      askJoker();
    }

    /* --------------------------------------------------------------- žolík */

    /**
     * Zeptá se na čerstvě vytaženého žolíka: použít teď, nebo uschovat?
     *
     * Ptá se jednou na jedno číslo v řadě (`jokerAsked`) — dotaz na stav
     * chodí každou chvíli a bez toho by dialog naskakoval pořád dokola.
     * Kdo dialog zavře, může žolíka pořád položit klikem do pole nebo
     * uschovat přes odznak; tohle je nabídka, ne brána.
     */
    function askJoker() {
      var mine = me();
      if (!mine || !mine.playing || !mine.pending || view.status !== 'running') {
        return;
      }
      if (mine.pending.type !== 'joker' || jokerAsked === mine.pending.no || busy) {
        return;
      }
      jokerAsked = mine.pending.no;

      MPUI.open({
        icon: 'joker',
        title: 'Vytáhl jsi žolíka',
        text: 'Můžeš mu hned určit hodnotu a položit ho, nebo si ho uschovat ' +
          'na později. Ostatní si volí vlastní hodnotu.' +
          (view.mode === 'hard' ? ' Rozhodnout se musíš do vypršení času.' : ''),
        dismissible: true,
        actions: [
          { label: 'Použít teď', value: 'now', autofocus: true },
          { label: 'Uschovat', value: 'later', variant: 'quiet' }
        ]
      }).then(function (choice) {
        if (choice === 'later') {
          storeJoker();
        }
        // „Použít teď“ nic neposílá: hráč prostě klikne do pole jako u čísla
      });
    }

    function storeJoker() {
      act({ action: 'storejoker' }).then(function (ok) {
        if (ok && me()) {
          MPUI.toast('Žolík uschován. Máš jich ' + me().jokers + '.', 'joker', 0, 'joker');
        }
      });
    }

    /** Natáhne uschovaného žolíka: vybere se hodnota, pak se klikne do pole. */
    function armJoker() {
      var mine = me();
      if (!mine || !mine.jokers || view.status !== 'running' || mine.done || busy) {
        return;
      }
      if (armedJoker !== null) {
        armedJoker = null;             // druhý klik natažení zruší
        render();
        return;
      }

      busy = true;
      render();
      MPUI.pickValue({
        title: 'Uplatnit uschovaného žolíka',
        text: 'Vyber hodnotu a pak klikni do pole, kam žolíka položíš.',
        dismissible: true,
        cancelLabel: 'Zpět'
      }).then(function (value) {
        busy = false;
        armedJoker = typeof value === 'number' ? value : null;
        render();
        if (armedJoker !== null) {
          MPUI.toast('Klikni do pole, kam žolíka za ' + armedJoker + ' položíš.',
            'joker', 0, 'joker');
        }
      });
    }

    function me() {
      return view && view.me ? view.me : null;
    }

    function isHost() {
      return Boolean(me() && me().host);
    }

    /* -------------------------------------------------------- dotazování */

    /* Řetěz timeoutů, ne setInterval: dokud se čeká na odpověď, další dotaz
       nevyjede. Se setIntervalem se při pomalé lince požadavky nakupily
       a server pak odpovídal na dotazy, o které už nikdo nestál. */
    function pollDelay() {
      if (!view || view.status === 'lobby') {
        return POLL_IDLE_MS;
      }
      if (view.status === 'over') {
        return POLL_OVER_MS;          // hlídá se jen to, jestli přijde další kolo
      }
      var mine = me();
      if (mine && mine.playing && mine.pending) {
        return POLL_IDLE_MS;          // číslo už mám, teď je řada na mně
      }
      if (mine && mine.done) {
        return POLL_HOST_MS;          // dohráno — čeká se na ostatní
      }
      return isHost() ? POLL_HOST_MS : POLL_WAITING_MS;
    }

    function schedulePoll() {
      stopPoll();
      pollId = window.setTimeout(function () {
        pollId = null;
        if (!seat) {
          return;
        }
        pollState().then(function () {
          if (seat && view) {
            schedulePoll();
          }
        });
      }, pollDelay());
    }

    function stopPoll() {
      if (pollId !== null) {
        window.clearTimeout(pollId);
        pollId = null;
      }
    }

    /* Dotaz na stav se smí zahodit — na rozdíl od akce hráče se za chvíli
       zeptáme znovu a čekat ve frontě na doběhnutí tahu nemá cenu. */
    function pollState() {
      if (!seat || inFlight) {
        return Promise.resolve(false);
      }
      return request({
        action: 'state',
        code: seat.code,
        playerId: seat.playerId,
        token: seat.token
      }, true);
    }

    /** Akce hráče. Po ní se hned pokračuje v dotazování. */
    function act(body, quiet) {
      if (!seat) {
        return Promise.resolve(false);
      }
      return send(Object.assign({
        code: seat.code,
        playerId: seat.playerId,
        token: seat.token
      }, body), quiet).then(function (ok) {
        if (seat && view) {
          schedulePoll();
        }
        return ok;
      });
    }

    /* --------------------------------------------------------- vykreslení */

    function render() {
      var phase = !seat || !view ? 'entry' : (view.status === 'lobby' ? 'room' : 'game');
      el.entry.hidden = phase !== 'entry';
      el.room.hidden = phase !== 'room';
      el.game.hidden = phase !== 'game';

      if (phase === 'entry') {
        renderEntry();
      } else if (phase === 'room') {
        renderRoom();
      } else {
        renderGame();
      }
    }

    function renderEntry() {
      var hard = el.modeSelect.value === 'hard';
      el.timeLabel.hidden = !hard;
      el.createBtn.disabled = busy || serverDown || !validTime();
      el.joinBtn.disabled = busy || serverDown || el.codeInput.value.trim().length < 3;
    }

    var MODE_LABEL = {
      easy: 'Lehká obtížnost — bez času',
      hard: 'Těžká obtížnost'
    };

    function modeText() {
      if (!view) {
        return '';
      }
      return view.mode === 'hard'
        ? MODE_LABEL.hard + ' — ' + view.seconds + ' s na číslo'
        : MODE_LABEL.easy;
    }

    function countText(n, one, few, many) {
      return n + ' ' + (n === 1 ? one : n < 5 ? few : many);
    }

    function renderRoom() {
      el.roomCode.textContent = view.code;
      el.roomMode.textContent = modeText();
      el.roomMeta.textContent = countText(view.players.length, 'hráč', 'hráči', 'hráčů');
      el.roomParty.innerHTML = view.players.map(function (player) {
        return partyRow(player, null);
      }).join('');

      el.startBtn.hidden = !isHost();
      el.startBtn.disabled = busy;
      el.roomHint.textContent = isHost()
        ? 'Rozešli kód. Až budou všichni v sestavě, spusť hru — od té chvíle už ' +
          'se nikdo nepřipojí.'
        : 'Čeká se, až zadavatel spustí hru.';
    }

    /** Jeden řádek sestavy. `rank` je vyplněný až v konečném pořadí. */
    function partyRow(player, rank) {
      var tags = '';
      if (player.host) {
        tags += '<span class="pill">zadavatel</span>';
      }
      if (!player.playing) {
        tags += '<span class="pill pill--off">rozdává</span>';
      }
      if (player.left) {
        tags += '<span class="pill pill--off">odešel</span>';
      }
      var mine = me() && player.id === me().id;

      var meta = '';
      if (view.status !== 'lobby' && player.playing && !player.left) {
        meta = player.placed + '/25 políček';
        if (player.forfeited) {
          meta += ' · ' + player.forfeited + '× propadlo';
        }
        if (player.jokers) {
          meta += ' · ' + player.jokers + '× žolík v ruce';
        }
        if (player.done) {
          meta += ' · dohráno';
        } else if (player.behind > 0) {
          meta += ' · ' + player.behind + ' ve frontě';
        }
      }

      return '<li class="party-row' + (mine ? ' is-mine' : '') +
        (rank ? ' is-ranked' : '') + (rank && rank <= 3 ? ' is-podium' : '') + '">' +
        (rank ? '<span class="party-rank">' + rank + '</span>' : '') +
        '<span class="party-who">' +
        '<span class="party-name">' + escapeHTML(player.name) +
        (mine ? '<span class="pill pill--on">ty</span>' : '') + tags + '</span>' +
        (meta ? '<span class="party-meta">' + meta + '</span>' : '') +
        '</span>' +
        (view.status !== 'lobby' && player.playing
          ? '<span class="party-score">' + player.score + '</span>'
          : '') +
        '</li>';
    }

    function renderGame() {
      var mine = me();
      var playing = Boolean(mine && mine.playing);
      el.game.classList.toggle('is-dealer', !playing);

      renderDraw();
      renderBoard();
      renderCounters();
      renderControls();
      renderSide();
    }

    function renderDraw() {
      var mine = me();
      var pending = mine && mine.pending;

      /* Kdo jenom rozdává, vidí poslední vytažené číslo. Kdo hraje, vidí to
         svoje — a ta dvě čísla se liší, když hráč zaostal za frontou. */
      var shown = pending || (mine && !mine.playing ? view.last : null);

      // žolík jde ven bez hodnoty — místo čísla se ukáže hvězdička
      el.drawValue.textContent = !shown ? '–'
        : (shown.type === 'joker' ? '★' : String(shown.value));

      if (shown) {
        var label = shown.no + '. číslo';
        if (shown.type === 'joker') {
          label += ' · žolík';
        }
        el.drawOrder.textContent = label;
        el.drawTile.classList.remove('is-empty');
        if (view.drawn !== lastDrawn) {
          el.drawValue.classList.remove('draw-pop');
          void el.drawValue.offsetWidth;
          el.drawValue.classList.add('draw-pop');
        }
      } else {
        el.drawOrder.textContent = view.status === 'over' ? 'konec hry' : 'číslo';
        el.drawTile.classList.add('is-empty');
      }
      lastDrawn = view.drawn;
    }

    function renderBoard() {
      var mine = me();
      if (!mine || !mine.playing) {
        return;
      }
      var jokerSet = {};
      mine.jokerCells.forEach(function (pair) {
        jokerSet[pair[0] + ':' + pair[1]] = true;
      });
      var live = view.status === 'running' && !mine.done;
      // do pole se kliká buď s číslem z fronty, nebo s nataženým žolíkem z ruky
      var canPlace = live && (Boolean(mine.pending) || armedJoker !== null);

      cells.forEach(function (cell, index) {
        var row = Math.floor(index / 5);
        var col = index % 5;
        var value = mine.grid[row][col];
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

        if (value === null && canPlace) {
          /* Natažený žolík má přednost před číslem z fronty: hráč si ho právě
             vybral a klik do pole patří jemu. */
          var ghost = armedJoker !== null ? armedJoker
            : (mine.pending.type === 'joker' ? null : mine.pending.value);

          cell.setAttribute('tabindex', '0');
          cell.setAttribute('role', 'button');
          cell.setAttribute('aria-label', ghost === null
            ? 'Prázdné políčko — vlož žolíka'
            : 'Prázdné políčko — vlož ' + ghost);
          if (ghost === null) {
            delete cell.dataset.ghost;
          } else {
            cell.dataset.ghost = ghost;
          }
        } else {
          cell.removeAttribute('tabindex');
          cell.removeAttribute('role');
          cell.removeAttribute('aria-label');
          delete cell.dataset.ghost;
        }
      });

      board.classList.toggle('is-placing', canPlace);

      /* Náhled bodů. Žolík z fronty ještě nemá hodnotu, takže není co
         počítat — natažený žolík z ruky ji naopak má a náhled se ho týká
         stejně jako obyčejného čísla. */
      if (window.MPPreview) {
        var preview = null;
        if (canPlace) {
          preview = armedJoker !== null ? armedJoker
            : (mine.pending.type === 'joker' ? null : mine.pending.value);
        }
        MPPreview.paint(cells, preview);
      }

      /* Prochází se bodové buňky, ne přijaté linie: po novém kole přijde
         prázdný seznam a body z minulého kola by na okrajích pole zůstaly
         viset. */
      var lines = mine.lines || [];
      scoreOut.forEach(function (out, index) {
        var points = lines[index] || 0;
        out.textContent = String(points);
        out.classList.toggle('is-scoring', points > 0);
      });
    }

    function renderCounters() {
      var mine = me();
      el.totalScore.textContent = mine && mine.playing ? String(mine.score) : '–';
      el.placedCount.textContent = mine && mine.playing ? mine.placed + '/25' : '–';

      var jokers = mine && mine.playing ? mine.jokers : 0;
      el.jokerCount.textContent = String(jokers);
      el.jokerBadge.classList.toggle('has-jokers', jokers > 0);
      el.jokerBadge.classList.toggle('is-armed', armedJoker !== null);
      el.jokerBadge.hidden = !(mine && mine.playing);
      el.jokerBadge.disabled = !(jokers > 0 && view.status === 'running' &&
        !mine.done && !busy);
      el.jokerBadge.title = armedJoker !== null
        ? 'Žolík za ' + armedJoker + ' — klikni do pole, nebo sem pro zrušení'
        : 'Uschovaní žolíci — klikni pro uplatnění';
    }

    function renderControls() {
      var mine = me();
      var running = view.status === 'running';
      var waiting = view.players.filter(function (player) {
        return player.playing && !player.left && !player.done && player.behind > 0;
      }).length;

      el.drawBtn.hidden = !isHost() || !running;
      el.drawBtn.disabled = busy || view.drained;
      el.drawBtn.textContent = view.drained ? 'Balíček je prázdný' : 'Vytáhnout číslo';

      el.finishBtn.hidden = !isHost() || !running;
      el.restartBtn.hidden = !isHost() || view.status !== 'over';
      el.restartBtn.disabled = busy;
      el.leaveGame.textContent = view.status === 'over' ? 'Zpátky na výběr' : 'Odejít';

      if (!running) {
        el.turnHint.textContent = 'Konec hry';
        return;
      }
      if (armedJoker !== null) {
        el.turnHint.textContent = 'Klikni do pole, kam žolíka položíš';
      } else if (mine && mine.playing && mine.pending) {
        el.turnHint.textContent = mine.pending.type === 'joker'
          ? 'Polož žolíka, nebo ho uschovej'
          : 'Polož číslo do pole';
      } else if (mine && mine.playing && mine.jokers > 0 && view.drained) {
        el.turnHint.textContent = 'Uplatni uschovaného žolíka';
      } else if (mine && mine.done) {
        el.turnHint.textContent = 'Máš dohráno, čeká se na ostatní';
      } else if (isHost()) {
        el.turnHint.textContent = waiting
          ? countText(waiting, 'hráč ještě pokládá', 'hráči ještě pokládají',
            'hráčů ještě pokládá')
          : 'Všichni čekají na další číslo';
      } else {
        el.turnHint.textContent = 'Čeká se na zadavatele';
      }
    }

    function renderSide() {
      var over = view.status === 'over';
      el.sideTitle.textContent = over ? 'Pořadí' : 'Skupina';
      el.sideMeta.textContent = over
        ? (view.reason || 'Dohráno')
        : (view.drained ? 'balíček je prázdný' : view.remaining + ' karet v balíčku');

      if (over && view.standings) {
        var byId_ = {};
        view.players.forEach(function (player) {
          byId_[player.id] = player;
        });
        el.sideParty.innerHTML = view.standings.map(function (entry) {
          return partyRow(byId_[entry.id] || entry, entry.rank);
        }).join('');
      } else {
        el.sideParty.innerHTML = view.players.map(function (player) {
          return partyRow(player, null);
        }).join('');
      }

      var mine = me();
      /* Propadlé číslo políčko spotřebuje — do volných se nepočítá. */
      var free = mine && mine.playing
        ? 25 - mine.placed - (mine.forfeited || 0)
        : 0;
      if (over) {
        el.sideHint.textContent = isHost()
          ? 'Můžeš rozdat další kolo se stejnou sestavou.'
          : 'Zadavatel může rozdat další kolo.';
      } else if (mine && mine.jokers > 0 && free <= mine.jokers) {
        /* Poslední chvíle na uschované žolíky: další číslo z balíčku by je
           připravilo o jediné volné políčko, kam se dají uplatnit. */
        el.sideHint.textContent = 'Zbývá ti ' +
          countText(free, 'políčko', 'políčka', 'políček') + ' a v ruce máš ' +
          countText(mine.jokers, 'žolíka', 'žolíky', 'žolíků') +
          '. Uplatni je, jinak propadnou.';
      } else if (mine && mine.playing && mine.pending && mine.pending.no < view.drawn) {
        el.sideHint.textContent = 'Máš zpoždění — pokládáš ' + mine.pending.no +
          '. číslo, zatímco padlo už ' + view.drawn + '.';
      } else if (view.mode === 'hard') {
        el.sideHint.textContent = 'Termín na číslo platí pro všechny stejně. ' +
          'Co nestihneš, propadne.';
      } else {
        el.sideHint.textContent = '';
      }
    }

    /* ------------------------------------------------------------ časomíra */

    function formatTime(seconds) {
      var m = Math.floor(seconds / 60);
      var s = seconds % 60;
      return String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0');
    }

    function stopTimer() {
      if (timerId !== null) {
        window.clearInterval(timerId);
        timerId = null;
      }
    }

    /* Odpočet drží rozdíl mezi serverovým termínem a serverovým `now`
       v okamžiku odpovědi — ne mezi termínem a hodinami v počítači. */
    function syncTimer() {
      stopTimer();
      var mine = me();
      if (!mine || !mine.deadline || view.status !== 'running') {
        el.timerTile.hidden = true;
        return;
      }
      var skew = Date.now() - view.now;
      var deadline = mine.deadline;
      el.timerTile.hidden = false;

      function tick() {
        var left = Math.ceil((deadline + skew - Date.now()) / 1000);
        el.timerValue.textContent = formatTime(Math.max(0, left));
        var pct = (left / (view.seconds || 1)) * 100;
        el.timerTile.classList.remove('t-good', 't-warn', 't-bad');
        el.timerTile.classList.add(pct > 60 ? 't-good' : pct > 30 ? 't-warn' : 't-bad');
        if (left <= 0) {
          stopTimer();
          onTimeout();
        }
      }

      tick();
      timerId = window.setInterval(tick, 250);
    }

    /* Vypršel termín. Serveru se to jenom oznámí, aby číslo zmizelo hned —
       potichu, protože na výsledku to nic nemění: i kdyby požadavek nedorazil,
       propadlé číslo si server srovná sám při nejbližším dotazu na stav.
       Hlášku o propadnutí proto vypisuje `adopt()` podle skutečného stavu,
       ne tenhle pokus. */
    function onTimeout() {
      var mine = me();
      if (!mine || !mine.pending || view.status !== 'running') {
        return;
      }
      act({ action: 'timeout' }, true);
    }

    /* ------------------------------------------------------------- akce */

    function validTime() {
      if (el.modeSelect.value !== 'hard') {
        return true;
      }
      var value = parseInt(el.timeInput.value, 10);
      return !Number.isNaN(value) && value >= 3 && value <= 300;
    }

    function defaultName() {
      var profile = window.MPStore ? MPStore.active() : null;
      return profile ? profile.name : '';
    }

    function createLobby() {
      if (!validTime()) {
        MPUI.toast('Zadej čas 3 až 300 sekund.', 'warn', 0, 'alert');
        return;
      }
      busy = true;
      render();
      send({
        action: 'create',
        name: el.hostName.value || defaultName(),
        mode: el.modeSelect.value,
        seconds: parseInt(el.timeInput.value, 10),
        hostPlays: el.hostPlays.checked
      }).then(function (ok) {
        if (ok) {
          warnIfNotStored();
          schedulePoll();
        }
      });
    }

    function joinLobby() {
      var code = el.codeInput.value.trim().toUpperCase();
      if (!code) {
        return;
      }
      busy = true;
      render();
      send({
        action: 'join',
        code: code,
        name: el.joinName.value || defaultName()
      }).then(function (ok) {
        if (ok) {
          warnIfNotStored();
          schedulePoll();
        }
      });
    }

    /* Bez souhlasu s ukládáním nemá kam uložit místo v lobby, takže obnovení
       stránky znamená konec rozehrané hry. Říct to dopředu je lepší než to
       nechat hráče zjistit tím, že přijde o pole. */
    function warnIfNotStored() {
      if (window.MPConsent && MPConsent.granted()) {
        return;
      }
      MPUI.toast('Bez zapnutého ukládání se po obnovení stránky do hry nevrátíš.',
        'warn', 5200, 'info');
    }

    function place(index) {
      var mine = me();
      if (!mine || !mine.playing || mine.done || view.status !== 'running' || busy) {
        return;
      }
      var row = Math.floor(index / 5);
      var col = index % 5;
      if (mine.grid[row][col] !== null) {
        return;
      }

      /* Natažený žolík z ruky jde mimo frontu čísel, takže se pokládá i ve
         chvíli, kdy hráč zrovna drží číslo — to mu ve frontě zůstane. */
      if (armedJoker !== null) {
        var value = armedJoker;
        armedJoker = null;
        act({ action: 'usejoker', row: row, col: col, value: value });
        return;
      }

      if (!mine.pending) {
        return;
      }

      if (mine.pending.type === 'joker') {
        busy = true;
        render();
        MPUI.pickValue({
          text: 'Vyber číslo, které žolík zastoupí. Ostatní si volí vlastní.',
          dismissible: true,
          cancelLabel: 'Zpět'
        }).then(function (value) {
          busy = false;
          if (typeof value !== 'number') {
            render();
            return;
          }
          stopTimer();
          act({ action: 'place', row: row, col: col, value: value });
        });
        return;
      }

      stopTimer();
      act({ action: 'place', row: row, col: col });
    }

    function leave() {
      var running = view && view.status === 'running';
      MPUI.open({
        icon: 'alert',
        title: isHost() && running ? 'Ukončit hru a odejít?' : 'Odejít z lobby?',
        text: isHost()
          ? 'Bez zadavatele nemá kdo tahat čísla, takže hra skončí a ukáže se pořadí.'
          : 'Tvoje pole se zahodí a do pořadí se nezapočítá.',
        dismissible: true,
        actions: [
          { label: 'Odejít', value: 'yes', variant: 'danger' },
          { label: 'Zůstat', value: 'no', variant: 'quiet', autofocus: true }
        ]
      }).then(function (choice) {
        if (choice !== 'yes') {
          return;
        }
        act({ action: 'leave' }).then(function () {
          forget(null);
        });
      });
    }

    /* -------------------------------------------------------- konec hry */

    function showEnd() {
      stopTimer();
      var standings = view.standings || [];
      var mine = me();
      var myRow = mine ? standings.filter(function (row) {
        return row.id === mine.id;
      })[0] : null;

      var rows = standings.slice(0, 5).map(function (row) {
        return '<li class="party-row is-ranked' +
          (myRow && row.id === myRow.id ? ' is-mine' : '') +
          (row.rank <= 3 ? ' is-podium' : '') + '">' +
          '<span class="party-rank">' + row.rank + '</span>' +
          '<span class="party-who"><span class="party-name">' +
          escapeHTML(row.name) + '</span>' +
          '<span class="party-meta">' + row.placed + '/25 políček</span></span>' +
          '<span class="party-score">' + row.score + '</span>' +
          '</li>';
      }).join('');

      var text = view.reason || 'Hra skončila.';
      if (myRow) {
        text += ' Skončil jsi ' + myRow.rank + '. z ' +
          countText(standings.length, 'hráče', 'hráčů', 'hráčů') + '.';
      }

      MPUI.open({
        icon: 'trophy',
        title: 'Konec hry',
        text: text,
        dismissible: true,
        bodyHTML: '<ul class="party-list party-list--dialog">' + rows + '</ul>',
        actions: isHost()
          ? [
            { label: 'Hrát znovu', value: 'again', autofocus: true },
            { label: 'Zavřít', value: 'close', variant: 'quiet' }
          ]
          : [{ label: 'Zavřít', value: 'close', autofocus: true }]
      }).then(function (choice) {
        if (choice === 'again') {
          restart();
        }
      });
    }

    function restart() {
      act({ action: 'restart' }).then(function (ok) {
        if (ok) {
          endShown = false;
          resetBoard();
          schedulePoll();
        }
      });
    }

    function resetBoard() {
      cells.forEach(function (cell) {
        cell.textContent = '';
        cell.classList.remove('filled', 'from-joker', 'just-placed');
        cell.removeAttribute('title');
      });
      if (window.MPPreview) {
        MPPreview.clear(cells);
      }
      scoreOut.forEach(function (out) {
        out.textContent = '0';
        out.classList.remove('is-scoring');
      });
      board.classList.remove('is-placing');
      el.timerTile.hidden = true;
      lastDrawn = 0;
      armedJoker = null;
      jokerAsked = 0;
    }

    /* --------------------------------------------------------- posluchače */

    el.createForm.addEventListener('submit', function (event) {
      event.preventDefault();
      createLobby();
    });

    el.joinForm.addEventListener('submit', function (event) {
      event.preventDefault();
      joinLobby();
    });

    el.modeSelect.addEventListener('change', renderEntry);
    el.timeInput.addEventListener('input', renderEntry);
    el.codeInput.addEventListener('input', function () {
      // kód se píše velkými písmeny, ať se shoduje s tím, co je na obrazovce
      var start = el.codeInput.selectionStart;
      el.codeInput.value = el.codeInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
      el.codeInput.setSelectionRange(start, start);
      renderEntry();
    });

    el.startBtn.addEventListener('click', function () {
      act({ action: 'start' }).then(function (ok) {
        if (ok) {
          resetBoard();
        }
      });
    });

    el.drawBtn.addEventListener('click', function () {
      act({ action: 'draw' });
    });

    el.jokerBadge.addEventListener('click', armJoker);

    el.finishBtn.addEventListener('click', function () {
      MPUI.open({
        icon: 'alert',
        title: 'Ukončit hru teď?',
        text: 'Body se spočítají z toho, co kdo stihl položit, a ukáže se pořadí.',
        dismissible: true,
        actions: [
          { label: 'Ukončit', value: 'yes', variant: 'danger' },
          { label: 'Hrát dál', value: 'no', variant: 'quiet', autofocus: true }
        ]
      }).then(function (choice) {
        if (choice === 'yes') {
          act({ action: 'finish' });
        }
      });
    });

    el.restartBtn.addEventListener('click', restart);
    el.leaveRoom.addEventListener('click', leave);
    el.leaveGame.addEventListener('click', function () {
      if (view && view.status === 'over') {
        act({ action: 'leave' }).then(function () {
          forget(null);
        });
        return;
      }
      leave();
    });

    function copyText(text, label) {
      var done = function () {
        MPUI.toast(label + ' zkopírován.', null, 0, 'check');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(done, function () {
          MPUI.toast('Zkopírovat se nepovedlo — opiš to ručně.', 'warn', 0, 'alert');
        });
        return;
      }
      MPUI.toast('Zkopírovat se nepovedlo — opiš to ručně.', 'warn', 0, 'alert');
    }

    el.copyCode.addEventListener('click', function () {
      copyText(view.code, 'Kód');
    });

    el.copyLink.addEventListener('click', function () {
      var url = window.location.origin + window.location.pathname + '?kod=' + view.code;
      copyText(url, 'Odkaz');
    });

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

    el.netRetry.addEventListener('click', function () {
      hideNet();
      if (seat) {
        pollState().then(function () {
          schedulePoll();
        });
      } else {
        render();
      }
    });

    /* Odvolaný souhlas znamená „nic si nepamatuj“ — uložené místo v lobby jde
       ven hned, ne až při dalším načtení. Rozehraná hra v téhle kartě běží dál,
       jen ji nepřežije obnovení stránky. */
    if (window.MPConsent) {
      MPConsent.onChange(function (next) {
        if (next === 'granted') {
          if (seat) {
            writeSeat(seat);
          }
        } else {
          clearSeat();
        }
      });
    }

    // Rozehraná hra na serveru přežije zavření karty, ale ostatní na tebe čekají.
    window.addEventListener('beforeunload', function (event) {
      var mine = me();
      if (view && view.status === 'running' && mine && (mine.host || mine.placed > 0)) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    /* -------------------------------------------------------------- vstup */

    el.hostName.value = defaultName();
    el.joinName.value = defaultName();

    var wanted = new URLSearchParams(window.location.search).get('kod');
    if (wanted) {
      el.codeInput.value = wanted.toUpperCase().replace(/[^A-Z0-9]/g, '');
    }
    render();

    if (seat) {
      // rozehrané místo z minulé návštěvy — zkusíme se do něj vrátit
      pollState().then(function (ok) {
        if (ok) {
          schedulePoll();
        }
      });
    } else {
      // Bez serveru nemá stránka co dělat — řekneme to hned, ne až po kliknutí.
      MPApi.probe().then(function (up) {
        if (!up) {
          serverDown = true;
          showNet('Server není dostupný. Skupinová hra bez něj nefunguje — ' +
            'hru pro jednoho najdeš v sekci Hra.');
          render();
        }
      });
    }
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start);
  } else {
    start();
  }
})();
