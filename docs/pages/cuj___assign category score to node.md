- Assign a map field value in [[Firestore/nodes]]
	- TODO Add security rules
	  collapsed:: true
		- ```
		  rules_version = '2';
		  
		  service cloud.firestore {
		    match /databases/{database}/documents {
		  
		      // Match any document in the 'game_levels' collection
		      match /game_levels/{levelId} {
		  
		        // Anyone can read the level information and the scores
		        allow read: if true;
		  
		        // Rules for writing (creating/updating) scores
		        allow update: if request.auth != null && canWriteScore(request.resource.data.scores, resource.data.scores);
		  
		      }
		  
		      // Helper function to check the score update logic
		      function canWriteScore(incomingScores, existingScores) {
		        // The user can only add or change their own score. The key must be their UID.
		        let userScoreKey = request.auth.uid;
		  
		        // Ensure the incoming score is a number
		        let isScoreValid = incomingScores[userScoreKey] is number;
		  
		        // Create a new map of existing scores but without the user's current score
		        let otherScores = existingScores.diff(map.from({userScoreKey: existingScores[userScoreKey]}))
		  
		        // Check that no other scores were changed
		        let otherScoresUnchanged = incomingScores.diff(map.from({userScoreKey: incomingScores[userScoreKey]})) == otherScores;
		  
		        return isScoreValid && otherScoresUnchanged;
		      }
		    }
		  }
		  ```
- Integrate this data in [[BigQuery]] - add it to [[Data lake]]