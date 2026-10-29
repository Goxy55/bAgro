# RZS otvoreni podaci

[Zvanična stranica](https://opendata.stat.gov.rs/odata/) je katalog sa direktnim CSV i JSON izvodima. Linkovi se čitaju iz objavljenog HTML-a; ne konstruišu se pretpostavljene OData/API adrese. Provera 29.10.2026. vratila je HTTP 200. Katalog ima 719 skupova, od kojih 182 pripadaju poljoprivredi, šumarstvu i ribarstvu. Za Agro portal provereno je sledećih šest:

| Skup | Šifra | Zapisa | Period |
| --- | --- | ---: | --- |
| Biljna proizvodnja | 130102IND01 | 26.271 | 2005–2026 |
| Bilans stoke | 1302020101IND01 | 560 | 2006–2025 |
| Mlečni proizvodi iz mlekara za tržište | 13020201040401IND01 | 1.408 | mesečno, 2012–2026 |
| Indeksi cena inputa | 03020201IND02 | 1.248 | kvartalno, 2020–2026 |
| Indeksi cena proizvođača po KD | 03020202IND01 | 2.880 | mesečno, 2020–2026 |
| Indeksi cena proizvođača po grupama proizvoda | 03020203IND01 | 6.720 | mesečno, 2020–2026 |

Ukupno **39.087 izvornih zapisa**, sa **4.747 nedostajućih vrednosti**. Broj zapisa je upoređen sa katalogom, svaki originalni JSON sačuvan je bez izmena i ima SHA-256. Izvedeni Excel/CSV preslovljavaju nazive na latinicu, dodaju poreklo i izdvajaju teritoriju/period; ne preračunavaju fizičke vrednosti. Cenovni indeks nije jedinična cena: indeksi ne popunjavaju cenovnik normativa.

## Ponovljivo preuzimanje

```bash
npm run collect:rzs
```

Podrazumevani direktorijum je `data/rzs`, izvan Gita i javnog web root-a. Druga putanja se bira sa `--out /putanja`. Komanda radi bez otvaranja baze, ne zahteva API ključ i ne uključuje raspored. Koristi isključivo zvanični HTTPS domen, postojeći mrežni/proxy pristup sa TLS verifikacijom, robots.txt, sekvencijalne zahteve i najmanje sekund između njih. Granice su 3 MB za katalog i 32 MB za pojedinačni JSON. Veličina, format i broj redova proveravaju se pre zamene poslednje verzije. Originali po hash-u ostaju u `originali/`. Greška zadržava prethodne podatke, zapisuje se u `poslednja-provera.json` i završava komandu neuspešnim statusom.

RZS izričito dozvoljava besplatnu ponovnu upotrebu uz navođenje izvora, datuma preuzimanja i izmena. Te oznake su u isporučenom Excelu, CSV kolonama i evidenciji izvora. Ne tvrdi se da je ceo servis standardni OData endpoint sa proizvoljnim `$filter` upitima; potvrđeni su linkovi koje katalog stvarno objavljuje.

## Godišnji nacionalni podaci u aplikaciji

```bash
# Za PGlite prvo zaustaviti server i napraviti backup.
npm run import:rzs -- --archive data/rzs --preview
npm run import:rzs -- --archive data/rzs
```

Isti postupak prihvata raspakovani paket sa `preuzimanje.json` i originalima nazvanim šifrom skupa. `--preview` proverava izvor i priprema JSON u `data/rzs-priprema` bez otvaranja baze. Uvoz je operaterska radnja sa audit zapisom; web uvoz ostaje dostupan samo administratoru preko postojeće forme i API-ja. Svaka serija se uvozi transakciono. Ponovljena nepromenjena opažanja ne dodaju duplikate/revizije; izmena čuva prethodnu vrednost, status i poreklo.

Uvoze se godišnje **RS** serije biljne proizvodnje i bilansa stoke: **202 serije i 4.313 opažanja**. Regionalni nivoi se ne sabiraju u Srbiju. U aplikaciji su dostupni u **Tržište Srbije → Nacionalna statistika**, uz izbor proizvoda. Početno se prikazuje prvi proizvod, sa njegovim pokazateljima; moguće je izabrati drugi ili sve proizvode. Petogodišnji pregled i tekuća godina ostaju odvojeni. Mesečno mleko i mesečni/kvartalni indeksi ostaju u izvornom paketu; nisu proizvoljno pretvoreni u godišnje podatke.

Jedinice biljnih pokazatelja izričito su navedene u izvornoj koloni `nVrPod`: ha, t i t/ha. Bilans stoke zadržava **hiljade grla**, bez množenja sa 1.000. Proizvodi i šire grupe zadržavaju identitet: maline/kupine su zasebne; kupus i kelj, dinje i lubenice i ostale grupe ne predstavljaju pojedinačnu kulturu. Nacionalni pokazatelji nisu rezultat svakog gazdinstva i ne menjaju njegovu maržu ili novčani tok.

## Datumi, statusi i preciznost

JSON nema datum objave svakog pojedinačnog istorijskog opažanja. **Datum objave ostaje null**, dok se ažuriranje celog skupa vodi odvojeno kao `source_updated_at`. Originalni datum preuzimanja se čuva pri uvozu. Migracija `004_statistic_provenance.sql` dopušta nepoznatu objavu i dodaje podatke o izvoru bez resetovanja baze.

Čuvaju se izvorna šifra i opis statusa: A konačan, P prethodan, R revidiran, K ispravljen, O nije raspoloživ, M neprimenljiv i N nije značajna vrednost. Praznine ostaju praznine. Nepoznat status, promenjena jedinica/osnova ili duplirana nacionalna kombinacija prekidaju pripremu i zahtevaju pregled.

Svako uvezeno opažanje sadrži URL, hash originala i red u JSON nizu. Decimalni zapis uzima se iz izvornog JSON tokena preko `JSON.parse` source context-a, bez zaokruživanja kroz JavaScript double. PostgreSQL čuva izvornu decimalnu vrednost; prikaz i prosek koriste postojeću dokumentovanu Decimal.js politiku. Provereno je na Node 24.19.0; runtime bez podrške za izvorni JSON zapis odbija uvoz. Datum ažuriranja nije zamenjen datumom objave.

## Provereno i granice

Preuzimanje šest originala je stvarno izvršeno. Svih 4.313 pripremljenih godišnjih vrednosti nezavisno je upoređeno sa izvornim JSON-om pomoću Python Decimal, uz provere teritorije, statusa, reda i hash-a. Ostali veliki skupovi iz kataloga, uključujući popisne tabele i trgovinske klasifikacije, nisu automatski preuzeti niti mapirani na kulture. Nacionalne jedinične otkupne cene nisu potvrđene kroz ovih šest skupova; cenovni indeksi se ne predstavljaju kao takve cene.

Backup baze sadrži uvezena opažanja i istoriju. Posebno čuvati i originalne datoteke `data/rzs`/isporučeni paket radi potpunog izvornog audita. Novi server dobija podatke uvozom paketa ili obnavljanjem baze, ne iz privatne lokalne baze u Gitu. RZS servis je besplatan podatkovni izvor; prostor, baza, backup i hosting imaju sopstvene operativne zahteve.

`npm test`: **76 prolazi**, bez padova ili preskakanja. Provereni su teritorije, jedinice, sirovi statusi, decimalni tokeni, nepoznata objava, idempotentnost/revizije i admin autorizacija. Produkcioni build prolazi. Browser provera `scripts/rzs-browser-check.ts` koristi zaseban TEST nalog/bazu i stvarne javne RZS podatke; izbor pšenice/goveda, pet godina, odvojena 2026, datumi i telefon od 390 px prolaze bez pageerror-a. Privatno poslovanje nije u test snimcima.
