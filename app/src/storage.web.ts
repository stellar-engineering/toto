// Where the app keeps what it knows between visits, in a browser: this site's local storage.
// ponytail: readable by any script that runs on this page, so the page loads none but its own
// (see the Content-Security-Policy in site/_headers). A key the browser itself holds and will
// not export would be stronger; the cipher here needs the raw key, so that means changing cipher.
export const read = (key: string): string | null => {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
};
export const write = (key: string, value: string) => {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private windows can refuse. The Toto then has to be added again next visit.
  }
};
