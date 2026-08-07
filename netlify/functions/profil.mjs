/* POST /api/profil — ověřené statistiky jednoho hráče.
   ==========================================================================

   Čte a nuluje to, co se napočítalo v lib/stats.mjs. Zapsat se sem nedá nic
   jiného než nula: endpoint, kterým by šlo poslat vlastní čísla, tu schválně
   není. Statistiky vznikají výhradně dohráním partie v /api/hra.

   Proč POST a ne GET
   ------------------
   Ke čtení je potřeba tajemství hráče. V GET by leželo v adrese, a ta se
   dostane do historie prohlížeče, do logů a do hlavičky Referer. V těle
   požadavku nezůstane nikde.

   Odpověď: { stats } nebo { error } */

import { verifyPlayer, playerStats, resetPlayerStats } from './lib/store.mjs';

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store'
    }
  });
}

export default async (request) => {
  if (request.method !== 'POST') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  let body;
  try {
    body = await request.json();
  } catch (err) {
    return json({ error: 'bad_json' }, 400);
  }
  if (!body || typeof body !== 'object') {
    return json({ error: 'bad_json' }, 400);
  }

  try {
    const player = await verifyPlayer(body.playerId, body.playerSecret);
    /* Neznámá dvojice a špatné tajemství dostanou stejnou odpověď — jinak by
       šlo podle rozdílu zjistit, které id existuje. */
    if (!player) {
      return json({ error: 'unknown_player' }, 403);
    }

    if (body.action === 'reset') {
      const stats = await resetPlayerStats(player.id);
      return json({ stats: stats || playerStats(player) });
    }

    return json({ stats: playerStats(player) });
  } catch (err) {
    console.error('profil:', err);
    return json({ error: 'server_error' }, 500);
  }
};
