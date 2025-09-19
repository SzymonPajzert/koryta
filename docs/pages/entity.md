- Modeled in #Firestore or #Google/RTDB
-
- TODO Some new entities
	- Connection
	- Task
	- Wpis
		- E.g. #entity/tag afera, such as
			- #[[Politycy z Warszawy przeciwko stopalko]]
			- [[Rozdane pieniądze z KPO]]
-
- TODO Migrate entities away from #RTDB - [[Migrate to firestore]]
	- LATER Remove Company.owner and manager fields
		- https://github.com/SzymonPajzert/koryta/issues/44
-
- [[pages/pomoc/problemy]] checks that all nodes are good
-
- | Entity | Where modeled |
  | --- | --- |
  | #entity/person | #RTDB |
  | #entity/company | #RTDB |
  | #entity/article | #RTDB |
  | #entity/task | Doesn't exist |
-
- {{embed [[Entities relations]]}}