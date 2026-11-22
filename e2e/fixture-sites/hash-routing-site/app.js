// Hash routing: every "page" is the same URL with a different fragment. Fragments never
// reach the server, so each route can only be read by opening it in a browser. Like a
// Docsify site, some routes are written in markdown files beside the page (guide.md).
(function () {
  var pages = {
    '#/': ['Hashbang Docs', 'Documentation for a tool whose site routes on the URL fragment. Each section below is a different fragment of one URL, which a crawler must open in a browser to read.'],
    '#/install': ['Install', 'Download the binary and put it on your path. This text appears only after the fragment changes.'],
    '#/configure': ['Configure', 'Write a config file in your home directory. This text also appears only after the fragment changes.'],
    '#/guide': ['Guide', 'A longer walk through a first project, from an empty folder to a running build, kept in a markdown file as well.'],
    '#/guide/plugins': ['Plugins', 'How to write a plugin and load it from the config file. A route two segments deep.'],
  };
  function render() {
    // "#/install?id=usage" is the Install route, scrolled to a heading.
    var route = (location.hash || '#/').split('?')[0];
    var page = pages[route] || pages['#/'];
    document.title = page[0] === 'Hashbang Docs' ? 'Hashbang Docs' : page[0] + ' - Hashbang Docs';
    document.getElementById('app').innerHTML =
      '<nav><a href="#/">Home</a> <a href="#/guide">Guide</a> <a href="#/install">Install</a> <a href="#/configure">Configure</a></nav>' +
      '<main><h1>' + page[0] + '</h1><p>' + page[1] + '</p>' +
      (route === '#/guide' ? '<p><a href="#/guide/plugins">Plugins</a> <a href="#/install?id=usage">Usage</a></p>' : '') +
      '</main>';
  }
  window.addEventListener('hashchange', render);
  render();
})();
