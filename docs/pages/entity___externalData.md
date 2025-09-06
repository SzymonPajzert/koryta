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
		- ID - Link to [[Google/Storage]]
		- Type
	- TODO Contains extracted values from the storage
		- [[entity/externalData/company/name]]
		- [[entity/externalData/company/krs]]
		- [[entity/externalData/company/regon]]
		- [[entity/externalData/company/nip]]
		- [[entity/externalData/person/name]]
		- [[entity/externalData/person/birthYear]]
		- [[entity/externalData/location/city]]
		- [[entity/externalData/location/commune]]
	-