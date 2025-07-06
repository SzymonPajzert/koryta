describe('list', () => {
  beforeEach(() => {
    cy.visit('/list')
  })

  it('screenshots', () => {
    cy.wait(1500).get("body").matchImageSnapshot()
  })
})
