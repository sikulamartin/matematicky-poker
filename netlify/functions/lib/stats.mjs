/* Statistiky hráče — čistý výpočet.
   ==========================================================================

   Tenhle modul je serverový protějšek toho, co dřív počítal prohlížeč
   v js/store.js. Rozdíl není v tom, co se počítá, ale odkud čísla přicházejí:
   sem je nikdo neposílá. Volá se až v okamžiku, kdy partie skončila na
   serveru, a hodnoty jdou přímo ze stavu partie — skóre spočítalo
   `rescore()` v lib/run.mjs, délku změřily serverové hodiny, obtížnost
   je ta, se kterou se partie zakládala.

   Proto tu nejsou žádné kontroly věrohodnosti. Místní verze měla tři
   (žeton partie, meze skóre, otisk uložení) a všechny existovaly jen proto,
   že čísla přicházela zvenčí. Tady přicházet nemají kudy.

   Modul je čistá funkce nad objektem: nesahá na síť ani na úložiště, takže
   se dá celý otestovat bez Netlify (viz tests/statistiky.mjs). */

/** Prázdná sada. Tvar musí odpovídat `emptyStats()` v public/js/store.js. */
export function emptyStats() {
  return {
    games: 0,          // partie, které došly do konce (dohrané i ukončené)
    finished: 0,       // z toho ty se všemi 25 zaplněnými políčky
    best: 0,           // nejlepší skóre napříč obtížnostmi
    bestEasy: 0,
    bestHard: 0,
    fastestMs: null,   // nejrychlejší DOKONČENÁ partie
    fastestMode: null,
    lastPlayed: null
  };
}

/**
 * Doplní chybějící klíče.
 *
 * Záznamy hráčů vznikaly dřív, než statistiky existovaly, takže `player.stats`
 * často chybí celé. Bez tohohle by se první dohraná partie takového hráče
 * pokusila přičíst k `undefined`.
 */
export function normalizeStats(raw) {
  const stats = emptyStats();
  if (!raw || typeof raw !== 'object') {
    return stats;
  }
  for (const key of Object.keys(stats)) {
    if (raw[key] !== undefined) {
      stats[key] = raw[key];
    }
  }
  return stats;
}

/**
 * Přičte jednu skončenou partii.
 *
 * Nemutuje — vrací novou sadu. Volající ji zapisuje podmíněně (CAS) a při
 * kolizi celý výpočet opakuje nad čerstvou verzí, takže musí být opakovatelný
 * nad jiným výchozím stavem.
 *
 * @param {Object} stats  dosavadní sada (projde `normalizeStats`)
 * @param {Object} run    { score, mode, durationMs, complete, at }
 * @returns {{ stats: Object, records: string[] }} records: 'best' | 'easy' |
 *          'hard' | 'fastest' — co se touhle partií překonalo
 */
export function applyRun(stats, run) {
  const next = normalizeStats(stats);
  const records = [];

  const score = Number.isFinite(run.score) ? run.score : 0;
  const mode = run.mode === 'hard' ? 'hard' : 'easy';
  const complete = run.complete === true;
  const duration = Number.isFinite(run.durationMs) ? run.durationMs : null;

  next.games++;
  next.lastPlayed = run.at || new Date().toISOString();

  if (score > next.best) {
    next.best = score;
    records.push('best');
  }
  if (mode === 'hard') {
    if (score > next.bestHard) {
      next.bestHard = score;
      records.push('hard');
    }
  } else if (score > next.bestEasy) {
    next.bestEasy = score;
    records.push('easy');
  }

  /* Nejrychlejší hra se počítá jen ze zaplněného pole. Kdyby se počítaly
     i nedohrané partie, byl by rekordem první tah. */
  if (complete) {
    next.finished++;
    if (duration !== null && (next.fastestMs === null || duration < next.fastestMs)) {
      next.fastestMs = duration;
      next.fastestMode = mode;
      records.push('fastest');
    }
  }

  return { stats: next, records };
}
