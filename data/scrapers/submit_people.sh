set -e

TERYT=$1
if [[ $2 == prod ]]; then
	SUFFIX="--prod --endpoint https://autopush.koryta.pl"
fi

echo $TERYT
echo $SUFFIX

# echo "koryta PeopleEnriched --refresh CompaniesKRS --refresh PeopleKRS --refresh PeopleMerged --refresh PeopleEnriched"
# koryta PeopleEnriched --refresh CompaniesKRS --refresh PeopleKRS --refresh PeopleMerged --refresh PeopleEnriched

echo "koryta PeoplePayloads --region $TERYT --ignore-elections --currently-employed | koryta_uploader --type person --submit $SUFFIX" 
koryta PeoplePayloads --region $TERYT --ignore-elections --currently-employed --output stderr 2>&1 1>/dev/null | koryta_uploader --type person --submit $SUFFIX 
echo "koryta PeoplePayloads --region $TERYT | koryta_uploader --type person --submit $SUFFIX"
koryta PeoplePayloads --region $TERYT --output stderr 2>&1 1>/dev/null | koryta_uploader --type person --submit $SUFFIX 
