/** Leaves the app for another site, such as a vendor's sign-in page; tests replace it. */
export function leaveTo(url: string) {
  window.location.assign(url);
}
