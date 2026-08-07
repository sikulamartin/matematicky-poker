/* Sada ikon. Vloží se jako skrytý SVG sprite na začátek <body>, prvky pak
   odkazují na <use href="#i-nazev">. Žádné emoji — kresba drží linku 1,6 px
   a bere barvu z currentColor, takže sedí do všech tří motivů. */
(function () {
  'use strict';

  var PATHS = {
    home: '<path d="M3.2 10.4 12 3.2l8.8 7.2"/><path d="M5.6 9.3V20.3h12.8V9.3"/><path d="M9.6 20.3v-6h4.8v6"/>',
    dice: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="4.2"/>' +
      '<circle cx="8.4" cy="8.4" r="1.35" fill="currentColor" stroke="none"/>' +
      '<circle cx="12" cy="12" r="1.35" fill="currentColor" stroke="none"/>' +
      '<circle cx="15.6" cy="15.6" r="1.35" fill="currentColor" stroke="none"/>',
    hash: '<path d="M9.3 3.4 7.3 20.6"/><path d="M16.7 3.4l-2 17.2"/><path d="M3.6 8.6h16.8"/><path d="M3.2 15.4h16.8"/>',
    grid: '<rect x="3.4" y="3.4" width="17.2" height="17.2" rx="3.2"/><path d="M3.4 9.1h17.2M3.4 14.9h17.2M9.1 3.4v17.2M14.9 3.4v17.2"/>',
    book: '<path d="M6.6 3.4h10.9a1.5 1.5 0 0 1 1.5 1.5v14.2a1.5 1.5 0 0 1-1.5 1.5H6.6A2.6 2.6 0 0 1 4 18V6a2.6 2.6 0 0 1 2.6-2.6z"/><path d="M4 17.3h15"/>',
    joker: '<rect x="5.1" y="2.9" width="13.8" height="18.2" rx="2.6"/>' +
      '<path d="M12 7.2l1.45 3 3.25.45-2.35 2.3.55 3.25L12 14.66l-2.9 1.54.55-3.25-2.35-2.3 3.25-.45z"/>',
    gauge: '<path d="M4.1 17.4a8.6 8.6 0 1 1 15.8 0"/><path d="M12 17.4l4.2-5.3"/><circle cx="12" cy="17.4" r="1.3" fill="currentColor" stroke="none"/>',
    timer: '<circle cx="12" cy="13.6" r="7.6"/><path d="M12 9.6v4.2l2.6 1.9"/><path d="M9.4 2.8h5.2"/>',
    arrowRight: '<path d="M4.4 12h14.4"/><path d="M13.1 6.4 18.8 12l-5.7 5.6"/>',
    trophy: '<path d="M7.4 3.6h9.2v5.2a4.6 4.6 0 0 1-9.2 0z"/><path d="M7.4 5.2H4.8a2.6 2.6 0 0 0 2.6 2.6M16.6 5.2h2.6a2.6 2.6 0 0 1-2.6 2.6"/><path d="M12 13.4v3.2"/><path d="M9.2 16.6h5.6l.9 3.8H8.3z"/>',
    eraser: '<path d="M8.4 20.4h11.8"/><path d="M15.1 4.2 20 9.1a1.6 1.6 0 0 1 0 2.2l-7.6 7.6H8.2l-3.6-3.6a1.6 1.6 0 0 1 0-2.2l8.3-8.9a1.6 1.6 0 0 1 2.2 0z"/>',
    shuffle: '<path d="M3.4 6.6h3.3c1.7 0 2.7.8 3.7 2.3l3.5 4.9c1 1.5 2 2.3 3.7 2.3h3"/><path d="M3.4 17.4h3.3c1.7 0 2.7-.8 3.7-2.3"/><path d="M17.6 3.6l3 3-3 3"/><path d="M17.6 14.4l3 3-3 3"/>',
    info: '<circle cx="12" cy="12" r="8.6"/><path d="M12 11v5.6"/><path d="M12 7.6v.9"/>',
    alert: '<path d="M12 4.2 21.2 19.8H2.8z"/><path d="M12 10v4.1"/><path d="M12 17.2v.7"/>',
    check: '<path d="M4.8 12.4 10 17.6 19.2 6.8"/>',
    close: '<path d="M6 6l12 12M18 6 6 18"/>',
    menu: '<path d="M3.8 6.8h16.4M3.8 12h16.4M3.8 17.2h16.4"/>'
  };

  var sprite = '<svg class="mp-sprite" aria-hidden="true" focusable="false">';
  for (var name in PATHS) {
    sprite += '<symbol id="i-' + name + '" viewBox="0 0 24 24" fill="none" ' +
      'stroke="currentColor" stroke-width="1.6" stroke-linecap="round" ' +
      'stroke-linejoin="round">' + PATHS[name] + '</symbol>';
  }
  sprite += '</svg>';

  function inject() {
    if (document.querySelector('.mp-sprite')) {
      return;
    }
    var host = document.createElement('div');
    host.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
    host.innerHTML = sprite;
    document.body.insertBefore(host, document.body.firstChild);
  }

  /** Vrátí HTML jedné ikony — pro dialogy a dynamicky skládané prvky. */
  function markup(name, className) {
    return '<svg class="icon' + (className ? ' ' + className : '') +
      '" aria-hidden="true"><use href="#i-' + name + '"></use></svg>';
  }

  if (document.body) {
    inject();
  } else {
    document.addEventListener('DOMContentLoaded', inject);
  }

  window.MPIcons = { markup: markup, names: Object.keys(PATHS) };
})();
