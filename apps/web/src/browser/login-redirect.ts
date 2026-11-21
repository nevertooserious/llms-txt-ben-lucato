// What a page does when the API says its session has ended (signed out in another tab,
// or the cookie expired): go to the login page, and come back here afterwards.

export function goToLoginIfSignedOut(response: Response): void {
  if (response.status !== 401) return;
  const here = `${window.location.pathname}${window.location.search}`;
  window.location.assign(`/login?next=${encodeURIComponent(here)}`);
}
