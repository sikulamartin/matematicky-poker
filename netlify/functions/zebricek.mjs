/* GET /api/zebricek?obdobi=day|week|month|all — výpis žebříčku.
   ==========================================================================

   Čte jediný klíč z Netlify Blobs a posílá ho tak, jak je — seřazený
   a oříznutý už při zápisu (viz lib/store.mjs). Žádné počítání za běhu,
   takže odpověď stojí jedno čtení bez ohledu na to, kolik se toho nahrálo.

   playerId v odpovědi není přihlašovací údaj — samo o sobě neotevře nic,
   protože zápis do partie vyžaduje ještě tajemství. Posílá se proto, aby
   si klient našel v tabulce vlastní řádek a zvýraznil ho. */

import { readBoard, periodKey, PERIODS, PAGE_N } from './lib/store.mjs';

const LABELS = {
  day: 'Dnes',
  week: 'Tento týden',
  month: 'Tento měsíc',
  all: 'Celkově'
};

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      // Krátká cache srazí špičku, když si žebříček otevře celá třída
      // naráz, a přitom nezdrží zápis o víc než pár sekund.
      'cache-control': 'public, max-age=15'
    }
  });
}

export default async (request) => {
  if (request.method !== 'GET') {
    return json({ error: 'method_not_allowed' }, 405);
  }

  const url = new URL(request.url);
  const period = url.searchParams.get('obdobi') || 'all';
  if (!PERIODS.includes(period)) {
    return json({ error: 'bad_period' }, 400);
  }

  try {
    const entries = await readBoard(period);
    return json({
      period,
      key: periodKey(period),
      label: LABELS[period],
      limit: PAGE_N,
      count: entries.length,
      entries: entries.map((entry, index) => ({
        rank: index + 1,
        playerId: entry.playerId,
        name: entry.name,
        score: entry.score,
        mode: entry.mode,
        durationMs: entry.durationMs,
        at: entry.at
      }))
    });
  } catch (err) {
    console.error('zebricek:', err);
    return json({ error: 'server_error' }, 500);
  }
};
