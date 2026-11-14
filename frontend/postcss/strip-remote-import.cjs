// Removes remote `@import url(https://…)` rules from bundled CSS.
//
// @near-wallet-selector/modal-ui ships a stylesheet that starts with
//   @import "https://fonts.googleapis.com/css2?family=Inter…";
// The production Content-Security-Policy (next.config.ts) allows only
// `style-src 'self'` and `font-src 'self' data:`, so the browser blocks that import
// and fails the whole stylesheet ("Failed to load chunk … .css"), which breaks the
// wallet picker. Dropping the remote import keeps the strict CSP and makes the
// modal fall back to its system font stack; no third-party request is made.
const REMOTE = /^\s*(?:url\(\s*)?["']?https?:\/\//i;

module.exports = () => ({
  postcssPlugin: "strip-remote-import",
  AtRule: {
    import(rule) {
      if (REMOTE.test(rule.params)) rule.remove();
    },
  },
});
module.exports.postcss = true;
