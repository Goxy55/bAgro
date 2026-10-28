# STIPS modul — uvoz, pregled i lokalne cene

Modul je deo istog Agro portala: koristi postojeću autentikaciju, admin ulogu, PostgreSQL/PGlite, audit log i React interfejs. Nema plaćenog servisa ili novog naloga kod treće strane. STIPS podaci su javni referentni podaci, odvojeni od privatnih poslovnih podataka gazdinstava i nacionalnih RZS serija. Ne menjaju cenovnike normativa automatski.

## Kako se koristi

1. Prijavite se kao administrator i otvorite **Administracija → STIPS bilteni**.
2. Kliknite **Uvezi bilten**. Podržani su PDF i sačuvana HTML stranica, do 8 MB, najviše 40 PDF strana.
3. Unesite tačan zvanični URL originala, naziv, datum objave i period cena. Ako datumi nisu poznati, ostavite nacrt; aplikacija ih ne uzima proizvoljno iz naziva fajla ili datuma preuzimanja. Dokumentujte proveru uslova korišćenja pre objave.
4. Preuzmite **Original** i uporedite ga sa izdvojenim tekstom/tabelama. Original je sačuvan bez izmene, sa SHA-256 kontrolom.
5. Za tabelu sa mestima po kolonama otvorite **Pregled tabela i mapiranje kolona na mesta**. Odaberite prvi red podataka, kolonu proizvoda/jedinice/kvaliteta i kolone cena. Svakoj cenovnoj koloni eksplicitno dodelite konkretno mesto, tržište, valutu i vrstu cene. Tabela se pretvara u zasebne lokalne predloge. Pregledani i objavljeni redovi se ne prepisuju novim mapiranjem.
6. Otvorite **Pregledaj red**. Proverite proizvod, mesto, pijacu/područje otkupa, vrstu cene, jedinicu, valutu, cenu ili raspon, period i kvalitet. Izvorni red/stranica ostaju povezani sa cenom. Navedite razlog odobrenja i kliknite **Odobri i objavi cenu**.
7. Korisnici vide odobrene podatke u **Tržište Srbije → STIPS · lokalne cene**, sa filterima i originalnim dokumentom. Nema automatskog nacionalnog proseka, lažne tražnje ili menjanja poslovnog rezultata gazdinstva.
8. Izmena nacrta već objavljenog reda ne menja vidljivu cenu. Ponovna eksplicitna objava pravi reviziju i čuva prethodnu verziju. **Povuci objavu** uklanja trenutnu cenu iz pregleda uz očuvanje istorije.

Za probu postoji `tests/fixtures/stips-synthetic.html`, jasno označena sintetička datoteka. Koristite je isključivo u posebnom TEST gazdinstvu/bazi. To nisu stvarne STIPS cene. U testu koristite označeni TEST izvor i belešku o sintetičkom poreklu; ne predstavljajte primer kao preuzet zvanični bilten.

## Automatsko preuzimanje

Početno je **isključeno**. U podešavanjima administrator navodi stvarne STIPS stranice sa direktnim PDF linkovima i belešku o proverenim uslovima. Jedina početna adresa je poznata početna stranica, ne izmišljen API. Ako ona nema linkove ka biltenima, potrebno je navesti stvarnu stranicu sa biltenima.

- **Proveri pristup sajtu** proverava dostupnost početne stranice. Ne potvrđuje prava preuzimanja, metodologiju ili uspeh PDF parsera.
- **Preuzmi dostupne biltene** pokreće jednu kontrolisanu proveru posle podešenih uslova.
- Kada je raspored uključen, server proverava kada je sledeći termin na svakih 60 sekundi i radi po podešenom razmaku 6–168 sati. Podrazumevani razmak je 24 sata, do 5 dokumenata; to je razmak provere linkova, ne tvrdnja o ritmu objavljivanja izvora.
- Dozvoljene su samo HTTPS adrese `www.stips.minpolj.gov.rs` i `stips.minpolj.gov.rs`, bez korisničkih kredencijala, drugih portova ili spoljnog preusmeravanja. Poštuju se zabrane i crawl-delay iz robots.txt, sa najmanje sekundom između zahteva istom izvoru. Ako izvor traži više od 60 sekundi razmaka, ova verzija zaustavlja automatski uvoz i ostavlja ručni tok.
- Preuzimanje je sekvencijalno, sa vremenskim/veličinskim ograničenjima, najviše 3 ulazne stranice i 10 dokumenata po proveri. Koristi postojeću proxy konfiguraciju i zadržava TLS verifikaciju.
- Preuzeti bilteni ulaze samo u pripremu. Nema automatske objave cena.
- Greška osvežavanja ostavlja poslednje odobrene podatke, beleži neuspeh i prikazuje upozorenje. Zaključavanje i vremenski ograničen lease sprečavaju paralelne poslove. Novi pokušaj ide po narednom terminu ili eksplicitnim pokretanjem, bez neograničenog brzog ponavljanja.

**Pristup je naknadno potvrđen za arhivu INPUTI i njene XLS/XLSX priloge**, koji imaju zaseban [adapter i administrativni modul](STIPS-INPUTI.md). Ranije provere su vraćale proxy 403. Živo preuzimanje i parsiranje PDF biltena kroz opisani automatski PDF tok ostaje nepotvrđeno; njegovi testovi koriste kontrolisane odgovore.

## Obrada i pravila

- PDF se čita pomoću `pdf-parse`/PDF.js sa isključenom evaluacijom koda; tabele se izdvajaju iz geometrije. HTML se parsira preko Cheerio bez izvršavanja skripti.
- Ako mreža tabele nije prepoznata, prikazuju se tekst i upozorenje. Skenirani ili nečitljivi PDF dobija status za ručni unos/OCR. OCR servis nije implementiran niti se izmišlja prepoznata cena.
- Različiti rasporedi tabela ne tumače se proizvoljno: za matricu se koristi eksplicitno mapiranje, a za ostalo pojedinačna provera.
- Prazno, crtica ili neprepoznata vrednost ostaju nepoznati. `1.234,50` se čita kao `1234.5`. Raspon `90–110` ostaje raspon; ne računa se izmišljena srednja cena. Eksplicitna nula zahteva razlog.
- Pre objave su obavezni datum objave, period, dokumentovana provera izvora, proizvod, konkretno mesto/tržište, vrsta cene, jedinica i valuta. Ne prihvata se mesto „Srbija“ kao zamena za lokalno tržište.
- Cena čuva izvornu adresu, SHA-256 dokumenta, stranicu i citat, datum objave/preuzimanja/provere, jedinicu, valutu, kvalitet i reviziju. „Period završen pre X dana“ opisuje starost podatka i nije obećanje da je cena još aktuelna.
- Isti binarni dokument ima jedan hash i ne uvozi se dvaput; isti mapirani red ima stabilan izvorni ključ. Objava nepromenjenog reda ne dodaje reviziju. Istorija objavljenih verzija ostaje nepromenljiva.
- Dokumenti se čuvaju u `bytea` koloni baze, pa postojeći backup/restore uključuje i originalne biltene. Rastuća arhiva zahteva disk i redovan backup; hosting nije nužno besplatan.

## Tehničke putanje

- Migracija: `migrations/002_stips.sql`; postojeća v1 baza se nadograđuje bez resetovanja.
- Server: `server/stips/{schema,extract,service,crawler,routes}.ts`.
- UI: `client/stips.tsx`; ugrađen u postojeće administrativne i tržišne kartice.
- Auth korisnici: `GET /api/stips`, `GET /api/stips/documents/:id/file` (kopija dostupna tek kada postoji objavljena cena).
- Admin: `/api/admin/stips` — dokumenti, upload, metapodaci, mapiranje, ručni redovi, nacrti, objava/povlačenje, istorija, podešavanja, provera pristupa i preuzimanje.
- Sve mutacije prolaze postojeću proveru sesije, uloge i Origin-a. Otpremanje se obrađuje tek posle administratorske provere.

## Verifikacija

`npm test`: **42 prolazi, 0 pada**. Novi testovi pokrivaju nadogradnju postojeće baze, stvarno PDF parsiranje sintetičke tabele, HTML bez skripti, skenirani dokument, srpske decimale i raspone, mapiranje matrice, idempotentnost, zabranu objave nepotpunih/nacionalno pogrešno označenih cena, nepromenljiv objavljeni snapshot do nove potvrde, istoriju i povlačenje, ovlašćenja, ograničenje fajlova, robots pravila i neuspeh osvežavanja uz očuvanje podataka. Ranijih 26 provera ostaje zeleno.

Browser provera: `scripts/stips-browser-check.ts` koristi unapred kreiran **admin TEST nalog i odvojenu bazu**; vrednosti se prosleđuju kroz `STIPS_E2E_EMAIL`, `STIPS_E2E_PASSWORD` i opciono `STIPS_E2E_URL`. Provereni su upload → mapiranje → pregled → eksplicitna objava → tržište → preuzimanje originala, kao i telefon širine 390 px bez horizontalnog skrola i bez browser pageerror-a. Slike u `docs/screens/stips-*.png` imaju samo označene test podatke.
