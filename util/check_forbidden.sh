#!/bin/bash
# Check files for forbidden patterns:
#
#   TO-DOs (without a link to a Github bug)
#   console.log() use console.debug instead or just don't

grep -r -n \
    -E 'TODO|console.log' \
    --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.jj \
    --exclude-dir=dist --exclude-dir=.nuxt --exclude-dir=.output \
    --exclude-dir=wiki --exclude-dir=venv12 --exclude-dir=.venv \
    --exclude=check_forbidden.sh \
    . | grep -vE 'TODO\(https://github.com/SzymonPajzert/koryta/issues/[0-9]+\)'