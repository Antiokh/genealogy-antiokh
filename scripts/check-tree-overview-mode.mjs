import { readFileSync } from 'node:fs';
import { balanceTwoSpouseLayout } from '../public/tree/balance-spouses.js';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const fail = (message) => {
  console.error(`Tree overview check failed: ${message}`);
  process.exitCode = 1;
};
const expect = (condition, message) => {
  if (!condition) fail(message);
};

const component = read('src/components/FamilyTree.astro');
const index = read('src/content/docs/people/index.mdx');
const familyChart = read('src/pages/trees/renderers/family-chart.astro');
const scope = read('public/tree/scope.js');
const personCard = read('public/tree/person-card.js');

expect(index.includes('<FamilyTree overviewMode={true} />'), 'all-people page must use the component-level overviewMode API');
expect(!index.includes('renderer="family-chart"'), 'all-people page must not configure the overview renderer itself');
expect(!index.includes('expandAllOnLoad'), 'legacy expandAllOnLoad must not leak into page content');

expect(component.includes('overviewMode?: boolean;'), 'FamilyTree must expose overviewMode');
expect(/overviewMode\s*\?\s*'family-chart'/.test(component), 'overview mode must select Family Chart inside the component');
expect(component.includes("rendererQuery.set('overview', '1')"), 'overview mode must be passed to the renderer');
expect(component.includes('{!overviewMode && ('), 'overview mode must hide target-centering controls');
expect(component.includes('M5 12h14M12 5v14'), 'zoom-in must use a geometrically centered SVG icon');
expect(component.includes('M5 12h14'), 'zoom-out must use a geometrically centered SVG icon');
expect(!component.includes('>+</button>') && !component.includes('>−</button>'), 'zoom controls must not rely on font glyph baselines');

expect(scope.includes("overviewMode: params.get('overview') === '1'"), 'tree context must parse overview mode');
expect(scope.includes('людей в дереве'), 'overview status must use the compact total-only label');
expect(scope.includes('if (overviewMode) {'), 'overview status must bypass focus and visible/total controls');

expect(personCard.includes('const isOverviewMode = () =>'), 'person cards must detect overview mode');
expect(personCard.includes('if (!isOverviewMode()) this.loadRelationship();'), 'overview cards must skip kinship-label calculation');
expect(personCard.includes("const focusId = overviewMode ? ''"), 'overview cards must have no target/focus figure');

expect(familyChart.includes('const overviewMode = context.overviewMode;'), 'Family Chart must consume overview context');
expect(familyChart.includes('overviewMode,'), 'Family Chart must render overview-specific status');
expect(familyChart.includes('if (overviewMode) expandAll();'), 'overview mode must expand the complete genealogy on initialization');


// Family Chart v0.9.0 lays every spouse on one side. In a two-marriage row,
// verify symmetrical placement without moving the row extent or breaking the
// couple points used by children's connectors and relation icons.
function twoSpouseFixture(gender = 'M') {
  const direction = gender === 'M' ? 1 : -1;
  const id = gender === 'M' ? 'parent-m' : 'parent-f';
  const original = gender === 'M' ? [-286, 0, 286] : [286, 0, -286];
  const first = { x: original[1], y: 0, sx: 0, data: { id: 'former' }, added: true };
  const second = { x: original[2], y: 0, sx: -143 * direction, data: { id: 'current' }, added: true };
  const firstChild = { data: { id: 'child-former', rels: { parents: [id, 'former'] } }, psx: NaN };
  const secondChild = { data: { id: 'child-current', rels: { parents: [id, 'current'] } }, psx: NaN };
  const parent = {
    x: original[0], y: 0,
    data: { id, data: { gender } },
    spouses: [first, second],
    children: [firstChild, secondChild],
  };
  return { tree: { is_horizontal: false, data: [parent, first, second, firstChild, secondChild] }, parent, first, second, firstChild, secondChild };
}

for (const gender of ['M', 'F']) {
  const t = twoSpouseFixture(gender);
  const originalExtent = [t.parent.x, t.first.x, t.second.x].sort((a, b) => a - b);
  expect(balanceTwoSpouseLayout(t.tree) === 1, `exactly two spouses should balance for ${gender}`);
  expect(t.parent.x === 0, `main parent remains centered for ${gender}`);
  const reordered = [t.first.x, t.parent.x, t.second.x].sort((a, b) => a - b);
  expect(JSON.stringify(reordered) === JSON.stringify(originalExtent), `row width stays unchanged for ${gender}`);
  expect(Math.abs(t.first.x - t.parent.x) === Math.abs(t.second.x - t.parent.x), `both spouses at equal distance for ${gender}`);
  expect(t.first.sx === (t.first.x + t.parent.x) / 2, `first marriage midpoint stays correct for ${gender}`);
  expect(t.second.sx === (t.second.x + t.parent.x) / 2, `second marriage midpoint stays correct for ${gender}`);
  expect(t.firstChild.psx === t.first.sx, `first couple's child descends from their union for ${gender}`);
  expect(t.secondChild.psx === t.second.sx, `second couple's child descends from their union for ${gender}`);
}
const single = twoSpouseFixture();
single.parent.spouses.pop();
const priorX = single.parent.x;
expect(balanceTwoSpouseLayout(single.tree) === 0 && single.parent.x === priorX, 'single marriage must keep native layout');
const many = twoSpouseFixture();
many.parent.spouses.push({ x: 572, y: 0, data: { id: 'third' }, added: true });
expect(balanceTwoSpouseLayout(many.tree) === 0 && many.parent.x === priorX, '3+ marriages must keep native layout');
const ancestry = twoSpouseFixture();
ancestry.parent.is_ancestry = true;
expect(balanceTwoSpouseLayout(ancestry.tree) === 0, 'ancestry layout must not change');
const horizontal = twoSpouseFixture();
horizontal.tree.is_horizontal = true;
expect(balanceTwoSpouseLayout(horizontal.tree) === 0, 'horizontal layouts must remain untouched');
expect(
  familyChart.indexOf('chart.setBeforeUpdate(() => balanceTwoSpouseLayout(chart.store.getTree()))')
    < familyChart.indexOf('chart.updateTree({ initial:true, main_id:layoutFocusId })'),
  'balance positions before f3 calculates SVG links and renders cards',
);

if (!process.exitCode) console.log('Tree overview mode check passed.');
