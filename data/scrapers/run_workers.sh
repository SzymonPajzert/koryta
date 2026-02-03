#!/bin/bash

# This script runs N crawler workers in tmux sessions.
# Usage: ./run_workers.sh [number_of_workers]

NUM_WORKERS=${1:-1} # Default to 1 worker if no argument is provided
SESSION_NAME="koryta-crawler"

echo "Starting $NUM_WORKERS crawler workers in tmux session '$SESSION_NAME'..."

# Create a new tmux session
tmux new-session -d -s $SESSION_NAME

for i in $(seq 1 $NUM_WORKERS); do
    WORKER_ID="worker-$i"
    echo "Starting $WORKER_ID in a new tmux window..."

    # Create a new window for each worker
    tmux new-window -t $SESSION_NAME:$i -n $WORKER_ID

    # Send the command to the new window
    # Assuming the script is run from the 'scrapers' directory
    tmux send-keys -t $SESSION_NAME:$i "source .env/bin/activate" C-m
    tmux send-keys -t $SESSION_NAME:$i "poetry run python src/scrapers/article/crawler.py --worker-id $WORKER_ID" C-m
done

echo "Workers started. To attach to the tmux session, run: tmux attach -t $SESSION_NAME"
echo "To see the individual worker windows, use: Ctrl+b, then n (next window) or p (previous window)."
echo "To detach from the session, use: Ctrl+b, then d."
