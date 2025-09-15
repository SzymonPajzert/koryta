- LATER implement it
-
- Leverage a tool built for exactly this purpose. You likely already have Google Analytics (GA4) for general traffic monitoring.
  
  **How it works:**
- **Track Views:** Ensure your Nuxt app is correctly configured with Google Analytics to track page views for each article URL.
- **Get Data:** Use the Google Analytics Data API to programmatically fetch the most viewed pages over a specific period (e.g., last 24 hours, last 7 days).
- **Update Firestore:** A scheduled Cloud Function can run periodically (e.g., once every hour or once a day), call the GA API, get the list of popular articles, and then store that curated list in a dedicated Firestore document (e.g., `/feeds/popularArticles`).
- **Display Feed:** Your Nuxt app reads this single `/feeds/popularArticles` document. This is extremely cheap—just one document read for every user who loads the feed.
- **Pros:**
	- **Free (usually):** Google Analytics is free, and the API calls from a scheduled function will likely fall within the free tier.
	- **Powerful Analytics:** You get all the power of GA, including filtering bots, checking time-on-page, bounce rate, etc., which gives you a much better metric for "popularity" than raw views.
	- **Zero Writes on Page Load:** Your production database is not touched by view-tracking traffic at all.
- **Cons:**
	- **Significant Lag:** Data in the GA API can have a lag of several hours to a full day. This is not suitable if you need up-to-the-minute popularity.
	- **External Dependency:** Relies on the Google Analytics API and requires setting up API credentials and permissions.
	- **Implementation Complexity:** Setting up the OAuth or service account for the API call can be more complex than a pure-Firebase solution.