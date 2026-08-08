/* Stavový automat partie o žebříček — celý na serveru.
   ==========================================================================

   Tohle je to místo, kvůli kterému má žebříček smysl. Balíček i pole leží
   tady, klient je nikdy celé nevidí a skóre neposílá — jen říká „polož
   kartu na 2,3“ a dostane zpátky nový stav. Vymyšlené číslo tedy nemá kudy
   dovnitř: neexistuje endpoint, který by skóre přijímal.

   Co tím padá a co ne
   -------------------
   padá   podvrh skóre, přehrání staré partie, hraní se znalostí balíčku
          dopředu (klient zná vždycky jen právě vytaženou kartu)
   nepadá „skript hraje dobře v reálném čase“. To má každá online hra
          a bez měření chování hráče se s tím nedá dělat nic rozumného.

   Stav partie
   -----------
   Uložený objekt je popsaný v `emptyRun()`. Klientovi se posílá jen
   `publicState()` — ořezaná verze BEZ zbytku balíčku. Kdyby šel ven celý
   deck, byla by celá tahle práce k ničemu.

   Modul je čistá logika: nesahá na síť ani na úložiště, jen bere stav
   a akci a vrací nový stav. Díky tomu se dá celý otestovat v Node bez
   Netlify (viz tests/run.mjs). */

import rules from '../../../public/shared/rules.js';

/* Meze partie. Nejsou to bezpečnostní hranice, ale ochrana proti zaseknutým
   a zapomenutým partiím — každá otevřená partie zabírá místo v úložišti. */
export const RUN_TTL_MS = 6 * 60 * 60 * 1000;   // 6 hodin na dohrání
export const MIN_MOVE_MS = 120;                 // rychlejší tah než člověk stihne

/* Rezerva k limitu na tah v těžké obtížnosti. Pokrývá cestu požadavku tam
   a zpátky — bez ní by hráč na pomalé lince přišel o kartu, kterou stihl
   položit včas. */
export const LATE_GRACE_MS = 1500;

/* `daily` je denní výzva: pravidla lehké obtížnosti, ale balíček nepřichází
   z Math.random — zakládající funkce ho podstrčí odvozený z data (viz
   netlify/functions/hra.mjs). Tady se tím nic nemění, jen se ten režim musí
   uznat jako platný. */
export const MODES = ['easy', 'hard', 'daily'];

/** Chyba, kterou funkce převede na HTTP odpověď s daným kódem. */
export class RunError extends Error {
  constructor(code, status = 400) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

export function emptyRun({ id, mode, playerId, seconds, deck, day }) {
  return {
    id,
    mode: MODES.includes(mode) ? mode : 'easy',
    playerId,
    /** jen v těžké obtížnosti: kolik sekund má hráč na jeden tah */
    seconds: seconds || null,
    /* Balíček se dá podstrčit. Denní výzva ho míchá z data (viz
       rules.dailyDeck), aby ho celý den dostali všichni stejný; bez něj
       se namíchá nový náhodný. */
    deck: deck || rules.buildDeck(),
    /** jen v denní výzvě: den, ze kterého je balíček — 'RRRR-MM-DD' */
    day: day || null,
    grid: rules.emptyGrid(),
    /** políčka položená ze žolíka — kreslí se jinou barvou */
    jokerCells: [],
    /** žolíci uschovaní v ruce */
    jokers: 0,
    /** karta čekající na položení: { value, fromJoker } */
    pending: null,
    /** kdy se karta vytáhla — z toho se v těžké obtížnosti počítá limit */
    pendingAt: null,
    /** vytažený žolík čeká na rozhodnutí „použít teď / uschovat“ */
    awaitingJoker: false,
    placed: 0,
    /* Kolik čísel propadlo kvůli času. Každé z nich spotřebuje jedno z 25
       políček — pole po něm zůstane prázdné a nová karta ho nenahradí. */
    forfeited: 0,
    drawNo: 0,
    score: 0,
    lines: [],
    over: false,
    reason: null,
    startedAt: Date.now(),
    /* Schválně 0, ne Date.now(): žádný tah ještě neproběhl, takže brzda
       nemá co brzdit. S časem založení odmítla první tažení každé partie
       jako `too_fast` a hráč dostal chybovou lištu hned po kliknutí
       na Start. */
    lastMoveAt: 0,
    finishedAt: null
  };
}

/* ------------------------------------------------------------- pohled ven */

/** Co smí vidět klient. Zbytek balíčku tu schválně není. */
export function publicState(run) {
  return {
    runId: run.id,
    mode: run.mode,
    day: run.day || null,
    seconds: run.seconds,
    grid: run.grid,
    jokerCells: run.jokerCells,
    jokers: run.jokers,
    pending: run.pending,
    /* Odpočet řídí server, ne prohlížeč: klient jen dopočítá rozdíl proti
       tomuhle okamžiku. Přetočené hodiny na počítači hráče tím pádem limit
       neovlivní. */
    deadline: deadlineOf(run),
    now: Date.now(),
    awaitingJoker: Boolean(run.awaitingJoker),
    placed: run.placed,
    forfeited: run.forfeited || 0,
    drawNo: run.drawNo,
    score: run.score,
    lines: run.lines,
    remaining: run.deck.length,
    over: run.over,
    reason: run.reason,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    durationMs: (run.finishedAt || Date.now()) - run.startedAt
  };
}

/* --------------------------------------------------------------- pomocné */

/** Do kdy musí být karta položená. `null` = bez limitu (lehká obtížnost). */
function deadlineOf(run) {
  if (run.mode !== 'hard' || !run.seconds || !run.pendingAt) {
    return null;
  }
  return run.pendingAt + run.seconds * 1000;
}

/** Uplynul limit i s rezervou na přenos? */
function isLate(run) {
  const deadline = deadlineOf(run);
  return deadline !== null && Date.now() > deadline + LATE_GRACE_MS;
}

/** Kolik z 25 políček je už vyřízených — zaplněných nebo propadlých. */
function usedCells(run) {
  return run.placed + (run.forfeited || 0);
}

/* Karta propadla — mizí z ruky a políčko po ní zůstává prázdné navždy.
   Náhradní kartu hráč nedostane: to je celý smysl těžké obtížnosti. Propadlé
   číslo proto spotřebuje jedno z 25 políček a partie o něj bude kratší. */
function forfeit(run) {
  run.pending = null;
  run.pendingAt = null;
  run.forfeited = (run.forfeited || 0) + 1;
  if (usedCells(run) >= rules.CELLS_TOTAL) {
    return finish(run, 'Poslednímu číslu vypršel čas.');
  }
  return run;
}

function rescore(run) {
  const result = rules.scoreGrid(run.grid);
  run.score = result.total;
  run.lines = result.lines.map((line) => line.points);
}

function assertLive(run) {
  if (run.over) {
    throw new RunError('run_over', 409);
  }
  if (Date.now() - run.startedAt > RUN_TTL_MS) {
    finish(run, 'Partie vypršela.');
    throw new RunError('run_expired', 410);
  }
}

/* Brzda na tažení karty. Není to bezpečnostní opatření (skript prostě
   počká), ale sráží nejlevnější způsob, jak endpoint zahltit.

   Hlídá se schválně JEN tažení, ne pokládání. Klient po položení stejně
   čeká 260 ms, než natáhne další číslo, takže poctivá hra na tuhle mez
   nikdy nenarazí — kdežto na položení narazit může: rychlé kliknutí do
   pole hned po vytažení čísla je normální hra, ne podvod. Bot je tím
   omezený na 120 ms na kartu, což je celý účel. */
function assertPace(run) {
  const now = Date.now();
  if (now - run.lastMoveAt < MIN_MOVE_MS) {
    throw new RunError('too_fast', 429);
  }
  run.lastMoveAt = now;
}

function finish(run, reason) {
  if (run.over) {
    return run;
  }
  run.over = true;
  /* Bez důvodu končí partie zaplněným polem. Když ale některá čísla propadla,
     zůstane pole neúplné a hráč by jinak hádal, proč se přestalo táhnout. */
  run.reason = reason ||
    (run.forfeited ? 'Všechna políčka jsou vyřízená.' : null);
  run.pending = null;
  run.finishedAt = Date.now();
  rescore(run);
  return run;
}

/* ------------------------------------------------------------------ akce */

/**
 * Vytáhne z balíčku další kartu.
 * Žolík se nepokládá rovnou — vrátí se `pending: null` a `awaitingJoker`,
 * takže se klient musí zeptat, co s ním. Tah tím nezmizí, stejně jako
 * v místní hře.
 */
export function draw(run) {
  assertLive(run);
  if (run.pending) {
    throw new RunError('already_pending');
  }
  assertPace(run);

  // propadlá čísla se počítají jako vyřízená políčka — dál se za ně netahá
  if (usedCells(run) >= rules.CELLS_TOTAL) {
    return finish(run);
  }

  const card = run.deck.pop();
  if (!card) {
    if (run.jokers > 0) {
      return run;                 // dohrát jde už jen uschovanými žolíky
    }
    return finish(run, 'Balíček je prázdný.');
  }

  if (card.type === 'joker') {
    run.awaitingJoker = true;
    return run;
  }

  run.drawNo++;
  run.pending = { value: card.value, fromJoker: false };
  run.pendingAt = Date.now();
  return run;
}

/**
 * Odpověď na vytaženého žolíka.
 * @param {'now'|'later'} choice
 * @param {number} [value] hodnota 1–13, když choice === 'now'
 */
export function answerJoker(run, choice, value) {
  assertLive(run);
  if (!run.awaitingJoker) {
    throw new RunError('no_joker_pending');
  }

  if (choice === 'now') {
    if (!rules.isValue(value)) {
      throw new RunError('bad_value');
    }
    run.awaitingJoker = false;
    run.drawNo++;
    run.pending = { value, fromJoker: true };
    run.pendingAt = Date.now();
    return run;
  }

  run.awaitingJoker = false;
  run.jokers++;
  // uschovaný žolík nespotřebuje tah — rovnou se táhne dál
  run.lastMoveAt = 0;
  return draw(run);
}

/** Uplatní žolíka z ruky. */
export function useStoredJoker(run, value) {
  assertLive(run);
  if (run.jokers <= 0) {
    throw new RunError('no_jokers');
  }
  if (run.pending || run.awaitingJoker) {
    throw new RunError('already_pending');
  }
  if (!rules.isValue(value)) {
    throw new RunError('bad_value');
  }

  run.lastMoveAt = Date.now();
  run.jokers--;
  run.drawNo++;
  run.pending = { value, fromJoker: true };
  run.pendingAt = Date.now();
  return run;
}

/** Položí čekající kartu na políčko [row, col], obojí 0–4. */
export function place(run, row, col) {
  assertLive(run);
  if (!run.pending) {
    throw new RunError('nothing_to_place');
  }
  if (!Number.isInteger(row) || !Number.isInteger(col) ||
      row < 0 || row > 4 || col < 0 || col > 4) {
    throw new RunError('bad_cell');
  }
  if (run.grid[row][col] !== null) {
    throw new RunError('cell_taken');
  }

  /* Limit v těžké obtížnosti hlídá server. Bez toho by stačilo v prohlížeči
     vypnout odpočet a hrát na neomezený čas — a přitom se zapsat do žebříčku
     jako těžká obtížnost. */
  if (isLate(run)) {
    return forfeit(run);
  }

  run.lastMoveAt = Date.now();
  run.grid[row][col] = run.pending.value;
  if (run.pending.fromJoker) {
    run.jokerCells.push([row, col]);
  }
  run.placed++;
  run.pending = null;
  rescore(run);

  if (usedCells(run) >= rules.CELLS_TOTAL) {
    return finish(run);
  }
  return run;
}

/**
 * Karta propadla, protože vypršel čas.
 * Klient si o to říká sám, ale server si datum ověří — jinak by šlo
 * nepohodlné karty odhazovat a čekat na lepší.
 */
export function timeout(run) {
  assertLive(run);
  if (!run.pending) {
    throw new RunError('nothing_to_place');
  }
  const deadline = deadlineOf(run);
  if (deadline === null) {
    throw new RunError('no_time_limit');
  }
  if (Date.now() < deadline) {
    throw new RunError('too_early');
  }
  return forfeit(run);
}

/** Hráč partii vzdal. Skóre se počítá z toho, co stihl položit. */
export function giveUp(run) {
  assertLive(run);
  return finish(run, 'Hráč partii ukončil.');
}

/* ------------------------------------------------------------- rozcestník */

/**
 * Provede akci nad stavem partie.
 * @param {Object} run   stav z úložiště (mutuje se)
 * @param {Object} body  { action, row, col, choice, value }
 */
export function apply(run, body) {
  switch (body.action) {
    case 'draw':
      return draw(run);
    case 'place':
      return place(run, body.row, body.col);
    case 'joker':
      return answerJoker(run, body.choice, body.value);
    case 'usejoker':
      return useStoredJoker(run, body.value);
    case 'timeout':
      return timeout(run);
    case 'giveup':
      return giveUp(run);
    case 'state':
      return run;
    default:
      throw new RunError('unknown_action');
  }
}

export { rules };
