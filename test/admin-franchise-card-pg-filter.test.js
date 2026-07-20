const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const rootDir = path.resolve(__dirname, '..');

function loadFranchiseListUtils() {
  const code = fs.readFileSync(path.join(rootDir, 'admin-assets/js/admin-franchise-list-utils.js'), 'utf8');
  const context = {
    window: {
      EatsAdminFranchiseListUtils: {}
    }
  };
  vm.createContext(context);
  vm.runInContext(code, context, { filename: 'admin-franchise-list-utils.js' });
  return context.window.EatsAdminFranchiseListUtils;
}

test('franchise detail keeps active cards visible after PG change', () => {
  const utils = loadFranchiseListUtils();

  const html = utils.cardDetailHtml({
    id: 10,
    pgProviderId: 2,
    cardList: [
      {
        id: 1,
        cardCompany: 'GH Card',
        maskedNumber: '****1111',
        pgProviderId: 1,
        active: true,
        hidden: false
      },
      {
        id: 2,
        cardCompany: 'Deleted Routeup Card',
        maskedNumber: '****2222',
        pgProviderId: 2,
        active: false,
        hidden: true
      },
      {
        id: 3,
        cardCompany: 'Routeup Card',
        maskedNumber: '****3333',
        pgProviderId: 2,
        active: true,
        hidden: false
      }
    ]
  }, {});

  assert.match(html, /GH Card/);
  assert.doesNotMatch(html, /Deleted Routeup Card/);
  assert.match(html, /Routeup Card/);
  assert.match(html, /\*\*\*\*-\*\*\*\*-\*\*\*\*-3333/);
});

test('admin franchise card queries attach every active visible card regardless of the current PG', () => {
  const server = fs.readFileSync(path.join(rootDir, 'server.js'), 'utf8');

  assert.match(server, /COALESCE\(cards\.hidden, false\) = false/);
  assert.match(server, /COALESCE\(cards\.active, true\) = true/);
  assert.doesNotMatch(server, /card_users\.pg_provider_id IS NULL\s+OR cards\.pg_provider_id = card_users\.pg_provider_id/s);
});
