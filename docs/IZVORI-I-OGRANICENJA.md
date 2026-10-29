# Izvori i status integracija

Ranije provere u `source-connectivity.json` vraćale su proxy 403. Naknadno su potvrđeni STIPS XLS/XLSX inputi i, 29.10.2026, [RZS katalog i šest JSON skupova](RZS.md). Živo NBS ažuriranje i automatski STIPS PDF tok ostaju nepotvrđeni. Raniji 403 ne treba tumačiti kao trenutno stanje svih izvora.

## Upotrebljive putanje

- NBS: administrator proverava zvaničnu listu i unosi EUR/RSD, datum objave, interval važenja i izvor. Podržane su liste za različite datume, uključujući poslednju važeću listu vikendom/praznikom. Automatski NBS scraper nije implementiran bez potvrđenog formata/pristupa.
- RZS: administrator uvozi dokumentovan JSON izvod preko validiranog API-ja `/api/admin/statistics` ili forme u aplikaciji. Format je u `statistics-import.example.json` (prazan obrazac, ne nacionalni podaci). Šema zahteva definiciju, mapiranje, geografiju, jedinicu, valutu, vrstu cene, status i izvorne URL-ove. Nepoznat datum objave ostaje null; ažuriranje skupa se čuva odvojeno. Promena definicije ili jedinice zahteva novi identitet serije.
- Ponovljen neizmenjen izvod je idempotentan. Izmena opažanja čuva staru reviziju; greška se vraća bez brisanja prethodnih podataka, jer je ceo uvoz transakcija.
- Poslednjih pet dostupnih završenih godina određuje se po svakoj seriji. Praznina nije nula; prosek ima broj opažanja; godišnja promena zahteva oba uporediva opažanja. Tekuća godina se prikazuje odvojeno.
- STIPS sada ima zaseban [modul za biltene i lokalne cene](STIPS.md): PDF/HTML uvoz, pregled, mapiranje, eksplicitnu objavu i kontrolisani preuzimač. Živi pristup i format XLS/XLSX inputa su provereni zasebnim modulom; automatski PDF tok ostaje nepotvrđen. Administratorski uvoz označen kao STIPS ne prihvata lažnu nacionalnu geografiju „Srbija“. Čak ni prosek lokalnih cena ne postaje zvanični nacionalni godišnji pokazatelj.
- Imenik, potrebe kupaca i zahtevi imaju odvojene forme/tabele. Objavljene potrebe moraju biti odobrene i neistekle. Svaki zapis ima javni izvor i datum provere. Nema slanja poruka ili automatskih ponuda.

## Operativno ažuriranje

Izvode ažurirati prema stvarnom objavljivanju izvora. Za RZS postoje komande `collect:rzs` i `import:rzs`; raspored nije automatski uključen. STIPS može proveravati stvarne PDF linkove u podesivom razmaku, početno isključeno; raspored nije tvrdnja da postoji API ili da je živi pristup potvrđen. Kursevi se unose po intervalima važenja; godišnji podaci pri novom zvaničnom izdanju; cene prema dinamici konkretne serije. Prikazan je datum poslednjeg preuzimanja, a bez proverenog unosa prazno stanje „Nema potvrđenih podataka“. Ne brisati istoriju pri grešci osvežavanja.

Za dalje integracije proveriti konkretne formate i obuhvat na: `opendata.stat.gov.rs`, `data.stat.gov.rs`, `www.stat.gov.rs`, `www.stips.minpolj.gov.rs`, `webappcenter.nbs.rs`. RZS otvoreni JSON podaci i STIPS inputi su dostupni u sprovedenim proverama; to ne potvrđuje sve adrese ili formate. Zatim sa stvarnim izvodima testirati format, metodologiju, poslednjih pet raspoloživih godina, revizije i prava ponovne upotrebe. Ne uvoditi plaćene servise.
