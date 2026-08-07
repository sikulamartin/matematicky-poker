# Matematický Poker

Kombinační hra s čísly 1–13 na poli 5×5. Taháš karty z balíčku, rozhoduješ, kam je zapíšeš, a sbíráš body za pokerové kombinace ve všech řádcích, sloupcích a obou úhlopříčkách. Zapsané číslo už nejde přesunout — každý tah je konečný.

Celá hra běží jako statický web v prohlížeči. Žádný backend, žádný build, žádné závislosti a žádná data neopouštějí zařízení hráče.

**Živá verze:** [sikulamartin.github.io/matematicky-poker](https://matematickypoker.netlify.app/)

---

## Obsah

- [Co hra umí](#co-hra-umí)
- [Rychlý start](#rychlý-start)
- [Nasazení](#nasazení)
- [Pravidla ve zkratce](#pravidla-ve-zkratce)
- [Bodovací tabulka](#bodovací-tabulka)
- [Struktura projektu](#struktura-projektu)
- [Architektura](#architektura)
- [Motivy a design tokeny](#motivy-a-design-tokeny)
- [Data, úložiště a soukromí](#data-úložiště-a-soukromí)
- [Přístupnost a ovládání](#přístupnost-a-ovládání)
- [Podpora prohlížečů](#podpora-prohlížečů)
- [Vývoj a konvence](#vývoj-a-konvence)
- [Licence](#licence)

---

## Co hra umí

| Režim | Stránka | Popis |
|---|---|---|
| **Hra — lehká** | `easy.html` | Plná hra bez časového tlaku. |
| **Hra — těžká** | `hard.html` | Odpočet 3–300 sekund na jedno číslo. Co nestihneš uložit, propadne a políčko zůstane prázdné. |
| **Výběr čísel** | `number selection.html` | Samostatný generátor pro hru na papíře. Historie tahů, přehled zbývajících karet, rozehraná hra přežije reload. |
| **Tabulka** | `table.html` | Prázdné pole k ručnímu vyplnění s průběžným bodováním. Užitečné pro kontrolu papírové partie. |
| **Profil** | `account.html` | Lokální účty (bez hesla a bez serveru), statistiky a správa uložených dat. |
| **Pravidla** | `rules.html` | Kompletní pravidla a bodovací tabulka. |
| **Zásady** | `privacy.html` | Co se ukládá, kam a jak to smazat. |

Dál:

- **Tři vizuální motivy** — Terminál, Academism, Legacy. Volba se ukládá a platí napříč stránkami.
- **Žolíci** — dva v balíčku. Jde je použít hned s vlastní hodnotou, nebo uschovat na později; uschovaný žolík nespotřebuje tah.
- **Vlastní dialogy** místo `alert()` / `confirm()` / `prompt()` — stylovatelné, přístupné, s ochrannou lhůtou proti nechtěnému potvrzení dojezdem stisku.
- **Souhlas s ukládáním** — bez něj hra funguje, jen si po zavření karty nic nepamatuje.
- **Responzivní layout** od ~380 px do 4K, včetně sbalené hamburgerové nabídky pod 860 px.

## Rychlý start

Repozitář je čistě statický. Stačí ho naklonovat a otevřít přes libovolný lokální server:

```bash
git clone https://github.com/sikulamartin/matematicky-poker.git
cd matematicky-poker

# jakýkoli statický server, například:
python3 -m http.server 8000
# nebo
npx serve .
```

Pak otevři <http://localhost:8000>.

> **Proč server a ne dvojklik na `index.html`?**
> Přes `file://` část prohlížečů blokuje `localStorage` a cookies, takže by nefungovaly motivy ani profily. Samotná hra by šla, uložená data ne.

Nic se neinstaluje, nic se nekompiluje — žádné `package.json`, žádný bundler, žádný krok navíc. Jediná externí závislost jsou webfonty z Google Fonts; bez internetu se web vykreslí systémovým písmem.

## Nasazení

GitHub Pages: **Settings → Pages → Source: Deploy from a branch → `main` / `root`**. Nic dalšího není potřeba, repozitář je připravený k přímému servírování.

Stejně dobře funguje jakýkoli statický hosting (Netlify, Vercel, Cloudflare Pages, obyčejný Apache/nginx). Jen pozor na název souboru `number selection.html` — obsahuje mezeru a v odkazech je psaný jako `number%20selection.html`. Některé konfigurace serverů mezeru v cestě odmítají.

## Pravidla ve zkratce

1. Klikneš na **Generovat** a balíček vydá kartu.
2. Vybereš prázdné políčko a číslo do něj vložíš.
3. Další číslo se natáhne **samo** — tlačítko *Táhnout ručně* zůstává jen jako záloha.
4. Body se přepočítají hned, u každého řádku, sloupce i obou úhlopříček.
5. Hra končí, jakmile je zaplněných všech 25 políček.

**Balíček** má 54 karet: čtyři kusy od každé hodnoty 1–13 (52) plus dva žolíky. Míchá se Fisherovým–Yatesovým algoritmem a karta se nikdy neopakuje. Políček je jen 25, takže velkou část balíčku v jedné hře neuvidíš.

**Vyhodnocuje se 12 linií** — 5 řádků, 5 sloupců a obě úhlopříčky. Z každé linie se počítá jen její *nejlepší* kombinace; v rámci jedné linie se body nesčítají. Teoretické maximum je proto 12 × 125 = **1500 bodů**.

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

Zdroj pravdy je pole `COMBOS` v [js/scoring.js](js/scoring.js) — tabulka v `rules.html` i tady v README ho jen opisuje.

## Struktura projektu

```
.
├── index.html                 rozcestník
├── difficulty.html            volba obtížnosti
├── easy.html  hard.html       hra (bez času / s odpočtem)
├── number selection.html      generátor čísel pro hru na papíře
├── table.html                 ruční tabulka s bodováním
├── account.html               profil a statistiky
├── rules.html                 pravidla
├── privacy.html               zásady zpracování dat
│
├── css/
│   ├── main.css               jediný <link> v HTML, importuje zbytek
│   ├── tokens.css             sdílené škály + smlouva proměnných pro motivy
│   ├── base.css               reset, rozměry pole, kostra stránky
│   ├── components.css         lišta, tlačítka, rozcestník, dialogy
│   ├── board.css              konzole nad polem a hrací pole
│   ├── picker.css             stránka Výběr čísel
│   ├── prose.css              textové stránky (Pravidla, Zásady)
│   ├── account.css            odznak účtu, Profil, lišta souhlasu
│   ├── responsive.css         zvětšování pro velké displeje i zmenšování
│   └── theme-{terminal,academism,legacy}.css
│
├── js/
│   ├── icons.js               SVG sprite, načítá se jako první
│   ├── theme.js               přepínač motivů
│   ├── ui.js                  dialogy, výběr hodnoty, toasty
│   ├── consent.js             souhlas s ukládáním
│   ├── store.js               lokální profily a statistiky
│   ├── account.js             odznak účtu v liště
│   ├── nav.js                 hamburgerová nabídka
│   ├── scoring.js             bodování 12 linií
│   ├── deck.js                balíček 54 karet
│   ├── game.js                řízení hry (easy + hard)
│   ├── numbers.js             stránka Výběr čísel
│   └── freetable.js           stránka Tabulka
│
├── img/                       ikony, favicon, podkladové vzory
└── _original/                 první verze webu, ponechána pro srovnání
```

Složka `_original/` je archiv původní implementace před přepsáním. Nic z ní se nenačítá a do nasazení nezasahuje.

## Architektura

Žádný framework a žádné moduly — každý soubor je IIFE, která si na `window` pověsí jeden jmenný prostor. Sdílení stavu jde výhradně přes tato rozhraní.

| Globální objekt | Soubor | Rozhraní |
|---|---|---|
| `MPIcons` | `js/icons.js` | `markup(name)`, `names` |
| `MPTheme` | `js/theme.js` | `apply(id)`, `current()`, `themes` |
| `MPUI` | `js/ui.js` | `open()`, `pickValue()`, `toast()`, `isOpen()` |
| `MPConsent` | `js/consent.js` | `state()`, `granted()`, `set()`, `onChange()`, `cookie` |
| `MPStore` | `js/store.js` | `list()`, `active()`, `create()`, `record()`, `exportJSON()`, `onChange()`, … |
| `MPAccount` | `js/account.js` | `promptName()`, `openMenu()`, `refresh()` |
| `MPDeck` | `js/deck.js` | `create()`, `VALUES`, `COPIES`, `JOKERS` |
| `MPScore` | `js/scoring.js` | `attach(board, out)`, `evaluate(grid)`, `COMBOS` |

### Pořadí načítání

Na pořadí `<script>` tagů záleží a při přidávání stránky je potřeba ho dodržet:

```html
<script src="js/icons.js"></script>   <!-- první v <body>, sprite musí být v DOM -->
...
<script src="js/theme.js"></script>
<script src="js/ui.js"></script>
<script src="js/consent.js"></script>  <!-- před store.js -->
<script src="js/store.js"></script>
<script src="js/account.js"></script>  <!-- před nav.js -->
<script src="js/nav.js"></script>
<!-- dál už jen skripty konkrétní stránky -->
```

Tři tvrdé závislosti:

- `icons.js` musí být první prvek v `<body>`, jinak odkazy `<use href="#i-…">` nemají na co ukázat.
- `consent.js` běží před `store.js` — store se ho ptá, jestli vůbec smí sáhnout na disk.
- `account.js` běží před `nav.js` — nav si obsah `.rail-actions` přebírá do sbalené nabídky, co přijde později, už tam nespadne.

Volba motivu se navíc nasazuje malým inline skriptem v `<head>` každé stránky, aby web při načtení neproblikl výchozím motivem.

## Motivy a design tokeny

Motiv = jeden soubor `css/theme-*.css`, který naplní proměnné definované v [css/tokens.css](css/tokens.css). Komponenty smějí sahat **jen** na tyto proměnné — natvrdo napsaný hex v komponentě se rozbije v ostatních dvou motivech.

Přidání motivu:

1. Zkopíruj existující `theme-*.css` a naplň všechny proměnné ze soupisu v `tokens.css`.
2. Přidej `@import` do `css/main.css`.
3. Zaregistruj ID a popisek v poli `THEMES` v [js/theme.js](js/theme.js).
4. Pokud přejmenováváš existující motiv, doplň starý název do mapy `RENAMED`, ať se hráčům s uloženou volbou web nepřepne zpátky na výchozí.

Aktuální motivy: `terminal`, `academism` (výchozí), `legacy`. Historické názvy `papir`, `anthropic`, `studio`, `noc` se automaticky mapují na nástupce.

## Data, úložiště a soukromí

Nic se neposílá na server — hra žádný nemá. Všechno leží v prohlížeči hráče a dělí se na dvě kategorie:

| Kategorie | Co | Kde | Podmíněno souhlasem |
|---|---|---|---|
| Nezbytné | volba motivu, záznam o souhlasu | `localStorage['mp-theme']`, `localStorage` + cookie `mp_consent` | ne |
| Volitelné | lokální profily a statistiky | `localStorage['mp-profiles']`, cookies `mp_profile`, `mp_stats` | ano |
| Provozní | rozehraná partie ve Výběru čísel | `localStorage['mp-picker']` | ano |

Bez souhlasu drží `store.js` data jen v paměti karty: hra funguje normálně, po zavření se nic nezachová. Udělení souhlasu paměť rovnou uloží, odvolání uložené stopy smaže. Cookies jsou jen záloha aktivního profilu pro případ, že prohlížeč vyhodí `localStorage` — proto se zrcadlí jen aktivní profil, do 4 kB se víc nevejde.

### Kontroly zápisu skóre — a čím nejsou

`store.js` má tři vrstvy kontrol: žeton partie (`beginRun` → jeden zápis), test věrohodnosti (body jsou násobky pěti, strop 1500, dohraná partie nemůže být kratší než 5 sekund) a kontrolní součet uloženého záznamu.

**Není to zabezpečení a nikdy jím být nemůže.** Celá hra běží u hráče, klíč k podpisu leží ve stejném souboru. Kdo si přečte zdroják, podvrhne si skóre. Kontroly zvedají laťku z „napiš do konzole jeden řádek“ na „přečti si zdroják a napiš skript“ a hlavně chytají poškozené zápisy — ručně přepsanou cookie, půlku objektu po zaplněném disku. Nepodvrhnutelnou tabulku rekordů umí jedině server, který sám drží balíček a sám vyhodnocuje tahy.

## Přístupnost a ovládání

- Hrací pole je `<table>` s `<caption>`, ne mřížka divů.
- Dialogy si hlídají fokus, zavírají se `Esc` a po zavření vracejí fokus tam, odkud přišly.
- Ikony jsou `aria-hidden`, význam nese text vedle nich.
- Drobečková navigace používá `aria-current="page"`.

Klávesové zkratky:

| Klávesa | Akce |
|---|---|
| `G` | vygeneruje další číslo |
| `Tab` + `Enter` | vybere a potvrdí políčko |
| `↑ ↓ ← →` | posun po ruční tabulce |
| `Esc` | zavře dialog, který jde zrušit |

## Podpora prohlížečů

Kód je psaný ve stylu ES5 (`var`, `function`, žádné moduly ani build), takže běží i na starších enginech. Z novějších API se používá `Number.isNaN` a CSS custom properties — reálná spodní hranice jsou tedy evergreen prohlížeče a Safari 10+. Layout je responzivní od ~380 px šířky výš.

## Vývoj a konvence

Žádný build, žádné testy, žádný linter — úpravy se dělají přímo v souborech a ověřují v prohlížeči.

Co držet:

- **Komentáře česky**, v hlavičce souboru vysvětli *proč*, ne *co*. Většina souborů má úvodní blok s kontextem a záměrně popisuje i to, co se v předchozí verzi rozbilo — ta historie je součástí dokumentace.
- **Žádný hex v komponentách.** Nová barva jde nejdřív do `tokens.css` a pak do všech tří motivů.
- **Žádná emoji v UI.** Ikony kreslí `js/icons.js` linkou 1,6 px a berou barvu z `currentColor`.
- **Nezlomitelné mezery** po jednopísmenných předložkách a spojkách (`v&nbsp;poli`) — česká sazba je nenechává viset na konci řádku.
- **Nové globální rozhraní** pověs na `window` jako `MP*` a doplň ho do tabulky v tomhle README.

Commity zatím bez pevné konvence; pro nové doporučuji `feat:` / `fix:` / `docs:` prefixy.

## Licence

Zatím nestanovena. Bez licenčního souboru platí výchozí autorské právo — nikdo jiný nesmí kód použít, upravovat ani šířit. Pokud chceš projekt otevřít, přidej `LICENSE` (typicky MIT) a odkaz doplň sem.
