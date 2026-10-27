# Testna objava na sopstvenom VPS-u

Paket koristi jedan proces aplikacije, ugrađeni PostgreSQL na trajnom Docker volumenu i Caddy za HTTPS. Predloženi domen naručioca je `agroportal.fitkoncept.rs`; upisan je u primer konfiguracije, ali DNS i serverski pristup još nisu provereni. Svaki tester registruje sopstveni nalog i otvara svoje gazdinstvo. Početna baza je prazna, osim izvornog arhivskog kataloga. Ne kopirati lokalni `data/`, `.env` ili sintetičke test baze na server.

Ovo uputstvo priprema objavu; samo postojanje ovih fajlova ne znači da postoji javni link. Nisu naručeni server, domen, email servis ili drugi plaćeni resursi. Sopstveni VPS, domen, slanje emailova i čuvanje rezervnih kopija mogu imati troškove.

## Preduslovi

- Linux VPS, Docker Engine i Docker Compose v2. Preporuka za malu probnu grupu: najmanje 2 GB RAM i 10 GB slobodnog diska; pratiti potrošnju.
- Poddomen, na primer `agro.vas-domen.rs`, čiji DNS A zapis pokazuje na VPS. AAAA zapis postaviti samo ako i IPv6 radi do servera.
- TCP portovi 80 i 443 dostupni spolja i slobodni za Caddy. SSH pristup ostaje zasebno zaštićen. Ako server već ima Nginx/Caddy ili sajt na ovim portovima, prvo uklopiti postojeći proxy; ne zaustavljati postojeće sajtove ovim uputstvom.
- Pristup servera registrima Docker Hub i npm tokom builda i ACME servisima za izdavanje sertifikata. Za stvarno osvežavanje podataka potreban je i pristup njihovim zvaničnim izvorima.

## Prva objava

Prenesite sadržaj repozitorijuma `bAgro` na VPS, na primer u `/opt/bAgro`, bez `node_modules`, `dist`, privatnih podataka i popunjenih `.env` fajlova. Možete raspakovati isporučeni ZIP. Komande se izvršavaju na VPS-u iz direktorijuma aplikacije:

```sh
cd /opt/bAgro
cp deploy/.env.example deploy/.env
chmod 600 deploy/.env
openssl rand -hex 32
```

Poslednja komanda pravi novu nasumičnu tajnu. Unesite je u `BETTER_AUTH_SECRET` u **privatni** `deploy/.env` na serveru. Popunite i `TEST_DOMAIN` (samo naziv domena, bez `https://` i bez putanje) i `TLS_EMAIL`. Tajnu sačuvajte zajedno sa privatnom konfiguracijom; njena promena poništava postojeće sesije. Ne šaljite je kroz chat ili Git. SMTP podesite kroz `SMTP_URL` i `MAIL_FROM` za slanje poruka za reset lozinke. Bez SMTP-a registracija i prijava rade, a reset emailom nije dostupan.

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml config --quiet
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d --build
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Prvi build instalira zaključane zavisnosti i gradi frontend. Server primenjuje migracije i jednom uvozi arhivski katalog. Caddy čeka zdravu aplikaciju i izdaje sertifikat za zadati domen. Aplikacija ne izlaže port 3000 na javni interfejs; javni ulaz su Caddy portovi 80/443. `TRUST_PROXY_HOPS=1` odgovara upravo ovoj topologiji. Ne otvarati dodatni direktni put do aplikacije uz to podešavanje.

Proverite sa računara van VPS-a, koristeći stvarni domen:

```sh
curl --fail https://agroportal.fitkoncept.rs/healthz
```

Očekuje se `{"status":"ok"}`. Otvorite taj domen u pregledaču, napravite dva probna naloga i zasebna gazdinstva. Proverite prijavu, čuvanje proizvodnje, PDF/XLSX i izolaciju naloga. Tek nakon uspešne HTTPS provere podelite isti link testerima. Poželjno je da probna grupa koristi označene probne podatke. Registracija je otvorena svakome ko dođe do linka; ovo nije sistem pozivnica.

Ako nema aktivnog novog cenovnika ili zvaničnog kursa, obračun ostaje nepotpun. To je očekivano. Cene 2017 nisu aktuelne cene; administrator posebno odobrava nove normative i kurseve. Automatski STIPS raspored početno je isključen. Ne obećavati žive podatke dok pristup iz VPS-a nije potvrđen.

## Administratorski nalog

Najpre se registrujte kroz aplikaciju. Za dodelu administratorske uloge postojećem nalogu pokrenite na VPS-u sledeće u Bash terminalu. Uneta lozinka ne menja lozinku postojećeg naloga; CLI je zahteva i pri kreiranju novog. Ne koristite zajednički admin nalog za testere.

```sh
read -r -p "Admin email: " ADMIN_EMAIL
read -r -s -p "Admin lozinka (najmanje 12 znakova): " ADMIN_PASSWORD
export ADMIN_EMAIL ADMIN_PASSWORD
docker compose --env-file deploy/.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -e ADMIN_EMAIL -e ADMIN_PASSWORD app npm run admin
unset ADMIN_PASSWORD ADMIN_EMAIL
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d app
```

Server mora biti zaustavljen dok CLI otvara ugrađenu bazu. Kratak prekid tokom dodele uloge ili backupa je očekivan. Proxy vraća nedostupnost dok se aplikacija ponovo pokreće.

## Trajnost, backup i ažuriranje

Podaci ostaju u volumenu `agro-test_agro_data` pri ponovnom kreiranju kontejnera. **Ne koristiti `docker compose down -v`**: ta opcija briše volumene, uključujući bazu i sertifikate. Ne uključivati više replika aplikacije nad ugrađenom bazom.

Backup, uz kratko zaustavljanje aplikacije:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps app npm run backup
docker compose --env-file deploy/.env -f deploy/compose.yaml up -d app
mkdir -p private-backups
chmod 700 private-backups
docker compose --env-file deploy/.env -f deploy/compose.yaml cp app:/app/data/backups/. ./private-backups/
```

Kopiju i `.sha256` fajl čuvati i van tog VPS-a na privatnom mestu. Rezervne kopije sadrže privatne podatke i hash-eve lozinki. Za vraćanje zaustavite aplikaciju, izaberite stvarni backup u volumenu i nov prazan direktorijum:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml stop app
docker compose --env-file deploy/.env -f deploy/compose.yaml run --rm --no-deps -e RESTORE_FILE=/app/data/backups/IME-BACKUPA.tar.gz -e RESTORE_DATA_DIR=/app/data/restored-postgres app npm run restore
```

Komanda proverava SHA-256 i čitanje vraćene baze. Posle uspešne provere upišite `DATA_DIR=/app/data/restored-postgres` u privatni `deploy/.env`, pa ponovo pokrenite aplikaciju sa `up -d app`. Ako provera ne uspe, zadržite prethodni `DATA_DIR`. [Detalji postupka](../README.md#backup--restore). Nikada ne prepisivati aktivnu bazu neproverenom kopijom.

Pre ažuriranja napraviti backup i sačuvati prethodni image za povratak. Preneti novu verziju izvora, bez prepisivanja `deploy/.env`, pa ponoviti `up -d --build`. Trajni volumen se ne prenosi iz izvornog paketa i ne briše. Migracije su dodavajuće; povratak stare aplikacije uz staru šemu zahteva prethodno proverenu rezervnu kopiju.

Logovi i stanje:

```sh
docker compose --env-file deploy/.env -f deploy/compose.yaml logs --tail=100 app proxy
docker compose --env-file deploy/.env -f deploy/compose.yaml ps
```

Ne deliti privatnu konfiguraciju, reset linkove ili sadržaj baze. Ne izlagati Docker socket ili servis baze internetu.

## Provere i ograničenja

Rezultati dosadašnjih lokalnih provera i tačno označeni neprovereni koraci navedeni su u [VERIFIKACIJA.md](VERIFIKACIJA.md). Puna provera Docker image-a i HTTPS proxy-ja još nije završena. Lokalne provere aplikacije ne dokazuju da su na konkretnom VPS-u ispravno podešeni DNS, firewall, javni sertifikat, SMTP ili pristup NBS/RZS/STIPS. Te korake proveriti nakon povezivanja servera. Jedna instanca i memorijski auth rate limit namenjeni su maloj probnoj grupi; za više instanci preći na spoljašnji PostgreSQL i distribuirano ograničavanje zahteva.
