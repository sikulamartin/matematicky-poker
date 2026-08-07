/* POST /api/hra — jediný vstup do partie o žebříček.
   ==========================================================================

   Klient sem posílá akce („táhni“, „polož na 2,3“, „žolík za sedmičku“)
   a dostává zpátky stav pole. Kartu, kterou ještě nevytáhl, nevidí; skóre
   nikdy neposílá. Endpoint, kterým by šlo zapsat body, prostě neexistuje.

   Kdo smí do partie sáhnout
   -------------------------
   runId je náhodné UUID a chová se jako klíč od partie: kdo ho má, hraje.
   Nekontroluje se u každého tahu znovu tajemství hráče, protože uhodnout
   UUID je stejně nemožné jako uhodnout tajemství, a ušetří to jedno čtení
   z úložiště na každý tah. Hráč se ověřuje jen při zakládání partie, kde
   se rozhoduje, pod jakým jménem se výsledek zapíše.

   Co se po dohrání zapisuje
   -------------------------
   žebříček     jen partie se všemi 25 políčky a jen se souhlasem hráče
                se zveřejněním přezdívky (`publish`)
   statistiky   každá skončená partie, souhlas ani žebříček v tom nehrají roli.
                Jsou to osobní čísla profilu — a jediný důvod, proč se přes
                server hraje i mimo žebříček (viz public/js/online.js).

   Odpověď vždycky: { state, player?, placements?, stats?, records?, error? } */

import {
  emptyRun, publicState, apply, RunError, MODES, rules
} from './lib/run.mjs';
import {
  loadRun, saveRun, newRunId, maybeSweep,
  issuePlayer, verifyPlayer, touchPlayer, submitScore, checkRunLimit,
  recordPlayerStats, playerStats
} from './lib/store.mjs';

const NAME_MAX = 24;

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

function fail(code, status = 400) {
  return json({ error: code }, status);
}

function cleanName(value) {
  return String(value === undefined || value === null ? '' : value)
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, NAME_MAX) || 'Hráč';
}

function clientIp(request) {
  return request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for') ||
    'neznama';
}

/* ------------------------------------------------------------------ start */

async function start(body, request) {
  if (!await checkRunLimit(clientIp(request))) {
    return fail('too_many_runs', 429);
  }
  await maybeSweep();     // občasný úklid náhrobků a opuštěných partií

  const name = cleanName(body.name);

  // Známý hráč se prokáže dvojicí id + tajemství, nový ji tady dostane.
  let player = await verifyPlayer(body.playerId, body.playerSecret);
  let issued = null;
  if (!player) {
    const fresh = await issuePlayer(name);
    player = fresh.record;
    issued = { id: player.id, secret: fresh.secret };
  }
  player = await touchPlayer(player, name);

  const mode = MODES.includes(body.mode) ? body.mode : 'easy';
  let seconds = null;
  if (mode === 'hard') {
    seconds = parseInt(body.seconds, 10);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 300) {
      return fail('bad_seconds');
    }
  }

  const run = emptyRun({ id: newRunId(), mode, seconds, playerId: player.id });
  run.name = name;
  // Bez souhlasu se zveřejněním se partie odehraje, ale do žebříčku nejde.
  run.publish = body.publish === true;
  await saveRun(run);

  /* Statistiky chodí i sem, ne jen po dohrání. Klient si je drží jako mezipaměť
     pro odznak účtu a stránku Profil, aby je uměl ukázat i ve chvíli, kdy je
     server zrovna nedostupný. */
  return json({
    state: publicState(run),
    player: issued ? { id: issued.id, secret: issued.secret } : { id: player.id },
    stats: playerStats(player)
  });
}

/* -------------------------------------------------------------- ostatní */

async function step(body) {
  const stored = await loadRun(body.runId);
  if (!stored) {
    return fail('run_not_found', 404);
  }

  /* Dohraná partie po sobě nechává náhrobek — malý záznam s koncovým stavem
     místo celého balíčku. Kdyby se místo něj mazala, dostal by 404 každý
     požadavek, který dorazí po tom posledním: opakované odeslání při
     výpadku spojení, druhý klik, nebo prohlížeč, který si zopakoval
     požadavek sám. Hráč pak uviděl „Partie na serveru už není“ přesně
     ve chvíli, kdy položil poslední kartu a hru vlastně vyhrál.

     Přehrát se ze záznamu nedá nic — nejsou v něm karty a další akce
     stejně narazí na `run_over`. */
  if (stored.tombstone) {
    return json({
      state: stored.state,
      placements: stored.placements || null,
      stats: stored.stats || null,
      records: stored.records || []
    });
  }

  const run = stored;
  if (run.over) {
    return json({ state: publicState(run) });
  }

  apply(run, body);

  if (!run.over) {
    await saveRun(run);
    return json({ state: publicState(run) });
  }

  const state = publicState(run);

  /* Náhrobek se zapisuje DŘÍV, než výsledek putuje do žebříčku, a zápis do
     žebříčku smí selhat.

     Pořadí je tu podstatné. Zápis do žebříčku je nejkřehčí část celého tahu:
     tři období, každé s vlastním cyklem a podmíněným zápisem. Když se dělal
     první a spadl, propadla s ním celá odpověď — partie zůstala v úložišti
     nedohraná, hráč dostal 500 a po dalším kliknutí totéž znovu. Vypadalo to,
     že poslední kartu prostě nejde položit, a dohrát se nedalo vůbec.

     Dohraná partie je fakt sama o sobě. Když se ji nepovede zapsat do
     tabulky, přijde hráč o jeden zápis v žebříčku — ne o odehranou partii. */
  await saveRun({
    id: run.id,
    tombstone: true,
    state,
    placements: null,
    stats: null,
    records: [],
    finishedAt: run.finishedAt
  });

  const finishedAt = new Date(run.finishedAt).toISOString();
  const complete = run.placed >= rules.CELLS_TOTAL;

  /* Statistiky profilu. Píšou se každé skončené partii, i té nedohrané a i té,
     která do žebříčku nejde — jsou to osobní čísla hráče, ne veřejná tabulka.
     Právě proto se hraje na serveru i mimo žebříček: čísla, která si klient
     počítá sám, si taky sám vymyslí.

     Selhat smí ze stejného důvodu jako žebříček (viz komentář výš) — dohraná
     partie je fakt sám o sobě a nesmí padnout s tím, co se k ní zapisuje. */
  let stats = null;
  let records = [];
  let statsFailed = false;
  try {
    const outcome = await recordPlayerStats(run.playerId, {
      score: run.score,
      mode: run.mode,
      durationMs: state.durationMs,
      complete,
      at: finishedAt
    });
    if (outcome) {
      stats = outcome.stats;
      records = outcome.records;
    }
  } catch (err) {
    console.error('statistiky:', err);
    statsFailed = true;
  }

  let placements = null;
  let boardFailed = false;
  if (run.publish && complete) {
    try {
      placements = await submitScore({
        playerId: run.playerId,
        name: run.name,
        score: run.score,
        mode: run.mode,
        durationMs: state.durationMs,
        at: finishedAt
      });
    } catch (err) {
      console.error('zebricek:', err);
      boardFailed = true;
    }
  }

  /* Náhrobek se přepíše až s hotovým výsledkem. Kdyby požadavek zemřel dřív,
     zůstane v úložišti ta prázdná verze — opakovaný pokus se o ni zastaví
     a nic se nepřipíše podruhé. Radši chybějící řádek v dialogu než dvakrát
     započítaná partie. */
  await saveRun({
    id: run.id,
    tombstone: true,
    state,
    placements,
    stats,
    records,
    finishedAt: run.finishedAt
  });

  return json({
    state,
    placements,
    stats,
    records,
    boardFailed: boardFailed || undefined,
    statsFailed: statsFailed || undefined
  });
}

/* ------------------------------------------------------------- rozcestník */

export default async (request) => {
  if (request.method !== 'POST') {
    return fail('method_not_allowed', 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return fail('bad_json');
  }
  if (!body || typeof body !== 'object') {
    return fail('bad_json');
  }

  try {
    return body.action === 'start' ? await start(body, request) : await step(body);
  } catch (err) {
    if (err instanceof RunError) {
      return fail(err.code, err.status);
    }
    console.error('hra:', err);
    return fail('server_error', 500);
  }
};
