import { readFileSync } from 'node:fs';

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

if (!process.exitCode) console.log('Tree overview mode check passed.');
