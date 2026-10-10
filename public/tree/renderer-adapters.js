export function toFamilyChartData(family) {
  const rels = Object.fromEntries(family.people.map((person) => [person.id, { parents: [], spouses: [], children: [] }]));

  for (const unit of family.families) {
    for (let i = 0; i < unit.partners.length; i += 1) {
      for (let j = i + 1; j < unit.partners.length; j += 1) {
        const a = unit.partners[i];
        const b = unit.partners[j];
        if (!rels[a] || !rels[b]) continue;
        if (!rels[a].spouses.includes(b)) rels[a].spouses.push(b);
        if (!rels[b].spouses.includes(a)) rels[b].spouses.push(a);
      }
    }
    for (const child of unit.children) {
      if (!rels[child]) continue;
      for (const parent of unit.partners) {
        if (!rels[parent]) continue;
        if (!rels[parent].children.includes(child)) rels[parent].children.push(child);
        if (!rels[child].parents.includes(parent)) rels[child].parents.push(parent);
      }
    }
  }

  return family.people.map((person) => {
    const [firstName, ...rest] = String(person.name || '').split(' ');
    return {
      id: person.id,
      data: {
        gender: person.sex || '',
        sex: person.sex || '',
        deceased: Boolean(person.deceased),
        photo: person.photo || '',
        cardName: person.cardName || '',
        birthSurname: person.birthSurname || '',
        marriedSurname: person.marriedSurname || '',
        'first name': firstName || person.id,
        'last name': rest.join(' '),
        years: person.years || '',
      },
      rels: rels[person.id],
    };
  });
}

export function toBalkanFamilyTree2Data(family) {
  const byId = Object.fromEntries(family.people.map((person) => [person.id, person]));
  const members = Object.fromEntries(family.people.map((person) => [person.id, {
    id: person.id,
    name: person.cardName || person.name || person.id,
    birthSurname: person.birthSurname || '',
    marriedSurname: person.marriedSurname || '',
    years: person.years || '',
    sex: person.sex || '',
    deceased: Boolean(person.deceased),
    photo: person.photo || '',
    ...(person.sex === 'M' ? { sexOrGender: 'male' } : person.sex === 'F' ? { sexOrGender: 'female' } : {}),
    spouseIds: [],
    childIds: [],
  }]));

  for (const unit of family.families) {
    const partners = unit.partners.filter((id) => members[id]);
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        const a = partners[i];
        const b = partners[j];
        if (!members[a].spouseIds.includes(b)) members[a].spouseIds.push(b);
        if (!members[b].spouseIds.includes(a)) members[b].spouseIds.push(a);
      }
    }
    for (const childId of unit.children) {
      const child = members[childId];
      if (!child) continue;
      for (const parentId of partners) {
        if (!members[parentId].childIds.includes(childId)) members[parentId].childIds.push(childId);
      }
      const fatherId = partners.find((id) => byId[id]?.sex === 'M');
      const motherId = partners.find((id) => byId[id]?.sex === 'F');
      if (fatherId) child.fatherId = fatherId;
      if (motherId) child.motherId = motherId;
    }
  }
  return Object.values(members);
}

export function toVueFlowElkData(family, { personWidth = 240, personHeight = 108, familySize = 18 } = {}) {
  const nodes = [
    ...family.people.map((person) => ({ id: person.id, type: 'person', width: personWidth, height: personHeight, data: { ...person } })),
    ...family.families.map((unit) => ({ id: unit.id, type: 'family', width: familySize, height: familySize, data: { label: unit.label || '' } })),
  ];
  const edges = [];
  for (const unit of family.families) {
    for (const partner of unit.partners) edges.push({ id: `${partner}-${unit.id}`, source: partner, target: unit.id });
    for (const child of unit.children) edges.push({ id: `${unit.id}-${child}`, source: unit.id, target: child });
  }
  return { nodes, edges };
}
