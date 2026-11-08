// The test-only sign-in link (apps/mobile/src/dev/e2eSession.ts) for the
// session of SERVER, EMAIL and PASSWORD, opening ROUTE when it is set.
const parts = [
  'server=' + encodeURIComponent(SERVER),
  'email=' + encodeURIComponent(EMAIL),
  'password=' + encodeURIComponent(PASSWORD),
];
if (ROUTE) parts.push('route=' + encodeURIComponent(ROUTE));
output.link = 'retrospend://__e2e/session?' + parts.join('&');
