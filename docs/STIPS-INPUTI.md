# STIPS cene inputa

**Administracija → STIPS · cene inputa** je referentna arhiva pesticida, mineralnih đubriva i semenskog materijala iz [zvanične godišnje tabele INPUTI](https://www.stips.minpolj.gov.rs/index.php/srl/strana/inputi). Koristi postojeću prijavu, admin ulogu i bazu. Preuzimanje ne stvara stvarni trošak, plaćanje ili aktivan normativ.

## Prikupljanje

Izaberite godinu, kliknite **Pronađi cenovnike**, označite objave i kliknite **Preuzmi izabrane cenovnike**. Prate se stvarni linkovi iz godišnje tabele i njihov pojedinačni XLS/XLSX prilog. Ne konstruišu se adrese za nedostajuće mesece. Preuzimanje je sekvencijalno, prati robots.txt i crawl-delay (najmanje sekund između zahteva), čuva TLS verifikaciju i prihvata samo zvanične STIPS HTTPS adrese. Ograničenja po dokumentu: 8 MB, 20 sheetova, 1.000 redova, 80 kolona, 30.000 opažanja. Nepoznata struktura se odbija.

Original se čuva bez izmena u bazi sa SHA-256. Isti binarni dokument ne pravi duplikate. Izmenjeni prilog ima novi hash i zasebne zapise; raniji podaci i reference ostaju sačuvani. Greška preuzimanja ne briše arhivu. Originali i nalazi dostupni su u detaljima modula i uključeni su u postojeći backup baze.

Jedan zapis predstavlja izvornu ćeliju, sa proizvodom, proizvođačem/poreklom, pakovanjem, mestom, sheetom i adresom ćelije. Praznina i crtica nisu nula. Nejasan zapis, izričita nula i formula imaju status za proveru i nisu ponuđeni kao potvrđena cena za normativ. Formula i keširani rezultat se čuvaju bez izvršavanja. Takvi redovi se pregledaju uz original; automatsko odobravanje ili ispravljanje nije implementirano.

Period se potvrđuje u zaglavljima radne sveske, bez zaključivanja iz URL putanje. Neslaganje stranice/kolone arhive i sadržaja ostaje vidljivo upozorenje. Na primer, stranica jesenjeg semena 2026. u naslovu navodi septembar, a XLS izričito navodi oktobar 2026; sačuvan je oktobar. Datum objave i precizan tržišni nivo nisu potvrđeni i ostaju nepoznati. Datum preuzimanja nije datum objave ili period cene.

STIPS navodi sezonsko prikupljanje iz poljoprivrednih apoteka, pred prolećnu i jesenju setvu. Ne pretpostavlja se mesečna serija od 12 objava, nacionalni/godišnji prosek ili nepromenjena cena između objava. Nazivi pesticida su istorijski sadržaj, bez tvrdnje o aktuelnoj registraciji ili preporučenoj primeni.

## Primena u zajedničkom cenovniku

Otvorite izabrane nacrte u **Zajednički cenovnik**. Panel **Popuni cene iz STIPS-a** automatski predlaže povezivanje sa već preuzetim cenama. Početni datum je kraj važenja cenovnika ili današnji dan, šta je ranije. Početno mesto ima najviše raspoloživih brojčanih zapisa; vidljivo je i može se promeniti. Za svaki proizvod uzima se najnoviji raspoloživi izvorni mesec do izabranog datuma. To nije tvrdnja da je cena istog dana i dalje važeća ili tada već bila objavljena: datum objave nije potvrđen.

1. Pregledajte **Predloge**. Nedvosmislen proizvod ili ranije potvrđena veza imaju pripremljen izbor. Ako postoji više proizvođača/pakovanja ili nije jasna formulacija, izaberite odgovarajući predlog jednom. Izbor iste materijalne stavke prenosi se i na njene izvorne varijante sa različitim brojem operacija, bez promene količina i alternativa.
2. Proverite mesto, mesec, pakovanje, predloženu jedinicu i cenu. **Osnova pakovanja** otvara predloženi delilac, koji možete ispraviti ako izvorna cena nije za celo označeno pakovanje. Prepoznaju se kg, g/gr, l/lit i ml; kg i t preračunavaju se dimenziono, a kg i l se ne pretvaraju jedni u druge. Pakovanja poput `25000 sj` nemaju automatsko tumačenje setvene jedinice.
3. Jednom potvrdite pregled proizvoda, jedinica normativa i osnove izabranih cena. Starije reference zahtevaju zasebno prihvatanje: izvor pre početka važenja cenovnika ili stariji od 12 meseci u odnosu na datum izbora. Starija cena nije predstavljena kao nova tržišna cena.
4. Kliknite **Primeni STIPS cene u nacrtima**. Jednim čuvanjem primenjuju se sve označene stavke u svim izabranim kulturama. Čuvaju se i potvrđene veze proizvoda, proizvođača, pakovanja i delioca za buduće nacrte. Cene i normativi se ne aktiviraju ovim korakom.

**Bez STIPS cene** prikazuje nepokrivene stavke, a **Već popunjene** sačuvane cene i poreklo. Postojeće cene se početno čuvaju; uključivanje **Ponudi i zamenu postojećih cena u nacrtima** omogućava novi predlog i zahteva novu potvrdu. Matrica **Ručni unos i raspored cena po kulturama** je sklopljena i dostupna kada je potrebna detaljna izmena. Pre ručnog rada ili primene predloga sačuvajte/odbacite druge neprihvaćene izmene; stari prozor ne može prepisati noviju verziju.

Potvrđena veza ima prednost pred prepoznavanjem po nazivu. Potpuno podudaranje ima prednost pred sličnim nazivom. Različite NPK formulacije ne izjednačavaju se. Bare KAN/UREA bez potvrđenog procenta i nepotpune oznake pesticidnih formulacija traže pregled. Generičko „Seme“ ne dobija automatski sortu ili hibrid; potvrđena ručna veza ostaje vezana za konkretnu kulturu. Ako zapamćeno pakovanje/proizvod nema dostupnu cenu za mesto, alternativa zahteva pregled. Nema tihog biranja najjeftinijeg preparata ili nacionalnog proseka.

Seme iz ovih cenovnika se bez prethodno potvrđene veze ne povezuje po samom nazivu zrna: npr. semenski tritikale nije cena tritikalea za ishranu stoke. Kontekst biljnih inputa i stočarske hrane odvojen je i u zapamćenim vezama. Nedvosmislene starije reference mogu imati unapred prikazan proizvod i delilac, ali početno nisu uključene; posebna potvrda starijih referenci uključuje te izbore.

Ovi STIPS XLS/XLSX cenovnici pokrivaju pesticide, đubriva i semenski materijal. Ne obezbeđuju sve cene goriva, rada, veterinarskih usluga ili mašinskih operacija. Nepokrivena stavka ostaje prazna, umesto da dobije nulu ili nepovezanu cenu.

Pojedinačni izbor ostaje dostupan: u ručnoj matrici uz stavku kliknite **Izaberi STIPS cenu** i izaberite proizvod, formulaciju/sortu, pakovanje, mesto i period. Kod semena se čuva izvorni sheet (npr. PŠENICA ili JEČAM), jer „SVE SORTE“ samostalno ne identifikuje kulturu.

Obavezno navedite koliko potvrđenih jedinica normativa pokriva izvorna cena, datum vrednovanja/NBS kursa unutar izvornog meseca i obrazloženje podudaranja proizvoda i osnove. Potvrdite obe provere i prihvatanje istorijske reference ako je izvor stariji od perioda cenovnika.

Sintetički primer: 2.500 RSD za potvrđeno celo pakovanje od 25 kg daje 100 RSD/kg, uz delilac 25. Ako cena već važi za kg, delilac je 1. **Sama oznaka „25 kg“ ne potvrđuje osnovu cene**: grupni predlog popunjava delilac, ali administrator potvrđuje ili ispravlja osnovu pre primene.

Grupno **Primeni STIPS cene u nacrtima** ili ručno **Sačuvaj cene u nacrtima** na serveru ponovo proverava izvor i primenjuje jediničnu cenu na normirane količine izabranih kultura. RSD/jedinici se zaokružuje na najviše 12 decimala, ROUND_HALF_UP; izvorni iznos i delilac ostaju sačuvani. EUR se obračunava postojećom decimalnom politikom, zvaničnim kursom za prikazani datum u izvornom mesecu. Grupni predlog koristi poslednji dan izvornog meseca, ograničen izabranim datumom ako je isti mesec još u toku. Bez kursa RSD unos ostaje sačuvan sa izvorom, a EUR cena je prazna. Današnji kurs nije zamena.

Migracija `005_input_price_links.sql` čuva potvrđene veze i njihovog autora, izvorno opažanje i datum izmene. Primena cene i promena veze su u istoj transakciji i audit evidenciji. Naknadni uvoz novih cena ne menja aktivne/arhivske normative, prethodne reference ili sačuvane obračune.

Snapshot stavke čuva hash, URL stranice/priloga, sheet/ćeliju, izvorni iznos, proizvod, proizvođača, pakovanje, mesto, period, datum preuzimanja, delilac, datum vrednovanja i obrazloženje. Kasniji uvoz ne menja istoriju. Ručna izmena pripremljene cene, valute ili jedinice uklanja pripremljenu vezu sa izvorom. Aktiviranje kompletnog normativa ostaje zasebno administratorsko odobrenje.

## Operaterski uvoz i nova instalacija

Za PGlite prvo zaustavite server i napravite backup:

```bash
npm run import:inputs -- 2024 2025 2026
```

Kopije originala sa kontrolnim zbirovima ostaju u `data/stips-inputi`, izvan Gita. Uvoz nije automatski uključen pri startu aplikacije. Dostupne starije godine mogu se izabrati, ali njihovi rasporedi nisu provereni ovim prikupljanjem.

Pripremljeni paket `izvori.json` + `originali/` može se uvesti bez mreže:

```bash
npm run import:inputs -- 2024 2025 2026 --archive /putanja/do/raspakovanog/paketa
```

Proveravaju se format manifesta i SHA-256 svakog originala. Čuva se originalni datum preuzimanja; to nije nova mrežna provera. Nova instalacija zahteva uvoz ili obnovu baze. Privatna poslovna baza se ne šalje u Git.

## Provereno prikupljanje

Za 2024–2026. preuzet je **21 originalni cenovnik**, ukupno **27.678 ćelija**: **13.342 brojčane cene**, **14.092 nedostajuće vrednosti** i **244 zapisa za proveru**. Sva tri godišta pokrivaju pesticide, mineralna đubriva i seme. Provereni URL-ovi, hash-evi, vremena preuzimanja i nalazi su u `source/stips-inputi-audit-2024-2026.json`. Pojedinačna lokalna cena nije prosek Srbije ili automatski važeći današnji cenovnik.

Čitač je zaključan na `@e965/xlsx@0.20.3`, npm distribuciju SheetJS CE 0.20.3 (Apache-2.0), sa integritetom u lock fajlu. Zvanični CDN vraća 403 iz ovog okruženja; stari npm paket `xlsx@0.18.5` nije uveden. Parser ne izvršava formule ili makroe. Podaci su dostupni administratorima; modul ih ne objavljuje na javnom sajtu i ne koristi plaćen podatkovni servis. Arhiva zauzima prostor baze i backupa.

## Verifikacija implementacije

`npm test`: 85 prolazi, bez padova ili preskakanja; uključeni su XLS/XLSX, praznine, formule bez izvršavanja, periodi, izvori, idempotentnost, zaštita admin pristupa i originala, eksplicitna osnova pakovanja, istorijska potvrda, poreklo cene u dva nacrta, kurs izvornog meseca i nedostajući kurs. Novi testovi proveravaju predloge bez menjanja normativa, mesto/period, kg/t i kg/l, zaštitu postojećih cena, zapamćene veze, atomarno čuvanje i zabranu mešanja semena sa hranivima. Produkcioni build prolazi. Nezavisni Python čitači su uporedili svih 27.678 izdvojenih vrednosti sa originalnim ćelijama.

`scripts/inputs-browser-check.ts` koristi odvojenu sintetičku bazu/admina preko `INPUTS_E2E_URL`, `INPUTS_E2E_EMAIL` i `INPUTS_E2E_PASSWORD`. Za ponavljanje pripremite TEST izvor sa 2.500 RSD za 25 kg i TEST kurs 100 za 30.09.2026; to nisu stvarne tržišne cene ili NBS kurs.

`scripts/suggestions-browser-check.ts` proverava grupnu primenu u produkcionom lokalnom serveru: predlog pri otvaranju, jednu potvrdu za dve kulture, RSD/EUR, čuvanje/reload, pamćenje proizvoda i grupisanje ponovljenih operacija. Koristi `SUGGESTIONS_E2E_URL/EMAIL/PASSWORD`, zasebnu praznu TEST bazu sa NPK fixture-om i kursom navedenim iznad; podrazumevani port je 3700. Slike `docs/screens/stips-suggestions-*.png` sadrže samo označene sintetičke TEST podatke. Ne pokretati protiv poslovne baze.

Pokrivenost prepoznavanja nad svih 21 stvarnih arhivskih cenovnika proverena je bez upisa normativa na zasebnoj bazi: [izveštaj po izvornim kategorijama](../source/stips-price-coverage-2026-10-29.json). Za Beograd i datum izbora 29.10.2026. postoje predlozi za 12 grupa materijala u Usevima, 12 u Povrću i 13 u Voću; to nisu brojevi potpuno odobrenih normativa. Izbor proizvoda/pakovanja i starijih referenci može biti potreban. Provera je koristila ranije preuzete originale i njihove kontrolne sume, bez nove tvrdnje o mrežnom osvežavanju ili cenama danas.
