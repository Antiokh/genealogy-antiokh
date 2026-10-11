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
        url: person.url || '',
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

export function toBalkanFamilyTreeData(family, personCardElementHtml) {
  const byId = Object.fromEntries(family.people.map((person) => [person.id, person]));
  const nodes = Object.fromEntries(family.people.map((person) => [person.id, {
    id: person.id,
    name: person.cardName || person.name || person.id,
    gender: person.sex === 'M' ? 'male' : person.sex === 'F' ? 'female' : undefined,
    pids: [],
    cardHtml: personCardElementHtml(person),
  }]));

  for (const unit of family.families) {
    const partners = unit.partners.filter((id) => nodes[id]);
    for (let i = 0; i < partners.length; i += 1) {
      for (let j = i + 1; j < partners.length; j += 1) {
        const a = partners[i];
        const b = partners[j];
        if (!nodes[a].pids.includes(b)) nodes[a].pids.push(b);
        if (!nodes[b].pids.includes(a)) nodes[b].pids.push(a);
      }
    }

    const maleParent = partners.find((id) => byId[id]?.sex === 'M');
    const femaleParent = partners.find((id) => byId[id]?.sex === 'F');
    const remaining = partners.filter((id) => id !== maleParent && id !== femaleParent);

    for (const childId of unit.children) {
      const child = nodes[childId];
      if (!child) continue;
      if (maleParent) child.fid = maleParent;
      if (femaleParent) child.mid = femaleParent;
      if (!child.fid && remaining[0]) child.fid = remaining[0];
      if (!child.mid && remaining.find((id) => id !== child.fid)) child.mid = remaining.find((id) => id !== child.fid);
      if (!child.fid && !child.mid && partners[0]) child.fid = partners[0];
    }
  }

  return Object.values(nodes);
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
