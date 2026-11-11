// The theme picked in the portal (src/features/shell/useUiPrefs.ts) goes on <html> before the first paint, so a page
// never opens in the computer's colours and fades over. A file, not inline code, because the CSP allows no inline script.
try {
  const theme = localStorage.getItem('hcml.theme');
  if (theme === 'light' || theme === 'dark') document.documentElement.setAttribute('data-theme', theme);
} catch {
  // Storage is blocked (private mode): the computer's theme stands, as it does in the app.
}
