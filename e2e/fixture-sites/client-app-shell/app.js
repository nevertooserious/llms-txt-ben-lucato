// A client-side app: the server sends the same empty shell for every path, and this
// script renders the page for the current path, including the navigation.
(function () {
  var pages = {
    '/': {
      title: 'Shellfish Analytics',
      heading: 'Analytics that render in the browser',
      body:
        'Shellfish Analytics is a dashboard product whose whole interface is drawn by JavaScript. ' +
        'Without running this script a crawler sees an empty div and nothing else. ' +
        'This paragraph is long enough that the rendered page clearly holds more text than the shell.',
      loadsAnnouncement: true,
    },
    '/features': {
      title: 'Features | Shellfish Analytics',
      heading: 'Features',
      body:
        'Real-time charts, saved queries, scheduled reports and team sharing. Every feature listed here ' +
        'exists only in the rendered page, never in the HTML the server sends.',
    },
    '/pricing': {
      title: 'Pricing | Shellfish Analytics',
      heading: 'Pricing',
      body:
        'Free for one user, then a flat monthly price per seat. The pricing table is rendered on the ' +
        'client, so plain HTTP fetching would miss it entirely.',
    },
    '/docs': {
      title: 'Docs | Shellfish Analytics',
      heading: 'Documentation',
      body:
        'Install the tracking snippet, define your events, then build a dashboard. These instructions ' +
        'are rendered by the same script as every other page on this site.',
    },
  };

  var page = pages[location.pathname] || {
    title: 'Not found | Shellfish Analytics',
    heading: 'Page not found',
    body: 'There is nothing at this address.',
  };

  document.title = page.title;
  var root = document.getElementById('root');
  root.innerHTML =
    '<header><nav>' +
    '<a href="/">Home</a> <a href="/features">Features</a> <a href="/pricing">Pricing</a> <a href="/docs">Docs</a>' +
    '</nav></header>' +
    '<main><h1></h1><p class="body"></p><p class="announcement"></p></main>';
  root.querySelector('h1').textContent = page.heading;
  root.querySelector('.body').textContent = page.body;

  if (page.loadsAnnouncement) {
    var announcement = root.querySelector('.announcement');
    announcement.textContent = 'Loading…';
    // Waits before fetching, so a crawler that stops at network idle would capture "Loading…".
    setTimeout(function () {
      fetch('/api/announcement.json')
        .then(function (response) { return response.json(); })
        .then(function (data) { announcement.textContent = data.text; });
    }, 600);
  }
})();
