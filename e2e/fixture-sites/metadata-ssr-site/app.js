// The server sends real <head> metadata, but the body is drawn here.
(function () {
  var app = document.getElementById('app');
  app.innerHTML =
    '<header><nav><a href="/">Home</a> <a href="/work">Work</a> <a href="/contact">Contact</a></nav></header>' +
    '<main><h1>We build interfaces in the browser</h1>' +
    '<p>Halfway Studio is a design studio whose site puts its title and description in the HTML the server ' +
    'sends, then renders everything else with JavaScript. A plain fetch gets the metadata and none of the ' +
    'words a reader would actually see on the page.</p></main>';
})();
