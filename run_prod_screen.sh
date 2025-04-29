#!/usr/bin/env bash
# Check if the file 'data/config/repo_config.json' exists; if not, create a blank file.
if [ ! -f "data/config/repo_config.json" ]; then
    mkdir -p data/config
    touch data/config/repo_config.json
fi

SCREEN_NAME="alfePROD"

# Start a detached screen session with the custom name, then run your production script
screen -S "$SCREEN_NAME" -dm bash -c "./run_prod.sh"
