-
- TODO Add this to documentation somewhere as well
-
- TODO Implement extractors of #dane
	- TODO Ingest [[dane/artykuły]]
		- Can yield multiple per data entry
	- TODO Ingest [[dane/krs]]
	- TODO Ingest [[dane/pkw]]
	  :LOGBOOK:
	  CLOCK: [2025-09-07 Sun 12:12:38]--[2025-09-07 Sun 12:12:39] =>  00:00:01
	  :END:
	- TODO Ingest [[dane/wiki]]
-
- Model
	- Source - corresponds to [[dane]]
		- ID - Link to [[Cloud Storage]]
		- Type
	- TODO Contains extracted values from the storage
		- [[entity/record/company/name]]
		- [[entity/record/company/krs]]
		- [[entity/record/company/regon]]
		- [[entity/record/company/nip]]
		- [[entity/record/person/name]]
		- [[entity/record/person/birthYear]]
		- [[entity/record/location/city]]
		- [[entity/record/location/commune]]
	-