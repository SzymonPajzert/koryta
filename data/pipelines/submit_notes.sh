#!/usr/bin/env bash
set -e

# Writes the pipeline's notes onto people's pages.
#
#   ./submit_notes.sh                 # against a local dev stack
#   ./submit_notes.sh prod            # against autopush
#
# Today there is one note pipeline: PeopleWikiNotes copies the opening
# paragraph of a person's Wikipedia article onto their page, for the pages that
# already link to that article and whose register date of birth agrees with the
# article's to the day.
#
# `koryta_uploader --type note` reconciles the whole uid at once - it writes
# what changed, leaves what did not, and deletes the note on anybody who no
# longer qualifies. So this is safe to re-run, and re-running it is how a
# corrected Wikipedia link takes the old paragraph off the page.
#
# A prod run asks you to log in through the browser and the account has to be
# in the datascience group - that is what `firestore.rules` lets write a
# pipeline's notes. Set KORYTA_ID_TOKEN to reuse an id token instead.
#
# The lead paragraphs come out of the Wikipedia dump, so a first run has to
# rebuild the wiki chain (~40 minutes for the dump pass):
#
#   uv run koryta PeopleEnriched --refresh ProcessWiki --refresh all

if [[ $1 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi

echo "koryta PeopleWikiNotes | koryta_uploader --type note --submit $SUFFIX"
uv run koryta PeopleWikiNotes --no-backup --output stderr 2>&1 1>/dev/null |
	uv run koryta_uploader --type note --submit $SUFFIX
