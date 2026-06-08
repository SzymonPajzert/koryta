## Assets

### powiaty data

How I got the data for powiaty?

I downloaded it from https://gis-support.pl/baza-wiedzy-2/dane-do-pobrania/granice-administracyjne/#:~:text=narz%C4%99dzi%20z%20geoportalu%2C;%20us%C5%82ugi%20WFS:%20https://mapy.geoportal.gov.pl/wss/service/PZGIK/PRG/WFS/AdministrativeBoundaries.
If the website doesn't work, https://mapy.geoportal.gov.pl/imap/Imgp_2.html should work instead - https://www.geoportal.gov.pl/pl/dane/panstwowy-rejestr-granic-prg/#:~:text=Us%C5%82uga%20jest%20dost%C4%99pna%20pod%20adresem,/PRG/WFS/AdministrativeBoundaries.

After we have shapefile files downloaded, we can submit the zip to https://mapshaper.org/.

Simplify the shapefile to whatever accuracy is enough for our case.

In the console you need to attach a property of the TERYT code using a command `-each 'id = JPT_KJ_I_1'`

Then you can export with flags `-o id-field=id` as a SVG and the teryt codes tagged as IDs should be present in the exported svg file - https://github.com/mbloch/mapshaper/issues/138.

You can then use the following script to update the actual JSON files imported:

```
node scripts/generate_map_json.js app/assets/wojewodztwa.svg app/assets/poland_voivodeships.json
```
