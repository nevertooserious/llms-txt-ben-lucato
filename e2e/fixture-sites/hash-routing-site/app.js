// Hash routing: every "page" is the same URL with a different fragment. Fragments never
// reach the server, so to a crawler this whole site is one page.
(function () {
  var pages = {
    '#/': ['Hashbang Docs', 'Documentation for a tool whose site routes on the URL fragment. Each section below is a different fragment of one URL, which crawlers and llms.txt cannot address separately.'],
    '#/install': ['Install', 'Download the binary and put it on your path. This text appears only after the fragment changes.'],
    '#/configure': ['Configure', 'Write a config file in your home directory. This text also appears only after the fragment changes.'],
  };
  function render() {
    var page = pages[location.hash || '#/'] || pages['#/'];
    document.getElementById('app').innerHTML =
      '<nav><a href="#/">Home</a> <a href="#/install">Install</a> <a href="#/configure">Configure</a></nav>' +
      '<main><h1>' + page[0] + '</h1><p>' + page[1] + '</p></main>';
  }
  window.addEventListener('hashchange', render);
  render();
})();
