/**
 * dsh-motion — host half.
 *
 * This plugin is client-only: the UI bundle is declared through `dsh.client`
 * in package.json and served by dsh-client-modules. The host entry exists only
 * so the package can be listed as a bundle and installed with `dsh plugin add`
 * / from the market. It registers no services and runs no code in Node.
 */
export const name = "dsh-motion";
export const inject = [];
export function apply(_ctx) {}
