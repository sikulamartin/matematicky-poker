/* Úložiště nad Netlify Blobs — rozehrané partie, hráči a žebříček.
   ==========================================================================

   Blobs jsou součástí Netlify, takže k žebříčku není potřeba druhá služba
   ani druhý účet. Za to se platí tím, že to není databáze: nejsou dotazy,
   není řazení, není transakce přes víc klíčů. Návrh z toho vychází.

   Klíče
   -----
   mp-runs    <runId>            rozehraná partie i s balíčkem
   mp-players <playerId>         otisk tajemství hráče a jeho přezdívka
   mp-board   all | m-RRRR-MM    žebříček jednoho období: pole záznamů
              | w-RRRR-Www         seřazené sestupně, oříznuté na TOP_N
   mp-limits  <hashIP>           počítadlo rozehraných partií v okně
   mp-lobby   <kód>              skupinová hra: balíček, řada čísel a pole
                                 všech hráčů v jednom záznamu

   Souběžné zápisy
   ---------------
   Žebříček je jeden klíč, do kterého píše kdokoli dohraje. Bez opatření by
   se při dvou zápisech ve stejnou chvíli jeden ztratil (Blobs jinak dělají
   „poslední vyhrává“). Proto se čte s `consistency: 'strong'` a zapisuje
   podmíněně přes `onlyIfMatch: etag`; když mezitím někdo stihl zapsat,
   `modified` přijde false a celý cyklus se opakuje. */

import { getStore } from '@netlify/blobs';
import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { RUN_TTL_MS } from './run.mjs';
import { LOBBY_TTL_MS, CODE_ALPHABET, CODE_LENGTH } from './lobby.mjs';
import { emptyStats, normalizeStats, applyRun } from './stats.mjs';

const TOP_N = 100;              // co se drží v jednom období
export const PAGE_N = 50;       // co se posílá klientovi
const CAS_RETRIES = 6;
const RUN_LIMIT = 40;           // rozehraných partií na IP
const RUN_LIMIT_WINDOW_MS = 60 * 60 * 1000;

/* Silná konzistence je tu schválně: žebříček po dohrané partii musí být
   vidět hned, ne „do minuty“. Za to se platí pomalejším čtením, což u pár
   requestů za partii nikoho netrápí. */
const strong = { consistency: 'strong' };

function store(name) {
  return getStore({ name, ...strong });
}

export const runs = () => store('mp-runs');
export const players = () => store('mp-players');
export const board = () => store('mp-board');
export const limits = () => store('mp-limits');
export const lobbies = () => store('mp-lobby');

/* ---------------------------------------------------------------- partie */

export async function loadRun(id) {
  if (typeof id !== 'string' || !id) {
    return null;
  }
  return runs().get(id, { type: 'json' });
}

export async function saveRun(run) {
  await runs().setJSON(run.id, run);
}

/* Zůstává pro úklid a testy — běžný průběh partie po sobě nechává náhrobek
   (viz hra.mjs), ne prázdno. */
export async function dropRun(id) {
  await runs().delete(id);
}

export function newRunId() {
  return randomUUID();
}

/* Jak dlouho se drží náhrobek dohrané partie. Stačí, aby přežil opožděný
   nebo zopakovaný požadavek na poslední tah — hodina je bohatě. */
const TOMBSTONE_TTL_MS = 60 * 60 * 1000;

/* Jak často se uklízí. Sweep čte všechny rozehrané partie, takže ho nemá
   smysl pouštět při každém startu; jednou za dvacet partií drží úložiště
   v mezích a nikoho nezdrží. */
const SWEEP_CHANCE = 0.05;

/**
 * Smaže náhrobky a opuštěné partie.
 *
 * Bez toho by úložiště jenom rostlo: partie, kterou hráč nedohrál a zavřel
 * kartu, nikdo nesmaže, a náhrobky dohraných partií zůstávají taky.
 */
export async function sweepRuns(now = Date.now()) {
  const store = runs();
  const { blobs } = await store.list();
  let removed = 0;

  for (const blob of blobs) {
    const run = await store.get(blob.key, { type: 'json' });
    if (!run) {
      continue;
    }
    const stale = run.tombstone
      ? now - (run.finishedAt || 0) > TOMBSTONE_TTL_MS
      : now - (run.startedAt || 0) > RUN_TTL_MS;
    if (stale) {
      await store.delete(blob.key);
      removed++;
    }
  }
  return removed;
}

/** Uklidí jen občas — viz SWEEP_CHANCE. Chyby úklidu hru nesmí zastavit. */
export async function maybeSweep() {
  if (Math.random() >= SWEEP_CHANCE) {
    return;
  }
  try {
    await sweepRuns();
  } catch (err) {
    console.error('sweep:', err);
  }
}

/* ----------------------------------------------------------------- hráči */

/* Hráč nemá heslo ani e‑mail — dostane jen dvojici id + tajemství, kterou
   si prohlížeč uloží. Tajemství se ukládá jako otisk, aby výpis úložiště
   nestačil k převzetí cizí identity. Je to slabá identita a nemá předstírat
   nic víc: kdo si tajemství zkopíruje, hraje pod cizím jménem. Brání to
   jedinému, ale podstatnému — aby jeden hráč nezaplavil žebříček pod
   deseti přezdívkami z jednoho prohlížeče. */

function hashSecret(secret) {
  return createHash('sha256').update(String(secret)).digest('hex');
}

/**
 * Založí nového hráče.
 *
 * Vrací celý uložený záznam, ne jenom id — volající s ním dál pracuje
 * a zapisuje ho zpátky. Když se místo něj poslalo dál jen `{ id, secret }`,
 * přepsal první `touchPlayer()` záznam v úložišti verzí bez `secretHash`.
 * Hráč se tím pádem příští partii neprokázal, dostal novou identitu — a do
 * žebříčku se místo jednoho nejlepšího výsledku zapisovala každá partie
 * zvlášť, pokaždé pod novým hráčem se stejnou přezdívkou.
 */
export async function issuePlayer(name) {
  const id = randomUUID();
  const secret = randomBytes(24).toString('base64url');
  const record = {
    id,
    secretHash: hashSecret(secret),
    name,
    createdAt: new Date().toISOString(),
    runs: 0
  };
  await players().setJSON(id, record);
  return { record, secret };
}

/** Ověří dvojici id + tajemství. Vrací záznam hráče, nebo null. */
export async function verifyPlayer(id, secret) {
  if (typeof id !== 'string' || typeof secret !== 'string' || !id || !secret) {
    return null;
  }
  const player = await players().get(id, { type: 'json' });
  if (!player || player.secretHash !== hashSecret(secret)) {
    return null;
  }
  return player;
}

/* Záznam hráče se od chvíle, kdy nese statistiky, mění ze dvou stran: při
   zakládání partie (přezdívka, počítadlo) a při jejím dokončení (statistiky).
   Nepodmíněný zápis by jednu z těch změn zahodil — hráč se dvěma otevřenými
   kartami by přišel o dohranou partii tím, že v druhé kartě zmáčkl Start.
   Proto stejný postup jako u žebříčku: čtení s ETagem, podmíněný zápis
   a při kolizi celá úprava znovu nad čerstvou verzí. */
const PLAYER_CAS_RETRIES = 6;

/**
 * Přečte hráče, nechá ho upravit a zapíše zpátky.
 *
 * @param {string} id
 * @param {Function} mutate  mutate(player) → libovolná návratová hodnota;
 *   ta se vrátí ven, když zápis projde. Musí být opakovatelná — při kolizi
 *   se volá znovu nad cizí verzí záznamu.
 * @param {Object} [store]   dá se podstrčit kvůli testům bez Netlify
 * @returns {*|null} co vrátil `mutate`, nebo null když hráč neexistuje
 */
export async function updatePlayer(id, mutate, store = players()) {
  if (typeof id !== 'string' || !id) {
    return null;
  }
  for (let attempt = 0; attempt < PLAYER_CAS_RETRIES; attempt++) {
    const result = await store.getWithMetadata(id, { type: 'json' });
    if (!result || !result.data) {
      return null;
    }
    const player = result.data;
    const outcome = mutate(player);
    const options = writeOptions({ etag: result.etag || null, exists: true });
    const { modified } = await store.setJSON(id, player, options || {});
    if (modified) {
      return outcome;
    }
    // někdo nás předběhl — přečteme znovu a zopakujeme úpravu nad jeho verzí
  }
  throw new Error('player_busy');
}

export async function touchPlayer(player, name) {
  if (!player.secretHash) {
    // bez otisku by se hráč příště neprokázal — radši nezapisovat nic
    throw new Error('player_without_secret');
  }
  const updated = await updatePlayer(player.id, (record) => {
    record.runs = (record.runs || 0) + 1;
    if (name) {
      record.name = name;
    }
    return record;
  });
  /* Čerstvě založený hráč se v úložišti ještě nemusí projevit (silná
     konzistence platí pro čtení, ne pro pořadí zápisů) — v tom případě
     zapíšeme rovnou to, co držíme v ruce. */
  if (updated) {
    return updated;
  }
  player.runs = (player.runs || 0) + 1;
  if (name) {
    player.name = name;
  }
  await players().setJSON(player.id, player);
  return player;
}

/* ----------------------------------------------------- statistiky hráče */

/** Statistiky hráče tak, jak se posílají ven. */
export function playerStats(player) {
  return normalizeStats(player && player.stats);
}

/**
 * Přičte skončenou partii ke statistikám hráče.
 * @param {string} playerId
 * @param {Object} run  { score, mode, durationMs, complete, at } — viz stats.mjs
 * @returns {{ stats: Object, records: string[] }|null} null, když hráč není
 */
export async function recordPlayerStats(playerId, run, store = players()) {
  return updatePlayer(playerId, (player) => {
    const outcome = applyRun(player.stats, run);
    player.stats = outcome.stats;
    return outcome;
  }, store);
}

/** Vynuluje statistiky. Přezdívka, identita ani počítadlo partií nemizí. */
export async function resetPlayerStats(playerId, store = players()) {
  return updatePlayer(playerId, (player) => {
    player.stats = emptyStats();
    return player.stats;
  }, store);
}

/* ------------------------------------------------------------- období */

/* Hranice dne, týdne i měsíce se počítají v českém čase, ne v UTC.
   Server běží v UTC, ale hráč ne: v létě je Praha o dvě hodiny napřed,
   takže partie dohraná ve 23:30 by v UTC spadla do včerejška a v tabulce
   „Dnes“ by se neobjevila — přestože ji hráč právě dohrál. U měsíce si
   toho nikdo nevšimne, u dne by to bylo vidět každý večer. */
const ZONE = 'Europe/Prague';

const dateFormat = new Intl.DateTimeFormat('cs-CZ', {
  timeZone: ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit'
});

/** Kalendářní datum daného okamžiku v českém čase. */
function localDate(when) {
  const parts = {};
  for (const part of dateFormat.formatToParts(when)) {
    if (part.type !== 'literal') {
      parts[part.type] = Number(part.value);
    }
  }
  return parts;      // { year, month, day }
}

function pad(value) {
  return String(value).padStart(2, '0');
}

/** ISO číslo týdne pro kalendářní datum — týden začíná pondělím, rozhoduje čtvrtek. */
function isoWeek(year, month, day) {
  const d = new Date(Date.UTC(year, month - 1, day));
  const weekday = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - weekday);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}

export const PERIODS = ['day', 'week', 'month', 'all'];

/** Klíč období pro daný okamžik. */
export function periodKey(period, when = new Date()) {
  if (period === 'all') {
    return 'all';
  }
  const { year, month, day } = localDate(when);
  if (period === 'day') {
    return 'd-' + year + '-' + pad(month) + '-' + pad(day);
  }
  if (period === 'month') {
    return 'm-' + year + '-' + pad(month);
  }
  const week = isoWeek(year, month, day);
  return 'w-' + week.year + '-W' + pad(week.week);
}

/* --------------------------------------------------------------- žebříček */

function betterThan(a, b) {
  if (a.score !== b.score) {
    return a.score > b.score;
  }
  // stejné skóre: rozhoduje kratší čas, pak dřívější zápis
  if (a.durationMs !== b.durationMs) {
    return a.durationMs < b.durationMs;
  }
  return a.at < b.at;
}

/**
 * Zařadí záznam do jednoho období.
 * Na hráče se drží jediný nejlepší výsledek — jinak by deset dobrých partií
 * jednoho člověka vytlačilo z první desítky všechny ostatní.
 */
function merge(list, entry) {
  const next = list.filter((item) => item.playerId !== entry.playerId);
  const previous = list.find((item) => item.playerId === entry.playerId);
  const keep = previous && !betterThan(entry, previous) ? previous : entry;
  next.push(keep);
  next.sort((a, b) => (betterThan(a, b) ? -1 : 1));
  return next.slice(0, TOP_N);
}

/** Přečte jedno období i s ETagem, ať se dá zapsat podmíněně. */
async function readPeriod(key, store = board()) {
  const result = await store.getWithMetadata(key, { type: 'json' });
  if (!result) {
    return { list: [], etag: null, exists: false };
  }
  return {
    list: Array.isArray(result.data) ? result.data : [],
    etag: result.etag || null,
    exists: true
  };
}

/**
 * Jak zapsat nový obsah období.
 *
 * Vypadá to jako zbytečná drobnost, ale je to místo, kde hra přestala jít
 * dohrát. Rozhoduje se mezi třemi možnostmi:
 *
 *   onlyIfMatch  známe ETag — zapíšeme jen tehdy, když se mezitím nezměnil
 *   onlyIfNew    záznam ještě neexistuje — zapíšeme jen tehdy, když ho
 *                nikdo nestihl založit dřív
 *   bez podmínky záznam existuje, ale ETag k němu nemáme
 *
 * Ta třetí větev je tu kvůli lokálnímu `netlify dev`: jeho náhrada Blobs
 * vrací tělo bez hlavičky ETag. Dokud se v tom případě posílalo `onlyIfNew`,
 * odpovídalo úložiště na každý pokus 412 (záznam přece existuje), cyklus
 * šestkrát selhal a zápis skončil výjimkou. Hráč to poznal tak, že poslední
 * kartu nešlo položit — a v každé další partii znovu, protože po první
 * dohrané partii už žebříček existoval.
 *
 * Bez ETagu se souběžný zápis uhlídat nedá, takže poslední vyhrává. Na
 * ostrém Netlify k tomu nedojde (ETag odtamtud chodí vždycky) a v lokálním
 * vývoji hraje jeden člověk.
 */
export function writeOptions({ etag, exists }) {
  if (etag) {
    return { onlyIfMatch: etag };
  }
  if (!exists) {
    return { onlyIfNew: true };
  }
  return undefined;
}

export async function readBoard(period, when = new Date(), store = board()) {
  const { list } = await readPeriod(periodKey(period, when), store);
  return list.slice(0, PAGE_N);
}

/**
 * Zapíše dohranou partii do všech tří období.
 * Každé období je vlastní klíč a vlastní CAS cyklus — mezi obdobími není
 * transakce. V nejhorším případě se výsledek objeví v jednom žebříčku
 * a v druhém ne, což je vada, kterou nikdo nepozná, a cena za to, že
 * úložiště není databáze.
 *
 * `store` se dá podstrčit, aby šel celý cyklus otestovat bez Netlify
 * (viz tests/zebricek.mjs).
 */
export async function submitScore(entry, store = board()) {
  const placements = {};
  for (const period of PERIODS) {
    const key = periodKey(period, new Date(entry.at));
    placements[period] = await casMerge(key, entry, store);
  }
  return placements;
}

async function casMerge(key, entry, store = board()) {
  for (let attempt = 0; attempt < CAS_RETRIES; attempt++) {
    const { list, etag, exists } = await readPeriod(key, store);
    const next = merge(list, entry);
    const options = writeOptions({ etag, exists });
    const { modified } = await store.setJSON(key, next, options || {});
    if (modified) {
      const rank = next.findIndex((item) => item.playerId === entry.playerId);
      return rank === -1 ? null : rank + 1;
    }
    // někdo nás předběhl — přečteme znovu a zkusíme to s jeho verzí
  }
  throw new Error('board_busy');
}

/* --------------------------------------------------------- skupinová hra */

/* Lobby je jeden záznam, do kterého píšou všichni hráči naráz — každé
   položené číslo je zápis. Bez opatření by se souběžné tahy přepisovaly
   (Blobs jinak dělají „poslední vyhrává“) a hráč by viděl, jak mu číslo
   z pole zmizelo. Proto stejný postup jako u žebříčku: čtení s ETagem
   a podmíněný zápis, při kolizi se celá úprava zopakuje nad čerstvým
   stavem. Úprava proto musí být přepočitatelná — dostane stav a udělá
   nad ním totéž znovu. */

const LOBBY_CAS_RETRIES = 8;
const LOBBY_CODE_TRIES = 12;

/** Kód lobby — krátký, bez zaměnitelných znaků, ať se dá nadiktovat. */
export function newLobbyCode() {
  const bytes = randomBytes(CODE_LENGTH);
  let code = '';
  for (let i = 0; i < CODE_LENGTH; i++) {
    code += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return code;
}

/** Tajemství jednoho místa v lobby — kód zná celá skupina, tohle jen hráč. */
export function newSeatToken() {
  return randomBytes(18).toString('base64url');
}

export async function loadLobby(code) {
  if (typeof code !== 'string' || !code) {
    return null;
  }
  return lobbies().get(code.toUpperCase(), { type: 'json' });
}

/**
 * Založí lobby pod dosud volným kódem.
 * @param {Function} build  build(code) → nový objekt lobby
 */
export async function createLobby(build, store = lobbies()) {
  for (let attempt = 0; attempt < LOBBY_CODE_TRIES; attempt++) {
    const code = newLobbyCode();
    const lobby = build(code);
    const { modified } = await store.setJSON(code, lobby, { onlyIfNew: true });
    if (modified) {
      return lobby;
    }
    // kód už někdo má — zkusíme jiný
  }
  throw new Error('lobby_codes_exhausted');
}

/**
 * Přečte lobby, nechá ho upravit a zapíše zpátky.
 *
 * @param {string} code
 * @param {Function} mutate  mutate(lobby) → true, když se má stav zapsat.
 *   Může vyhodit LobbyError; ta projde ven a nic se nezapíše.
 * @returns {Object|null} upravené lobby, nebo null když neexistuje
 */
export async function updateLobby(code, mutate, store = lobbies()) {
  const key = String(code || '').toUpperCase();
  for (let attempt = 0; attempt < LOBBY_CAS_RETRIES; attempt++) {
    const result = await store.getWithMetadata(key, { type: 'json' });
    if (!result || !result.data) {
      return null;
    }
    const lobby = result.data;
    const changed = mutate(lobby);
    if (!changed) {
      return lobby;
    }
    const options = writeOptions({ etag: result.etag || null, exists: true });
    const { modified } = await store.setJSON(key, lobby, options || {});
    if (modified) {
      return lobby;
    }
    // někdo nás předběhl — přečteme znovu a zopakujeme úpravu nad jeho verzí
  }
  throw new Error('lobby_busy');
}

export async function dropLobby(code) {
  await lobbies().delete(String(code || '').toUpperCase());
}

/**
 * Smaže lobby, do kterých se nikdo dlouho neozval.
 * Bez toho by úložiště jenom rostlo: skupina, která hru nedohrála a zavřela
 * karty, po sobě záznam neuklidí.
 */
export async function sweepLobbies(now = Date.now()) {
  const store = lobbies();
  const { blobs } = await store.list();
  let removed = 0;

  for (const blob of blobs) {
    const lobby = await store.get(blob.key, { type: 'json' });
    if (!lobby) {
      continue;
    }
    const touched = Math.max(
      lobby.finishedAt || 0,
      lobby.lastDrawAt || 0,
      lobby.startedAt || 0,
      lobby.createdAt || 0
    );
    if (now - touched > LOBBY_TTL_MS) {
      await store.delete(blob.key);
      removed++;
    }
  }
  return removed;
}

/** Uklidí jen občas — stejná úvaha jako u maybeSweep(). */
export async function maybeSweepLobbies() {
  if (Math.random() >= SWEEP_CHANCE) {
    return;
  }
  try {
    await sweepLobbies();
  } catch (err) {
    console.error('sweep lobby:', err);
  }
}

/* ------------------------------------------------------------ omezení IP */

/* Hrubá brzda proti zakládání partií ve smyčce. Není to obrana proti
   někomu s víc adresami — jenom to drží spotřebu úložiště v mezích. */
export async function checkRunLimit(ip) {
  const key = createHash('sha256').update(String(ip || 'neznama')).digest('hex').slice(0, 32);
  const now = Date.now();
  const current = (await limits().get(key, { type: 'json' })) || { start: now, count: 0 };

  if (now - current.start > RUN_LIMIT_WINDOW_MS) {
    current.start = now;
    current.count = 0;
  }
  current.count++;
  await limits().setJSON(key, current);
  return current.count <= RUN_LIMIT;
}
