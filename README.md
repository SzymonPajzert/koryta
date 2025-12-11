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
- [Logseq](https://logseq.com) for future big ideas and notes.
  - Anything that we don't want to loose but doesn't have a concrete shape yet.
  - If possible, we should migrate away from it to a more collaborative tool - TBD.
  - You can download it from https://logseq.com/downloads.
  - After installing, add the ./docs folder as a graph. -[this](logseq://graph/docs?page=2025-09-06) link after configuration should open the app for you.

## Project structure

### `docs` - Folder containing Logseq documentation

I'm a single guy, with lots of ideas and not enough time to implement them. I try to organize them in this folder and you can you can click [this](logseq://graph/docs?page=2025-09-06) to get started (after setting up Logseq)

The journal pages are not saved in the repository (files in ./docs/journals), so you can put there any notes you have.

Then you can move anything that is of value to its own page - https://discuss.logseq.com/t/how-to-create-pages-in-logseq/8433.

### `data` - Python infrastructure to mine the data

- `data/scrapers`- **has README** - Poetry project containing the infrastructure
- `data/leads` - Logseq directory, containing notes on missing people. While the website is not fully functional, this is a best place to write down in a semi-organized way information about missing people. Those files are used to filter out failing test cases.

### UI related (multiple dirs)

- `frontend` - **has README** - NUXT framework definition of the UI
- `cypress` - Cypress snapshot testing (mainly to have screenshots for comparing changes)
- `database` - Some copy of the prod data listed there, it's a fairly accurate state of the DB
- `functions` - Currently a single function, used to fetch the name of the article in the UI
