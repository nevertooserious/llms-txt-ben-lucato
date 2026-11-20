// Hydration: attaches behaviour to markup the server already rendered. Changes no text.
document.querySelectorAll('a').forEach(function (link) {
  link.addEventListener('click', function () { document.body.dataset.lastClicked = link.href; });
});
document.body.dataset.hydrated = 'true';
