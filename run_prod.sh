#!/usr/bin/env bash
# Check if the file 'data/config/repo_config.json' exists; if not, create a blank file.
if [ ! -f "data/config/repo_config.json" ]; then
    mkdir -p data/config
    touch data/config/repo_config.json
fi

clear
bash -c "npm install"
node executable/server_webserver.js
