/* Stránka Žebříček — přepínání období a výpis pořadí.

   Data přijdou ze serveru už seřazená a oříznutá, takže tady se nic
   nepočítá ani neřadí. Vlastní řádek se pozná podle playerId uloženého
   při první partii o žebříček. */
(function () {
  'use strict';

  var host, meta, tabs;
  var current = 'all';
  var cache = {};        // období → odpověď, ať přepínání netahá znovu

  function escapeHTML(text) {
    return String(text)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function icon(name) {
    return window.MPIcons.markup(name);
  }

  function formatDuration(ms) {
    return window.MPStore ? MPStore.formatDuration(ms) : Math.round(ms / 1000) + ' s';
  }

  function formatDate(iso) {
    var date = new Date(iso);
    if (Number.isNaN(date.getTime())) {
      return '';
    }
    return date.toLocaleDateString('cs-CZ', { day: 'numeric', month: 'numeric' });
  }

  /* --------------------------------------------------------- vykreslení */

  function renderTabs() {
    tabs.forEach(function (tab) {
      var active = tab.getAttribute('data-period') === current;
      tab.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  }

  function renderError(code) {
    var text = code === 'offline' || code === 'timeout'
      ? 'Server neodpovídá. Žebříček se načte, až bude web nasazený na Netlify — ' +
        'lokálně ho rozjede příkaz npm run dev.'
      : 'Žebříček se nepodařilo načíst (' + code + ').';
    host.innerHTML = '<div class="note note--warn">' + icon('alert') +
      '<p>' + escapeHTML(text) + '</p></div>';
    meta.textContent = '–';
  }

  function renderEmpty() {
    host.innerHTML = '<p class="list-empty">Za tohle období tu zatím nikdo není. ' +
      'Buď první — stačí dohrát jednu partii <a href="ranked.html">o žebříček</a>.</p>';
    meta.textContent = '0 hráčů';
  }

  function renderList(data) {
    if (!data.entries.length) {
      renderEmpty();
      return;
    }
    var mine = window.MPApi.player();
    var myId = mine ? mine.id : null;

    meta.textContent = data.count + ' ' +
      (data.count === 1 ? 'hráč' : data.count < 5 ? 'hráči' : 'hráčů');

    host.innerHTML = '<ol class="board-list">' + data.entries.map(function (entry) {
      var isMine = myId && entry.playerId === myId;
      return '<li class="board-row' + (isMine ? ' is-mine' : '') +
        (entry.rank <= 3 ? ' is-podium' : '') + '">' +
        '<span class="board-rank">' + entry.rank + '</span>' +
        '<span class="board-who">' +
        '<span class="board-name">' +
        '<span class="board-nick">' + escapeHTML(entry.name) + '</span>' +
        (isMine ? '<span class="pill pill--on">ty</span>' : '') + '</span>' +
        '<span class="board-meta">' +
        (entry.mode === 'hard' ? 'těžká' : 'lehká') + ' · ' +
        formatDuration(entry.durationMs) + ' · ' + formatDate(entry.at) +
        '</span>' +
        '</span>' +
        '<span class="board-score">' + entry.score + '</span>' +
        '</li>';
    }).join('') + '</ol>';
  }

  /* ---------------------------------------------------------- načítání */

  function load(period, force) {
    current = period;
    renderTabs();

    if (cache[period] && !force) {
      renderList(cache[period]);
      return;
    }

    host.innerHTML = '<p class="list-empty">Načítám žebříček…</p>';
    meta.textContent = '…';

    window.MPApi.leaderboard(period).then(function (result) {
      if (current !== period) {
        return;                 // hráč mezitím přepnul jinam
      }
      if (!result.ok) {
        renderError(result.error);
        return;
      }
      cache[period] = result.data;
      renderList(result.data);
    });
  }

  function init() {
    host = document.getElementById('boardHost');
    if (!host) {
      return;
    }
    meta = document.getElementById('boardMeta');
    tabs = Array.prototype.slice.call(document.querySelectorAll('.tab[data-period]'));

    tabs.forEach(function (tab) {
      tab.addEventListener('click', function () {
        load(tab.getAttribute('data-period'), false);
      });
    });

    /* Období se dá poslat odkazem — ?obdobi=day. Platí jen ta, pro která
       je na stránce záložka, takže se seznam nemusí udržovat na dvou
       místech: přibude záložka, přibude i platná hodnota. */
    var wanted = new URLSearchParams(window.location.search).get('obdobi');
    var known = tabs.some(function (tab) {
      return tab.getAttribute('data-period') === wanted;
    });
    load(known ? wanted : 'all', false);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
