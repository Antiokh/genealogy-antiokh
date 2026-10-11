const PROFILE_FIELDS = [
  "facts",
  "relatives",
  "relativeFamilies",
  "photos",
  "biography",
  "notes",
  "consistencyIssues",
  "matches",
];

function visitObjects(value, visit, path = "$", seen = new Set()) {
  if (!value || typeof value !== "object" || seen.has(value)) return;
  seen.add(value);
  if (!Array.isArray(value)) visit(value, path);
  for (const [key, child] of Object.entries(value)) {
    visitObjects(child, visit, `${path}.${key}`, seen);
  }
}

function findTree(payload) {
  let result;
  visitObjects(payload, (object, objectPath) => {
    if (!result && Array.isArray(object.personCards)) result = { object, objectPath };
  });
  return result;
}

function findProfile(payload) {
  let result;
  visitObjects(payload, (object, objectPath) => {
    const fields = PROFILE_FIELDS.filter((field) => Object.hasOwn(object, field));
    if (fields.length >= 2 && (!result || fields.length > result.fields.length)) {
      result = { object, objectPath, fields };
    }
  });
  return result;
}

function extractProfile(payload) {
  return findProfile(payload)?.object ?? null;
}

function extractTree(payload) {
  return findTree(payload)?.object ?? null;
}

function firstValue(payload, names, basePath = "$") {
  let result;
  visitObjects(payload, (object, relativePath) => {
    if (result) return;
    for (const name of names) {
      const value = object[name];
      if ((typeof value === "string" || typeof value === "number") && String(value)) {
        const objectPath = relativePath === "$" ? basePath : `${basePath}${relativePath.slice(1)}`;
        result = { value: String(value), field: `${objectPath}.${name}` };
        return;
      }
    }
  });
  return result;
}

function directValue(object, names, objectPath) {
  for (const name of names) {
    const value = object?.[name];
    if ((typeof value === "string" || typeof value === "number") && String(value)) {
      return { value: String(value), field: `${objectPath}.${name}` };
    }
  }
  return undefined;
}

function classifyPayload(payload) {
  const tree = findTree(payload);
  if (tree) {
    const cardIds = tree.object.personCards
      .map((card) => card && (card.id ?? card.individualId ?? card.individualID))
      .filter((id) => id !== undefined && id !== null);
    const treeSize = firstValue(tree.object, ["familyTreeSize", "treeSize", "familySize"]);
    const rootId = firstValue(tree.object, ["rootIndividualID", "rootIndividualId", "rootId"]);
    return {
      kind: "tree",
      personCount: cardIds.length,
      familyTreeSize: treeSize ? Number(treeSize.value) || treeSize.value : null,
      rootIndividualId: rootId?.value ?? null,
    };
  }

  const profile = findProfile(payload);
  if (profile) {
    const id = directValue(
      profile.object,
      ["individualID", "individualId", "individual_id", "personId", "personID"],
      profile.objectPath,
    );
    return {
      kind: "profile",
      fields: profile.fields,
      personId: id?.value ?? null,
      personIdField: id?.field ?? null,
    };
  }

  return { kind: "other" };
}

module.exports = { classifyPayload, extractProfile, extractTree };
