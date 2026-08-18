/** Region node for a TERYT code, or null when there is none.
 *
 * Codes longer than a powiat are truncated to one, which is the level the
 * region nodes are complete at. Returns null rather than throwing so a bulk
 * ingest is not aborted by a single unmappable seat.
 *
 * Both lookups are needed. The region nodes the TERYT pipeline wrote carry the
 * code in their document id (`teryt1610`), which costs one point read; the ones
 * that predate it carry it in a `teryt` field, which needs a query. Trying the
 * id first is what keeps the common case off the query path.
 */
export async function findRegionByTeryt(
  db: FirebaseFirestore.Firestore,
  terytArg: string,
): Promise<string | null> {
  const teryt = terytArg.length > 4 ? terytArg.slice(0, 4) : terytArg;
  const regionNodeId = `teryt${teryt}`;
  const nodeWithTerytID = db.collection("nodes").doc(regionNodeId);
  if ((await nodeWithTerytID.get()).exists) {
    return regionNodeId;
  }

  const nodeWithTerytField = db
    .collection("nodes")
    .where("teryt", "==", teryt)
    .limit(1);
  const snapshot = await nodeWithTerytField.get();
  if (!snapshot.empty && snapshot.docs[0]) {
    return snapshot.docs[0].id;
  }

  return null;
}
