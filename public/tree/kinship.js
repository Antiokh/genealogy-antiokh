const sexOf = (person) => String(person?.sex || '').toUpperCase();

const gendered = (person, male, female, neutral = 'родственник') => {
  const sex = sexOf(person);
  if (sex === 'M' || sex === 'MALE') return male;
  if (sex === 'F' || sex === 'FEMALE') return female;
  return neutral;
};

const cousinPrefix = (degree, person) => {
  if (degree <= 1) return '';
  const female = sexOf(person) === 'F' || sexOf(person) === 'FEMALE';
  if (degree === 2) return female ? 'двоюродная ' : 'двоюродный ';
  return female ? 'троюродная ' : 'троюродный ';
};

function buildRelations(family) {
  const ids = new Set((family.people || []).map((person) => person.id));
  const parents = new Map([...ids].map((id) => [id, new Set()]));
  const partners = new Map([...ids].map((id) => [id, []]));

  for (const unit of family.families || []) {
    const unitPartners = (unit.partners || []).filter((id) => ids.has(id));
    const children = (unit.children || []).filter((id) => ids.has(id));

    for (const child of children) {
      for (const parent of unitPartners) parents.get(child)?.add(parent);
    }

    for (let i = 0; i < unitPartners.length; i += 1) {
      for (let j = i + 1; j < unitPartners.length; j += 1) {
        const a = unitPartners[i];
        const b = unitPartners[j];
        const relation = unit.relation || { kind:'parents' };
        partners.get(a)?.push({ id:b, relation });
        partners.get(b)?.push({ id:a, relation });
      }
    }
  }

  return { parents, partners };
}

function ancestorDistances(parents, startId) {
  const distances = new Map();
  if (!startId || !parents.has(startId)) return distances;
  distances.set(startId, 0);
  const queue = [startId];

  while (queue.length) {
    const id = queue.shift();
    const distance = distances.get(id) || 0;
    for (const parent of parents.get(id) || []) {
      const next = distance + 1;
      if (distances.has(parent) && distances.get(parent) <= next) continue;
      distances.set(parent, next);
      queue.push(parent);
    }
  }

  return distances;
}

function ancestorLabel(person, distance) {
  if (distance === 1) return gendered(person, 'отец', 'мать', 'родитель');
  if (distance === 2) return gendered(person, 'дед', 'бабушка', 'предок');
  return gendered(person, 'прадед', 'прабабушка', 'предок');
}

function descendantLabel(person, distance) {
  if (distance === 1) return gendered(person, 'сын', 'дочь', 'ребёнок');
  if (distance === 2) return gendered(person, 'внук', 'внучка', 'потомок');
  return gendered(person, 'правнук', 'правнучка', 'потомок');
}

function siblingLabel(person) {
  return gendered(person, 'брат', 'сестра');
}

function uncleLabel(person) {
  return gendered(person, 'дядя', 'тётя');
}

function nephewLabel(person) {
  return gendered(person, 'племянник', 'племянница');
}

function grandRelativeLabel(person, great = false) {
  if (great) return gendered(person, 'прадед', 'прабабушка', 'предок');
  return gendered(person, 'дед', 'бабушка', 'предок');
}

function youngerCollateralLabel(person, gap) {
  if (gap <= 1) return nephewLabel(person);
  if (gap === 2) return gendered(person, 'внучатый племянник', 'внучатая племянница', 'внучатый родственник');
  return gendered(person, 'правнучатый племянник', 'правнучатая племянница', 'правнучатый родственник');
}

function closestCommonAncestor(focusAncestors, targetAncestors) {
  let best = null;
  for (const [id, focusDistance] of focusAncestors) {
    if (focusDistance === 0 || !targetAncestors.has(id)) continue;
    const targetDistance = targetAncestors.get(id);
    if (targetDistance === 0) continue;
    const score = focusDistance + targetDistance;
    const spread = Math.abs(focusDistance - targetDistance);
    if (!best || score < best.score || (score === best.score && spread < best.spread)) {
      best = { id, focusDistance, targetDistance, score, spread };
    }
  }
  return best;
}

function bloodRelationship(byId, parents, focusId, targetId) {
  const target = byId.get(targetId);
  if (!target || !focusId || !targetId) return '';
  if (focusId === targetId) return 'центральная фигура';

  const focusAncestors = ancestorDistances(parents, focusId);
  const targetAncestors = ancestorDistances(parents, targetId);

  if (focusAncestors.has(targetId)) {
    return ancestorLabel(target, focusAncestors.get(targetId));
  }
  if (targetAncestors.has(focusId)) {
    return descendantLabel(target, targetAncestors.get(focusId));
  }

  const common = closestCommonAncestor(focusAncestors, targetAncestors);
  if (!common) return '';

  const a = common.focusDistance;
  const b = common.targetDistance;

  if (a === b) {
    if (a === 1) return siblingLabel(target);
    const degree = Math.min(3, a);
    return `${cousinPrefix(degree, target)}${siblingLabel(target)}`;
  }

  if (a > b) {
    const gap = a - b;
    if (gap === 1) {
      const degree = Math.min(3, b);
      return `${cousinPrefix(degree, target)}${uncleLabel(target)}`;
    }
    const degree = Math.min(3, b + 1);
    return `${cousinPrefix(degree, target)}${grandRelativeLabel(target, gap >= 3)}`;
  }

  const gap = b - a;
  const degree = Math.min(3, a);
  return `${cousinPrefix(degree, target)}${youngerCollateralLabel(target, gap)}`;
}

function directPartnerLabel(person, relation) {
  const kind = relation?.kind || 'partner';
  if (kind === 'divorced') return gendered(person, 'бывший муж', 'бывшая жена', 'бывший супруг');
  if (kind === 'married') return gendered(person, 'муж', 'жена', 'супруг');
  if (kind === 'parents') return 'со-родитель';
  return gendered(person, 'партнёр', 'партнёрша', 'партнёр');
}

export function buildKinshipLabels(family, requestedFocusId) {
  const people = family.people || [];
  const byId = new Map(people.map((person) => [person.id, person]));
  const focusId = byId.has(requestedFocusId) ? requestedFocusId : people[0]?.id || '';
  const { parents, partners } = buildRelations(family);
  const labels = new Map();

  for (const person of people) {
    const label = bloodRelationship(byId, parents, focusId, person.id);
    if (label) labels.set(person.id, label);
  }

  for (const link of partners.get(focusId) || []) {
    const person = byId.get(link.id);
    if (person) labels.set(link.id, directPartnerLabel(person, link.relation));
  }

  const focusPartnerLinks = partners.get(focusId) || [];
  for (const person of people) {
    if (labels.has(person.id)) continue;

    const targetPartnerLinks = partners.get(person.id) || [];
    if (targetPartnerLinks.some((link) => labels.has(link.id))) {
      labels.set(person.id, 'родство по браку');
      continue;
    }

    for (const focusPartnerLink of focusPartnerLinks) {
      if (!bloodRelationship(byId, parents, focusPartnerLink.id, person.id)) continue;
      labels.set(person.id, focusPartnerLink.relation?.kind === 'partner' ? 'родня партнёра' : 'родня супруга');
      break;
    }
  }

  return labels;
}
