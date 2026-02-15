export function anyNode(node: any) {
  return {
    name: node.name || "",
    type: node.type,
    parties: node.parties || [],
    content: node.content || "",
    sourceURL: node.sourceURL || "",
    shortName: node.shortName || "",
    wikipedia: node.wikipedia || "",
    rejestrIo: node.rejestrIo || "",
  };
}

export function anyEdge(node: any) {
  return {
    name: node.name || "",
    type: node.type,
    content: node.content || "",
    start_date: node.start_date || null,
    end_date: node.end_date || null,
    references: node.references || [],
    deleted: node.deleted || false,
    delete_reason: node.delete_reason || null,
  };
}
