import './commands'

beforeEach(() => {
    // block google analytics/installations for local testing to avoid 400/403
    cy.intercept("POST", "**/firebaseinstallations.googleapis.com/**", {
        forceNetworkError: true
    }).as("mockInstallations");

    cy.intercept("POST", "**/firebase.googleapis.com/**", {
        statusCode: 200,
        body: {}
    }).as("mockAnalytics");

    // Ignore Firebase internal errors
    cy.on('uncaught:exception', (err, runnable) => {
        if (err.message.includes('Analytics') || err.message.includes('Installations') || err.message.includes('App not found')) {
            return false;
        }
    });
});;

import '@percy/cypress';
import { addMatchImageSnapshotCommand } from '@simonsmith/cypress-image-snapshot/command';

addMatchImageSnapshotCommand();
