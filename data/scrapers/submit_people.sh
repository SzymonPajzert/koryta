set -e

# Usage: ./submit_people.sh <TERYT> [prod]
#
# ONLY_CHANGED=1 uploads only the people whose payload would write something
# koryta.pl does not already hold. A region submitted before is mostly no-ops,
# and a no-op still costs a request each -- see "Uploading only what changed"
# in the README. Off by default: what it drops is decided against the nightly
# export, so a region uploaded since today's dump would be filtered against
# yesterday's answer.

TERYT=$1
if [[ $2 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi
if [[ -n $ONLY_CHANGED ]]; then
	FILTER="--only-changed"
fi

echo $TERYT
echo $SUFFIX
echo $FILTER

# echo "koryta PeopleEnriched --refresh CompaniesKRS --refresh PeopleKRS --refresh PeopleMerged --refresh PeopleEnriched"
# koryta PeopleEnriched --refresh CompaniesKRS --refresh PeopleKRS --refresh PeopleMerged --refresh PeopleEnriched

echo "koryta PeoplePayloads --region $TERYT --ignore-elections --currently-employed $FILTER | koryta_uploader --type person --submit $SUFFIX"
koryta PeoplePayloads --region $TERYT --ignore-elections --currently-employed $FILTER --output stderr 2>&1 1>/dev/null | koryta_uploader --type person --submit $SUFFIX
echo "koryta PeoplePayloads --region $TERYT $FILTER | koryta_uploader --type person --submit $SUFFIX"
koryta PeoplePayloads --region $TERYT $FILTER --output stderr 2>&1 1>/dev/null | koryta_uploader --type person --submit $SUFFIX
