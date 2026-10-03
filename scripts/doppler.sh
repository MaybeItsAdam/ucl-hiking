#!/bin/sh
# The club's Doppler CLI: `doppler-hiking` (your own Doppler login kept apart,
# see README) when it's installed, otherwise plain `doppler` signed in to the
# UCL Hiking Club workplace. Always the hiking-webapp project, prd config:
# local dev reads the production database anyway.
if command -v doppler-hiking >/dev/null 2>&1; then cli=doppler-hiking; else cli=doppler; fi
exec "$cli" "$@"
