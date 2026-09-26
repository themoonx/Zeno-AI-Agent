


import { parseDdgHtml } from '../backend/tools/web-search.js';

let passed = 0;
let failed = 0;
function ok(name, cond, extra = '') {
  if (cond) {
    passed++;
    console.log(`  ✔ ${name}`);
  } else {
    failed++;
    console.log(`  ✘ ${name} ${extra}`);
  }
}


const htmlClassic = `
<div class="results">
  <div class="result">
    <h2><a rel="nofollow" href="//duckduckgo.com/l/?uddg=https%3A%2F%2Fnodejs.org%2F&rut=abc" class="result__a">Node.js — official site</a></h2>
    <a class="result__snippet" href="#">Node.js is a JavaScript runtime built on V8.</a>
  </div>
  <div class="result">
    <h2><a rel="nofollow" href="https://example.com/node-releases" class='result__a'>Node releases</a></h2>
    <a class='result__snippet' href='#'>Latest LTS is 24.x with security fixes.</a>
  </div>
  <div class="result sponsored">
    <h2><a href="https://duckduckgo.com/y.js?ad_domain=ads.example.com" class="result__a">BUY THINGS NOW</a></h2>
    <a class="result__snippet">An advertisement</a>
  </div>
</div>`;


const htmlLite = `
<table>
  <tr><td><a rel="nofollow" href="https://example.org/guide" class="result-link">A guide</a></td></tr>
  <tr><td class="result-snippet">The guide text lives here.</td></tr>
  <tr><td><a rel="nofollow" href="//example.com/direct" class="result-link">Direct URL result</a></td></tr>
  <tr><td class="result-snippet">Second snippet.</td></tr>
</table>`;


const htmlCaptcha = `<html><body><p>Unfortunately, bots use DuckDuckGo too — anomaly detected.</p></body></html>`;

const r1 = parseDdgHtml(htmlClassic, 10);
ok('classic layout: parses both results', r1.length === 2, JSON.stringify(r1));
ok('classic layout: unwraps uddg redirect URL', r1[0]?.url === 'https://nodejs.org/', r1[0]?.url);
ok('classic layout: positional snippet pairing', r1[0]?.snippet.includes('JavaScript runtime') && r1[1]?.snippet.includes('LTS'), JSON.stringify(r1.map((r) => r.snippet)));
ok('classic layout: single-quoted class attr handled', r1[1]?.title === 'Node releases');

const r2 = parseDdgHtml(htmlLite, 10);
ok('lite layout: parses both results', r2.length === 2, JSON.stringify(r2));
ok('lite layout: protocol-relative href normalized', r2[1]?.url === 'https://example.com/direct', r2[1]?.url);
ok('lite layout: snippet from td', r2[0]?.snippet.includes('guide text'), JSON.stringify(r2.map((r) => r.snippet)));

ok('captcha page parses to zero results (no crash)', parseDdgHtml(htmlCaptcha, 10).length === 0);
ok('maxResults respected', parseDdgHtml(htmlClassic, 1).length === 1);

console.log('─────────────────────────────────');
console.log(` ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
