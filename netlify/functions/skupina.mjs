/* POST /api/skupina — jediný vstup do skupinové hry.
   ==========================================================================

   Stejný řez jako u hry o žebříček (hra.mjs): klient posílá akce a dostává
   zpátky stav, který smí vidět. Balíček zůstává na serveru, skóre se nikdy
   neposílá dovnitř — endpoint, kterým by šlo body zapsat, neexistuje.

   Kdo smí do lobby sáhnout
   ------------------------
   Kód lobby se šíří po skupině, takže sám o sobě nic neprokazuje: kdo ho zná,
   smí se připojit, a to je celý jeho účel. Co konkrétní hráč smí, se pozná až
   podle dvojice playerId + token, kterou dostane při připojení. Bez ní se do
   cizího pole nedá položit číslo ani za zadavatele vytáhnout další.

   Odpověď vždycky: { lobby, seat?, error? } */

import {
  emptyLobby, publicLobby, apply, authPlayer, addPlayer, catchUp, touchSeen,
  LobbyError, MODES, NAME_MAX
} from './lib/lobby.mjs';
import {
  createLobby, loadLobby, updateLobby, newSeatToken,
  maybeSweepLobbies, checkRunLimit
} from './lib/store.mjs';
import { randomUUID } from 'node:crypto';

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

function cleanCode(value) {
  return String(value === undefined || value === null ? '' : value)
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
}

function clientIp(request) {
  return request.headers.get('x-nf-client-connection-ip') ||
    request.headers.get('x-forwarded-for') ||
    'neznama';
}

/* ---------------------------------------------------------------- vznik */

async function create(body, request) {
  if (!await checkRunLimit(clientIp(request))) {
    return fail('too_many_runs', 429);
  }
  await maybeSweepLobbies();

  const mode = MODES.includes(body.mode) ? body.mode : 'easy';
  let seconds = null;
  if (mode === 'hard') {
    seconds = parseInt(body.seconds, 10);
    if (!Number.isInteger(seconds) || seconds < 3 || seconds > 300) {
      return fail('bad_seconds');
    }
  }

  const hostId = randomUUID();
  const hostToken = newSeatToken();
  const lobby = await createLobby((code) => emptyLobby({
    code,
    mode,
    seconds,
    hostId,
    hostToken,
    hostName: cleanName(body.name),
    hostPlays: body.hostPlays !== false
  }));

  return json({
    lobby: publicLobby(lobby, hostId),
    seat: { code: lobby.code, playerId: hostId, token: hostToken }
  });
}

async function join(body) {
  const code = cleanCode(body.code);
  if (!code) {
    return fail('bad_code');
  }
  const existing = await loadLobby(code);
  if (!existing) {
    return fail('lobby_not_found', 404);
  }

  const playerId = randomUUID();
  const token = newSeatToken();
  const name = cleanName(body.name);

  /* Připojení je zápis do stejného záznamu jako tahy, takže jde přes stejný
     podmíněný cyklus — dva lidé, kteří kliknou na „Připojit“ ve stejnou
     chvíli, si navzájem nesmí přepsat řádek v sestavě. */
  const lobby = await updateLobby(code, (current) => {
    addPlayer(current, { id: playerId, name, token, playing: true });
    return true;
  });

  if (!lobby) {
    return fail('lobby_not_found', 404);
  }
  return json({
    lobby: publicLobby(lobby, playerId),
    seat: { code: lobby.code, playerId, token }
  });
}

/* ----------------------------------------------------------------- akce */

async function act(body) {
  const code = cleanCode(body.code);
  if (!code) {
    return fail('bad_code');
  }

  let viewerId = null;
  const lobby = await updateLobby(code, (current) => {
    const player = authPlayer(current, body.playerId, body.token);
    viewerId = player.id;

    /* Dotaz na stav není tah, ale ani není zadarmo: může nechat propadnout
       prošlá čísla a uzavřít hru. Zapisuje se proto jen tehdy, když se
       opravdu něco pohnulo — jinak by každé ťuknutí klienta znamenalo zápis
       celého lobby zpátky do úložiště. */
    if (body.action === 'state') {
      const moved = catchUp(current);
      const seen = touchSeen(player);
      return moved || seen;
    }

    touchSeen(player, Date.now());
    apply(current, player, body);
    return true;
  });

  if (!lobby) {
    return fail('lobby_not_found', 404);
  }
  return json({ lobby: publicLobby(lobby, viewerId) });
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
    if (body.action === 'create') {
      return await create(body, request);
    }
    if (body.action === 'join') {
      return await join(body);
    }
    return await act(body);
  } catch (err) {
    if (err instanceof LobbyError) {
      return fail(err.code, err.status);
    }
    console.error('skupina:', err);
    return fail('server_error', 500);
  }
};
