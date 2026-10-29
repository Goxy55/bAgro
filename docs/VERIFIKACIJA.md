# Provereni rezultat

Preseljenje u `Goxy55/bAgro` provereno je 27.10.2026. Aplikacija je u korenu `/workspace/bAgro`; ažurirani su README, CI putanje i uputstvo za VPS. Pre pomeranja napravljena je privatna rezervna kopija van repozitorijuma i proverene kontrolne sume svih izvornih i lokalnih podatkovnih fajlova. Programski kod, testovi, manifest i lockfile zavisnosti, kao i originalni Excel, ostali su neizmenjeni. Lokalna baza i tajne su sačuvane i isključene iz Gita.

Sa nove putanje prošli su `npm ci --cache /tmp/agro-npm-cache`, `npm run build` i svih 43 testa. Razvojni server je pokrenut iz novog korena: `/` i `/healthz` vraćaju 200, anonimni `/api/bootstrap` vraća 401, a privatne putanje vraćaju 404. Izvršavanje CI-ja na GitHub-u i javna objava nisu deo ove provere.

- `npm ci`: uspešna instalacija zaključanih zavisnosti.
- `npm run build`: stroga TypeScript provera i produkcioni frontend build prolaze.
- `npm test`: **85 prolazi, 0 pada, 0 preskočeno**. Test baze i sintetički TEST podaci su u odvojenom privremenom direktorijumu. Uključena je provera zahteva za javni HTTPS, adresu aplikacije, tajnu i eksplicitno poverenje u proxy, zajednički admin cenovnik i grupni STIPS predlozi.
- Ekstrakcija: 10 originalnih sheetova, 88 predložaka, 44 spoljne formule, 342 zabeležena nalaza. Svih pet zadatih istorijskih regresija prolazi toleranciju 0,000001 EUR.
- Originalni XLSX je bajt-po-bajt upoređen sa prilogom; SHA-256 je `422571958ad758ed1eaf206cce6b5751b4dc4546629940a7edad9aff53314a5a`.
- Browser: registracija, otvaranje gazdinstva, unos proizvodnje, nacrt i ponovna dopuna prodaje, tržišno prazno stanje, reload sesije, 390px telefon bez horizontalnog skrola. Nema browser pageerror-a. Izvršeno na razvojnom i lokalnom produkcionom serveru, sa odvojenom test bazom.
- Backup ugrađene PostgreSQL baze i restore uz SHA-256 u novi direktorijum uspešni; vraćene tabele su pročitane. Izvorna baza nije prepisana.
- HTTP putanje `/data/auth-secret`, `/source/izvor-2017.xlsx`, `/server/auth.ts`, `/.env` vraćaju 403/404; aplikacija vraća 200. Privatni fajlovi se ne serviraju statički.
- `npm audit`: 0 prijavljenih ranjivosti. Transitivni ExcelJS `uuid` je zaključan na popravljeni CommonJS-kompatibilan 11.1.1; nisu korišćeni isključena verifikacija paketa, TLS-a ili checksum-a.
- Postojeći praćeni fajlovi ranijih prototipova su neizmenjeni. `node_modules`, privatna baza, reset poruke, auth secret, backup-i i build izlazi su ignorisani u Gitu.

- STIPS modul: migracija postojeće baze, parsiranje PDF/HTML, mapiranje, pregled i eksplicitna objava, revizije, povlačenje i očuvanje podataka pri neuspešnom osvežavanju prolaze. Browser provera prošla je i na telefonu od 390 px; videti [STIPS dokumentaciju](STIPS.md).
- Zajednički admin cenovnik: jedna cena se primenjuje na više nacrt-verzija uz sačuvane zasebne količine. Testovi pokrivaju stvarne izvorne grupe, generičko seme po kulturi, kg/t, EUR/RSD, kurs, prazne/nulte cene, atomarnost, zastarele prozore i nepromenljive aktivne/arhivske verzije i snapshot-e. Browser provera na zasebnoj bazi proverava ječam/pšenicu, 0,50 EUR × 300 kg = 150 EUR po karti, trajnost posle reload-a i mobilnu tabelu. Slike sadrže samo TEST podatke; [uputstvo](ZAJEDNICKI-CENOVNIK.md).
- Hosting panel startup: `node app.cjs` pokrenut je u lokalnom production režimu sa zasebnom privremenom bazom i generisanom test tajnom. Početna stranica i `/healthz` rade; anonimni `/api/bootstrap` vraća 401, a `/.env`, `/data/auth-secret` i `/source/inventory.json` vraćaju 404. Proces je uredno zaustavljen. To potvrđuje početni fajl, ne konkretnu Passenger/cPanel/Plesk instalaciju.
- Docker Compose interpolacija/struktura (`config --quiet`) i Caddy konfiguracija (`caddy validate`, verzija 2.11.7) prolaze. Korišćena je sintetička tajna; javni servisi i sertifikati nisu napravljeni. Image build nije dovršen: instalacioni korak je prekinut, a nastavak rada usmeren je na prijavljeni cPanel/Plesk hosting. To nije provera pokretanja aplikacije u kontejneru.

## Šta nije potvrđeno

RZS katalog i šest JSON izvoda su preuzeti, a godišnji nacionalni podaci validirani i podržani u aplikaciji; videti [RZS postupak](RZS.md). Potvrđeni su i STIPS XLS/XLSX inputi. Preostalo je posebno proveriti živo NBS ažuriranje, automatski STIPS PDF tok, druge statističke/trgovinske klasifikacije i njihova mapiranja.

Spoljni SMTP, Passenger/cPanel/Plesk integracija i javni HTTPS hosting nisu operativno testirani. Putanja sa zasebnim PostgreSQL 18 lokalno je naknadno proverena, kako je opisano ispod. Docker/Compose paket je pripremljen; puna provera kontejnerske objave još nije završena. Nisu napravljeni plaćeni resursi niti javno objavljena aplikacija.

Za `agroportal.fitkoncept.rs` lokalno DNS razrešavanje nije uspelo, a HTTPS zahtev je odbio egress proxy sa 403 pre uspostavljanja veze sa domenom. Iz toga se ne može zaključiti da je DNS domena neispravan. Potrebna je provera iz korisnikovog hostinga ili druge mreže.

Cene 2017 ostaju arhiva. Stvarni aktuelni cenovnici i zvanične kursne liste zahtevaju dokumentovano administratorsko odobrenje; aplikacija ih ne izmišlja.

## GitHub / Render priprema — 29.10.2026.

- `render.yaml` je validiran prema JSON šemi preuzetoj sa `https://render.com/schema/render.yaml.json`. Provereni su aktuelni nazivi planova, cene, privatna konekcija baze i vezivanje `APP_URL` za dodeljenu adresu. To je provera konfiguracije, bez kreiranja Render resursa.
- `npm run build` i svih **76 testova** prolaze. Nisu dodavani paketi ili menjane verzije zavisnosti.
- Produkciona Node aplikacija je pokrenuta na zasebnom lokalnom portu sa pravim PostgreSQL 18 servisom (`postgres:18-alpine`, digest `sha256:10a5c69a83035ab5239f5620d708520e8b28f5aa1f2b20143e6024532edadfb5`). Baza je bila privremena i odvojena od privatne PGlite baze.
- Prošle su četiri migracije, 88 arhivskih predložaka i `prepare:hosted-test`: 202 RZS serije / 4.313 opažanja i 21 STIPS cenovnik. Ponovljena priprema preskače oba uspešno završena javna izvora, bez duplikata i bez aktiviranja aktuelnih normativa.
- API provera na zasebnom PostgreSQL-u: dve registracije, različita gazdinstva, administratorska dodela postojećem nalogu, odbijeni tuđi ID-jevi i izvoz, nepotpun rezultat bez normativa, 2,5 ha × odobren sintetički normativ, marža 40.000 / 100.000 RSD = 40%, delimična naplata 40.000 RSD u drugom mesecu, ostatak 60.000 RSD, PDF/XLSX i snapshot. Sintetički normativ i kurs korišćeni su isključivo u privremenoj test bazi i nisu deo hosting pripreme.
- Posle restarta samo aplikacionog procesa ostali su važeća sesija, poslovni podaci, snapshot i izolacija dve farme.

Stvarni Render deploy, njegovi memorijski limiti, HTTPS/proxy, DNS, SMTP i Render backup/restore čekaju vlasnikov nalog i proveru prve objave. Lokalna provera PostgreSQL-a ne potvrđuje te spoljne usluge. [Postupak i cena](RENDER.md), [koraci za testere](USER-TESTING.md).

## Grupno povezivanje STIPS cena — 29.10.2026.

Migracija `005_input_price_links.sql` dodaje potvrđene veze materijala, jedinice, proizvoda/proizvođača, pakovanja i delioca, bez izmene privatnih poslovnih zapisa ili originalnog Excela. Ponovljena migracija čuva postojeću bazu.

Prošlo je svih 85 testova i produkcioni build. Pokriveni su: nedvosmisleni nazivi, različite formulacije i nutritivni procenti, kg/g/t naspram l/ml, nejasne setvene jedinice, seme naspram stočne hrane, lokalno mesto i izvorni period, više ponuda, čuvanje postojećih cena, nedostajući kurs uz sačuvan RSD, zaštita zastarelog prozora, prava pristupa i poništavanje cele transakcije pri grešci. Poziv predloga ne popunjava bazu normativa i ne aktivira verzije.

Browser provera na zasebnom lokalnom produkcionom serveru proverava automatski predlog, primenu na ječam/pšenicu, poreklo i konverziju, trajnost posle reload-a i pamćenje veze za sledeći izbor. Više operacija istog materijala prikazuje se kao jedna odluka o ceni uz zasebne očuvane količine. Telefon 390 px nema horizontalno prekoračenje stranice, a sve kolone ostaju dostupne u tabeli. Slike u `docs/screens/stips-suggestions-*.png` su sintetički označene.

Ponovljene su i postojeće browser provere zajedničke ručne cene i pojedinačnog STIPS izbora: čuvanje/reload, različita semena, eksplicitna osnova, kurs izvornog meseca, poreklo, Escape i mobilni prikaz prolaze. Skripte otvaraju novi sklopljeni detalj kada testiraju ručnu matricu.

Svih 21 ranije preuzetih javnih STIPS XLS/XLSX originala uvezeno je u odvojenu bazu i provereno povezivanje sa svih 88 predložaka, bez aktiviranja normativa, upisa cena u njihove modele ili dodavanja kurseva. [Javni audit pokrivenosti](../source/stips-price-coverage-2026-10-29.json) navodi stvarni obuhvat za Beograd / 29.10.2026. Pesticidi, đubriva i semenski cenovnici ne pokrivaju sve operacije i stočarska hraniva. Ova provera nije novo mrežno osvežavanje.
