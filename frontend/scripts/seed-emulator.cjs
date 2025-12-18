var import_app = require("firebase-admin/app");
var import_firestore = require("firebase-admin/firestore");
process.env.FIRESTORE_EMULATOR_HOST = "localhost:8080";
process.env.GCLOUD_PROJECT = "demo-koryta-pl";
const app = (0, import_app.initializeApp)({
  projectId: "demo-koryta-pl"
});
const db = (0, import_firestore.getFirestore)(app);
async function seed() {
  console.log("Seeding database...");
  const batch = db.batch();
  const nodes = [
    {
      id: "1",
      name: "Jan Kowalski",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_tusk",
      name: "Donald Tusk",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_miszalski",
      name: "Aleksander Miszalski",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_patalas",
      name: "Jolanta Patalas",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_misko",
      name: "Rafa\u0142 Mi\u015Bko",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_kaczmarek",
      name: "Kazimierz Kaczmarek",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_zamaro",
      name: "Ma\u0142gorzata Zamaro",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_bartelski",
      name: "Bart\u0142omiej Bartelski",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "person_pastor",
      name: "Piotr Pastor",
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "article_kanalizacja",
      name: "Kanalizacja",
      type: "article",
      sourceURL: "https://example.com/scandal",
      shortName: "Afera",
      estimates: { mentionedPeople: 2 }
    },
    {
      id: "article_koryta_1",
      name: "Afera Korytowa",
      type: "article",
      sourceURL: "https://example.com/scandal",
      shortName: "Afera",
      estimates: { mentionedPeople: 2 }
    },
    {
      id: "place_krakow",
      name: "Miasto Krak\xF3w",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_nfosigw",
      name: "NFO\u015AiGW",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_wfosigw",
      name: "WFO\u015AiGW Krak\xF3w",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_warszawa",
      name: "Miasto Warszawa",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_polimex",
      name: "Polimex-Mostostal",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_wodny",
      name: "Wodny Park Warszawianka",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_ursus",
      name: "Ursus (Warszawa)",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    },
    {
      id: "place_rzad",
      name: "Rz\u0105d",
      type: "place",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    }
  ];
  for (const node of nodes) {
    batch.set(db.collection("nodes").doc(node.id), node);
  }
  const edges = [
    { source: "1", target: "place_krakow" },
    { source: "person_tusk", target: "place_rzad" },
    { source: "person_miszalski", target: "place_krakow" },
    { source: "person_patalas", target: "place_nfosigw" },
    { source: "person_misko", target: "place_nfosigw" },
    { source: "person_kaczmarek", target: "place_nfosigw" },
    { source: "person_zamaro", target: "place_nfosigw" },
    { source: "place_wfosigw", target: "place_nfosigw" },
    { source: "place_wfosigw", target: "place_nfosigw" },
    { source: "person_bartelski", target: "place_warszawa" },
    { source: "person_bartelski", target: "place_polimex" },
    { source: "person_pastor", target: "place_wodny" },
    { source: "person_pastor", target: "place_ursus" },
    { source: "article_kanalizacja", target: "place_krakow" },
    { source: "article_kanalizacja", target: "place_nfosigw" }
  ];
  for (const edge of edges) {
    const id = `${edge.source}-${edge.target}`;
    batch.set(db.collection("edges").doc(id), { ...edge, id, label: "test" });
  }
  for (let i = 0; i < 110; i++) {
    const id = `extra_${i}`;
    batch.set(db.collection("nodes").doc(id), {
      id,
      name: `Extra Node ${i}`,
      type: "person",
      stats: { people: 1 },
      sizeMult: 1,
      color: "#000000"
    });
  }
  await batch.commit();
  console.log("Database seeded successfully!");
}
seed().catch((err) => {
  console.error("Error seeding database:", err);
  process.exit(1);
});
