# Provereni rezultat

Preseljenje u `Goxy55/bAgro` provereno je 27.10.2026. Aplikacija je u korenu `/workspace/bAgro`; ažurirani su README, CI putanje i uputstvo za VPS. Pre pomeranja napravljena je privatna rezervna kopija van repozitorijuma i proverene kontrolne sume svih izvornih i lokalnih podatkovnih fajlova. Programski kod, testovi, manifest i lockfile zavisnosti, kao i originalni Excel, ostali su neizmenjeni. Lokalna baza i tajne su sačuvane i isključene iz Gita.

Sa nove putanje prošli su `npm ci --cache /tmp/agro-npm-cache`, `npm run build` i svih 43 testa. Razvojni server je pokrenut iz novog korena: `/` i `/healthz` vraćaju 200, anonimni `/api/bootstrap` vraća 401, a privatne putanje vraćaju 404. Izvršavanje CI-ja na GitHub-u i javna objava nisu deo ove provere.

- `npm ci`: uspešna instalacija zaključanih zavisnosti.
- `npm run build`: stroga TypeScript provera i produkcioni frontend build prolaze.
- `npm test`: **57 prolazi, 0 pada, 0 preskočeno**. Test baze i sintetički TEST podaci su u odvojenom privremenom direktorijumu. Uključena je provera zahteva za javni HTTPS, adresu aplikacije, tajnu i eksplicitno poverenje u proxy, kao i zajednički admin cenovnik.
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

Putanja sa spoljnim PostgreSQL servisom, spoljni SMTP, Passenger/cPanel/Plesk integracija i javni HTTPS hosting nisu operativno testirani. Lokalni razvoj i produkcioni build provereni su na ugrađenom PostgreSQL-u. Docker/Compose paket je pripremljen; puna provera kontejnerske objave još nije završena. Nisu napravljeni plaćeni resursi niti javno objavljena aplikacija.

Za `agroportal.fitkoncept.rs` lokalno DNS razrešavanje nije uspelo, a HTTPS zahtev je odbio egress proxy sa 403 pre uspostavljanja veze sa domenom. Iz toga se ne može zaključiti da je DNS domena neispravan. Potrebna je provera iz korisnikovog hostinga ili druge mreže.

Cene 2017 ostaju arhiva. Stvarni aktuelni cenovnici i zvanične kursne liste zahtevaju dokumentovano administratorsko odobrenje; aplikacija ih ne izmišlja.
