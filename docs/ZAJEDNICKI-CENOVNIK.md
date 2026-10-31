# Jedan cenovnik za sva gazdinstva

**Administracija → Zajednički cenovnik** je zajednička administrativna evidencija cena i odobrenih normativa. Korisnici gazdinstava koriste taj katalog za svoj proizvod i period. Ne prepisuju cenovnike, ne menjaju referentne cene i nemaju pristup drugim gazdinstvima.

## Priprema i cene

1. Kliknite **Novi cenovnik**, unesite naziv, period i razlog, pa **Pripremi kompletan cenovnik**. Svih 88 izvornih predložaka obuhvaćeno je automatski, uključujući oba stočarska intenziteta. Nije potreban izbor kultura. Novi nacrt može preneti prethodno odobrene savremene cene; arhivske cene iz 2017. ostaju prazne. Ponovljen isti zahtev ne pravi duplikate.
2. Ako već imate popunjene nacrte, otvorite **Preuzmi već unete nacrte u zajednički cenovnik → Objedini nacrte**. Grupisanje je po nazivu i periodu, uz najnoviji nacrt po kulturi. Zadržavaju se unete cene i ispravke. Preostale kulture dopunjavaju se u istom cenovniku; ne dobijaju arhivske cene. Stariji duplikati nacrta ostaju sačuvani.
3. Pregledajte **Referentne cene: STIPS i RZS dopuna**. STIPS ima prednost. Potvrdite nejasne proizvode/pakovanja; potvrđene veze pamte se za sledeći izbor. Izabrane cene čuvaju se jednom u svim odgovarajućim kartama.
4. **Zajednička tabela inputa** podrazumevano prikazuje nedostajuće ili neusaglašene cene. Unesite RSD/EUR cenu i jedinicu, datum ručnih cena/kursa i razlog, pa **Sačuvaj i rasporedi cene**. Jedan red obuhvata sve odgovarajuće kulture, bez njihovog biranja. Isključite filter da pregledate sve cene i njihove izvore. Detalj „Gde se primenjuje“ prikazuje obuhvat.
5. Seme/rasad različitih kultura, veterinarske usluge različitih kategorija, kg/t i različite formulacije ostaju zasebni. Opis ponavljanja iste operacije ne stvara novu odluku o ceni materijala. Količine, uključivanje alternativa i obračunske osnove ne menjaju se unosom cene.

Na primer, zajednička cena 0,50 EUR/kg i izvorne količine 300 i 200 kg daju zasebne troškove 150 i 100 EUR. Primer je ilustracija, nije aktuelna tržišna cena.

## Jedna cena za gorivo

Na vrhu otvorenog nacrta je **Mašinske operacije — zajednička cena goriva**. Unesite cenu po litru jednom, proverite datum i potvrdite primenu na sve povezane operacije. Svaka zadržava svoju potrošnju. Cena se prikazuje samo na tom mestu; usluge i materijali ostaju zasebni. [Obuhvat i postupak](MASINSKE-OPERACIJE.md).

## Jedna grupna potvrda

Označite **Potvrđujem jedinice celog cenovnika** tek nakon pregleda, pa **Proveri ceo cenovnik**. Jedna potvrda pokriva izvorni model i sve jasno normalizovane jedinice. Nejasne jedinice, šampinjoni/vreća, nedostajuće hranidbene osnove, nulte cene i alternative ostaju konkretni nalazi. Grupna potvrda ih ne rešava pretpostavkama.

Svi nalazi prikazuju se zajedno, grupisani po proizvodnji. **Reši posebnosti** otvara odgovarajući deklarativni model. Zatim se vratite u zajednički cenovnik i ponovite proveru. Cene koje nedostaju dopunite u zajedničkoj tabeli. Različite cene istog materijala i iste jedinice moraju se usaglasiti pre aktiviranja.

Kada je sve kompletno, označite **Odobravam ceo cenovnik** i kliknite **Potvrdi i aktiviraj ceo cenovnik**. Sve verzije aktiviraju se u jednoj transakciji. Ako bilo šta nije rešeno, nijedna kultura se ne aktivira delimično. Za isti period može postojati prethodna aktivna verzija: njena zamena i arhiviranje zahtevaju vidljivu grupnu potvrdu.

Imenovani cenovnik aktivira/arhivira se u celini. Običan korisnik nema write pristup tim endpoint-ima. Administratorska uloga ne daje pristup tuđim poslovnim podacima.

## Kurs: tačan datum i naknadni unos

RSD cena čuva originalni iznos, datum, izvor i status. Konverzija u EUR koristi samo proverenu NBS listu koja obuhvata taj datum. STIPS referenca koristi datum unutar izvornog meseca; RZS godišnja referenca 31. decembar izvorne godine. Ručni unos koristi datum iznad zajedničke tabele.

Kada kurs naknadno unesete u **NBS kursevi**, samo nerešene RSD stavke u **nacrtima** automatski dobijaju EUR vrednost. Ne morate ponovo unositi cene. Isto usklađivanje izvršava se pri pokretanju aplikacije nakon nadogradnje. **Uskladi cene sa unetim kursevima** omogućava izričito ponavljanje za postojeće nacrte. Audit beleži svaku dopunu. Aktivni/arhivski normativi, poslovni događaji, plaćanja i sačuvani izveštaji ne prepisuju se.

**Trag obračuna** prikazuje raspoloživ kurs nezavisno od toga da li je normativ kompletan. Prikazuje i tačan datum koji obračun traži: datum završetka proizvodnje ili 31. decembar obračunske godine. Kurs za drugi datum ne važi automatski za celu godinu. Za vikend/praznik koristite provereni interval važenja liste; nema proizvoljnog prenosa kursa na nepokrivene datume ili buduće liste.

Ako kurs postoji, a rezultat je nepotpun, prikaz jasno upućuje na normative/proizvodne podatke. Ako kurs nedostaje, datum je naveden uz konkretnu stavku. Praznina nije nula; nulta cena pri pozitivnoj količini zahteva razlog.

## RZS dopuna

**Preuzmi RZS dopunu cena** koristi proverenu zvaničnu tabelu prosečnih godišnjih otkupnih cena Srbije. **STIPS odgovarajući predlog ima prednost**. RZS se nudi za prepoznato seme određenih kultura ili odgovarajuća robna hraniva kada nema STIPS predloga. [Obuhvat, metodologija i uvoz](RZS-CENE.md).

RZS otkupna cena je posebna vrsta reference. Ne predstavlja ponudu dobavljača ili stvarno nastali rashod. Izvorni izvod ne navodi pouzdanu jedinicu, zato pre primene morate potvrditi jedinicu prema metodologiji/izvoru i posebno odobriti primenu kao reference inputa. Potvrđena veza se pamti. Indeksi cena ne popunjavaju polja RSD/kg ili RSD/l.

## Istorija i provera

Migracija `006_price_books.sql` dodaje imenovane cenovnike, članstvo verzija i RZS reference sa originalnim dokumentom. Postojeći poslovni podaci i izvorni Excel ostaju sačuvani. Grupni upisi čuvaju autora, razlog, izvor i reviziju; zastareli prozor ne prepisuje novije izmene.

Aktivni cenovnik menja se novom verzijom. Sačuvani snapshot izveštaja čuva prethodne normative i kurseve. Otvoreni, nesačuvani obračun koristi trenutno odobrenu verziju za ceo proizvodni period. Pre promene cenovnika sačuvajte izveštaje koje želite trajno zatvoriti. Čuvanje cene ne stvara stvarni trošak ili plaćanje.

Za poseban rad sa starim, nevezanim nacrtima postoji sklopljeni **Napredni izbor pojedinačnih nacrta**. Glavni tok ne zahteva njegovu upotrebu.

`npm test`: 101 prolazi. Zasebno je devet novih provera ponovljeno sa lokalnim PostgreSQL 18. Samostalna browser provera `npx tsx scripts/price-books-browser-check.ts` pravi privremenu TEST bazu i server, proverava ceo katalog, STIPS/RZS/ručni unos, grupnu potvrdu i mobilni prikaz, pa uklanja TEST bazu. Ne povezivati je sa poslovnom bazom. Detaljna evidencija: [VERIFIKACIJA.md](VERIFIKACIJA.md).
