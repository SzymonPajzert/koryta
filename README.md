# Koryta.pl

## Testing
First make the code auto update with

```
npm run watch
```

Run to start a prepopulated DB

```
firebase emulators:start --import=database
```

or start an empty instance

```
firebase emulators:start
```

Run tests through

```
npx cypress run
```