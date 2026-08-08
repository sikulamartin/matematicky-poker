/* GET|POST /api/vyzva — stav denní výzvy.
   ==========================================================================

   Vrací dvě věci: veřejnou tabulku dneška (a s ní rekord dne) a — když se
   volající prokáže identitou hráče — jeho vlastní pokus. Bez toho druhého by
   stránka nevěděla, jestli má nabídnout Start, nebo výsledek: pokus je jeden
   na den a hlídá se v záznamu hráče (viz lib/store.mjs).

   Proč POST: tajemství hráče nesmí do adresy, kde by skončilo v historii
   prohlížeče a v logu serveru — stejná úvaha jako u /api/profil. GET zůstává
   pro případ, kdy se ptá někdo bez identity; tabulka je veřejná.

   Balíček se odsud neposílá a posílat nesmí. Kdyby šel ven, věděl by hráč
   dopředu, co přijde, a celá výzva by ztratila smysl. */

import { verifyPlayer, dailyDay, readDaily, dailyOf } from './lib/store.mjs';

function json(data, status = 200, cache = 'no-store') {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': cache
    }
  });
}

/** Datum, jak se píše v češtině: 8. 8. 2026. */
function label(day) {
  const parts = day.split('-');
  return Number(parts[2]) + '. ' + Number(parts[1]) + '. ' + parts[0];
}

async function snapshot(player, cache) {
  const day = dailyDay();
  const entries = await readDaily(day);

  let mine = null;
  if (player) {
    const attempt = dailyOf(player, day);
    if (attempt) {
      /* Pořadí se bere z tabulky, ne ze záznamu hráče. To v něm je jenom
         otisk okamžiku, kdy se dohrálo — kdo přišel po něm s lepším
         výsledkem, posunul ho níž, aniž by mu to kdo zapsal. */
      const seat = entries.findIndex((item) => item.playerId === player.id);
      mine = {
        // 'open' = rozehráno a dá se dohrát, 'done' = pokus je vyčerpaný
        status: attempt.score === null || attempt.score === undefined ? 'open' : 'done',
        score: attempt.score === undefined ? null : attempt.score,
        rank: seat === -1 ? null : seat + 1,
        at: attempt.at || null
      };
    }
  }

  return json({
    day,
    label: label(day),
    record: entries.length ? entries[0].score : null,
    holder: entries.length ? entries[0].name : null,
    count: entries.length,
    entries: entries.map((entry, index) => ({
      rank: index + 1,
      playerId: entry.playerId,
      name: entry.name,
      score: entry.score,
      durationMs: entry.durationMs,
      at: entry.at
    })),
    mine
  }, 200, cache);
}

export default async (request) => {
  try {
    if (request.method === 'GET') {
      // Bez identity je odpověď pro všechny stejná — krátká cache srazí
      // špičku, když si výzvu otevře celá třída naráz.
      return await snapshot(null, 'public, max-age=15');
    }
    if (request.method !== 'POST') {
      return json({ error: 'method_not_allowed' }, 405);
    }

    let body;
    try {
      body = await request.json();
    } catch (err) {
      body = {};
    }
    const player = await verifyPlayer(body.playerId, body.playerSecret);
    return await snapshot(player, 'no-store');
  } catch (err) {
    console.error('vyzva:', err);
    return json({ error: 'server_error' }, 500);
  }
};
