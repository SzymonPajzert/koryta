Tests
- enter lista, click the first edit button as an admin, see what is shown
- try to edit a value and see that it's
  - modified in the db
  - if you check the value in the list, it's there
- just adding any element in each of the abstract dialog views
- adding a connection to an existing for each joined
  - how to even list them and make sure we have all of them

Cleanup
- Listview should be moved to the page, and the subcomponents cleaned up
- ListView is duplicated with the UserDialog - it should use a common component
- Don't allow TODOs while compiling
- Don't allow console.log while compiling
- Each dialog should have their concrete model type defined