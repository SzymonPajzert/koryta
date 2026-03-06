# Koryta.pl

This documentation outlines the project's structure and the technologies used. Refer to the README files in each directory for more thorough overview of each part.

## Technologies

This project uses the following technologies:

- [jj (jiujitsu)](https://github.com/jj-vcs/jj) for version control, because git is bad. You can probably still use git, but that's why there are a lot of `push-*` branches and forced updates in the pull requests.
- NUXT framework for UI (Vue, Vite and other magic), along the libraries:
  - Vuetify components
  - apex chart for the chart in the home page
  - v-network-graph for the /graf page
- Firebase to serve the website, with locally emulated:
  - Firestore and Realtime Database (no SQL, JSON, reactive and obserable)
  - Firebase hosting
  - Firebase cloud functions

## Project structure

### `data` - Python infrastructure to mine the data

- `data/scrapers`- **has README** - Poetry project containing the infrastructure

### UI related (multiple dirs)

- `frontend` - **has README** - NUXT framework definition of the UI
- `cypress` - Cypress snapshot testing (mainly to have screenshots for comparing changes)
- `database` - Some copy of the prod data listed there, it's a fairly accurate state of the DB
- `functions` - Currently a single function, used to fetch the name of the article in the UI
