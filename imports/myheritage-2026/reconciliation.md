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

Their family record has Louise as `WIFE` and Georg as `CHIL`, but no `HUSB`. Louise also has a marriage event dated approximately 1833–1834 while Georg was born on 16 July 1832. This does not identify Georg's father and is not enough to connect the Gerdau/Büsch component to the main Büsch/Bush branch. No bridge is asserted until a source names that parent or spouse.

The GEDCOM source metadata points to FamilySearch person IDs `176977591` (Louise) and `176977619` (Georg). These identifiers are preserved here as research leads; they do not themselves establish the missing parent link. The Erik-Amburger name index independently corroborates a Luise Charlotte Gerdau in St Petersburg, but the public index entry inspected does not establish her parents or Georg's father.

## Records anonymized in the latest snapshot

The 2026 GEDCOM contains 20 individual records whose `NAME` is empty (`//`). Nineteen of them were already unnamed in every earlier MyHeritage snapshot in which they occur. One record is different:

- `I500096` is **Василий Веждевенский** in the snapshots dated 2022-02-15, 2023-05-11 and 2023-11-25, but becomes `NAME //` in the 2026 snapshot.
- Its XREF, `_UID 61FD665AA4A50B35565879C306564A2B`, sex, death flag and `FAMS @F500041@` remain stable.
- `F500041` is also stable across all four snapshots and always contains `HUSB @I500096@` plus `CHIL @I500057@`.

The name and relationship are therefore restored canonically: Василий Веждевенский is recorded as the father of Нонна Веджневецкая (`I500057`). This is a recovery from version history of the same external record, not a fuzzy identity merge.

The remaining 19 unnamed 2026 records are not assigned invented identities. Some have family context, but neither the older MyHeritage snapshots nor the checked Genotek export provide enough identifying evidence to name them safely.

## Relations recovered from embedded source text

MyHeritage also stores relationship prose inside individual `SOUR/DATA/TEXT` blocks. The snapshot importer previously ignored this layer completely.

Applied to the canonical graph:

- `I500227`, an unnamed woman in explicit family `F500079`, is identified by Peter Bartmer's Record Match as **София Константиновна Бартмер (Сойникова)**. The explicit family already makes her Peter's wife and Evgenia's mother.
- **Albert Karl Adolf Lobeck** is named as husband in both Johanna-Maria Bartmer's and Ottilia-Maria Bartmer's records. The first marriage is approximately September 1871; the second is 5 August 1879, after Johanna-Maria's death in 1878.
- **Wilhelmine Kerkovius (Lobeck)** is explicitly named as Ottilia-Maria's child in the same Record Match.
- **Елизавета Николаевна Бартмер (Бёттхер)** is named as Apollinarius/Apollo Bartmer's wife in the Record Match and independently corroborated by the published index of St Petersburg metric records for their 1886 marriage.

The reconciliation is declarative in `reconciled-relations.json` and reapplied by `scripts/apply-reconciled-relations.mjs` after every snapshot import. Supplemental external-to-canonical mappings recovered from source text or snapshot history are kept in the reconciliation ledger and are merged into `mapping.json` by that step; the base snapshot mapping remains a faithful projection of the explicit demo snapshot.

## Claims kept pending rather than promoted to canonical relations

The following source-text claims are preserved for research but are not asserted as canonical relationships yet:

- Alexander-Eduard Bartmer's alleged parents: **Georg Friedrich Bartmer (Bahrtmer)** and **Anna Maria Bartmer (Heinicke)**. The claim comes from one embedded Record Match. The obvious Georg Friedrich Bartmer candidate in the Erik-Amburger index is recorded as 29 May 1768–1792, whereas Alexander-Eduard was born in 1812, so that candidate cannot be his father. A different same-name Georg Friedrich would need independent identification before any parent link is created.
- Peter Alexandrovich Bartmer's additional children: **Andrey Petrovich Bartmer** and **Sergey Petrovich Bartmer**. They appear in source prose but not in explicit family `F500079`.
- Otto Alexandrovich Bartmer's wife **Emilia-Anna-Christina Bartmer (Müller)** and children **Petr Ottovich Bartmer** and **Johanna-Amalia Bartmer**.
- Apollinarius Bartmer's children **Nina Apollonovna Bartmer** and **Boris Apollinarievich Bartmer**. The spouse is corroborated independently; the children still need a second identifying source before new canonical people are created.
- Any father/spouse that would connect Louise Charlotte Gerdau and Georg Gottfried Erasmus Büsch to the main Büsch/Bush component.

This split is intentional: source claims are retained, but uncertain identity merges are not converted into genealogy facts merely to make the graph connected.
