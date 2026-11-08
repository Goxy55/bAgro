# Članovi gazdinstva, izvoz i brisanje naloga

## Uloge

| Uloga | Pravo |
|---|---|
| **Vlasnik** | Sve; menja profil, poziva i uklanja članove, menja uloge. Jedan vlasnik po gazdinstvu. |
| **Član** | Unosi i menja evidenciju (proizvodnje, događaje, plaćanja, zalihe, izveštaje). Ne upravlja članovima. |
| **Pregled** | Samo čita i izvozi izveštaje. Svaka izmena vraća HTTP 403. |

Pravo se proverava na serveru u svakom zahtevu preko stvarnog članstva (ne prema `farm_id` iz klijenta). Globalni administrator i dalje ne dobija pristup privatnim gazdinstvima.

## Pozivnice

Vlasnik u **Podešavanja → Članovi gazdinstva** unosi email i ulogu. Server pravi jednokratan token (u bazi se čuva samo SHA-256 hash), važi 7 dana i radi samo za nalog sa istom email adresom. Ako je podešen `SMTP_URL`, link se šalje emailom; inače ga vlasnik kopira iz aplikacije i šalje lično. Nova pozivnica za istu adresu zamenjuje prethodnu. Pozvana osoba otvara link, prijavi se ili registruje, i pozivnica se prihvata automatski. Član može sam da napusti gazdinstvo; vlasnik ne može (mora ukloniti članove ili obrisati nalog).

## Izvoz podataka

**Podešavanja → Moji podaci i nalog → Izvezi moje podatke** preuzima JSON sa podacima naloga, članstvima, svim tabelama gazdinstava čiji ste vlasnik (tabele sa `farm_id` otkrivaju se iz šeme, pa novi moduli ulaze automatski) i vašom evidencijom radnji (poslednjih 5.000). Za gazdinstva gde ste član izvozi se samo članstvo. Hash lozinke i tokeni pozivnica se ne izvoze. Ograničeno na 5 zahteva u minuti.

## Brisanje naloga (anonimizacija)

Zahteva lozinku i upisanu reč `OBRIŠI`. Blokirano je dok gazdinstvo čiji ste vlasnik ima druge članove i za administratorske naloge. Postupak, u jednoj transakciji:

- nalog dobija ime „Obrisan korisnik" i adresu `deleted-<id>@deleted.invalid`; brišu se lozinka, sesije, tokeni za reset i pozivnice;
- članstva u tuđim gazdinstvima se brišu;
- gazdinstva u vlasništvu ostaju sa brojevima, ali se naziv menja u „Obrisano gazdinstvo", briše se opština, napomene uz proizvodnje, događaje, plaćanja, zalihe i mesečna ulaganja, kao i ime kupca/dobavljača u događajima; isto važi za ime gazdinstva u sačuvanim izveštajima.

**Ograničenja (važno za pravnu ocenu):**
- Slobodni tekst koji ste sami upisali u nazive proizvodnji ili u razloge izmena ostaje i može sadržati lične podatke.
- Evidencija radnji ostaje pod pseudonimom (ID naloga) do isteka roka `AUDIT_RETENTION_DAYS` (podrazumevano 365 dana).
- Backup-i napravljeni pre brisanja i dalje sadrže stare podatke dok se ne zamene; operater ih mora uzeti u obzir.
- Zakonske obaveze čuvanja poslovnih knjiga nisu procenjene; proverite sa pravnikom/računovođom pre javne objave, uz obaveštenje o privatnosti.
