# Izvori i status integracija

Tačni odgovori mrežne provere su u `source-connectivity.json`. Sve proverene adrese RZS/OData, RZS otkupnih cena, STIPS i NBS u ovom okruženju vraćaju **proxy 403 Forbidden**. Ovo ne potvrđuje niti opovrgava postojanje besplatnog API-ja, registracije ili prava preuzimanja. Nijedna živa statistička vrednost ili kurs nije izmišljen. Nisu provereni uslovi automatizovanog preuzimanja, konkretna mapiranja šifara i dostupnost svih pet godina po proizvodu.

## Upotrebljive putanje

- NBS: administrator proverava zvaničnu listu i unosi EUR/RSD, datum objave, interval važenja i izvor. Podržane su liste za različite datume, uključujući poslednju važeću listu vikendom/praznikom. Automatski NBS scraper nije implementiran bez potvrđenog formata/pristupa.
- RZS: administrator uvozi dokumentovan JSON izvod preko validiranog API-ja `/api/admin/statistics` ili forme u aplikaciji. Format je u `statistics-import.example.json` (prazan obrazac, ne nacionalni podaci). Šema zahteva definiciju, mapiranje, geografiju, jedinicu, valutu, vrstu cene, status, datum objave i izvorne URL-ove. Promena definicije ili jedinice zahteva novi identitet serije.
- Ponovljen neizmenjen izvod je idempotentan. Izmena opažanja čuva staru reviziju; greška se vraća bez brisanja prethodnih podataka, jer je ceo uvoz transakcija.
- Poslednjih pet dostupnih završenih godina određuje se po svakoj seriji. Praznina nije nula; prosek ima broj opažanja; godišnja promena zahteva oba uporediva opažanja. Tekuća godina se prikazuje odvojeno.
- STIPS sada ima zaseban [modul za biltene i lokalne cene](STIPS.md): PDF/HTML uvoz, pregled, mapiranje, eksplicitnu objavu i kontrolisani preuzimač. Živi pristup i aktuelni format još nisu potvrđeni. Administratorski uvoz označen kao STIPS ne prihvata lažnu nacionalnu geografiju „Srbija“. Čak ni prosek lokalnih cena ne postaje zvanični nacionalni godišnji pokazatelj.
- Imenik, potrebe kupaca i zahtevi imaju odvojene forme/tabele. Objavljene potrebe moraju biti odobrene i neistekle. Svaki zapis ima javni izvor i datum provere. Nema slanja poruka ili automatskih ponuda.

## Operativno ažuriranje

Do potvrde pristupa, administrator ažurira izvoz prema stvarnom objavljivanju izvora. STIPS može proveravati stvarne PDF linkove u podesivom razmaku, početno isključeno; raspored nije tvrdnja da postoji API ili da je živi pristup potvrđen. Kursevi se unose po intervalima važenja; godišnji podaci pri novom zvaničnom izdanju; cene prema dinamici konkretne serije. Prikazan je datum poslednjeg preuzimanja, a bez proverenog unosa prazno stanje „Nema potvrđenih podataka“. Ne brisati istoriju pri grešci osvežavanja.

Za buduću živu integraciju proveriti dostupnost i dozvolu za: `opendata.stat.gov.rs`, `data.stat.gov.rs`, `www.stat.gov.rs`, `www.stips.minpolj.gov.rs`, `webappcenter.nbs.rs`. Ovo su potrebni dodaci mrežnim podešavanjima, ne tvrdnja da je pristup sada omogućen. Zatim sa stvarnim izvodima testirati format, metodologiju, poslednjih pet raspoloživih godina, revizije i prava ponovne upotrebe. Ne uvoditi plaćene servise.
