/// <reference types="cypress" />

describe('home', () => {
  beforeEach(() => {
    cy.visit('/')
  })

  it('displays three clickable cards', () => {
    cy.get('.v-card').should('have.length', 3)
    cy.get('.v-card').first().contains('Zobacz listę')
    cy.get('.v-card').eq(1).contains('Dodaj osoby')
    cy.get('.v-card').eq(2).contains('Dołącz do projektu')
  })
})
