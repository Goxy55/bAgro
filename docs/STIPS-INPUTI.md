# STIPS cene inputa

**Administracija → STIPS · cene inputa** je referentna arhiva pesticida, mineralnih đubriva i semenskog materijala iz [zvanične godišnje tabele INPUTI](https://www.stips.minpolj.gov.rs/index.php/srl/strana/inputi). Koristi postojeću prijavu, admin ulogu i bazu. Preuzimanje ne stvara stvarni trošak, plaćanje ili aktivan normativ.

## Prikupljanje

Izaberite godinu, kliknite **Pronađi cenovnike**, označite objave i kliknite **Preuzmi izabrane cenovnike**. Prate se stvarni linkovi iz godišnje tabele i njihov pojedinačni XLS/XLSX prilog. Ne konstruišu se adrese za nedostajuće mesece. Preuzimanje je sekvencijalno, prati robots.txt i crawl-delay (najmanje sekund između zahteva), čuva TLS verifikaciju i prihvata samo zvanične STIPS HTTPS adrese. Ograničenja po dokumentu: 8 MB, 20 sheetova, 1.000 redova, 80 kolona, 30.000 opažanja. Nepoznata struktura se odbija.

Original se čuva bez izmena u bazi sa SHA-256. Isti binarni dokument ne pravi duplikate. Izmenjeni prilog ima novi hash i zasebne zapise; raniji podaci i reference ostaju sačuvani. Greška preuzimanja ne briše arhivu. Originali i nalazi dostupni su u detaljima modula i uključeni su u postojeći backup baze.

Jedan zapis predstavlja izvornu ćeliju, sa proizvodom, proizvođačem/poreklom, pakovanjem, mestom, sheetom i adresom ćelije. Praznina i crtica nisu nula. Nejasan zapis, izričita nula i formula imaju status za proveru i nisu ponuđeni kao potvrđena cena za normativ. Formula i keširani rezultat se čuvaju bez izvršavanja. Takvi redovi se pregledaju uz original; automatsko odobravanje ili ispravljanje nije implementirano.

Period se potvrđuje u zaglavljima radne sveske, bez zaključivanja iz URL putanje. Neslaganje stranice/kolone arhive i sadržaja ostaje vidljivo upozorenje. Na primer, stranica jesenjeg semena 2026. u naslovu navodi septembar, a XLS izričito navodi oktobar 2026; sačuvan je oktobar. Datum objave i precizan tržišni nivo nisu potvrđeni i ostaju nepoznati. Datum preuzimanja nije datum objave ili period cene.

STIPS navodi sezonsko prikupljanje iz poljoprivrednih apoteka, pred prolećnu i jesenju setvu. Ne pretpostavlja se mesečna serija od 12 objava, nacionalni/godišnji prosek ili nepromenjena cena između objava. Nazivi pesticida su istorijski sadržaj, bez tvrdnje o aktuelnoj registraciji ili preporučenoj primeni.

## Primena u zajedničkom cenovniku

Otvorite izabrane nacrte u **Zajednički cenovnik** i uz odgovarajuću stavku kliknite **Izaberi STIPS cenu**. Ručno izaberite proizvod, formulaciju/sortu, pakovanje, mesto i period. Nema automatskog izjednačavanja sličnih preparata ili semena različitih kultura. Kod semena se čuva izvorni sheet (npr. PŠENICA ili JEČAM), jer „SVE SORTE“ samostalno ne identifikuje kulturu.

Obavezno navedite koliko potvrđenih jedinica normativa pokriva izvorna cena, datum vrednovanja/NBS kursa unutar izvornog meseca i obrazloženje podudaranja proizvoda i osnove. Potvrdite obe provere i prihvatanje istorijske reference ako je izvor stariji od perioda cenovnika.

Sintetički primer: 2.500 RSD za potvrđeno celo pakovanje od 25 kg daje 100 RSD/kg, uz delilac 25. Ako cena već važi za kg, delilac je 1. **Sama oznaka „25 kg“ ne potvrđuje osnovu cene** i ne popunjava delilac automatski.

Prenos priprema unos. Tek **Sačuvaj cene u nacrtima** na serveru proverava izvor i primenjuje jediničnu cenu na normirane količine izabranih kultura. RSD/jedinici se zaokružuje na najviše 12 decimala, ROUND_HALF_UP; izvorni iznos i delilac ostaju sačuvani. EUR se obračunava postojećom decimalnom politikom, zvaničnim kursom za izabrani datum u izvornom mesecu. Bez kursa RSD unos ostaje sačuvan sa izvorom, a EUR cena je prazna. Današnji kurs nije zamena.

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

`npm test`: 67 prolazi, bez padova ili preskakanja; uključeni su XLS/XLSX, praznine, formule bez izvršavanja, periodi, izvori, idempotentnost, zaštita admin pristupa i originala, eksplicitna osnova pakovanja, istorijska potvrda, poreklo cene u dva nacrta, kurs izvornog meseca i nedostajući kurs. Produkcioni build prolazi. Nezavisni Python čitači su uporedili svih 27.678 izdvojenih vrednosti sa originalnim ćelijama.

`scripts/inputs-browser-check.ts` koristi odvojenu sintetičku bazu/admina preko `INPUTS_E2E_URL`, `INPUTS_E2E_EMAIL` i `INPUTS_E2E_PASSWORD`. Za ponavljanje pripremite TEST izvor sa 2.500 RSD za 25 kg i TEST kurs 100 za 30.09.2026; to nisu stvarne tržišne cene ili NBS kurs.
