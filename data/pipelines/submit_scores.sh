#!/usr/bin/env bash
set -e

# Runs every scoring model and uploads each one's shortlist under its own
# pipeline uid, so the site can tell which model nominated whom.
#
#   ./submit_scores.sh                    # against a local dev stack
#   ./submit_scores.sh prod               # against autopush
#   ./submit_scores.sh "" PeopleScoresPageRank   # one model only
#
# Each model is uploaded separately on purpose: `koryta_uploader --type score`
# reconciles a whole model at once, writing only what changed and retracting
# what the model no longer stands behind, and it can only do that for one model
# per run.
#
# A prod run asks you to log in through the browser, once per model, and the
# account has to be in the datascience group - that is what `firestore.rules`
# lets write a pipeline's votes. Set KORYTA_ID_TOKEN to reuse one id token
# instead of logging in for every model.

if [[ $1 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi

function run_koryta() {
	echo "koryta $@ --no-backup --no-mirror"
	DISABLE_BACKUP=1 uv run koryta "$@" --no-backup --no-mirror
}

MODELS=${2:-"PeopleScores PeopleScoresPageRank PeopleScoresCoappointment PeopleScoresTurnover PeopleScoresSuccession PeopleScoresCapture PeopleScoresFacts"}

run_koryta PeopleEnriched --refresh :ProcessWiki --refresh all

echo "Prerunning the models"
for MODEL in $MODELS; do
	echo "koryta $MODEL --no-backup --all"
	uv run koryta "$MODEL"  --no-backup --all
done

for MODEL in $MODELS; do
	echo "koryta $MODEL | koryta_uploader --type score --submit $SUFFIX"
	uv run koryta "$MODEL"  --no-backup --all --output stderr 2>&1 1>/dev/null |
		uv run koryta_uploader --type score --submit $SUFFIX
done
