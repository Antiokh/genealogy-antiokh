const sexOf = (person) => String(person?.sex || '').toUpperCase();
const isMale = (person) => ['M', 'MALE'].includes(sexOf(person));
const isFemale = (person) => ['F', 'FEMALE'].includes(sexOf(person));
const gendered = (person, male, female, neutral = 'родственник') => isMale(person) ? male : isFemale(person) ? female : neutral;
const result = (label, title = label) => ({ label, title });

function buildRelations(family) {
  const ids = new Set((family.people || []).map((person) => person.id));
  const parents = new Map([...ids].map((id) => [id, new Set()]));
  const children = new Map([...ids].map((id) => [id, new Set()]));
  const partners = new Map([...ids].map((id) => [id, []]));

  for (const unit of family.families || []) {
    const unitPartners = (unit.partners || []).filter((id) => ids.has(id));
    const unitChildren = (unit.children || []).filter((id) => ids.has(id));
    for (const child of unitChildren) {
      for (const parent of unitPartners) {
        parents.get(child)?.add(parent);
        children.get(parent)?.add(child);
      }
    }
    for (let i = 0; i < unitPartners.length; i += 1) {
      for (let j = i + 1; j < unitPartners.length; j += 1) {
        const relation = unit.relation || { kind:'parents' };
        const a = unitPartners[i], b = unitPartners[j];
        partners.get(a)?.push({ id:b, relation });
        partners.get(b)?.push({ id:a, relation });
      }
    }
  }

  return { parents, children, partners };
}

function partnerLink(partners, a, b) {
  return (partners.get(a) || []).find((link) => link.id === b);
}

function formalFamilyRelation(relation) {
  return ['married', 'divorced', 'partner'].includes(relation?.kind);
}

function enrichHalfSiblings(byId, parents, focusId, labels) {
  const focusParents = parents.get(focusId) || new Set();
  if (focusParents.size < 2) return;

  for (const person of byId.values()) {
    if (person.id === focusId) continue;
    const targetParents = parents.get(person.id) || new Set();
    if (targetParents.size < 2) continue;
    const shared = [...focusParents].filter((id) => targetParents.has(id));
    if (shared.length !== 1) continue;

    const sharedParent = byId.get(shared[0]);
    const label = isMale(sharedParent)
      ? gendered(person, 'единокровный брат', 'единокровная сестра', 'единокровный родственник')
      : isFemale(sharedParent)
        ? gendered(person, 'единоутробный брат', 'единоутробная сестра', 'единоутробный родственник')
        : gendered(person, 'неполнородный брат', 'неполнородная сестра', 'неполнородный родственник');
    labels.set(person.id, result(label));
  }
}

function enrichStepSiblings(byId, parents, partners, focusId, labels) {
  const focusParents = parents.get(focusId) || new Set();
  if (!focusParents.size) return;

  for (const person of byId.values()) {
    if (person.id === focusId || labels.has(person.id)) continue;
    const targetParents = parents.get(person.id) || new Set();
    if (!targetParents.size) continue;
    if ([...focusParents].some((id) => targetParents.has(id))) continue;

    let linked = false;
    for (const focusParent of focusParents) {
      for (const targetParent of targetParents) {
        const relation = partnerLink(partners, focusParent, targetParent)?.relation;
        if (formalFamilyRelation(relation)) {
          linked = true;
          break;
        }
      }
      if (linked) break;
    }

    if (linked) {
      labels.set(person.id, result(gendered(person, 'сводный брат', 'сводная сестра', 'сводный родственник')));
    }
  }
}

function enrichChildrenInLaw(byId, children, partners, focusId, labels) {
  for (const childId of children.get(focusId) || []) {
    const child = byId.get(childId);
    if (!child) continue;
    for (const link of partners.get(childId) || []) {
      if (link.relation?.kind !== 'married') continue;
      const spouse = byId.get(link.id);
      if (!spouse) continue;
      if (isMale(child) && isFemale(spouse)) labels.set(spouse.id, result('сноха', 'жена сына'));
      else if (isFemale(child) && isMale(spouse)) labels.set(spouse.id, result('зять', 'муж дочери'));
    }
  }
}

function enrichCoParentsInLaw(byId, parents, children, partners, focusId, labels) {
  for (const childId of children.get(focusId) || []) {
    for (const spouseLink of partners.get(childId) || []) {
      if (spouseLink.relation?.kind !== 'married') continue;
      const spouseId = spouseLink.id;
      for (const parentId of parents.get(spouseId) || []) {
        if (parentId === focusId) continue;
        const existing = labels.get(parentId);
        if (existing) continue;
        const parent = byId.get(parentId);
        if (!parent) continue;
        labels.set(parentId, result(gendered(parent, 'сват', 'сватья', 'сват')));
      }
    }
  }
}

export function enrichKinshipLabels(family, requestedFocusId, labels) {
  const people = family.people || [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const focusId = byId.has(requestedFocusId) ? requestedFocusId : people[0]?.id || '';
  if (!focusId) return labels;

  const { parents, children, partners } = buildRelations(family);
  enrichHalfSiblings(byId, parents, focusId, labels);
  enrichStepSiblings(byId, parents, partners, focusId, labels);
  enrichChildrenInLaw(byId, children, partners, focusId, labels);
  enrichCoParentsInLaw(byId, parents, children, partners, focusId, labels);
  return labels;
}
