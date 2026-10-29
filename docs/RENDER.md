# Testna objava preko GitHub-a i Rendera

Ova varijanta daje testerima jedan HTTPS link. Oni koriste telefon ili računar, registruju sopstveni nalog u Agro portalu i otvaraju svoje gazdinstvo. Render i GitHub nalog potreban je samo vlasniku objave. Za početak organizujte grupu od 5–10 testera; to je preporuka za organizaciju testiranja, a ne izmerena granica kapaciteta.

## Trošak pre aktiviranja

Konfiguracija [render.yaml](../render.yaml) predlaže dve plaćene instance u Frankfurtu, u besplatnom Hobby radnom prostoru:

| Resurs | Plan | Osnovna cena mesečno |
| --- | --- | ---: |
| Aplikacija, 512 MB | `0.5c-512mb` | 7 USD |
| PostgreSQL 18, 256 MB, disk 1 GB | `0.1c-256mb` | 6 USD |
| Osnovni zbir | | **13 USD** |

Cene su proverene 29.10.2026. na [zvaničnom cenovniku](https://render.com/pricing). Porez, eventualna naplata prostora i dodatna potrošnja obračunavaju se prema Render cenovniku; konačan iznos proverite u svom nalogu pre potvrde. Prostor baze nema automatsko proširivanje. Hosting se plaća dok su resursi aktivni; broj naloga testera u Agro portalu sam po sebi ne dodaje Render korisničke licence. Bazu ili servis nemojte brisati pre privatnog backupa podataka koje želite sačuvati.

Priprema fajlova u Git-u ne kreira resurse i ne objavljuje aplikaciju. Plaćena aktivacija nastaje tek kada vlasnik potvrdi objavu u svom Render nalogu.

## Objavljivanje, bez terminala na računaru

1. Otvorite **[Objavi Agro portal na Renderu](https://render.com/deploy?repo=https://github.com/Goxy55/bAgro)** i prijavite se na Render preko svog GitHub naloga. Ako birate radni prostor, Hobby nema obaveznu mesečnu pretplatu za sam prostor.
2. Odobrite Renderu pristup repozitorijumu `Goxy55/bAgro`, grana `main`. Ekran Blueprint učitava korenski `render.yaml`. Pregledajte aplikaciju i bazu, region i procenu naplate. Potvrdite kreiranje samo ako prihvatate prikazan trošak. Za ovu varijantu potrebni su podaci za naplatu kod Rendera.
3. Sačekajte završetak build-a i pripreme baze. Prva priprema preuzima i proverava javne RZS/STIPS podatke, pa može trajati nekoliko minuta. U Logs se vidi napredak; greška javnog izvora ostavlja prazno ili prethodno provereno stanje. Greška osnovne migracije/uvoza sprečava početak objave.
4. Kada servis dobije status **Live**, otvorite HTTPS adresu koju Render prikaže, oblika `https://…onrender.com`. Adresa se dodeljuje pri kreiranju; nemojte pretpostavljati tačno ime. `https://…onrender.com/healthz` treba da vrati `{"status":"ok"}`.
5. Registrujte svoj nalog u aplikaciji i otvorite svoje `TEST` gazdinstvo. Za administraciju otvorite **Shell** u Render web servisu i unesite samo ovu komandu, sa emailom tog naloga:

   ```sh
   npm run admin -- --existing vas-email@example.com
   ```

   Nalog mora već postojati. Komanda dodeljuje ulogu bez unosa ili promene lozinke i beleži radnju. Osvežite aplikaciju. Shell je potreban vlasniku za ovu početnu dodelu; testeri rade isključivo u pregledaču.
6. Podelite dodeljeni HTTPS link i [korake za testere](USER-TESTING.md). Svaki tester pravi svoj nalog i svoje `TEST` gazdinstvo. Ne delite jedan zajednički nalog.

## Šta se priprema automatski

- Migracije i izvorni katalog „Izvor 2017 — arhivski“, bez aktiviranja istorijskih cena za novu godinu.
- Zasebna trajna PostgreSQL baza i nasumična sesijska tajna. U bazu se ne kopiraju lokalni nalozi ili privatni poslovni podaci.
- Jedna aplikaciona instanca, provera `/healthz`, privatna veza aplikacije i baze u istom regionu. Javni pristup bazi je isključen (`ipAllowList: []`). `DATABASE_URL` i tajnu ne stavljajte u Git ili poruke.
- `APP_URL` preuzima stvarnu HTTPS adresu servisa kroz `RENDER_EXTERNAL_URL`, tako da prijava i provera Origin-a koriste isti domen.
- Početni uvoz javnih RZS godišnjih serija i STIPS cenovnika inputa za tekuću i dve prethodne godine. Originali STIPS dokumenata čuvaju se u bazi; RZS opažanja čuvaju izvorni kontekst i kontrolnu sumu. Uvoz ne kreira aktuelne normative, kurseve, farme ili lažne cene.
- Uspešna početna priprema svakog javnog izvora ima zapis u audit evidenciji i preskače se pri narednim objavama. To nije raspored redovnog osvežavanja. Neuspešan izvor nema oznaku uspeha i ponovo se pokušava pri sledećoj objavi. Provera RZS/STIPS pristupa sa Render mreže čeka prvu stvarnu objavu.
- Novi commit na `main` objavljuje se kada GitHub CI provere prođu (`checksPass`). Granu i uključenost GitHub Actions proverite u svom nalogu. Privatni podaci ostaju u bazi kroz promenu aplikacione verzije; build izlaz i lokalni disk aplikacije nisu mesto za trajne podatke.

Za ručno osvežavanje javnih izvora vlasnik može koristiti Shell:

```sh
npm run collect:rzs
# Nastavite uvoz samo ako je prethodno preuzimanje uspešno:
npm run import:rzs -- --archive data/rzs
npm run import:inputs -- 2024 2025 2026
```

Godine STIPS uvoza prilagodite periodu. Ručni RZS uvoz iz postojeće arhive ne predstavlja novu mrežnu proveru. Administratorski STIPS uvoz dostupan je i kroz aplikaciju. `SEED_PUBLIC_REFERENCES=false` isključuje automatsku početnu pripremu; osnovni arhivski katalog ostaje.

## Priprema obračuna i reset lozinke

Za testiranje unosa, navigacije, nacrta i praznih stanja dovoljna je sveža instalacija. Za konačan novčani obračun administrator prvo unosi **proverene NBS liste za datume događaja/plaćanja** i odobrava kompletne normative za izabrani period. Bez njih aplikacija treba da pokaže konkretno šta nedostaje. STIPS izvorne cene se biraju i proveravaju pre aktiviranja normativa; ne aktiviraju se same. Postupak je u [README-u](../README.md#administrator) i [zajedničkom cenovniku](ZAJEDNICKI-CENOVNIK.md).

U Render **Environment** podesite `SMTP_URL` i `MAIL_FROM` iz svog email servisa pre testiranja zaboravljene lozinke. Registracija i prijava rade bez SMTP-a, ali produkciono slanje reset poruke tada nije spremno. Lozinke, SMTP podatke i sesijsku tajnu unosite samo u privatna polja okruženja, ne u poruke ili Git.

## Sopstveni domen, kasnije

Prvo proverite rad preko dodeljenog `onrender.com` linka. Zatim u Render **Settings → Custom Domains** dodajte `agroportal.fitkoncept.rs`. U DNS panelu svog domena unesite baš zapis koji Render prikaže za taj poddomen; nije potrebno premeštati glavni sajt ili ceo domen. Sačekajte potvrdu DNS-a i HTTPS sertifikata.

U `render.yaml` zamenite ceo `APP_URL.fromService` unos sa:

```yaml
- key: APP_URL
  value: https://agroportal.fitkoncept.rs
```

Sačuvajte promenu u Git-u i primenite Blueprint izmenu/objavu. Samo ručna promena u dashboard-u može kasnije biti prepisana Blueprint sinhronizacijom. Posle promene koristite novi domen za prijavu i linkove testera; proverite odjavu/prijavu i reset link na novom domenu.

## Backup i završna provera vlasnika

Proverite dostupne **Backups / Recovery / Export** opcije na stranici Render PostgreSQL baze za odabrani plan i zabeležite stvarno zadržavanje kopija. Pre svake rizične promene napravite privatni logički izvoz i probajte restore u zasebnu bazu. Sama automatska objava koda nije backup baze. CLI `npm run backup` za spoljašnji PostgreSQL zahteva instaliran odgovarajući `pg_dump`; njegova dostupnost/verzija u Render Node okruženju nije potvrđena. Nemojte pretpostaviti da je ovaj CLI zamena za proveru Render backup-a. Backup-i sadrže privatne podatke i hash-eve lozinki.

Pre slanja linka testerima proverite dve odvojene registracije u različitim pregledačima, odvojena gazdinstva, čuvanje i ponovno učitavanje proizvodnje, PDF/XLSX, očuvanje podataka posle redeploy-a i reset poruke ako je SMTP uključen. Pratite memoriju, odziv i slobodan prostor baze tokom testiranja; povećanje paketa menja cenu i zahteva odluku vlasnika.

Lokalno je proverena produkciona aplikacija sa zasebnim PostgreSQL 18, migracije, početni uvoz, dve farme, zaštićeni izveštaji i delimične naplate. Sam Render nalog, javni HTTPS/proxy, domen i SMTP još nisu operativno provereni. Detalji: [verifikacija](VERIFIKACIJA.md). Zvanična dokumentacija: [Blueprint](https://render.com/docs/blueprint-spec), [Node](https://render.com/docs/deploy-node-express-app), [PostgreSQL](https://render.com/docs/postgresql-creating-connecting).
