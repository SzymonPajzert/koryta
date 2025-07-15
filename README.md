# Koryta.pl

This project uses

- [jj](https://github.com/jj-vcs/jj) because git is bad
- Vue + Vite framework
- UI libraries
  - Vuetify components
  - apex chart for the chart in the home page
  - v-network-graph for the /graf page
- Firebase for the backend, but specifically
  - Realtime Database (no SQL, JSON, reactive and obserable)
    - Some copy of the prod data listed in /database - this is a fairly accurate state of the DB
  - Firebase hosting
  - Firebase cloud functions (currently one, all defined in /functions directory)
- Testing
  - Cypress snapshot testing (mainly to have screenshots for comparing changes)
  - Firebase emulators for local development (https://firebase.google.com/docs/emulator-suite)

## Testing

You can run everything with:

```
npm run import-db && npm run dev:emulate
```

And then access either a Vite build on `localhost:3000` or Firebase emulated at `localhost:5002`

Run tests through

```
npx cypress run
```
