# Tree renderer behavior contract

This document records the interaction and visual behavior developed while tuning the BALKAN renderer in PR #28. The renderer implementation is allowed to differ, but the user-visible behavior below is the comparison baseline for Family Chart, Vue Flow + ELK and any future renderer.

The purpose of this contract is to stop renderer experiments from drifting into different products. A renderer that cannot support a requirement should document that as a renderer limitation instead of silently changing the behavior.

## Why this contract exists

The first BALKAN implementation looked like branches were collapsed, but it actually projected the canonical family graph to a smaller list of people, destroyed the renderer and loaded a new tree on every click. That produced the right rough shape but the wrong mental model: relatives disappeared from the renderer rather than remaining in the tree as collapsed branches.

PR #28 changed BALKAN to keep the complete source graph loaded, retain one renderer instance and use its native root / expand / collapse API. While doing that we also established a set of UI decisions that should not belong to BALKAN itself.

## Behavior history from the BALKAN iteration

### 1. Complete canonical data remains the source of truth

`/generated/tree.json` contains the complete renderer-independent graph. Renderers must never reinterpret partner/child membership by hand.

A renderer may build a visible projection when its API has no native collapse state, but that is an implementation fallback. The source graph and union membership remain complete and available for every interaction.

Preferred behavior: load the full graph once and use native hidden/collapsed state.

Fallback behavior: derive a visible projection from shared scope state and rebuild/re-layout the renderer. When this fallback is used it must be recorded in the renderer comparison because it affects latency and visual stability.

### 2. Initial view is focused, not filtered

The initial tree is centered on the requested `person` and shows enough immediate context to understand the family: parents/partners/children and the nearby branch controls. Hidden branches must have a visible affordance that says more family exists.

### 3. Branch affordance is explicit

A person that has expandable relations gets a small tree control. The control uses the site's theme tokens, not library hard-coded colors.

- tree + `+`: branch can be expanded;
- tree + `−`: branch can be collapsed;
- ancestor/up control where the renderer needs a distinct parent-expansion action;
- the whole non-navigation part of the card may also toggle the branch, but the explicit control must remain visible on mobile.

The control colors use `--tree-accent` and `--tree-background`.

### 4. Relationship/union state is visible on the graph

The canonical `family` / union object carries `relation.kind` and optional dates. Renderers should visualize this rather than drawing every partner relation as the same anonymous line.

Current icon semantics:

- `married`: linked/ring icon in the accent color;
- `divorced`: the married icon with a diagonal danger-color slash;
- `partner`: partner/people icon in the accent color;
- `parents`: neutral co-parent/parents icon when no explicit partnership status is known.

Date labels may be shown when they do not make the graph unreadable. The icon title/tooltip should keep the complete relation meaning.

### 5. PersonCard is renderer-independent

All renderers host the same `genealogy-person-card` Web Component.

Current card rules:

- clicking the avatar/photo opens the person's page;
- clicking the name does not navigate and remains available to the tree interaction;
- the mourning ribbon is always pure black (`#000`) in every theme;
- the top-right badge shows the relation to the focused person;
- relationship labels are limited to one `пра-` generation word and at most `троюродный` for very distant blood relations;
- established Russian affinity terms are preferred over generic text when the graph supports them (for example `тесть`, `тёща`, `свёкор`, `свекровь`, `шурин`, `свояченица`, `деверь`, `золовка`, `свояк`, `зять`, `сноха` / `невестка`);
- where modern Russian has no useful short one-word term, use a descriptive relation (`муж племянницы`, `двоюродный брат жены`) rather than `родство по браку`.

The card owns photo/death/name/kinship semantics. Renderers must not fork that markup.

### 6. Floating status has product meaning, not renderer meaning

The top-left status pill is:

`<focused person> · <visible> из <total> людей`

It must not repeat the renderer name; the renderer name already exists in the external selector.

Interactions:

- focused person's name: center on that person without changing branch state;
- total count: expand/show all people that the renderer can display;
- the pill sits close to the component edge so it does not waste canvas space.

### 7. Common viewport controls

Every renderer supports the same external commands:

- zoom in;
- zoom out;
- fit visible tree;
- center on focused person.

Renderer-specific controls can exist internally, but the common commands must remain functional.

### 8. Theme ownership stays with Genealogy Library

Renderer defaults are not visual authority. Backgrounds, edges, controls and relation icons use the shared CSS variables from `public/tree/renderer.css`.

At minimum:

- `--tree-background`;
- `--tree-accent`;
- `--tree-edge`;
- `--tree-union`;
- `--tree-danger`.

## Renderer implementation notes

### BALKAN FamilyTreeJS classic

PR #28 moved this renderer from filtered projections to native renderer state:

- complete node set loaded once;
- one `FamilyTree` instance;
- native `changeRoots`, `center`, `expand`, `collapse`;
- native visible node count;
- custom themed branch controls;
- union relationship icons;
- focused initial collapse state;
- status actions for focus and expand-all.

It is now the reference implementation for interaction semantics, not the preferred production dependency.

A real-data expand-all test with the current 232-person tree exposed a 200-person limitation in the free BALKAN usage path. Treat BALKAN as unsuitable for the production free/open-source requirement unless that limitation is removed under an acceptable license. Do not spend further product work making BALKAN the default renderer.

### Family Chart 0.9

Family Chart is a genealogy-specific open-source renderer and has good generation readability, but its input model flattens unions into person-level `parents` / `spouses` / `children`. Correct child-to-union placement with multiple spouses remains the main correctness risk.

For the PR #28 parity test it should receive:

- shared PersonCard with branch controls;
- the shared scope/status actions;
- relationship icons positioned between visible partner cards;
- explicit visible collapse affordances;
- expand-all on the 232-person graph;
- performance observation for rebuild/re-layout after a branch toggle.

Its current branch state is implemented by Genealogy Library's projected visible scope rather than verified native hidden-node state. This must remain visible in the comparison.

### Vue Flow + ELK

Vue Flow + ELK preserves canonical union nodes exactly and therefore gives us the strongest semantic control:

`person -> union <- person`, then `union -> children`.

For the PR #28 parity test it should receive:

- shared PersonCard with branch controls;
- relationship icon rendered directly in each union node;
- shared status/focus/expand-all behavior;
- shared theme tokens;
- ELK re-layout on visible-scope changes;
- performance observation on the complete 232-person graph.

Collapse is application-owned in the current implementation, but unlike Family Chart the union model is not flattened.

## Acceptance checklist for renderer comparison

A renderer test is considered comparable only when all applicable items below are present:

- [ ] same `/generated/tree.json` input;
- [ ] same focused person;
- [ ] same PersonCard component;
- [ ] avatar-only navigation;
- [ ] black mourning ribbon;
- [ ] kinship badge;
- [ ] explicit tree +/- control;
- [ ] card-body branch toggle;
- [ ] marriage / divorce / partnership / co-parent icon semantics;
- [ ] focus action from the status pill;
- [ ] expand-all action from the total count;
- [ ] zoom / fit / focus commands;
- [ ] theme variables instead of renderer hard-coded colors;
- [ ] multiple marriages tested with children attached to the correct union;
- [ ] 232-person expand-all tested;
- [ ] mobile tested;
- [ ] branch-toggle latency observed;
- [ ] expand-all latency observed;
- [ ] renderer/license limits recorded.

## Kinship terminology sources

The kinship badge should prefer modern dictionary terms over invented graph terminology. The primary reference for affinity terms is Gramota.ru's dictionary/reference material on terms of kinship and affinity. In particular it documents `тесть`, `тёща`, `свёкор`, `свекровь`, `шурин`, `свояченица`, `деверь`, `золовка`, `свояк`, `зять`, `сноха` and the broader modern use of `невестка`. Gramota's dictionary also explicitly includes a spouse of an aunt as `дядя` and a spouse of an uncle as `тётя`.

The implementation should use a descriptive phrase when a precise common modern term is unavailable instead of collapsing all affinity to `родство по браку`.
