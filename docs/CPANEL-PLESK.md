# Testna objava preko cPanel / Plesk panela

Željena adresa je `https://agroportal.fitkoncept.rs`. Sam domen i pristup kontrolnom panelu ne potvrđuju da hosting može pokrenuti ovu aplikaciju. Potrebna je serverska Node.js aplikacija; statički frontend ili PHP hosting sami nisu dovoljni.

Korisnik je potvrdio cPanel, ali u nalogu nije pronašao opciju za Node.js. Dostupnost te funkcije nije nezavisno proverena. Trenutni preduslov za objavu je potvrda operatera hostinga.

## Dostavljeni podaci o hostingu

Podatke je dostavio korisnik; nisu očitani direktnim pristupom serveru.

| Stavka | Dostavljeni podatak | Značenje za aplikaciju |
| --- | --- | --- |
| Paket / server | SuperPro / dodo | Provajder, pristup i ograničenja naloga nisu potvrđeni |
| Panel | cPanel 134.0, build 66 | Verzija panela ne potvrđuje da je Node.js omogućen nalogu |
| Sistem | Linux x86_64, kernel 4.18.0-553.141.2.lve.el8.x86_64 | Odgovarajuća osnovna platforma; konkretno izvršavanje nije provereno |
| Web server | Apache 2.4.69 | Potrebno usmeravanje poddomena ka podržanoj Node aplikaciji |
| Navedena baza | MariaDB 10.11.19 | Nije podržani servis baze trenutne aplikacije; dostupnost PostgreSQL-a ostaje nepoznata |
| Deljena IP adresa | 45.80.133.137 | Ne dokazuje namenski VPS, root pristup ili DNS podešavanje poddomena |
| Sendmail | /usr/sbin/sendmail | Sama putanja ne potvrđuje SMTP konfiguraciju koju aplikacija trenutno koristi |

Za mali test zaseban PostgreSQL servis **nije obavezan** ako operater potvrdi da podržava Node.js i tačno jedan proces aplikacije, bez preklapanja pri restartu, sa privatnim trajnim direktorijumom za ugrađeni PGlite. U ostalim procesnim modelima koristiti podržani PostgreSQL servis. Prisustvo samo MariaDB-a nije razlog da se aplikacija automatski prebacuje na tu bazu; to bi bio zaseban razvojni posao.

## Poruka za podršku hostinga

> Koristim paket SuperPro, server dodo, cPanel 134.0 build 66. Želim da na poddomenu agroportal.fitkoncept.rs pokrenem testnu Node.js aplikaciju. U cPanel-u ne vidim Setup Node.js App ni Application Manager. Da li moj paket podržava Node.js najmanje 22.12 (preporučeno 24), stalni aplikacioni proces i instalaciju zaključanih npm zavisnosti? Potreban je privatni application root izvan public_html, trajno čuvanje podataka i HTTPS za taj poddomen. Za mali test možemo koristiti ugrađenu PostgreSQL bazu ako garantujete tačno jedan proces bez preklapanja pri restartu i privatni trajni direktorijum; u suprotnom, da li nudite PostgreSQL servis (u informacijama je navedena MariaDB)? Ako koristite Passenger, molim potvrdite dostupnu verziju, način pokretanja startup fajla app.cjs i prosleđivanja porta. Molim navedite raspoložive memorijske/procesne limite, šta je uključeno u postojeći paket, eventualne dodatne troškove i koje opcije treba omogućiti u mom panelu.

Poruka je pripremljena za korisnika; nije poslata podršci. Ne slati lozinku za cPanel ili tajne aplikacije uz ovaj upit. Ako postojeći paket nema ovu podršku, poddomen može ostati postojeći, a aplikacija se postaviti na poseban odgovarajući server nakon izbora hostinga i odobrenja eventualnih troškova.

## Šta proveriti u panelu

U cPanel-u potražite **Setup Node.js App** ili **Application Manager**. U Plesk-u otvorite željeni domen i potražite **Node.js**. Proverite dostupnu verziju: minimum **22.12**, preporuka **24**. Ako opcija ne postoji, od tehničke podrške hostinga tražite potvrdu Node.js podrške, trajnog procesa i PostgreSQL-a, bez slanja lozinki kroz chat.

Pre instalacije operater treba da potvrdi:

- HTTPS sertifikat za taj poddomen i ispravno usmerenje zahteva ka Node.js aplikaciji.
- Node.js 22.12+ i mogućnost izvršavanja `npm ci` i `npm run build` ili dostave već izgrađenog frontenda.
- Privatni direktorijum aplikacije izvan `public_html` / `httpdocs`. Javni document root sme sadržati samo javne fajlove, npr. sadržaj `dist`; **ne postavljati ceo projekat u javni direktorijum**. Baza, `.env`, izvorni Excel i serverski kod moraju ostati privatni.
- PostgreSQL servis (preporučen za hosting panele) i njegovu adresu/TLS parametre. Ugrađeni PGlite sme se koristiti samo ako operater garantuje jedan proces bez preklapanja pri restartu i privatni trajni direktorijum. Passenger može pokretati više procesa; sam naziv panela nije takva garancija.
- Raspoloživu memoriju, prostor, backup i restart postupak. Pri promeni platforme proveriti izvršive zavisnosti, posebno esbuild i PDF parser.

## Konfiguracija Node aplikacije

U privatnom application root-u sačuvajte izvorni paket, bez tuđe ili lokalne poslovne baze i bez `node_modules` sa drugog operativnog sistema. Kroz panel podesite:

| Promenljiva | Vrednost / izvor |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_URL` | `https://agroportal.fitkoncept.rs` |
| `BETTER_AUTH_SECRET` | Nova nasumična tajna, najmanje 32 znaka, privatno generisana i sačuvana |
| `DATABASE_URL` | Privatna konekcija ka zasebnoj PostgreSQL bazi, ako se koristi taj režim |
| `DATABASE_SSL` | `true` kada servis zahteva verifikovan TLS, uz odgovarajući CA |
| `DATA_DIR` | Samo za ugrađenu bazu: apsolutna putanja izvan javnog document root-a |
| `SMTP_URL`, `MAIL_FROM` | Stvarni email servis za reset lozinke |
| `TRUST_PROXY_HOPS` | Po topologiji koju potvrdi operater; ne uključivati poverenje u proizvoljna klijentska zaglavlja |

Paket sadrži **`app.cjs`** kao početni fajl za panel koji traži CommonJS entry point. On učitava postojeći TypeScript server preko zaključane `tsx` biblioteke. `tsx` je trenutno u razvojnom delu zaključanih zavisnosti: instalirati i dev zavisnosti (`npm ci --include=dev`), čak i kada je aplikacija u production režimu. Posle toga pokrenuti `npm run build` i podesiti startup file `app.cjs`.

Podrška Passenger-a, prosleđivanje porta, broj procesa i migracije moraju se proveriti na konkretnom hostingu pre deljenja linka. Ovaj startup fajl nije dokaz da je svaka cPanel/Plesk konfiguracija kompatibilna. Ako panel obezbeđuje sopstvenu komandu umesto startup fajla, podržana komanda projekta je `npm start`.

Za prvi start koristiti jednu instancu radi migracije i arhivskog uvoza. Spoljni PostgreSQL put nije operativno potvrđen sa konkretnim hosting servisom; ne predstavljati ga kao već proverenu objavu. Više instanci zahteva dodatno usaglašavanje migracija, distribuirani auth rate limit i koordinisane pozadinske poslove.

## Provera pre slanja linka

`/healthz` treba da vrati samo `{"status":"ok"}` preko javnog HTTPS domena. Registracija i prijava treba da rade uz sigurne kolačiće. Proveriti dva odvojena probna gazdinstva, čuvanje i ponovno učitavanje podataka posle restarta, PDF/XLSX i reset emailom. Privatne putanje poput `/.env`, `/data/` i `/source/` ne smeju biti dostupne ni kroz web server hostinga.

Objava još nije izvršena. Javni domen, sertifikat, panel, procesni model i stvarna baza proveravaju se nakon pristupa tom hostingu. Ako hosting nema potrebnu Node.js podršku, alternativni [Docker paket za VPS](TESTNA-OBJAVA.md) može raditi na zasebnom serveru, dok se isti poddomen usmeri na njega; dodatni plaćeni server ne naručivati bez odobrenja.
