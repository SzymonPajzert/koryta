import time
import json

import streamlit as st
import pandas as pd
import plotly.express as px

from stores.redis import get_redis_client, LOG_KEY
from util.config import versioned


st.set_page_config(layout="wide")
st.title("🌐 Real-Time URL Monitoring Dashboard")

r = get_redis_client()

for request_log in versioned.read_jsonl("request_logs.jsonl"):
    json_log = json.dumps(request_log)
    # Log to Redis List using RPUSH
    r.rpush(LOG_KEY, json_log)


def fetch_and_process_data(r_client):
    """Fetches all logs from Redis and processes them into a DataFrame."""
    if not r_client:
        return pd.DataFrame()

    # Fetch all items from the Redis List (Lrange)
    all_logs_json = r_client.lrange(LOG_KEY, 0, -1)

    if not all_logs_json:
        return pd.DataFrame()

    # Parse JSON and create a list of dictionaries
    records = [json.loads(log) for log in all_logs_json]

    # Convert to DataFrame
    df = pd.DataFrame(records)

    # Ensure proper data types
    df["timestamp"] = pd.to_datetime(df["time"])
    df["status_code"] = df["response_code"].astype(str)

    # Determine if the request was an error
    # HTTP status codes 4xx and 5xx are generally errors. We also include 599 (our custom error)
    df["is_error"] = df["status_code"].apply(
        lambda x: x.startswith("4") or x.startswith("5")
    )

    return df


# This container allows us to refresh the content without the entire page blinking
placeholder = st.empty()

with placeholder.container():
    st.header("Live Request Statistics")

    # 1. Fetch Data
    df = fetch_and_process_data(r)

    if df.empty:
        st.info("Waiting for the monitoring worker to generate data...")
    else:
        # Get the latest timestamp for display
        latest_time = df["timestamp"].max().strftime("%Y-%m-%d %H:%M:%S")
        st.caption(f"Last update from worker: **{latest_time}**")

        # --- Aggregated Statistics ---

        # Total Requests
        total_requests = len(df)

        # Error Rate calculation
        total_errors = df["is_error"].sum()
        error_rate = (total_errors / total_requests) * 100 if total_requests else 0

        # Average Latency calculation
        # avg_latency = df[~df["is_error"]]["duration"].mean()

        col1, col2, col3 = st.columns(3)
        col1.metric("Total Requests", total_requests)
        # TODO
        # col2.metric(
        #     "Average Latency (ms)", f"{avg_latency:.2f}" if avg_latency else "N/A"
        # )
        col3.metric(
            "Error Rate (%)", f"{error_rate:.2f}%", delta_color="inverse"
        )  # Red for high errors

        st.markdown("---")

        # --- Latency Graph (Time Series) ---
        st.subheader("Latency Over Time (Successful Requests)")

        latency_df = df[~df["is_error"]].copy()

        if not latency_df.empty:
            fig_latency = px.line(
                latency_df,
                x="timestamp",
                y="latency_ms",
                color="url",
                title="Request Latency (ms)",
            )
            st.plotly_chart(fig_latency, use_container_width=True)

        # --- Error Rate Graph (Bar Chart) ---
        st.subheader("Error Rate by URL")

        # Group data by URL and calculate error rate
        error_summary = (
            df.groupby("url")
            .agg(total_count=("url", "size"), error_count=("is_error", "sum"))
            .reset_index()
        )

        error_summary["error_percentage"] = (
            error_summary["error_count"] / error_summary["total_count"]
        ) * 100

        fig_errors = px.bar(
            error_summary,
            x="url",
            y="error_percentage",
            color="error_percentage",
            color_continuous_scale=px.colors.sequential.Reds,
            title="Percentage of Errors per Monitored URL",
        )
        st.plotly_chart(fig_errors, use_container_width=True)

# Important: This tells Streamlit to rerun the script every 5 seconds to fetch new data
time.sleep(5)
st.rerun()
