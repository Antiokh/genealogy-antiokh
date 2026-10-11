# Tree visualization decision

This document records the current renderer shortlist for Genealogy Library. The detailed interaction/history contract extracted from the BALKAN work lives in [`tree-renderer-behavior-contract.md`](./tree-renderer-behavior-contract.md) and is the source of truth for what every renderer must reproduce.

The scope is family trees only. Pedigree/fan/timeline/map views can be evaluated separately.

## Hard requirements

A renderer remains a candidate only if it can satisfy all of these on the real genealogy:

1. Expand/collapse must be understandable and usable on mobile.
2. Multiple marriages/partnerships must preserve the correct parent pair for every child.
3. The exact shared `genealogy-person-card` must remain renderer-independent.
4. The complete real tree (currently 232 people) must be displayable without a free-tier/node-count ceiling.
5. Genealogy Library owns visual semantics: theme tokens, kinship badge, avatar navigation, mourning ribbon, union icons, status/focus controls.

Performance, licensing, implementation weight and generation readability are comparison criteria after correctness.

## Canonical model

The canonical graph remains renderer-independent:

```text
people + families/unions
        ↓
visibility / collapse state
        ↓
renderer adapter
        ↓
renderer
```

A union is always an explicit semantic object in the canonical data even when a renderer flattens it visually:

```text
person P1 -> union F1 <- person P2
                     |
                     +-> children
```

This is non-negotiable because a person can have multiple partnerships and children must stay attached to the correct union.

## Shared behavior baseline

PR #28 originally used BALKAN FamilyTreeJS to establish the product behavior. That behavior is now renderer-independent and is documented in `tree-renderer-behavior-contract.md`:

- focused initial view rather than a permanently filtered data source;
- visible tree `+ / −` branch controls;
- card-body branch interaction while avatar/photo remains the only page link;
- shared PersonCard and neutral portrait fallback;
- black mourning ribbon in every theme;
- kinship/affinity label relative to the focused person;
- union icons for marriage, divorce, partnership and neutral co-parenting;
- top-left `<focus> · N из M людей` status;
- clicking the focus name centers without changing branch state;
- clicking the total count expands/shows all;
- common zoom, fit and focus commands;
- shared theme variables rather than renderer hard-coded colors.

## Active candidates

### Family Chart 0.9 — genealogy-specific, MIT

Strengths:

- compact genealogy-specific renderer;
- good generation readability in the current demo;
- accepts the exact shared PersonCard;
- MIT licensed;
- relatively small integration surface.

Current implementation in PR #28 now has the same visible branch controls, status actions and relation-icon language as the BALKAN reference.

Main risk: Family Chart flattens union context into person-level parents/spouses/children. Correct placement for multiple spouses and their separate children must therefore be verified on real data. Union icons are positioned as an overlay between visible partner cards because the renderer has no persistent explicit union node in its public data shape.

Its current collapse implementation is application-owned projected visibility followed by renderer rebuild/re-layout, not verified native hidden-node state. That difference is part of the comparison.

### Vue Flow + ELK — explicit union graph, maximum control

Strengths:

- preserves canonical union nodes exactly;
- arbitrary custom Vue nodes host the exact shared PersonCard;
- marriage/divorce/partner icon is the actual union node rather than an overlay;
- multiple partnerships and child-per-union semantics are explicit;
- zoom/pan are handled by Vue Flow;
- layout and rendering are replaceable independently.

PR #28 now gives it the same branch controls, status actions, theme semantics and kinship cards as the reference behavior.

Risks:

- collapse/visibility remains application-owned;
- ELK re-layout is required after visible-scope changes;
- two libraries and more implementation/runtime weight;
- `@vue-flow/core` is MIT, while `elkjs` uses EPL-2.0, so redistribution obligations are different from a pure-MIT stack.

Architecturally this is currently the cleaner candidate for complex multi-partner genealogy because unions remain first-class nodes.

## Reference only: BALKAN FamilyTreeJS classic

BALKAN was useful for establishing the interaction model because it supports native root changes and native `expand` / `collapse`. PR #28 changed it from destroy/recreate filtered projections to one full node graph and native collapse state.

However, expanding the real genealogy exposed a 200-person limitation in the free BALKAN usage path while the current tree contains 232 people. That makes it unsuitable for the project's free/open-source production requirement.

Do not treat BALKAN as a finalist. Keep it only as a behavioral/reference renderer unless the node limit and licensing constraints change under acceptable terms.

## Current comparison

| Candidate | Collapse implementation | Union correctness | Shared card | 232 people | License / dependency note | Status |
| --- | --- | --- | --- | --- | --- | --- |
| Family Chart | app-owned scope + rebuild | flattened model; must verify multi-spouse layout | yes | to test | MIT | active candidate |
| Vue Flow + ELK | app-owned scope + ELK re-layout | exact explicit union nodes | yes | to test | Vue Flow MIT; ELK.js EPL-2.0 | active candidate |
| BALKAN classic | native | strong | yes | **blocked at 200 in free path** | proprietary/commercial constraints | reference only |

## Real-data test checklist

Both active candidates must be tested with the same `tree.json`, focused person and card component. At minimum verify:

- all 232 people via expand-all;
- multiple marriages with children from each union;
- half-siblings;
- unknown/missing parent;
- spouse ancestry and affinity labels;
- pedigree collapse;
- wide collateral branches;
- parents not rendered visually below their children;
- reasonable generation alignment;
- mobile pan/zoom/fit/focus;
- branch-toggle latency;
- expand-all latency;
- stable union icons while navigating;
- no renderer-specific fork of PersonCard.

The renderer pages record their latest rebuild/layout time in the status element's `title` and `data-render-ms` to make side-by-side performance checks easier without adding debug text to the visible UI.

## Rejected candidates

These remain rejected unless their underlying data/layout model changes:

| Candidate | Reason |
| --- | --- |
| ApexTree | strict nested hierarchy; one structural parent path |
| treeSpider | strict `id + parentId` hierarchy |
| d3-org-chart | secondary spouse connections do not participate in layout |
| DHTMLX Diagram org chart | partner nodes cannot cleanly represent child-per-union semantics |
| JSCharting Org | shared Web Component card could not be embedded cleanly |
| Topola | genealogy semantics useful, but production visual design too rigid for this product |
| Custom SVG demo | reference/prototype rather than a maintained renderer library |

The goal is not the most capable graph library. It is the smallest maintainable renderer that keeps family geometry correct, stays fast on the real tree, has acceptable licensing, and lets Genealogy Library own the visual language.
