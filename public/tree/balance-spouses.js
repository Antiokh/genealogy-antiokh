/**
 * Adapt Family Chart 0.9.0's already-calculated tree just before rendering.
 *
 * Upstream always places all spouses to the gender-dependent side of their
 * partner. With exactly two spouses this leaves the partner at the edge of a
 * three-card row. Reassign the same three x positions as spouse / person /
 * spouse, keeping the complete row's original extent and the library's own
 * children ordering. This is deliberately limited to exactly two spouses:
 * the single-spouse layout, larger unions, ancestry and overview mechanics
 * retain their standard behavior.
 *
 * Mutation happens via Chart.setBeforeUpdate, before Family Chart generates
 * SVG links and HTML cards. We also update the couple midpoints used to draw
 * child links and union icons. Manipulating DOM card positions after rendering
 * would leave those links attached to the wrong parents.
 */
export function balanceTwoSpouseLayout(tree) {
  if (!tree || tree.is_horizontal || !Array.isArray(tree.data)) return 0;

  let balanced = 0;
  for (const person of tree.data) {
    if (!person || person.is_ancestry || person.added || person.spouses?.length !== 2) continue;
    const [first, second] = person.spouses;
    if (!first || !second || first === second) continue;
    if (![person.x, first.x, second.x].every(Number.isFinite)) continue;

    const positions = [person.x, first.x, second.x].sort((a, b) => a - b);
    const [leftX, middleX, rightX] = positions;
    if (leftX === rightX || leftX === middleX || middleX === rightX) continue;

    // The original array is already arranged to match Family Chart's
    // gender-dependent sortChildrenWithSpouses. Preserve that orientation
    // so children still descend from their own couple, without crossings.
    const isFemale = person.data?.data?.gender === 'F';
    const leftSpouse = isFemale ? second : first;
    const rightSpouse = isFemale ? first : second;

    person.x = middleX;
    leftSpouse.x = leftX;
    rightSpouse.x = rightX;

    for (const spouse of [leftSpouse, rightSpouse]) {
      // Family Chart's spouse links and child links use the couple midpoint
      // (sx); its relation symbols use that same coordinate.
      spouse.sx = (person.x + spouse.x) / 2;
    }

    for (const child of person.children || []) {
      if (child?.is_ancestry || child?.added || !Array.isArray(child?.data?.rels?.parents)) continue;
      const coparent = [leftSpouse, rightSpouse]
        .find((spouse) => child.data.rels.parents.includes(spouse.data?.id));
      if (!coparent) continue;
      child.psx = coparent.sx;
      child.psy = person.y;
    }

    balanced += 1;
  }
  return balanced;
}
