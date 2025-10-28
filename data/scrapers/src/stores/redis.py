import streamlit as st
import redis
import sys

REDIS_HOST = "localhost"
REDIS_PORT = 6379

# List to add request logs to
LOG_KEY = "request_logs"

# Set of URLs to visit
URL_SET_KEY = "urls_to_visit"

# Redis sorted set by the timestamp of the last visited
DOMAIN_TIMES_KEY = "domain_last_visited"


# --- Redis Connection & Data Fetching ---
@st.cache_resource
def get_redis_client():
    """Create a single, cached Redis connection."""
    try:
        r = redis.Redis(host=REDIS_HOST, port=REDIS_PORT, decode_responses=True)
        r.ping()
        return r
    except Exception:
        st.error(
            "🚨 Could not connect to Redis. Please ensure Redis server is running."
        )
        sys.exit(1)
