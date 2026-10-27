# bAgro — Agro portal

Portal za poljoprivrednu proizvodnju. Funkcionalna lokalna aplikacija na srpskoj latinici za odvojena gazdinstva, ostvarenu proizvodnju, obračunsku maržu, poslovne događaje i ostvareni novčani tok. Aplikacija je samostalna i nalazi se u korenu repozitorijuma `Goxy55/bAgro`.

## Pokretanje

Potrebni su Node.js **22.12+** (provereno na 24.19.0) i npm. Verzije paketa su tačno zaključane u `package.json` i `package-lock.json`. Za ponovnu ekstrakciju izvornog Excela potreban je Python 3.10+ i `openpyxl==3.1.5`; generisani inventar je već uključen.

```sh
cd /workspace/bAgro
npm ci
cp .env.example .env
npm run dev
```

Otvorite aplikaciju na portu **3000** u svom lokalnom okruženju. Razvojni server i API rade u istom procesu. Registrujte nalog (lozinka najmanje 12 znakova), zatim otvorite gazdinstvo. Nema ugrađenog zajedničkog naloga, test gazdinstva ili savremenih cena. Razvojni auth secret automatski se generiše lokalno u ignorisanom `data/auth-secret`; ne ulazi u repozitorijum.

Prvi start automatski primenjuje migraciju i idempotentno uvozi 88 arhivskih predložaka. Izvorne cene 2017 **nisu aktivne**. Nedostatak aktivnog normativa ili kursa prikazuje se kao nepotpun obračun; ne pretpostavljaju se nule.

### Administrator

Zaustavite razvojni server pre CLI rada sa ugrađenom bazom. Postavite `ADMIN_EMAIL`, `ADMIN_PASSWORD` i opciono `ADMIN_NAME` preko bezbednog okruženja, pa pokrenite `npm run admin`. Lozinka mora imati najmanje 12 znakova. Za postojeći nalog dodeljuje se uloga, bez promene njegove lozinke. Ne upisujte lozinke u Git ili javne logove.

Administrator zatim u aplikaciji:

1. Klonira istorijsku kartu u novu verziju sa periodom važenja i razlogom.
2. Unosi nove proverene cene; prazne cene se ne preuzimaju iz 2017.
3. Potvrđuje jedinice, vremensku osnovu, nezavisne hranidbene blokove i alternative. Neprimenljive stavke isključuje sa razlogom; nulte cene potvrđuje razlogom.
4. Posebno potvrđuje jedinicu vreća za šampinjone. Za rasad zadržava odgovarajuću referentnu seriju.
5. Aktivira kompletan model. Aktivna verzija se ne uređuje direktno; za izmenu pravi novu verziju i arhivira prethodnu.
6. Unosi proverene zvanične NBS liste sa intervalom važenja. Bez kursa se poslovni događaj može sačuvati kao nacrt i kasnije dopuniti.

Nalog sa globalnom admin ulogom **ne dobija automatski pristup privatnim farmama**. Autorizacija se proverava preko stvarnog članstva u svakoj API putanji i izvozu. Klijentov `farm_id` ne određuje pristup.

### Zajednički unos cena po kulturama

U **Administracija → Zajednički cenovnik** pripremite nacrte za više kultura istog perioda i unosite cenu iste stavke jednom. Tabela zadržava posebne normirane količine i troškove u kolonama kultura. Podržani su EUR i RSD sa datumom kursa; seme različitih kultura i različite jedinice ostaju odvojeni. Čuvanje cena ne aktivira normative. Detaljno [uputstvo za zajednički cenovnik](docs/ZAJEDNICKI-CENOVNIK.md).

### Standardni rad

- Unesite ostvarenu površinu/broj grla i količinu proizvoda. Nacrt može biti nepotpun; završena evidencija pravi količinski ulaz na zalihu.
- Prodaja smanjuje zalihu. Početno stanje/korekcija zahteva obrazloženje. Interni prenos uparuje izlaz i ulaz atomski, uz sledljivi trošak.
- Stvarne troškove unesite opciono. „Nabavka zalihe“ prenosi vrednost u zalihu i ne duplira rashod pri kasnijoj potrošnji. Normativna veza ne menja odobreni katalog.
- Uplate/isplate unesite zasebno, uključujući delimična plaćanja. Novčani tok nikada ne nastaje iz normativa.
- Potvrdite kompletnost stvarne evidencije tek kada je završena. Neprodati deo znači privremen ciklus.
- Izveštaj može obuhvatiti farmu ili jednu proizvodnju. PDF i XLSX računaju se serverom; sačuvani snapshot čuva model i kurs i može se ponovo izvesti bez menjanja istorije.

## STIPS bilteni

Integrisan je modul **Administracija → STIPS bilteni**: ručni PDF/HTML uvoz, izdvajanje tabela, mapiranje kolona mesta, pregled i eksplicitna objava lokalnih cena, istorija i povlačenje. Odobreni podaci su u **Tržište Srbije → STIPS · lokalne cene**. Automatski preuzimač i raspored su implementirani i početno isključeni; stvarni mrežni pristup još nije potvrđen. Nema plaćenog servisa ili API ključa. Detaljno [STIPS uputstvo i ograničenja](docs/STIPS.md).

Migracija `002_stips.sql` dodaje tabele bez resetovanja postojeće baze. Originalni bilteni se čuvaju u bazi i ulaze u postojeći backup. Samo administrator može uvoziti, menjati i objavljivati referentne cene; to ne menja normative ili privatno poslovanje gazdinstava.

## Baza i migracije

Podrazumevano se koristi **PGlite 0.5.11**, pravi ugrađeni PostgreSQL, trajno u `data/postgres`. To je lokalni režim sa **jednim procesom**. Zaključavanje sprečava paralelno otvaranje baze iz CLI-ja i servera; posle naglog prekida sačekajte 10 sekundi za zastareli lock. Ne pokrećite dve instance nad istim direktorijumom.

Za odvojeni PostgreSQL servis podesite `DATABASE_URL`, a za TLS `DATABASE_SSL=true` i odgovarajući sistemski CA. `pg` Pool i Drizzle koriste isti relacioni model/migraciju. Putanja sa spoljnim PostgreSQL-om je implementirana, ali nije testirana sa zasebnim servisom u ovom okruženju; kompletna integraciona provera je izvršena na ugrađenom PostgreSQL-u. Za višestruke server instance koristite spoljašnji PostgreSQL, pouzdan pool, distribuiran rate limit i kontrolisan migracioni korak.

SQL je u `migrations/001_initial.sql` i `migrations/002_stips.sql`; `schema_migrations` prati izvršenje. Tabele obuhvataju autentikaciju, farme/članstva, izvorne sheetove, predloške i verzije, proizvodne periode, poslovne događaje, plaćanja, tri vrste evidencije zaliha, uparene prenose, potrošnju, kurseve, snapshot-e, statističke izvore/opažanja/revizije, kupce/ponude/zahteve i audit log. Privatne tabele imaju `farm_id`; složeni strani ključevi sprečavaju povezivanje tuđeg perioda/događaja. Autoritativna autorizacija je aplikaciona, ne PostgreSQL RLS; direktan pristup bazi poveravati samo operateru servera.

### Backup / restore

Za ugrađeni PostgreSQL **zaustavite server**:

```sh
npm run backup
# Postavite RESTORE_FILE na dobijeni .tar.gz, a RESTORE_DATA_DIR na NOV prazan direktorijum.
npm run restore
```

Backup je u `data/backups` (ili `BACKUP_DIR`) sa SHA-256 kontrolom. Restore proverava kontrolnu sumu, odbija neprazan direktorijum, učitava bazu i proverava čitanje tabela. Zatim postavite `DATA_DIR` na vraćeni direktorijum i pokrenite server. Originalna baza se ne briše/prepisuje. Backup sadrži privatne poslovne podatke i hash-eve lozinki; čuvajte ga privatno. Uz bazu čuvajte i isti `BETTER_AUTH_SECRET` i konfiguraciju van Gita.

Za spoljni PostgreSQL `npm run backup` koristi instalirani `pg_dump` i custom format; konekcioni parametri idu kroz okruženje. Restore radite pomoću `pg_restore --no-owner --dbname NOVA_BAZA backup.dump`, pa preusmerite `DATABASE_URL` na novu proverenu bazu. Ta operacija sa spoljnim servisom ovde nije izvršena.

## Provere

```sh
npm run build
npm test
# Ponovna ekstrakcija i kontrolni proračun svih pet istorijskih fixture-a:
python3 scripts/extract.py
# CLI uvoz (server mora biti zaustavljen za ugrađenu bazu):
npm run import
```

`npm test` koristi zaseban privremeni direktorijum/bazu i eksplicitno označene sintetičke podatke. Proverava izolaciju najmanje dve farme, direktne API/izvozne zahteve, formule/skaliranje, jedinice, maržu, nepotpune cene, hranidbene blokove, kurs, delimične naplate, subvencije, zamene normativa, nepromenljive snapshot-e, uparene prenose, troškove potrošnje zaliha, statističke revizije i PDF/XLSX podudarnost.

Browser provera: pokrenite **zaseban** razvojni server sa `APP_URL`/`PORT` i `DATA_DIR` koji nije vaša poslovna baza; postavite `E2E_URL`, pa `npx tsx scripts/browser-check.ts`. Podrazumevano očekuje port 3100 i `/usr/bin/chromium` (`CHROMIUM_PATH` može da promeni putanju). Proverava registraciju, profil, evidenciju proizvodnje, nacrt/dopunu prodaje, prazno tržište, sesiju i telefon bez horizontalnog skrola. Test slike u `docs/screens` sadrže samo označene TEST podatke.

## Prijava, reset i produkciono pokretanje

Autentikacija je Better Auth sa sigurnim sesijama i server-side proverom. Svi mutacioni poslovni endpoint-i zahtevaju odgovarajući Origin; auth koristi ugrađene zaštite i rate limit. IP za auth limit podrazumevano se uzima iz socket-a; klijentsko `x-agro-client-ip` zaglavlje se prepisuje. `TRUST_PROXY_HOPS=1` dozvoljen je iza jednog kontrolisanog proxy-ja, kada ne postoji direktan javni pristup aplikacionom portu (uključeno u Docker paket). Za više instanci potreban je distribuirani limit. Privatni odgovori imaju `Cache-Control: no-store`.

U razvoju reset poruke završavaju u privatnom `data/mail` (opciono `MAIL_DIR`), koje operater čita lokalno. U produkciji podesite `SMTP_URL` i `MAIL_FROM`; bez njih slanje reset poruka nije spremno. Nema prikazivanja reset tokena u javnom interfejsu ili logovima.

```sh
npm ci
npm run build
# Postavite NODE_ENV=production, APP_URL, BETTER_AUTH_SECRET (najmanje 32 nasumična znaka), SMTP i bazu u okruženju.
npm start
```

Produkcija zahteva eksplicitan `APP_URL` i `BETTER_AUTH_SECRET` sa najmanje 32 znaka; javni `APP_URL` mora koristiti HTTPS. `GET /healthz` anonimno proverava vezu sa bazom bez izlaganja poslovnih podataka. Javni hosting, domen, email isporuka, stalni disk, PostgreSQL i backup mogu imati operativne troškove. Besplatni izvori podataka ne znače besplatan hosting. Nisu napravljeni plaćeni resursi i aplikacija nije javno objavljena.

Za zajedničko testiranje na sopstvenom VPS-u pripremljeni su `Dockerfile`, trajni volumen i Caddy HTTPS proxy: [uputstvo za testnu objavu](docs/TESTNA-OBJAVA.md). Koristiti novu praznu bazu. Docker image ne uključuje privatni `data/` ili `.env`; arhivski izvor i katalog su uključeni. Jedna instanca podržava više odvojenih korisničkih naloga.

Za hosting sa kontrolnim panelom pogledajte [cPanel / Plesk preduslove i startup fajl](docs/CPANEL-PLESK.md). Podrška za Node.js, privatni application root i bezbedan procesni model moraju biti potvrđeni pre instalacije; PHP hosting sam nije dovoljan.

## Izvor i ograničenja

- [Izvorni audit i regresije](docs/IZVORNI-AUDIT.md)
- [Metodologija obračuna i vrednovanja](docs/METODOLOGIJA.md)
- [Status javnih izvora i uvoza](docs/IZVORI-I-OGRANICENJA.md)
- [Originalni Excel](source/izvor-2017.xlsx) i potpun [inventar ćelija](source/inventory.json)

Živi NBS/RZS/STIPS pristup blokiran je proxy 403 odgovorom. Implementirani su proverljiv admin uvoz, validacija, izvori, revizije i prazna stanja, a ne lažne žive integracije. Savremene cene i stvarni statistički podaci nisu podmetnuti kao test fixture-i. STIPS preuzimač je implementiran uz proverljiv ručni tok; njegov rad sa živim izvorom, kao i ostali automatski zvanični adapteri i uslovi ponovne upotrebe, čekaju stvarni pristup i metodološku proveru. Nema garancije potpunog besplatnog imenika ili dokumentovanih potreba za svaki proizvod.

Potrebno je poslovno odobrenje aktuelnih normativa i kurseva pre računanja stvarnih rezultata nove godine. Porezi, puna dobit, planiranje, individualna grla/parcele, bankarsko povezivanje i offline režim nisu deo prve faze. Za fizički različite nusproizvode administrator odobrava raspodelu zajedničkog troška; svaka količina ostaje u svojoj jedinici. Bez odobrene raspodele ili količine rezultat ostaje nepotpun, umesto pretpostavljene podele.
