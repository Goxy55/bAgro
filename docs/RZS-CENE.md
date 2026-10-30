# RZS godišnje cene kao dopuna inputima

Proveren javni izvor je [Prosečne godišnje otkupne cene poljoprivrednih proizvoda](https://data.stat.gov.rs/Home/Result/0302010302?languageCode=sr-Latn). Preuzimanje 31.10.2026. po beogradskom vremenu potvrdilo je 204 opažanja za 68 proizvoda, godine 2023–2025; 199 dostupnih pozitivnih vrednosti. [Kontrolna suma i audit](../source/rzs-price-audit-2026-10-31.json).

To su nacionalne godišnje **otkupne cene**, koje se razlikuju od lokalnih STIPS ponuda i nabavnih cena dobavljača. Ne koriste se za evidenciju izvršene kupovine ili plaćanja. Administracija može odobriti odgovarajuću otkupnu cenu kao referencu inputa za određeno seme ili robno hranivo. Ne dodeljuje se šira robna kategorija konkretnom preparatu.

## Preuzimanje i provera

U **Administracija → Zajednički cenovnik** otvorite nacrt i kliknite **Preuzmi RZS dopunu cena**. Adapter proverava robots.txt, koristi zvaničnu HTTPS adresu i vremenska/veličinska ograničenja, parsira isključivo literalni JSON niz prikazane tabele, bez izvršavanja JavaScript-a. Čuva originalni HTML, SHA-256, izvorni URL, datum prijema/preuzimanja i originalne dimenzije/status svake vrednosti. Jednaki original ponovo se ne uvozi. Revizije ostaju kao novi originali; bira se poslednji izvod po proizvodu i godini.

Ako izvor promeni strukturu, vrati grešku ili nije dostupan, prethodni originali ostaju sačuvani. Nema izmišljene API adrese ili cene. Datum objave nije utvrđen i ne izjednačava se sa datumom preuzimanja. Poverljive, nedostajuće i nepozitivne/neprepoznate vrednosti nisu predlozi cena.

CLI za operatera:

```sh
npm run import:rzs-prices
# Ili prethodno preuzeta zvanična stranica, za proverljiv uvoz bez mreže:
npm run import:rzs-prices -- /putanja/do/rzs-stranice.html
```

Kod offline uvoza sačuvani datum je prijem fajla u aplikaciju; stvarni raniji datum preuzimanja proverava se kroz operatersku evidenciju.

Za lokalni PGlite prvo zaustavite aplikaciju; native PostgreSQL podržava operaterski uvoz uz aktivan server. Ne izvršavati nad poslovnom bazom dok se testiraju sintetički fixture-i. Render priprema sa `SEED_PUBLIC_REFERENCES=true` pokušava zasebno početno preuzimanje ovog izvora; neuspeh ne briše druge izvore niti blokira samu aplikaciju.

## Jedinice i granice automatizacije

Ovaj konkretan RZS izvod ima `IDJedinicaMere=0`, a naziv indikatora `[nema]`. Ne tvrdimo da je kg potvrđen za sve proizvode. **Izvorna jedinica je obavezna admin odluka pre primene.** Za prepoznato suvo seme/hranu interfejs nudi kg kao predlog ciljne jedinice; potrebno je proveriti i izabrati izvornu jedinicu i grupno potvrditi model/proizvod. kg/t konvertuje se decimalnom aritmetikom; l i kg ne mogu se mešati. Nema primene ako potvrda jedinice ili posebna potvrda otkupne reference nije data.

STIPS kandidati imaju prednost. RZS rezerva obuhvata tačno prepoznate robe: pšenica/soja/suncokret seme, semenski krompir i odgovarajući kukuruz, pšenica, ovas, raž, soja ili lucerka kao hranivo. Nije automatski pokriven svaki input, hibrid, kategorija životinja ili sastav smeše. Potvrđene veze proizvoda i jedinica pamte se globalno uz autora i audit. Promena normativa i aktivacija su zasebne, eksplicitne admin radnje.

Izvorni period ostaje kalendarska godina. Referentni kurs je za 31. decembar te godine; nedostatak NBS liste ostavlja sačuvan RSD unos i praznu EUR cenu u nacrtu. Po naknadnom unosu tog kursa nacrti se usklađuju. Starija godišnja referenca zahteva prihvatanje i ne označava se kao tekuća tržišna ponuda.

RZS OData skup **03020201IND02** sadrži indekse cena repromaterijala, sredstava rada i usluga, a ne iznose RSD/kg. Ne koristi se kao jedinična cena i ne vrši se skriveno indeksiranje cena iz 2017. Dokumentovan adapter ove druge godišnje tabele ne znači da je proširen prethodni RZS statistički modul na sve cene i sve periode.
