describe('list', {viewportHeight: 1320, viewportWidth: 2000}, () => {
  beforeEach(() => {
    cy.visit('/pomoc')
  })

  it('screenshots', () => {
    cy.wait(1500).get("body").matchImageSnapshot()
  })
})
