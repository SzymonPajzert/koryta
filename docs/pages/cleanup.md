- See also [[testing]]
-
- DONE [[Enable emulators]]
  :LOGBOOK:
  CLOCK: [2025-09-15 Mon 16:32:32]--[2025-09-15 Mon 16:32:32] =>  00:00:00
  :END:
	- TODO Download data automatically
		- We can configure firebase.json to automatically import data on startup.
		- Using import property, we can run database/import_database.sh
-
- TODO Enable firebase crashlytics
	- Log all console.error and console.warn
- TODO Set up staging auth fake DB and everything
- LATER test in github actions that all of firebase parts build (e.g. functions didn't)
- TODO Test regularly that it looks nice on the phone
- LATER Check title in the cypress tests
- LATER Minify web bundle
- LATER Github workflows are failing
- LATER Log client failures somewhere #firebase #strona
- LATER Migrate from record to map in entity lookup code [[Migrate to firestore]]
- LATER Don't use document.title