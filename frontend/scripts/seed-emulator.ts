import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';

process.env.FIRESTORE_EMULATOR_HOST = 'localhost:8080';
process.env.GCLOUD_PROJECT = 'demo-koryta-pl';

const app = initializeApp({
  projectId: 'demo-koryta-pl',
});

const db = getFirestore(app, "koryta-pl");

async function seed() {
  console.log('Seeding database...');

  const nodes = [
    {
      id: '1',
      type: 'person',
      name: 'Jan Kowalski',
      parties: ['PiS', 'Konfederacja'],
      description: 'A politician',
    },
    {
      id: '2',
      type: 'person',
      name: 'Anna Nowak',
      parties: ['PO', 'Nowa Lewica'],
      description: 'A business owner',
    },
    {
      id: '3',
      type: 'place',
      name: 'Koryta Inc.',
      krsNumber: '0000123456',
      nipNumber: '1234567890',
      description: 'A shadowy company',
    },
    {
      id: '4',
      type: 'article',
      name: 'Wielka Afera',
      sourceURL: 'https://example.com/scandal',
      shortName: 'Afera',
      estimates: { mentionedPeople: 2 },
    },
  ];

  const edges = [
    { id: 'e1', source: '1', target: '3', type: 'employed', name: 'CEO' },
    { id: 'e2', source: '2', target: '3', type: 'owns', name: 'Shareholder' },
    { id: 'e3', source: '4', target: '1', type: 'mentions' },
    { id: 'e4', source: '4', target: '2', type: 'mentions' },
  ];

  const batch = db.batch();

  for (const node of nodes) {
    const ref = db.collection('nodes').doc(node.id);
    batch.set(ref, node);
  }

  for (const edge of edges) {
    const ref = db.collection('edges').doc(edge.id);
    batch.set(ref, edge);
  }

  await batch.commit();
  console.log('Database seeded successfully!');
}

seed().catch((err) => {
  console.error('Error seeding database:', err);
  process.exit(1);
});
