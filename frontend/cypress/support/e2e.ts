// Import commands.js using ES2015 syntax:
// import './commands';
import '@percy/cypress';
import { addMatchImageSnapshotCommand } from '@simonsmith/cypress-image-snapshot/command';

addMatchImageSnapshotCommand();
