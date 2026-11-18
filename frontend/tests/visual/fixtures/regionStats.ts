import type { RegionStat } from "../../../server/utils/regionStats";

/** A stand-in for `/api/stats/regions`, for the captures of the home map.
 *
 * WHY A FIXTURE AND NOT THE SEED. The seeded world has a handful of people in
 * a handful of powiaty, so the map would be one party in two places and grey
 * everywhere else, and no step of a share would ever show.
 *
 * WHAT IT IS. Production's powiaty on the 2026-11-18 15:29 export: people per
 * powiat and the party each is drawn in, as /api/stats/computeNodes counts
 * them. One line a powiat: teryt | name | people | party:count, most first.
 */
const LINES = `
0201|Powiat bolesławiecki|21|PO:7,PiS:5,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PSL:1
0202|Powiat dzierżoniowski|23|PO:10,PiS:4,Bezpartyjni Samorządowcy:3,Nowa Lewica:3,PSL:1
0203|Powiat głogowski|16|PiS:7,Nowa Lewica:4,PO:4
0204|Powiat górowski|3|PO:2,Bezpartyjni Samorządowcy:1
0205|Powiat jaworski|8|PO:4,Nowa Lewica:1,Nowoczesna:1,PiS:1
0206|Powiat karkonoski|12|PO:7,Nowa Lewica:2,PSL:2,PiS:1
0207|Powiat kamiennogórski|17|PO:8,PiS:5,Bezpartyjni Samorządowcy:1
0208|Powiat kłodzki|22|PO:7,Inne:2,PSL:2,PiS:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
0209|Powiat legnicki|9|PO:3,PSL:2,Nowoczesna:1,PiS:1
0210|Powiat lubański|14|PO:7,PiS:3,Inne:1,Nowa Lewica:1,PSL:1
0211|Powiat lubiński|83|PiS:39,PO:23,Bezpartyjni Samorządowcy:12,Nowa Lewica:4,Konfederacja:1,PSL:1
0212|Powiat lwówecki|3|PSL:1
0213|Powiat milicki|10|PO:3,PSL:3,Bezpartyjni Samorządowcy:2,Nowa Lewica:1,PiS:1
0214|Powiat oleśnicki|10|PO:3,Bezpartyjni Samorządowcy:1,Inne:1,PSL:1,PiS:1
0215|Powiat oławski|17|PiS:8,PO:4,Bezpartyjni Samorządowcy:2,Inne:1
0216|Powiat polkowicki|29|PO:12,PiS:6,Bezpartyjni Samorządowcy:5,Nowa Lewica:1,Nowoczesna:1
0217|Powiat strzeliński|5|PO:3,Nowa Lewica:1,PiS:1
0218|Powiat średzki (Środa Śląska)|15|PO:6,PiS:2,Bezpartyjni Samorządowcy:1,Inne:1,PSL:1
0219|Powiat świdnicki (Świdnica)|27|PO:8,PiS:5,PSL:2,Bezpartyjni Samorządowcy:1,Inne:1,Nowa Lewica:1,Nowoczesna:1
0220|Powiat trzebnicki|20|PO:9,Bezpartyjni Samorządowcy:3,PSL:3,PiS:2
0221|Powiat wałbrzyski|22|PO:8,Bezpartyjni Samorządowcy:3,PiS:3,Inne:2
0222|Powiat wołowski|17|PO:11,PiS:2,Nowa Lewica:1,PSL:1
0223|Powiat wrocławski|26|PO:10,PSL:4,PiS:4,Bezpartyjni Samorządowcy:1,Inne:1,Nowa Lewica:1
0224|Powiat ząbkowicki|16|PO:5,Nowa Lewica:2,PSL:2,Inne:1,PiS:1
0225|Powiat zgorzelecki|34|PO:16,PiS:7,Bezpartyjni Samorządowcy:3,PSL:3,Nowa Lewica:1
0226|Powiat złotoryjski|9|PO:2,PSL:1
0261|Jelenia Góra|49|PO:28,PiS:11,PSL:4,Bezpartyjni Samorządowcy:3,Inne:1,Nowa Lewica:1
0262|Legnica|87|PiS:35,PO:31,Bezpartyjni Samorządowcy:5,Nowa Lewica:4,PSL:4,Nowoczesna:1
0264|Wrocław|164|PO:63,PiS:41,Bezpartyjni Samorządowcy:20,PSL:13,Nowa Lewica:8,Inne:3,Nowoczesna:1
0265|Wałbrzych|30|PO:12,PiS:7,Inne:2,PSL:2,Bezpartyjni Samorządowcy:1
0401|Powiat aleksandrowski|11|PO:6,PSL:3,PiS:2
0402|Powiat brodnicki|1|PO:1
0403|Powiat bydgoski|11|PO:7,PiS:2,Nowa Lewica:1
0404|Powiat chełmiński|2|PO:1
0405|Powiat golubsko-dobrzyński|5|PO:2,PiS:1
0406|Powiat grudziądzki|3|PiS:2
0407|Powiat inowrocławski|29|PiS:16,PO:8,Nowa Lewica:2
0408|Powiat lipnowski|4|PiS:2,PO:1,PSL:1
0409|Powiat mogileński|10|PO:3,PiS:3,PSL:2,Nowa Lewica:1
0410|Powiat nakielski|8|PO:4,Nowa Lewica:1,PSL:1,PiS:1
0411|Powiat radziejowski|1|PO:1
0412|Powiat rypiński|7|PO:3,PiS:2,Nowa Lewica:1,PSL:1
0413|Powiat sępoleński|4|PO:3,PSL:1
0414|Powiat świecki|10|PO:7,PSL:1
0415|Powiat toruński|6|PiS:3,Nowa Lewica:1,PO:1
0416|Powiat tucholski|6|PO:3,PSL:1
0417|Powiat wąbrzeski|2|PO:1,PiS:1
0418|Powiat włocławski|10|PO:4,Nowa Lewica:2,PSL:1
0419|Powiat żniński|4|PO:1,PSL:1
0461|Bydgoszcz|50|PO:22,PiS:19,PSL:7,Nowa Lewica:2
0462|Grudziądz|3|PO:3
0463|Toruń|63|PO:26,PiS:23,PSL:7,Nowa Lewica:3,Inne:1
0464|Włocławek|32|PO:17,PiS:7,Nowa Lewica:5,PSL:3
0601|Powiat bialski|26|PSL:10,PiS:9,PO:3,Nowa Lewica:1
0602|Powiat biłgorajski|14|PiS:8,Inne:2,PO:2,PSL:1,Polska 2050:1
0603|Powiat chełmski|8|PSL:5,PiS:3
0604|Powiat hrubieszowski|5|PO:2,PiS:2,PSL:1
0605|Powiat janowski|3|PiS:2,PSL:1
0606|Powiat krasnostawski|12|PO:6,PiS:3,PSL:2
0607|Powiat kraśnicki|16|PiS:9,PSL:3,PO:2,Nowa Lewica:1
0608|Powiat lubartowski|8|PiS:5,PO:1,PSL:1
0609|Powiat lubelski|22|PSL:8,PiS:8,PO:5,Nowa Lewica:1
0610|Powiat łęczyński|18|PO:8,PiS:6,PSL:2,Konfederacja:1
0611|Powiat łukowski|13|PO:4,PSL:3,PiS:3,Nowa Lewica:1
0612|Powiat opolski (Opole Lubelskie)|9|PiS:7,PO:1,PSL:1
0613|Powiat parczewski|4|PO:1,PiS:1
0614|Powiat puławski|35|PiS:20,PO:10,PSL:2,Nowa Lewica:1
0615|Powiat radzyński|13|PiS:8,Inne:2,PSL:2
0616|Powiat rycki|4|PO:1,PSL:1,PiS:1
0617|Powiat świdnicki (Świdnik)|15|PiS:7,PO:3,Inne:1,Nowa Lewica:1,PSL:1
0618|Powiat tomaszowski (Tomaszów Lubelski)|15|PO:5,PiS:5,PSL:4,Inne:1
0619|Powiat włodawski|9|PiS:4,PSL:3,PO:1
0620|Powiat zamojski|11|PSL:4,PiS:4,Bezpartyjni Samorządowcy:1,Inne:1,PO:1
0661|Biała Podlaska|14|PiS:7,PSL:5,Konfederacja:1,PO:1
0662|Chełm|28|PiS:14,PSL:9,PO:3,Inne:1,Konfederacja:1
0663|Lublin|95|PiS:49,PO:27,PSL:14,Inne:1,Nowa Lewica:1,Nowoczesna:1
0664|Zamość|36|PO:12,PiS:12,PSL:8,Inne:1,Konfederacja:1,Nowa Lewica:1
0801|Powiat gorzowski|11|PO:8,PiS:2,PSL:1
0802|Powiat krośnieński (Krosno Odrzańskie)|5|PO:3,PiS:1
0803|Powiat międzyrzecki|9|PO:5,PiS:2,Bezpartyjni Samorządowcy:1,PSL:1
0804|Powiat nowosolski|5|PO:2,PSL:2,PiS:1
0805|Powiat słubicki|8|PO:5,PiS:2,PSL:1
0806|Powiat strzelecko-drezdenecki|4|PO:2,Nowa Lewica:1,PiS:1
0807|Powiat sulęciński|8|PO:5,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PiS:1
0808|Powiat świebodziński|11|PO:6,Bezpartyjni Samorządowcy:2,Nowa Lewica:1,PiS:1
0809|Powiat zielonogórski|10|PO:4,Nowa Lewica:2,PSL:1
0810|Powiat żagański|9|PO:3,PiS:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PSL:1
0811|Powiat żarski|5|PO:3,Nowa Lewica:1,PiS:1
0812|Powiat wschowski|3|PO:2
0861|Gorzów Wielkopolski|26|PO:15,PiS:5,Nowa Lewica:3,Bezpartyjni Samorządowcy:2,PSL:1
0862|Zielona Góra|45|PO:24,PSL:8,PiS:5,Nowa Lewica:4,Bezpartyjni Samorządowcy:2,Nowoczesna:1
1001|Powiat bełchatowski|62|PiS:29,PO:25,PSL:3,Nowa Lewica:1
1002|Powiat kutnowski|11|PiS:4,PO:3,PSL:2,Inne:1
1003|Powiat łaski|3|Nowa Lewica:1,PO:1,PSL:1
1004|Powiat łęczycki|7|Inne:2,PiS:2,Nowa Lewica:1,PSL:1
1005|Powiat łowicki|17|PO:7,PSL:6,PiS:3,Nowa Lewica:1
1006|Powiat łódzki wschodni|3|Nowa Lewica:1,PiS:1
1007|Powiat opoczyński|12|PiS:5,PSL:3,PO:2
1008|Powiat pabianicki|17|PO:10,Inne:2,PiS:2,Nowa Lewica:1,PSL:1
1009|Powiat pajęczański|2|PO:1,PiS:1
1010|Powiat piotrkowski|15|PO:4,PSL:4,PiS:3
1011|Powiat poddębicki|7|PSL:4,Nowoczesna:1,PO:1,PiS:1
1012|Powiat radomszczański|16|PiS:8,PO:6,PSL:2
1013|Powiat rawski|6|PSL:2,PiS:2,Bezpartyjni Samorządowcy:1,PO:1
1014|Powiat sieradzki|17|PO:7,PiS:6,PSL:2
1015|Powiat skierniewicki|6|PiS:3,Inne:1,PSL:1
1016|Powiat tomaszowski (Tomaszów Mazowiecki)|26|PiS:16,PO:6,PSL:2
1017|Powiat wieluński|6|PSL:3,Inne:1,PO:1,PiS:1
1018|Powiat wieruszowski|1|Nowa Lewica:1
1019|Powiat zduńskowolski|18|PO:11,PiS:3,PSL:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
1020|Powiat zgierski|23|PO:9,PSL:8,PiS:5,Inne:1
1021|Powiat brzeziński|4|PiS:2,PO:1,PSL:1
1061|Łódź|80|PO:39,PiS:17,PSL:13,Nowa Lewica:6,Inne:2
1062|Piotrków Trybunalski|11|PO:5,Nowa Lewica:2,PSL:2,PiS:1
1063|Skierniewice|16|PiS:6,PO:2,PSL:2,Inne:1,Nowa Lewica:1
1201|Powiat bocheński|10|PiS:5,PSL:3,PO:1
1202|Powiat brzeski (Brzesko)|24|PiS:12,PSL:5,Nowa Lewica:1,PO:1
1203|Powiat chrzanowski|21|PO:10,PiS:7,PSL:2,Polska 2050:1
1204|Powiat dąbrowski|14|PiS:7,PO:3,Nowa Lewica:1,PSL:1
1205|Powiat gorlicki|8|PiS:5,PO:2,Inne:1
1206|Powiat krakowski|43|PO:16,PiS:14,PSL:8
1207|Powiat limanowski|11|PiS:5,Inne:2,PO:1
1208|Powiat miechowski|5|PiS:3,PSL:2
1209|Powiat myślenicki|18|PO:6,PiS:6,Nowa Lewica:2,PSL:2
1210|Powiat nowosądecki|49|PiS:18,PO:15,PSL:5,Inne:3,Nowa Lewica:1
1211|Powiat nowotarski|27|PO:10,PiS:5,PSL:4,Nowa Lewica:1
1212|Powiat olkuski|11|PiS:4,PO:3,PSL:1
1213|Powiat oświęcimski|14|PiS:5,PO:4,PSL:1
1214|Powiat proszowicki|4|PSL:2,PiS:2
1215|Powiat suski|7|PiS:2,PO:1,PSL:1
1216|Powiat tarnowski|25|PiS:11,PO:6,PSL:2,Inne:1,Nowa Lewica:1
1217|Powiat tatrzański|15|PiS:8,PO:5,PSL:1
1218|Powiat wadowicki|12|PiS:5,PO:4,PSL:2
1219|Powiat wielicki|30|PiS:16,PO:8,PSL:2
1261|Kraków|205|PO:76,PiS:73,PSL:30,Nowa Lewica:6,Inne:5,Bezpartyjni Samorządowcy:1
1262|Nowy Sącz|30|PO:13,PiS:8,PSL:3,Inne:2
1263|Tarnów|96|PiS:58,PO:28,PSL:6,Konfederacja:1
1401|Powiat białobrzeski|1|PO:1
1402|Powiat ciechanowski|21|PSL:9,PO:5,PiS:3,Inne:1
1403|Powiat garwoliński|14|PO:4,PiS:4,Inne:2,PSL:2,Nowa Lewica:1
1404|Powiat gostyniński|7|PO:3,PSL:3,PiS:1
1405|Powiat grodziski (Grodzisk Mazowiecki)|19|PO:10,PSL:4,PiS:2
1406|Powiat grójecki|4|PO:3,PiS:1
1407|Powiat kozienicki|20|PiS:12,PO:4,Nowa Lewica:1,PSL:1
1408|Powiat legionowski|20|PO:10,PiS:7,Bezpartyjni Samorządowcy:1,PSL:1
1409|Powiat lipski|2|PiS:1
1410|Powiat łosicki|3|PO:2,PiS:1
1411|Powiat makowski|4|PO:2,PSL:1,PiS:1
1412|Powiat miński|31|PiS:16,PO:11,PSL:3
1413|Powiat mławski|7|PSL:3,PiS:2,Nowa Lewica:1
1414|Powiat nowodworski (Nowy Dwór Mazowiecki)|18|PSL:6,PiS:6,PO:4
1415|Powiat ostrołęcki|2|PSL:1,PiS:1
1416|Powiat ostrowski (Ostrów Mazowiecka)|4|PiS:2,PO:1
1417|Powiat otwocki|26|PiS:11,PO:9,Inne:2,Konfederacja:1,Nowa Lewica:1,Nowoczesna:1,PSL:1
1418|Powiat piaseczyński|21|PO:9,PiS:4,PSL:3,Bezpartyjni Samorządowcy:1,Inne:1,Nowa Lewica:1
1419|Powiat płocki|14|PSL:6,PO:3,PiS:3,Nowa Lewica:1
1420|Powiat płoński|11|PSL:4,PO:3,Bezpartyjni Samorządowcy:1,PiS:1
1421|Powiat pruszkowski|32|PSL:10,PiS:9,PO:8,Konfederacja:1,Nowa Lewica:1,Nowoczesna:1
1422|Powiat przasnyski|2|PO:2
1423|Powiat przysuski|2|PSL:1,PiS:1
1424|Powiat pułtuski|12|PO:5,PiS:3,PSL:2,Konfederacja:1
1425|Powiat radomski|13|PO:5,PiS:4,PSL:3
1426|Powiat siedlecki|13|PiS:9,PSL:2,Inne:1
1427|Powiat sierpecki|7|PiS:2,Bezpartyjni Samorządowcy:1,PO:1,PSL:1
1428|Powiat sochaczewski|16|PSL:7,PiS:5,PO:2,Bezpartyjni Samorządowcy:1,Inne:1
1429|Powiat sokołowski|3|PiS:2,PO:1
1430|Powiat szydłowiecki|1|
1432|Powiat warszawski zachodni|23|PO:8,PSL:6,PiS:5,Inne:2,Nowoczesna:1
1433|Powiat węgrowski|5|PO:3,Nowa Lewica:1
1434|Powiat wołomiński|41|PiS:18,PO:8,Inne:2,PSL:2,Nowa Lewica:1
1435|Powiat wyszkowski|12|PSL:4,PiS:4,Nowa Lewica:1,PO:1
1437|Powiat żuromiński|3|PSL:2,Nowa Lewica:1
1438|Powiat żyrardowski|20|PO:7,PiS:4,PSL:2,Bezpartyjni Samorządowcy:1
1461|Ostrołęka|20|PiS:12,PO:6,PSL:2
1462|Płock|66|PiS:27,PO:19,PSL:16,Nowa Lewica:3
1463|Radom|47|PO:26,PiS:15,PSL:4
1464|Siedlce|34|PiS:12,PO:11,PSL:6,Inne:1,Nowa Lewica:1
1465|Miasto Warszawa|815|PO:303,PiS:268,PSL:147,Nowa Lewica:34,Inne:8,Bezpartyjni Samorządowcy:6,Nowoczesna:3,Konfederacja:2,Polska 2050:2
1601|Powiat brzeski (Brzeg)|14|Inne:5,PiS:4,PO:3,PSL:1
1602|Powiat głubczycki|5|PO:3,PiS:2
1603|Powiat kędzierzyńsko-kozielski|29|PO:15,PiS:6,Nowa Lewica:2,PSL:2
1604|Powiat kluczborski|3|PO:1,PSL:1
1605|Powiat krapkowicki|11|PO:3,PSL:1
1606|Powiat namysłowski|14|PO:5,PSL:5
1607|Powiat nyski|31|PiS:13,PO:10,Nowa Lewica:3,PSL:3,Inne:1
1609|Powiat opolski|15|PO:6,Nowa Lewica:1,PSL:1,PiS:1
1610|Powiat prudnicki|13|PO:6,Inne:2,Nowa Lewica:2,PSL:1
1611|Powiat strzelecki|7|PO:3,Nowa Lewica:2,PiS:1
1661|Opole|52|PiS:16,PO:14,PSL:4,Nowa Lewica:3,Inne:2
1801|Powiat bieszczadzki|6|PSL:2,PiS:2,Bezpartyjni Samorządowcy:1,PO:1
1802|Powiat brzozowski|7|PO:3,Inne:2,PSL:1,PiS:1
1803|Powiat dębicki|26|PiS:17,PO:7,PSL:2
1804|Powiat jarosławski|15|PiS:9,PSL:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PO:1
1805|Powiat jasielski|18|PiS:6,PO:5,PSL:2,Inne:1
1806|Powiat kolbuszowski|14|PiS:8,PSL:2,PO:1
1807|Powiat krośnieński|24|PiS:14,PO:4,PSL:1
1808|Powiat leżajski|7|PiS:4,PO:2
1809|Powiat lubaczowski|7|PiS:4,PO:2,PSL:1
1810|Powiat łańcucki|4|PO:1,PSL:1,PiS:1
1811|Powiat mielecki|28|PiS:14,PO:4,PSL:3,Inne:1,Konfederacja:1,Nowa Lewica:1
1812|Powiat niżański|3|PiS:2,PO:1
1813|Powiat przemyski|15|PiS:7,PO:4,Bezpartyjni Samorządowcy:1
1814|Powiat przeworski|5|PO:2,PSL:1,PiS:1
1815|Powiat ropczycko-sędziszowski|3|PSL:2
1816|Powiat rzeszowski|14|PiS:6,PSL:5,PO:3
1817|Powiat sanocki|19|PiS:10,PSL:5,PO:4
1818|Powiat stalowowolski|14|PiS:9,PO:4
1819|Powiat strzyżowski|2|PiS:2
1820|Powiat tarnobrzeski|6|PiS:5,PSL:1
1821|Powiat leski|4|PO:2,Nowa Lewica:1,PiS:1
1861|Krosno|15|PiS:10,PO:4,Nowa Lewica:1
1862|Przemyśl|14|PiS:6,PO:5,PSL:1
1863|Rzeszów|57|PiS:27,PO:16,PSL:8,Nowa Lewica:5
1864|Tarnobrzeg|22|PiS:14,PO:5,PSL:2,Bezpartyjni Samorządowcy:1
2001|Powiat augustowski|3|PiS:3
2002|Powiat białostocki|11|PO:4,PSL:4,PiS:2,Nowa Lewica:1
2003|Powiat bielski (Bielsk Podlaski)|7|PiS:2,Inne:1,PO:1
2004|Powiat grajewski|3|Inne:1,Nowa Lewica:1,PiS:1
2005|Powiat hajnowski|1|PSL:1
2006|Powiat kolneński|4|PiS:3,PO:1
2007|Powiat łomżyński|3|PO:2,Nowa Lewica:1
2009|Powiat sejneński|2|PO:1,PiS:1
2010|Powiat siemiatycki|6|PO:3,PiS:2,PSL:1
2011|Powiat sokólski|12|PiS:6,PO:2,Konfederacja:1,PSL:1
2012|Powiat suwalski|4|PO:2,PSL:1,PiS:1
2013|Powiat wysokomazowiecki|7|PO:3,PiS:3,PSL:1
2014|Powiat zambrowski|3|PiS:2,Bezpartyjni Samorządowcy:1
2061|Białystok|45|PO:21,PiS:15,PSL:4,Nowa Lewica:2,Inne:1
2062|Łomża|20|PiS:11,PO:6,Bezpartyjni Samorządowcy:1,Inne:1,Nowa Lewica:1
2063|Suwałki|13|PO:8,PiS:3,PSL:1
2201|Powiat bytowski|10|PO:5,PiS:4,Nowa Lewica:1
2202|Powiat chojnicki|3|PO:2
2203|Powiat człuchowski|3|PiS:2,PO:1
2204|Powiat gdański|16|PO:5,PiS:4,Inne:2,PSL:2
2205|Powiat kartuski|6|PiS:2,Inne:1,PO:1,PSL:1
2206|Powiat kościerski|4|PO:3
2207|Powiat kwidzyński|7|PO:5,PSL:1
2208|Powiat lęborski|13|PiS:4,Inne:2,PO:2,Konfederacja:1,Nowa Lewica:1
2209|Powiat malborski|12|PO:6,PiS:2,Inne:1,PSL:1
2210|Powiat nowodworski (Nowy Dwór Gdański)|6|PO:2,PSL:1,PiS:1
2211|Powiat pucki|8|PiS:5,Nowa Lewica:1,PO:1
2212|Powiat słupski|8|PO:4,PiS:4
2213|Powiat starogardzki|15|PiS:6,PO:4,Inne:1
2214|Powiat tczewski|10|PO:4,PiS:4,Inne:1
2215|Powiat wejherowski|17|PO:6,PiS:6
2216|Powiat sztumski|3|PO:1
2261|Gdańsk|167|PiS:95,PO:45,PSL:7,Nowa Lewica:6,Inne:3,Bezpartyjni Samorządowcy:1,Konfederacja:1,Nowoczesna:1
2262|Gdynia|64|PiS:26,PO:22,PSL:6,Nowa Lewica:5,Inne:2
2263|Słupsk|16|PO:7,PiS:4,Inne:1,Nowa Lewica:1,PSL:1
2264|Sopot|12|PiS:7,PO:2,Inne:1,Nowa Lewica:1
2401|Powiat będziński|42|PO:13,PiS:13,Nowa Lewica:10,PSL:1
2402|Powiat bielski (Bielsko-Biała)|42|PiS:14,PO:10,Inne:4,PSL:4,Nowa Lewica:3
2403|Powiat cieszyński|37|PO:15,PiS:7,PSL:3,Nowa Lewica:2,Inne:1
2404|Powiat częstochowski|12|Nowa Lewica:4,PSL:4,PO:2,Polska 2050:1
2405|Powiat gliwicki|16|PO:8,PiS:5,PSL:2
2406|Powiat kłobucki|9|PSL:5,PiS:2,Nowa Lewica:1
2407|Powiat lubliniecki|6|Nowa Lewica:2,PO:2,PiS:2
2408|Powiat mikołowski|9|PO:4,PiS:2,Nowa Lewica:1
2409|Powiat myszkowski|7|PO:3,Nowa Lewica:2,PiS:1
2410|Powiat pszczyński|25|PO:11,PiS:9,Inne:4
2411|Powiat raciborski|14|PO:5,PiS:3,Nowa Lewica:1
2412|Powiat rybnicki|1|PO:1
2413|Powiat tarnogórski|34|PiS:12,PO:9,Inne:2,Nowa Lewica:2,Konfederacja:1,PSL:1
2414|Powiat bieruńsko-lędziński|12|PO:6,PiS:4,Inne:1
2415|Powiat wodzisławski|16|PO:6,PiS:3,Nowa Lewica:2,PSL:2
2416|Powiat zawierciański|21|PO:5,PSL:5,Nowa Lewica:4,PiS:3
2417|Powiat żywiecki|17|PO:7,PSL:4,PiS:4
2461|Bielsko-Biała|62|PO:26,PiS:12,PSL:5,Inne:4,Nowa Lewica:4
2462|Bytom|30|PiS:15,PO:11,Konfederacja:1,Nowa Lewica:1,PSL:1
2463|Chorzów|27|PO:11,PiS:7,Nowa Lewica:3,Inne:2,Konfederacja:1,PSL:1
2464|Częstochowa|43|PiS:12,PSL:10,Nowa Lewica:9,PO:7,Inne:2,Polska 2050:1
2465|Dąbrowa Górnicza|21|PO:10,Nowa Lewica:4,PiS:4,Inne:1,Nowoczesna:1,Polska 2050:1
2466|Gliwice|63|PO:25,PiS:25,Nowa Lewica:4,PSL:4,Inne:2
2467|Jastrzębie-Zdrój|32|PiS:18,PO:8,PSL:3,Nowa Lewica:2
2468|Jaworzno|31|PiS:18,PO:10,Inne:1,PSL:1,Polska 2050:1
2469|Katowice|173|PO:64,PiS:60,PSL:14,Nowa Lewica:12,Inne:6,Bezpartyjni Samorządowcy:2,Konfederacja:2,Polska 2050:2,Nowoczesna:1
2470|Mysłowice|7|PiS:4,PO:3
2471|Piekary Śląskie|21|PiS:10,PO:8,Inne:1
2472|Ruda Śląska|13|PO:4,PSL:4,PiS:4,Nowa Lewica:1
2473|Rybnik|20|PO:8,PiS:8,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
2474|Siemianowice Śląskie|15|Nowa Lewica:4,PO:4,PiS:4,Inne:1,Konfederacja:1
2475|Sosnowiec|43|PO:18,PiS:9,Nowa Lewica:8,PSL:2,Polska 2050:2
2476|Świętochłowice|6|PO:2,PiS:2,Nowa Lewica:1
2477|Tychy|31|PO:16,PiS:9,Inne:2,Nowa Lewica:1
2478|Zabrze|32|PO:11,PiS:11,PSL:4,Nowa Lewica:2,Inne:1
2479|Żory|8|PiS:4,PO:3,Nowa Lewica:1
2601|Powiat buski|18|PSL:10,PiS:3,Bezpartyjni Samorządowcy:2,PO:2
2602|Powiat jędrzejowski|7|PiS:3,Inne:1,Nowa Lewica:1,PO:1,PSL:1
2603|Powiat kazimierski|2|PSL:2
2604|Powiat kielecki|37|PiS:15,PSL:12,PO:4,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
2605|Powiat konecki|13|PiS:6,PSL:3,Bezpartyjni Samorządowcy:1,Inne:1
2606|Powiat opatowski|2|PSL:1,PiS:1
2607|Powiat ostrowiecki|23|PO:9,PSL:8,PiS:4,Nowa Lewica:1
2608|Powiat pińczowski|3|PO:1,PiS:1
2609|Powiat sandomierski|5|PSL:3,Inne:1,PiS:1
2610|Powiat skarżyski|25|PiS:9,PO:8,PSL:3,Inne:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
2611|Powiat starachowicki|25|PiS:11,PO:5,PSL:4,Nowa Lewica:2
2612|Powiat staszowski|22|PiS:8,PO:5,PSL:3,Bezpartyjni Samorządowcy:2,Inne:1
2613|Powiat włoszczowski|5|PSL:2,PiS:1
2661|Kielce|61|PiS:27,PO:14,PSL:12,Nowa Lewica:4,Bezpartyjni Samorządowcy:1
2801|Powiat bartoszycki|6|PiS:2,Inne:1,Nowa Lewica:1,PO:1,PSL:1
2802|Powiat braniewski|8|PiS:3,PO:2,Inne:1,PSL:1
2803|Powiat działdowski|12|PSL:5,PO:3,Bezpartyjni Samorządowcy:1
2804|Powiat elbląski|5|PSL:3,PO:1,PiS:1
2805|Powiat ełcki|11|PO:7,PSL:2,PiS:2
2806|Powiat giżycki|6|PSL:4,PO:2
2807|Powiat iławski|10|PO:3,PSL:2,PiS:2,Bezpartyjni Samorządowcy:1
2808|Powiat kętrzyński|6|PiS:3,PSL:2,Nowa Lewica:1
2809|Powiat lidzbarski|11|PSL:4,PiS:2,Inne:1,PO:1
2810|Powiat mrągowski|1|Nowa Lewica:1
2811|Powiat nidzicki|6|PO:2,PSL:2,PiS:1
2812|Powiat nowomiejski|5|PSL:4
2813|Powiat olecki|4|PSL:2,PO:1,PiS:1
2814|Powiat olsztyński|10|PSL:3,Nowa Lewica:1,PO:1,PiS:1
2815|Powiat ostródzki|11|PiS:3,PO:2,PSL:2
2816|Powiat piski|3|PSL:2,PO:1
2817|Powiat szczycieński|8|PSL:6,PO:1
2818|Powiat gołdapski|5|PO:3,Inne:1
2819|Powiat węgorzewski|1|PiS:1
2861|Elbląg|25|PSL:8,PiS:8,PO:7,Nowa Lewica:2
2862|Olsztyn|37|PO:11,PiS:11,PSL:10,Nowa Lewica:3,Inne:1
3001|Powiat chodzieski|6|PO:4,PiS:1
3002|Powiat czarnkowsko-trzcianecki|6|PiS:2,PO:1
3003|Powiat gnieźnieński|22|PO:7,PiS:7,PSL:3,Nowa Lewica:2,Nowoczesna:1
3004|Powiat gostyński|3|PSL:2,PiS:1
3005|Powiat grodziski (Grodzisk Wielkopolski)|2|PO:1,PiS:1
3006|Powiat jarociński|21|PO:9,PiS:6,PSL:2
3007|Powiat kaliski|9|PO:4,PSL:2,PiS:2,Bezpartyjni Samorządowcy:1
3008|Powiat kępiński|12|PO:3,PSL:3,PiS:3,Inne:1,Nowa Lewica:1
3009|Powiat kolski|11|PiS:6,PO:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PSL:1
3010|Powiat koniński|10|PiS:5,PO:2,Nowa Lewica:1,PSL:1
3011|Powiat kościański|6|PO:3,Nowa Lewica:1,PSL:1
3012|Powiat krotoszyński|13|PSL:5,PO:4,Nowa Lewica:2
3013|Powiat leszczyński|4|PiS:3,Nowa Lewica:1
3014|Powiat międzychodzki|3|Nowa Lewica:1,PO:1
3015|Powiat nowotomyski|5|PO:2,Nowa Lewica:1
3016|Powiat obornicki|5|PiS:2,Inne:1,PSL:1
3017|Powiat ostrowski (Ostrów Wielkopolski)|29|PO:11,PiS:10,Nowa Lewica:3,Bezpartyjni Samorządowcy:1,PSL:1
3018|Powiat ostrzeszowski|5|PSL:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PO:1
3019|Powiat pilski|19|PiS:7,PO:6,Nowa Lewica:1,PSL:1
3020|Powiat pleszewski|13|PSL:5,PO:3,Nowa Lewica:2,PiS:1
3021|Powiat poznański|48|PO:21,PiS:8,PSL:5,Nowa Lewica:4,Bezpartyjni Samorządowcy:2
3022|Powiat rawicki|4|Bezpartyjni Samorządowcy:1,Nowa Lewica:1,PiS:1
3023|Powiat słupecki|7|Nowa Lewica:2,PSL:2,PO:1,PiS:1
3024|Powiat szamotulski|11|PO:5,PSL:1,PiS:1
3025|Powiat średzki (Środa Wielkopolska)|4|PO:1,PSL:1
3026|Powiat śremski|9|PO:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1,Nowoczesna:1,PSL:1,PiS:1
3027|Powiat turecki|6|PiS:3,PO:2,PSL:1
3028|Powiat wągrowiecki|7|PSL:2,Inne:1,Nowa Lewica:1,PO:1,PiS:1
3029|Powiat wolsztyński|6|PO:3,PSL:2,Nowa Lewica:1
3030|Powiat wrzesiński|3|PO:2
3031|Powiat złotowski|1|PO:1
3061|Kalisz|22|PiS:11,PO:5,PSL:3,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
3062|Konin|20|PO:9,Nowa Lewica:4,PiS:4,PSL:2,Nowoczesna:1
3063|Leszno|7|PiS:3,Nowa Lewica:2,PO:2
3064|Poznań|168|PO:71,PiS:53,PSL:18,Nowa Lewica:17,Inne:3,Bezpartyjni Samorządowcy:1
3201|Powiat białogardzki|13|PO:8,PiS:3,Nowoczesna:1,PSL:1
3202|Powiat choszczeński|2|PO:1,PSL:1
3203|Powiat drawski|7|Nowa Lewica:1,Nowoczesna:1,PO:1,PiS:1
3204|Powiat goleniowski|10|PO:6,PiS:2,Bezpartyjni Samorządowcy:1,PSL:1
3205|Powiat gryficki|9|PO:4,PiS:3,Nowa Lewica:2
3206|Powiat gryfiński|9|PiS:5,PO:4
3207|Powiat kamieński|12|PO:6,PiS:3,Nowa Lewica:1,Nowoczesna:1,PSL:1
3208|Powiat kołobrzeski|16|PO:9,PiS:3,PSL:2
3209|Powiat koszaliński|5|PSL:2,Inne:1,PO:1,PiS:1
3210|Powiat myśliborski|6|PO:2,PiS:2,Bezpartyjni Samorządowcy:1,Nowa Lewica:1
3211|Powiat policki|31|PO:13,PiS:13,Nowa Lewica:1
3212|Powiat pyrzycki|7|PO:4,PiS:2,PSL:1
3213|Powiat sławieński|6|PO:3,PSL:2
3214|Powiat stargardzki|10|PiS:5,Nowa Lewica:3,PO:2
3215|Powiat szczecinecki|5|Nowa Lewica:1,PO:1,PiS:1
3216|Powiat świdwiński|4|PO:4
3217|Powiat wałecki|5|PO:2,PiS:2,Nowa Lewica:1
3218|Powiat łobeski|3|PO:2
3261|Koszalin|24|PO:14,Nowa Lewica:3,PiS:3,Bezpartyjni Samorządowcy:1,Inne:1,PSL:1
3262|Szczecin|65|PO:27,PiS:23,PSL:6,Nowa Lewica:5
3263|Świnoujście|21|PO:12,PiS:5,Nowa Lewica:3,Nowoczesna:1
`;

export function regionStatsFixture(): RegionStat[] {
  return LINES.trim()
    .split("\n")
    .map((line) => {
      const [teryt, name, people, parties] = line.split("|");
      return {
        id: `teryt${teryt}`,
        teryt: teryt!,
        name: name!,
        people: Number(people),
        parties: Object.fromEntries(
          (parties ? parties.split(",") : []).map((pair) => {
            const at = pair.lastIndexOf(":");
            return [pair.slice(0, at), Number(pair.slice(at + 1))];
          }),
        ),
      };
    });
}
