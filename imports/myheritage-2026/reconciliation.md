# Reconciliation of detached and source-text-only relatives

Audit date: 2026-10-11.

## Inputs checked

- MyHeritage snapshots dated 2022-02-15, 2023-05-11, 2023-11-25, and 2026-09-10.
- The separate `genotek_full.ged` export.
- The repository snapshot under `demos/anton-family` and the canonical person records under `src/content/docs/people`.

Raw GEDCOMs remain private and are not committed.

## Explicit GEDCOM graph

No explicit `FAM` parent/child or spouse edge present in the older MyHeritage snapshots disappeared from the 2026 snapshot for people that still exist in that snapshot. The apparent detachments therefore are not primarily an importer regression.

The 2026 MyHeritage graph contains one non-technical two-person component outside the main tree:

- Louise Charlotte Gerdau (`I500162`)
- Georg Gottfried Erasmus Büsch (`I500164`)

Their family record has Louise as `WIFE` and Georg as `CHIL`, but no `HUSB`. Louise also has a marriage event dated approximately 1833–1834 while Georg was born on 16 July 1832. This does not identify Georg's father and is not enough to connect the Gerdau/Büsch component to the main Büsch/Busch branch. No bridge is asserted until a source names that parent or spouse.

The GEDCOM source metadata points to FamilySearch person IDs `176977591` (Louise) and `176977619` (Georg). These identifiers are preserved here as research leads; they do not themselves establish the missing parent link. The Erik-Amburger name index independently corroborates a Luise Charlotte Gerdau in St Petersburg, but the public index entry inspected does not establish her parents or Georg's father.

### Büsch/Busch research leads

The placeholder `I500222` (`Jохан Юлиус Буш`), father of Woldemar Carl Chrostopher Bush, can be identified with high confidence as **Johann Julius Adolf Busch / Юлий Адольфович Буш (1823–1896)**. Erik-Amburger records Johann Julius Adolf Busch and separately a merchant `Woldemar / Vladimir Jul.` born in 1855. An independent St Petersburg local-history source names Юлий Адольфович Буш and lists his sons, including Владимир Юльевич. This identity is promoted to the canonical person record, but his own parents remain unknown.

A plausible candidate around the detached Gerdau/Büsch component is **Agathon Büsch (1801–1873)**: he was born in Wolmar and later served as a physician and state councillor in St Petersburg. Those two locations overlap unusually well with Louise Charlotte Gerdau (from Wolmar, later St Petersburg), and his surname matches Georg. However, no source inspected so far directly names Agathon as Louise's spouse or Georg's father. He therefore remains a research lead only; no edge is added.

## Relations recovered from embedded source text

MyHeritage also stores relationship prose inside individual `SOUR/DATA/TEXT` blocks. The snapshot importer previously ignored this layer completely.

Applied to the canonical graph:

- `I500227`, an unnamed woman in explicit family `F500079`, is identified by Peter Bartmer's Record Match as **София Константиновна Бартмер (Сойникова)**. The explicit family already makes her Peter's wife and Evgenia's mother.
- **Albert Karl Adolf Lobeck** is named as husband in both Johanna-Maria Bartmer's and Ottilia-Maria Bartmer's records. The first marriage is approximately September 1871; the second is 5 August 1879, after Johanna-Maria's death in 1878.
- **Wilhelmine Kerkovius (Lobeck)** is explicitly named as Ottilia-Maria's child in the same Record Match.
- **Елизавета Николаевна Бартмер (Бёттхер)** is named as Apollinarius/Apollo Bartmer's wife in the Record Match and independently corroborated by the published index of St Petersburg metric records for their 1886 marriage.

The reconciliation is declarative in `reconciled-relations.json` and reapplied by `scripts/apply-reconciled-relations.mjs` after every snapshot import. Supplemental external-to-canonical mappings recovered from source text are kept in the reconciliation ledger and are merged into `mapping.json` by that step; the base snapshot mapping remains a faithful projection of the explicit demo snapshot.

## Claims kept pending rather than promoted to canonical relations

The following source-text claims are preserved for research but are not asserted as canonical relationships yet:

- Alexander-Eduard Bartmer's parents: **Georg Friedrich Bartmer (Bahrtmer)** and **Anna Maria Bartmer (Heinicke)**. The names come from one embedded match and need identity disambiguation before assigning parent IDs.
- Peter Alexandrovich Bartmer's additional children: **Andrey Petrovich Bartmer** and **Sergey Petrovich Bartmer**. They appear in source prose but not in explicit family `F500079`.
- Otto Alexandrovich Bartmer's wife **Emilia-Anna-Christina Bartmer (Müller)** and children **Petr Ottovich Bartmer** and **Johanna-Amalia Bartmer**.
- Apollinarius Bartmer's children **Nina Apollonovna Bartmer** and **Boris Apollinarievich Bartmer**. The spouse is corroborated independently; the children still need a second identifying source before new canonical people are created.
- Any father/spouse that would connect Louise Charlotte Gerdau and Georg Gottfried Erasmus Büsch to the main Büsch/Busch component.

This split is intentional: source claims are retained, but uncertain identity merges are not converted into genealogy facts merely to make the graph connected.
