const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

test('talk board UI is polished on root and app mirror', () => {
  for (const prefix of ['', 'www/']) {
    const html = read(`${prefix}index.html`);
    const js = read(`${prefix}js/app.js`);
    const css = read(`${prefix}css/style.css`);

    assert.match(html, /id="btn-home-talk-write-floating"/, `${prefix}home needs a floating write entry`);
    assert.match(html, /class="talk-screen-panel"/, `${prefix}talk list needs the updated panel wrapper`);
    assert.match(js, /#btn-home-talk-write-floating.+navigate\('talk-write'\)/s, `${prefix}home write button must open talk write`);
    assert.match(js, /home-talk-row-card/, `${prefix}home talk rows must use the polished row card`);
    assert.match(js, /class="talk-cafe-stat"/, `${prefix}talk cards must expose compact stats`);
    assert.match(css, /\.talk-screen-panel\b/, `${prefix}talk screen panel styles are required`);
    assert.match(css, /\.talk-write-floating\.home-talk-write-floating\b/, `${prefix}home floating button styles are required`);
    assert.doesNotMatch(js, /class="talk-cafe-dot"/, `${prefix}old dot-only talk card marker should be gone`);
  }
});
