# Matematický Poker

Kombinační hra s čísly 1–13 na poli 5×5. Taháš karty z balíčku, rozhoduješ, kam je zapíšeš, a sbíráš body za pokerové kombinace ve všech řádcích, sloupcích a obou úhlopříčkách. Zapsané číslo už nejde přesunout — každý tah je konečný.

Hra běží jako statický web v prohlížeči. Výjimky jsou tři: režim **o žebříček**, kde partii řídí server (veřejná tabulka rekordů jinak nemá cenu — skóre spočítané v prohlížeči si každý přepíše), **denní výzva**, kde balíček vzniká z data a pokus se počítá jednou za den, a **hra ve skupině**, kde server rozdává jednu řadu čísel celému lobby.

Bez serveru je web pořád plně hratelný. Odpadne jenom žebříček, denní výzva a hra ve skupině.

**Živá verze:** [matematicky-poker](https://matematickypoker.netlify.app/)

## Co hra umí

| Režim | Stránka | Popis |
|---|---|---|
| **Hra — lehká** | `easy.html` | Plná hra bez časového tlaku. Karty rozdává a body počítá server, aby se partie dala připsat do statistik profilu; bez připojení hra běží dál místně a nezapíše se. |
| **Hra — těžká** | `hard.html` | Odpočet 3–300 sekund na jedno číslo. Co nestihneš uložit, propadne a políčko zůstane prázdné. Jinak stejné jako lehká — server rozdává, statistiky se počítají u něj. |
| **Hra — o žebříček** | `ranked.html` | Karty rozdává a body počítá server. Výsledek jde do veřejné tabulky. Vyžaduje připojení. |
| **Denní výzva** | `vyzva.html` | Balíček se míchá z data, takže ho v ten den mají všichni stejný a ve stejném pořadí — nerozhoduje, komu se sešly lepší karty. Pokus je jeden na den, výsledek jde do tabulky dne a rekord dne je vidět pořád. Vyžaduje připojení i zapnuté ukládání. |
| **Hra — ve skupině** | `skupina.html` | Zadavatel tahá čísla pro celou skupinu, každý je skládá do vlastního pole. Na konci pořadí skupiny. Vyžaduje připojení. |
| **Žebříček** | `leaderboard.html` | Nejlepší hráči za dnešek, týden, měsíc a celkově. |
| **Výběr čísel** | `number selection.html` | Samostatný generátor pro hru na papíře. Historie tahů, přehled zbývajících karet, rozehraná hra přežije reload. |
| **Tabulka** | `table.html` | Prázdné pole k ručnímu vyplnění s průběžným bodováním. |
| **Profil** | `account.html` | Lokální účty (bez hesla a bez registrace), statistiky ověřené serverem a správa uložených dat. |
| **Pravidla** | `rules.html` | Kompletní pravidla a bodovací tabulka. |
| **Zásady** | `privacy.html` | Co se ukládá, kam a jak to smazat. |

Dál:

- **Tři vizuální motivy** — Terminál, Academism, Legacy. Volba se ukládá a platí napříč stránkami.
- **Náhled bodů** — u každého volného políčka svítí, kolik by tam čekající číslo přineslo. Nejvyšší zisk je zvýrazněný barvou. Počítá to prohlížeč z toho, co je vidět na obrazovce, takže se to nepere se serverovým skóre; vypínač je v konzoli nad polem. V denní výzvě a ve hře o žebříček se `js/preview.js` vůbec nenačítá — tam se hraje o pořadí proti ostatním.
- **Žolíci** — dva v balíčku. Jde je použít hned s vlastní hodnotou, nebo uschovat na později; uschovaný žolík nespotřebuje tah.
- **Vlastní dialogy** místo `alert()` / `confirm()` / `prompt()` — stylovatelné, přístupné, s ochrannou lhůtou proti nechtěnému potvrzení dojezdem stisku.
- **Souhlas s ukládáním** — bez něj hra funguje, jen si po zavření karty nic nepamatuje.
- **Responzivní layout** — od úzkých telefonů po velké monitory, pod 860 px se lišta sbalí do hamburgeru.
- **Žebříček řízený serverem** — čtyři období (dnes, tento týden, tento měsíc, celkově), jeden nejlepší výsledek na hráče, skóre vzniká na serveru.
- **Skupinová hra v lobby** — kód o pěti znacích, až dvanáct hráčů, sdílená řada čísel a průběžné pořadí vedle pole.
- **Denní výzva** — jeden balíček na den pro všechny (míchá se ze semínka odvozeného z data), jeden pokus na hráče a vlastní tabulka dne. Rekord dne se píše nad polem, ne až po dohrání.

## Spuštění

### Bez serveru — stačí statický server

```bash
git clone https://github.com/sikulamartin/matematicky-poker.git
cd matematicky-poker
python3 -m http.server 8000 --directory public
```

Otevři <http://localhost:8000>. Hrát jde všechno; `ranked.html`, `skupina.html` a `leaderboard.html` řeknou, že server neodpovídá, a `easy.html` s `hard.html` přepnou na místní hru — partie se v ní nezapíšou do statistik profilu.

Dvojklik na `public/index.html` (`file://`) není dobrý nápad — cookies přes něj nefungují, takže se rozbijí profily.

### Se žebříčkem — Netlify CLI

```bash
npm install
npm run dev          # netlify dev na http://localhost:8888
```

`netlify dev` naservíruje `public/` a k tomu spustí funkce z `netlify/functions/` včetně lokální sandboxové náhrady Netlify Blobs. Produkční data se přes ni nedají číst.

### Bez Netlify, ale se žebříčkem

```bash
npm run serve       # http://localhost:8788
```

`tests/server.mjs` je náhrada všech serverových funkcí: drží data v paměti a všechnu herní
logiku bere ze stejného `lib/run.mjs` a `lib/lobby.mjs` jako produkce, takže se pod
ním dá zkoušet i `ranked.html` a `skupina.html`. Nic se neinstaluje.

### Testy

```bash
npm test
```

Projede serverový automat partie v Node — bez Netlify, protože
`netlify/functions/lib/run.mjs` schválně nesahá na síť ani na úložiště. Kromě
běžného průběhu hry testuje pokusy o podvrh, časový limit těžké obtížnosti
a scénář s uschovanými žolíky.

| Soubor | Co hlídá |
|---|---|
| `tests/run.mjs` | stavový automat partie: pravidla, žolíci, limit, pokusy o podvrh |
| `tests/joker.mjs` | uschované žolíky na konci pole a náhrobek dohrané partie |
| `tests/zebricek.mjs` | zápis do žebříčku proti dvěma napodobeninám úložiště (s ETagy i bez nich) a hranice období v českém čase |
| `tests/statistiky.mjs` | počítání statistik profilu a jejich podmíněný zápis do záznamu hráče včetně souběhu dvou karet |
| `tests/skupina.mjs` | lobby skupinové hry: sdílená řada čísel, oprávnění zadavatele, uschovaní žolíci, propadnutí v těžké obtížnosti, pořadí a nové kolo |
| `tests/nahled.mjs` | náhled bodů: zisk na dotčených liniích proti přepočtu celého pole, chování vypínače |
| `tests/vyzva.mjs` | denní výzva: balíček odvozený z data, hranice dne v českém čase, jeden pokus na hráče a den, zápis do tabulky dne |

`tests/zebricek.mjs` si podstrkuje vlastní úložiště přes nepovinný parametr
`submitScore(entry, store)`, takže testuje skutečný zápisový cyklus, ne jeho
kopii.

**Pozor při testování v prohlížeči:** headless Chrome s `--virtual-time-budget`
zrychluje hodiny stránky, ale server běží v reálném čase. Klient si myslí, že
mezi tahy počkal 260 ms, server vidí 4 ms a odmítá je jako `too_fast`. Není to
chyba hry — jen se takhle nedá měřit nic, co závisí na čase. Reálný průběh
partie je 52 požadavků na 25 políček.

## Nasazení na Netlify

1. Naklikej v Netlify **Add new site → Import an existing project** a vyber repozitář.
2. Build nastavení se načte z [netlify.toml](netlify.toml), nic se nevyplňuje ručně:
   - publish adresář `public`
   - funkce `netlify/functions`
3. Netlify Blobs se zapne samo při prvním zápisu — žádný klíč, žádná druhá služba, žádná konfigurace.

Publish adresář je schválně `public/`, ne kořen repozitáře: Netlify nahraje publish adresář tak, jak je, a v kořeni by s ním šlo nahoru i `node_modules` a serverový kód.

Pozor na `number selection.html` — má v názvu mezeru a v odkazech je psaný jako `number%20selection.html`.

## Pravidla ve zkratce

1. Klikneš na **Generovat** a balíček vydá kartu.
2. Vybereš prázdné políčko a číslo do něj vložíš.
3. Další číslo se natáhne **samo** — tlačítko *Táhnout ručně* zůstává jen jako záloha.
4. Body se přepočítají hned, u každého řádku, sloupce i obou úhlopříček.
5. Hra končí, jakmile je zaplněných všech 25 políček.

**Balíček** má 54 karet: čtyři kusy od každé hodnoty 1–13 (52) plus dva žolíky. Míchá se Fisherovým–Yatesovým algoritmem a karta se nikdy neopakuje. V denní výzvě se míchá týmž algoritmem, jen z generátoru odvozeného z data — pořadí je pak pro všechny hráče toho dne stejné. Políček je jen 25, takže velkou část balíčku v jedné hře neuvidíš.

**Vyhodnocuje se 12 linií** — 5 řádků, 5 sloupců a obě úhlopříčky. Z každé linie se počítá jen její *nejlepší* kombinace; v rámci jedné linie se body nesčítají. Strop je tedy 12 × 125 = **1500 bodů**.

## Bodovací tabulka

„Vedle sebe“ znamená, že stejná čísla leží v linii bez přerušení hned za sebou. Za to je vždy víc bodů než za stejnou kombinaci rozházenou.

| Kombinace | Příklad | Body |
|---|---|---:|
| Pětice — pětkrát stejné číslo | `7 7 7 7 7` | 125 |
| Čtveřice vedle sebe | `3 3 3 3 9` | 100 |
| Seřazená postupka | `4 5 6 7 8` | 75 |
| Čtveřice rozházená | `3 3 9 3 3` | 70 |
| Postupka v libovolném pořadí | `6 4 8 5 7` | 50 |
| Full house vedle sebe | `2 2 2 9 9` | 50 |
| Full house | `2 9 2 9 2` | 40 |
| Dva páry vedle sebe | `5 5 8 8 1` | 35 |
| Dva páry | `5 8 5 1 8` | 30 |
| Trojice vedle sebe | `6 6 6 2 9` | 25 |
| Trojice | `6 2 6 9 6` | 20 |
| Pár vedle sebe | `4 11 11 2 7` | 15 |
| Pár | `4 11 2 7 11` | 10 |

Zdroj pravdy je pole `COMBOS` v [public/shared/rules.js](public/shared/rules.js) — tabulka v `rules.html` i tady v README ho jen opisuje.

`shared/rules.js` běží doslova dvakrát: v prohlížeči jako klasický `<script>` a v Netlify funkci jako CommonJS modul (proto ten UMD obal). Od chvíle, kdy skóre počítá i server, musí obě strany dát na stejné pole stejné číslo — dvě kopie bodovací tabulky by se dřív nebo později rozešly a hráč by v žebříčku viděl jiné body, než mu ukázala hra.

## Struktura projektu

```
.
├── netlify.toml               publish adresář, funkce, přesměrování /api/*
├── package.json               jediné závislosti: @netlify/blobs + netlify-cli
│
├── public/                    ← publish adresář, celý statický web
│   ├── index.html                 rozcestník
│   ├── difficulty.html            volba režimu
│   ├── easy.html  hard.html       místní hra (bez času / s odpočtem)
│   ├── ranked.html                hra o žebříček, řízená serverem
│   ├── vyzva.html                 denní výzva — balíček z data, jeden pokus
│   ├── skupina.html               hra ve skupině — lobby, sdílená čísla, pořadí
│   ├── leaderboard.html           tabulka nejlepších
│   ├── number selection.html      generátor čísel pro hru na papíře
│   ├── table.html                 ruční tabulka s bodováním
│   ├── account.html               profil a statistiky
│   ├── rules.html                 pravidla
│   ├── privacy.html               zásady zpracování dat
│   │
│   ├── shared/rules.js        pravidla hry pro OBĚ strany (UMD)
│   │
│   ├── css/
│   │   ├── main.css               jediný <link> v HTML, importuje zbytek
│   │   ├── tokens.css             sdílené škály + smlouva proměnných pro motivy
│   │   ├── base.css               reset, rozměry pole, kostra stránky
│   │   ├── components.css         lišta, tlačítka, rozcestník, dialogy
│   │   ├── board.css              konzole nad polem a hrací pole
│   │   ├── picker.css             stránka Výběr čísel
│   │   ├── prose.css              textové stránky (Pravidla, Zásady)
│   │   ├── account.css            odznak účtu, Profil, lišta souhlasu
│   │   ├── leaderboard.css        žebříček, taby, lišta spojení
│   │   ├── lobby.css              skupinová hra: čekárna, sestava, pořadí
│   │   ├── responsive.css         zvětšování pro velké displeje i zmenšování
│   │   └── theme-{terminal,academism,legacy}.css
│   │
│   ├── js/
│   │   ├── icons.js               SVG sprite, načítá se jako první
│   │   ├── theme.js               přepínač motivů
│   │   ├── ui.js                  dialogy, výběr hodnoty, hlášky
│   │   ├── consent.js             souhlas s ukládáním
│   │   ├── store.js               lokální profily, mezipaměť statistik ze serveru
│   │   ├── account.js             odznak účtu v liště
│   │   ├── nav.js                 hamburgerová nabídka
│   │   ├── scoring.js             napojení bodování na tabulku v DOM
│   │   ├── preview.js             náhled bodů u volných políček + jeho vypínač
│   │   ├── deck.js                balíček v prohlížeči
│   │   ├── game.js                místní hra bez serveru — záložní režim
│   │   ├── api.js                 jediné místo, kde web sahá na síť
│   │   ├── online.js              hra na serveru: easy, hard, žebříček i denní výzva
│   │   ├── skupina.js             skupinová hra — tenký klient s dotazováním
│   │   ├── leaderboard.js         stránka Žebříček
│   │   ├── profile.js             stránka Profil
│   │   ├── numbers.js             stránka Výběr čísel
│   │   └── freetable.js           stránka Tabulka
│   │
│   └── img/                   ikony, favicon, podkladové vzory
│
├── netlify/functions/
│   ├── hra.mjs                POST /api/hra — start, tah, žolík, konec
│   ├── skupina.mjs            POST /api/skupina — lobby, tažení, pokládání
│   ├── zebricek.mjs           GET  /api/zebricek — výpis pořadí
│   ├── vyzva.mjs              GET|POST /api/vyzva — tabulka dne a vlastní pokus
│   ├── profil.mjs             POST /api/profil — ověřené statistiky hráče
│   └── lib/
│       ├── run.mjs                stavový automat partie (čistá logika)
│       ├── lobby.mjs              stavový automat lobby (čistá logika)
│       ├── stats.mjs              výpočet statistik profilu (čistá logika)
│       └── store.mjs              Netlify Blobs: partie, hráči, žebříček, výzva, lobby
│
├── tests/
│   ├── run.mjs                testy serverového automatu (npm test)
│   ├── joker.mjs              žolíci na konci pole, náhrobek dohrané partie
│   ├── zebricek.mjs           zápis do žebříčku s ETagy i bez nich
│   ├── statistiky.mjs         statistiky profilu: výpočet i souběžný zápis
│   ├── skupina.mjs            lobby: sdílená čísla, oprávnění, pořadí
│   ├── vyzva.mjs              denní výzva: balíček z data, pokus na den, tabulka
│   └── server.mjs             lokální náhrada všech funkcí (npm run serve)
└── _original/                 první verze webu, ponechána pro srovnání
```

Složka `_original/` je archiv původní implementace před přepsáním. Nic z ní se nenačítá.

## Jak je to poskládané

Žádný framework a žádné moduly — každý soubor je IIFE, která si na `window` pověsí jeden jmenný prostor. Sdílení stavu jde výhradně přes tato rozhraní.

| Globální objekt | Soubor | Rozhraní |
|---|---|---|
| `MPIcons` | `js/icons.js` | `markup(name)`, `names` |
| `MPTheme` | `js/theme.js` | `apply(id)`, `current()`, `themes` |
| `MPUI` | `js/ui.js` | `open()`, `pickValue()`, `toast()`, `isOpen()`, `close()` |
| `MPConsent` | `js/consent.js` | `state()`, `granted()`, `set()`, `onChange()`, `cookie` |
| `MPStore` | `js/store.js` | `list()`, `active()`, `create()`, `setStats()`, `exportJSON()`, `onChange()`, … |
| `MPAccount` | `js/account.js` | `promptName()`, `openMenu()`, `refresh()` |
| `MPDeck` | `js/deck.js` | `create()`, `VALUES`, `COPIES`, `JOKERS` |
| `MPScore` | `js/scoring.js` | `attach(table, totalEl)`, `evaluate(grid)`, `combos` |
| `MPPreview` | `js/preview.js` | `paint(cells, value)`, `clear(cells)`, `deltas(grid, value)`, `enabled()`, `set()`, `mount()` |
| `MPRules` | `shared/rules.js` | `COMBOS`, `evaluate()`, `scoreGrid()`, `buildDeck()`, … |
| `MPApi` | `js/api.js` | `startRun()`, `act()`, `lobby()`, `daily()`, `leaderboard()`, `stats()`, `resetStats()`, `probe()`, `player()` |
| `MPGame` | `js/game.js` | `start({ statsNote })` — spouští ji `online.js`, sama se nespustí |
| `MPRanked` | `js/online.js` | `publishAllowed()`, `setPublish()`, `decided()` |

### Pořadí načítání

Na pořadí `<script>` tagů záleží a při přidávání stránky je potřeba ho dodržet:

```html
<script src="js/icons.js"></script>      <!-- první v <body>, sprite musí být v DOM -->
...
<script src="shared/rules.js"></script>  <!-- před scoring.js, deck.js i preview.js -->
<script src="js/theme.js"></script>
<script src="js/ui.js"></script>
<script src="js/consent.js"></script>    <!-- před store.js -->
<script src="js/store.js"></script>
<script src="js/account.js"></script>    <!-- před nav.js -->
<script src="js/nav.js"></script>
<!-- dál už jen skripty konkrétní stránky -->
```

Tvrdé závislosti:

- `icons.js` musí být první prvek v `<body>`, jinak odkazy `<use href="#i-…">` nemají na co ukázat.
- `shared/rules.js` běží před `scoring.js`, `deck.js` a `preview.js` — všechny si z něj berou bodovací tabulku nebo složení balíčku.
- `preview.js` běží před herními skripty (`game.js`, `online.js`, `skupina.js`) — ty ho volají při každém překreslení pole.
- `consent.js` běží před `store.js` — store se ho ptá, jestli vůbec smí sáhnout na disk.
- `account.js` běží před `nav.js` — nav si obsah `.rail-actions` přebírá do sbalené nabídky, co přijde později, už tam nespadne.
- `store.js` běží před `api.js` — api se ho ptá, kterému profilu má připsat identitu; a `game.js` před `online.js`, protože online.js mu při výpadku serveru předává řízení.

Volba motivu se navíc nasazuje malým inline skriptem v `<head>` každé stránky, aby web při načtení neproblikl výchozím motivem.

## Motivy

Motiv = jeden soubor `css/theme-*.css`, který naplní proměnné definované v [css/tokens.css](css/tokens.css). Komponenty smějí sahat **jen** na tyto proměnné — natvrdo napsaný hex v komponentě se rozbije v ostatních dvou motivech.

Přidání motivu:

1. Zkopíruj existující `theme-*.css` a naplň všechny proměnné ze soupisu v `tokens.css`.
2. Přidej `@import` do `css/main.css`.
3. Zaregistruj ID a popisek v poli `THEMES` v [js/theme.js](js/theme.js).
4. Když přejmenováváš existující motiv, doplň starý název do mapy `RENAMED`, ať se hráčům s uloženou volbou web nepřepne zpátky na výchozí.

Motivy: `terminal`, `academism` (výchozí), `legacy`. Historické názvy `papir`, `anthropic`, `studio`, `noc` se automaticky mapují na nástupce.

Přepínač v liště je rozbalovací seznam: spouštěč ukazuje zvolený motiv, po kliknutí se rozbalí `role="listbox"` se všemi motivy (šipky, Home/End, Enter, Escape). V hamburgerové nabídce se spouštěč schová a seznam se rozloží napevno pod nadpis „Motiv“ — o to se stará `responsive.css`, ne JavaScript. Další motiv v poli `THEMES` se do seznamu přidá sám, šířku lišty už neovlivní.

## Server a žebříček

Celý server je pět funkcí a pět úložišť v Netlify Blobs. Žádná databáze, žádný druhý účet.

| Endpoint | Co dělá |
|---|---|
| `POST /api/hra` | jediný vstup do partie: `start`, `draw`, `place`, `joker`, `usejoker`, `timeout`, `giveup` |
| `POST /api/skupina` | jediný vstup do skupinové hry: `create`, `join`, `state`, `start`, `draw`, `place`, `storejoker`, `usejoker`, `timeout`, `finish`, `restart`, `leave`, `hostplaying` |
| `GET /api/zebricek?obdobi=day\|week\|month\|all` | výpis pořadí |
| `GET\|POST /api/vyzva` | denní výzva: tabulka dne a rekord dne. POSTem s identitou hráče navíc jeho dnešní pokus — GET je veřejný |
| `POST /api/profil` | ověřené statistiky hráče; `action: 'reset'` je vynuluje. POST proto, že k nim je potřeba tajemství — v adrese by skončilo v historii a v logu |

**Klient nikdy neposílá skóre.** Balíček i pole leží na serveru, klient říká jen „polož kartu na 2,3“ a dostane zpátky nový stav. Odpověď schválně neobsahuje zbytek balíčku (`publicState()` v [run.mjs](netlify/functions/lib/run.mjs)) — kdyby ho posílala, mohl by si hráč tahy naplánovat dopředu a celá práce by byla k ničemu.

Přes stejný endpoint jde i lehká a těžká obtížnost a denní výzva. Není to kvůli žebříčku, ale kvůli statistikám profilu: číslo, které si spočítá prohlížeč, si hráč v konzoli přepíše, a žádná kontrola s tím nic neudělá, protože běží na stejném místě, kde se podvádí. Rozdíl je jen v tom, co se s výsledkem stane — do žebříčku jde pouze `ranked.html` a jen se souhlasem se zveřejněním, výzva má vlastní tabulku dne.

Další věci, které z toho plynou:

- **Identita hráče** je dvojice náhodné id + tajemství, kterou server vydá při první partii. Tajemství se ukládá jako SHA‑256 otisk. Pod identitou leží i statistiky profilu, takže se zahodí jen na výslovné přání (Smazat všechna data), ne při vypnutí žebříčku. Identit je tolik, kolik má prohlížeč místních profilů — `localStorage['mp-player']` je mapa `profileId → identita`, aby si dva sourozenci u jednoho notebooku nesečetli skóre dohromady. Je to slabá identita a nemá předstírat nic víc — brání jedinému, ale podstatnému: aby jeden hráč nezaplavil žebříček pod deseti přezdívkami z jednoho prohlížeče. Záznam hráče se proto nesmí přepsat verzí bez otisku: bez něj se hráč příští partii neprokáže, dostane novou identitu a v tabulce mu přibude řádek místo toho, aby se výsledek srovnal s jeho nejlepším.
- **`runId` je klíč od partie.** Náhodné UUID, kdo ho má, hraje. Tajemství se u každého tahu neověřuje — uhodnout UUID je stejně nemožné a ušetří to jedno čtení z úložiště na tah.
- **Časový limit těžké obtížnosti hlídá server.** Bez toho by stačilo v prohlížeči vypnout odpočet a hrát na neomezený čas, ale zapsat se jako těžká obtížnost. Pozdní tah kartu nepoloží — propadne. Rezerva 1,5 s pokrývá cestu požadavku.
- **Dohraná partie po sobě nechává náhrobek**, nemaže se. Je to malý záznam
  s koncovým stavem místo celého balíčku. Kdyby se mazala, dostal by 404 každý
  požadavek, který dorazí po tom posledním — opakované odeslání při výpadku
  spojení, druhý klik, prohlížeč, který si požadavek zopakoval sám. Hráč pak
  uviděl *„Partie na serveru už není“* přesně ve chvíli, kdy položil poslední
  kartu. Přehrát se z náhrobku nedá nic: nejsou v něm karty a další akce
  narazí na `run_over`.
- **Úklid** běží líně — při zhruba každém dvacátém startu se smažou náhrobky
  starší hodiny a partie, které nikdo nedohrál (6 h). Bez toho by úložiště jen
  rostlo, protože zavřenou kartu prohlížeče nemá kdo ohlásit.
- **Zápis do žebříčku je až po náhrobku a smí selhat.** Je to nejkřehčí část
  celého tahu — čtyři období, každé s vlastním cyklem. Když se dělal první a
  spadl, propadla s ním celá odpověď: partie zůstala v úložišti nedohraná,
  hráč dostal 500 a po dalším kliknutí totéž. Vypadalo to, že *poslední kartu
  prostě nejde položit*. Dohraná partie je fakt sám o sobě; neúspěšný zápis
  stojí hráče řádek v tabulce, ne odehranou hru (`boardFailed` v odpovědi).
- **Souběžné zápisy** do žebříčku řeší podmíněný zápis: čte se s `consistency: 'strong'`, zapisuje přes `onlyIfMatch: etag`, a když někdo mezitím stihl zapsat, celý cyklus se opakuje. Bez toho by Blobs dělaly „poslední vyhrává“ a výsledky by se ztrácely.
- **ETag nemusí dorazit.** Lokální náhrada Blobs v `netlify dev` vrací tělo bez
  hlavičky `etag`. Dokud se v tom případě posílalo `onlyIfNew`, odpovídalo
  úložiště 412 (záznam přece existuje), cyklus šestkrát selhal a skončil
  výjimkou — pod `netlify dev` tedy nešla dohrát žádná partie od té druhé dál.
  Existující záznam bez ETagu se proto zapisuje bez podmínky: souběh se
  neuhlídá, ale v lokálním vývoji hraje jeden člověk. Hlídá to
  [tests/zebricek.mjs](tests/zebricek.mjs).
- **Období jsou čtyři** a každé je vlastní klíč: `d-RRRR-MM-DD`, `w-RRRR-Www`, `m-RRRR-MM` a `all`. Hranice dne, týdne i měsíce se počítají v **českém čase**, ne v UTC — partie dohraná ve 23:30 by jinak spadla do včerejška a v tabulce „Dnes“ by se neobjevila.
- **Na hráče se drží jediný nejlepší výsledek** v každém období. Jinak by deset dobrých partií jednoho člověka vytlačilo z první desítky všechny ostatní.
- **Do žebříčku jdou jen dohrané partie** se všemi 25 políčky, a jen když hráč zapnul zveřejnění přezdívky.

### Denní výzva

Celá výzva stojí na jedné větě: **balíček je funkcí data.** Míchá se ze semínka
`mp-vyzva-RRRR-MM-DD` deterministickým generátorem (xmur3 + mulberry32
v [shared/rules.js](public/shared/rules.js)), takže ho v ten den dostane každý
hráč stejný a ve stejném pořadí — a dostane ho stejný i po restartu funkce nebo
za rok. Tím se ze skóre stane porovnatelné číslo: nerozhoduje, komu se sešly
lepší karty, ale kdo je líp poskládal.

- **Pokus je jeden na den**, a proto: kdo by směl začít podruhé, hraje se
  znalostí celého pořadí karet a měřila by se paměť, ne hra. Pokus se drží
  v záznamu hráče (`player.daily = { day, runId, score, rank }`) a spotřebuje ho
  i partie, která se do veřejné tabulky nikdy nedostane. Je to stejně slabá
  hranice jako celá zdejší identita — kdo si smaže uložená data, dostane nový
  pokus. Brání to nazkoušení balíčku nanečisto, ne odhodlanému podvodníkovi.
  Právě proto výzva vyžaduje zapnuté ukládání: bez uložené identity by měl
  každý pokusů kolik chce.
- **Rozehraná výzva se dá dohrát**, i když hráč zavřel kartu. Druhý start
  v tentýž den nezaloží novou partii, ale vrátí stav té rozehrané. Restartem
  se tedy nedá dostat k lepšímu začátku.
- **Vlastní tabulka, ne období žebříčku.** Klíč `c-RRRR-MM-DD` leží ve stejném
  úložišti `mp-board`, ale stranou od `d-` / `w-` / `m-` / `all`. Míchat partie
  z pevného balíčku s partiemi z náhodných by znamenalo srovnávat nesrovnatelné.
- **Rozhoduje den balíčku, ne okamžik dohrání.** Partie rozehraná ve 23:50
  a dokončená po půlnoci patří pořád ke svému dni; podle času dohrání by spadla
  k dalšímu balíčku, kde by ji nikdo nedohnal.
- **Rekord dne se píše pořád** — nad polem, ne až v dialogu na konci. Je to
  jediné číslo, proti kterému má dnešní výsledek smysl poměřovat, protože skóre
  z jiných dnů vzniklo na jiném balíčku.

Hlídá to [tests/vyzva.mjs](tests/vyzva.mjs): shodné pořadí karet pro dva hráče
téhož dne, různé pro různé dny, hranice dne v českém čase, jeden pokus na den
a zápis do tabulky dne včetně partie přes půlnoc.

### Skupinová hra

Lobby je jeden záznam v úložišti `mp-lobby` pod pětiznakovým kódem. Drží balíček,
řadu vytažených čísel a pole všech hráčů. Stavový automat je
[lib/lobby.mjs](netlify/functions/lib/lobby.mjs) — stejně jako `run.mjs` nesahá
na síť ani na úložiště, takže se dá celý otestovat v Node
([tests/skupina.mjs](tests/skupina.mjs)).

- **Sdílená řada čísel je celý smysl režimu.** Kdyby si každý tahal sám, vyhrál
  by ten, kdo dostal lepší karty. Takhle mají všichni stejná čísla a liší se jen
  tím, kam je položili. Čísla tahá zadavatel; každý hráč má `cursor` — kolik jich
  už vyřídil — a jeho aktuální číslo je vždycky `sequence[cursor]`.
- **Zaostat je dovolené.** Zadavatel může táhnout dál, i když někdo ještě
  nepoložil: pomalejšímu se čísla nakupí ve frontě a dohání je popořadě. V těžké
  obtížnosti to neplatí — termín je společný pro celou skupinu (počítá se od
  vytažení) a co se nestihne, propadne. Kdyby byl termín individuální, hrál by
  pomalý hráč s delším časem než ostatní.
- **Žolíka dostane skupina naráz a každý s ním naloží po svém** — položí ho
  s vlastní hodnotou, nebo si ho uschová. Sdílenou řadu to nerozhodí: `cursor`
  se posune tak jako tak, žolík je prostě vyřízený jinak. Uschovaný žolík se
  pak pokládá mimo řadu (spotřebuje políčko, ne číslo z fronty), takže jde
  uplatnit i s číslem v ruce a přežije i dojetí balíčku — hráč s žolíkem v ruce
  se proto neuzavře jako dohraný, dokud ho nepoloží.
- **Kód lobby neprokazuje nic** — zná ho celá skupina, to je jeho účel. Co smí
  konkrétní hráč, se pozná až podle dvojice `playerId` + `token`, kterou dostane
  při připojení. Token leží v lobby, které se stejně čte při každé akci, takže
  ověření nestojí ani jedno čtení navíc.
- **Souběžné zápisy** jsou tu častější než u žebříčku: do jednoho záznamu píše
  každé položené číslo. Řeší to `updateLobby()` v
  [store.mjs](netlify/functions/lib/store.mjs) — přečti s ETagem, uprav, zapiš
  podmíněně, při kolizi zopakuj úpravu nad čerstvým stavem. Úprava proto musí
  být přepočitatelná.
- **Klient se ptá, neposlouchá.** Žádné WebSockety — statický hosting by kvůli
  nim musel držet spojení. Cadence se řídí tím, na co se čeká: 0,7 s když hráč
  čeká na další číslo, 1,2 s u zadavatele, 2,2 s v čekárně a při vlastním
  rozmýšlení, 3 s po konci hry (hlídá se jen, jestli přijde další kolo).
- **Akce hráče se řadí do fronty, dotaz na stav se zahazuje.** Dokud se akce při
  obsazené lince rovnou zahazovala, mizela hráči kliknutí — stisk se trefil do
  právě běžícího dotazu na pozadí a neprovedl se vůbec, bez chyby a bez hlášky.
- **Výsledky skupinové hry nejdou do veřejného žebříčku.** Hraje se se sdílenými
  čísly a pod taktovkou zadavatele, takže se s partiemi o žebříček porovnat
  nedají. Pořadí skupiny žije jen v lobby a mizí s ním (úklid po 6 hodinách od
  poslední akce).

### Co server pořád neumí

Server brání podvrhu skóre, přehrání staré partie i hraní se znalostí balíčku dopředu. **Nebrání tomu, aby dobře hrál skript** — a bez měření chování hráče se s tím rozumně dělat nic nedá. Tenhle problém má každá online hra.

## Co se ukládá

Do žebříčku jde jen to, co hráč sám odešle dohranou partií v režimu o žebříček — přezdívka, skóre, obtížnost, délka hry a datum. Lehká a těžká obtížnost se serverem hrají, ale nezveřejňují nic: k identitě hráče se připíšou jen jeho vlastní čísla, která vidí on sám. Bez zapnutého ukládání se na server nechodí vůbec a hraje se místně. Ve skupinové hře jde na server přezdívka a rozehrané pole, ale vidí je jenom ti, kdo znají kód lobby, a s lobby to i zmizí. Zbytek leží v prohlížeči a dělí se na dvě kategorie:

| Kategorie | Co | Kde | Podmíněno souhlasem |
|---|---|---|---|
| Nezbytné | volba motivu, zapnutý náhled bodů, záznam o souhlasu | `localStorage['mp-theme']`, `localStorage['mp-preview']`, `localStorage` + cookie `mp_consent` | ne |
| Volitelné | lokální profily a mezipaměť statistik | `localStorage['mp-profiles']`, cookies `mp_profile`, `mp_stats` | ano |
| Volitelné | rozehraná partie ve Výběru čísel | `localStorage['mp-picker']` | ano |
| Volitelné | souhlas se zveřejněním v žebříčku | `localStorage['mp-publish']` | ano |
| Volitelné | identita hráče (žebříček i statistiky), mapa profileId → identita | `localStorage['mp-player']` | ano |
| Volitelné | místo v rozehrané skupinové hře | `localStorage['mp-seat']` | ano |

Bez souhlasu drží `store.js` data jen v paměti karty: hra funguje normálně, po zavření se nic nezachová. Udělení souhlasu paměť rovnou uloží, odvolání uložené stopy smaže. Cookies jsou jen záloha aktivního profilu pro případ, že prohlížeč vyhodí `localStorage` — proto se zrcadlí jen aktivní profil, do 4 kB se víc nevejde. Statistiky v prohlížeči jsou mezipaměť; smazat je tady znamená přijít o zobrazení, ne o čísla — ta drží server pod identitou hráče, a ta se maže spolu s ostatními daty.

Zveřejnění přezdívky je vědomě oddělené od souhlasu s ukládáním: jedno znamená „pamatuj si mě“, druhé „ukaž mě ostatním“. Ptá se na něj vlastní dialog před první partií o žebříček a přepnout jde v profilu.

### Kde vzniká skóre

Skóre i statistiky vznikají výhradně na serveru, ze stavu partie, kterou sám odehrál. Endpoint, kterým by šlo body poslat, neexistuje: `apply()` v [run.mjs](netlify/functions/lib/run.mjs) zná jen `draw`, `place`, `joker`, `usejoker`, `timeout`, `giveup` a `state`, cizí pole v těle požadavku propadnou. Statistiky se pak počítají v [stats.mjs](netlify/functions/lib/stats.mjs) z hodnot, které nikdo neposlal — skóre spočítal server, délku změřily jeho hodiny, obtížnost je ta, se kterou se partie zakládala.

Prohlížeč si čísla jenom zrcadlí (`MPStore.setStats()`), aby šla ukázat i bez spojení. Kdo mezipaměť přepíše, oklame do nejbližšího spojení sám sebe: první odpověď ze serveru ji přepíše zpátky.

**Dřív to tak nebylo.** Místní hra si počítala statistiky sama a `store.js` je hlídal žetonem partie, mezemi věrohodnosti a kontrolním součtem. Nic z toho zabezpečení nebylo a být nemohlo — hra běžela u hráče a klíč k podpisu ležel ve stejném souboru. Zůstal jen ten kontrolní součet, a to v roli, která mu patří: chytá poškozený zápis, ne podvod.

**Co tím nepadá:** skript, který hraje dobře v reálném čase. Brzda pouští jedno tažení za 120 ms, víc se bez měření chování hráče dělat nedá. Padá podvrh skóre, přehrání staré partie a hraní se znalostí balíčku dopředu.

**Cena** je připojení a 52 požadavků na partii. Bez serveru se easy i hard hrají dál místně — hra je úplná, jen se nikam nezapíše a dialog na konci to řekne.

## Ovládání a přístupnost

| Klávesa | Akce |
|---|---|
| `G` | vygeneruje další číslo |
| `Tab` + `Enter` | vybere a potvrdí políčko |
| `↑ ↓ ← →` | posun po ruční tabulce |
| `Esc` | zavře dialog, který jde zrušit |

Hrací pole je `<table>` s `<caption>`, ne mřížka divů. Dialogy si hlídají fokus, zavírají se `Esc` a po zavření vracejí fokus tam, odkud přišly. Ikony jsou `aria-hidden`, význam nese text vedle nich.

## Když v tom budeš hrabat

Žádný build ani bundler. Klientský kód je psaný ve stylu ES5 (`var`, `function`, žádné moduly), serverové funkce jsou moderní ESM (`.mjs`) — proto `package.json` **nemá** `"type": "module"`: `shared/rules.js` musí zůstat CommonJS, aby ho uměl načíst prohlížeč jako obyčejný `<script>` i funkce přes `import`.

Serverová logika se ověřuje pomocí `npm test`, klientská pořád jen v prohlížeči.

Co držet:

- **Komentáře česky**, v hlavičce souboru vysvětli *proč*, ne *co*. Většina souborů má úvodní blok s kontextem a záměrně popisuje i to, co se v předchozí verzi rozbilo — ta historie je součástí dokumentace.
- **Žádný hex v komponentách.** Nová barva jde nejdřív do `tokens.css` a pak do všech tří motivů.
- **Žádná emoji v UI.** Ikony kreslí `js/icons.js` linkou 1,6 px a berou barvu z `currentColor`.
- **Nezlomitelné mezery** po jednopísmenných předložkách a spojkách (`v&nbsp;poli`) — česká sazba je nenechává viset na konci řádku.
- **Nové globální rozhraní** pověs na `window` jako `MP*` a doplň ho do tabulky výš.
- **Pravidla hry patří do `shared/rules.js`**, ne do `scoring.js` ani do funkce. Dvě kopie bodovací tabulky se rozejdou a žebříček přestane sedět s tím, co hráč viděl ve hře.
- **`publicState()` nesmí prozradit balíček.** Když do stavu partie přibude pole, rozmysli si, jestli ho klient opravdu smí vidět.
