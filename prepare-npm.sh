#!/bin/bash
# Prepare NPM package with embedded submodules

# Update and initialize submodules
git submodule update --init --recursive

# Remove .git references from deps to avoid npm pack issues  
find deps -name ".git" -exec rm -rf {} + 2>/dev/null || true

echo "Package ready for npm publish"
