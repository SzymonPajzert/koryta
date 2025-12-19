import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

process.env.FIREBASE_AUTH_EMULATOR_HOST = 'localhost:9099';
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
      name: 'Test Node 1',
      type: 'person',
      description: 'A test person',
    },
    {
      id: '2',
      name: 'Test Node 2',
      type: 'organization',
      description: 'A test organization',
    },
  ];

  const batch = db.batch();

  for (const node of nodes) {
    const ref = db.collection('nodes').doc(node.id);
    batch.set(ref, node);
  }

  await batch.commit();
  console.log('Database seeded successfully!');

  // Seed Auth User
  const auth = getAuth(app);
  try {
    await auth.createUser({
      uid: 'test-admin',
      email: 'admin@koryta.pl',
      password: 'password123',
      displayName: 'Admin User',
    });
    console.log('Admin user created: admin@koryta.pl / password123');
  } catch (error: any) {
    if (error.code === 'auth/email-already-exists') {
        console.log('Admin user already exists');
    } else {
        throw error;
    }
  }
}

seed().catch((err) => {
  console.error('Error seeding database:', err);
  process.exit(1);
});
