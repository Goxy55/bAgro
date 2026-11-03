# Priprema jednog cenovnika

**Administracija → Zajednički cenovnik** otvara se kao početni admin ekran. Cenovnik važi za sva gazdinstva, uz njihove zasebne količine i periode. Administrator cenama upravlja jednom; vlasnici gazdinstava evidentiraju svoje ostvareno poslovanje.

## Osnovni postupak

1. **Novi cenovnik** → naziv i period → **Kreiraj dinarski cenovnik**. Obuhvaćeno je svih 88 predložaka. Nije potrebno birati kulture. Izvorne cene 2017. ostaju arhiva.
2. Unesite **jednu cenu goriva u RSD/l**. Povezane izvorne operacije zadržavaju sopstvenu potrošnju; potvrđene usluge/sati/ha ne postaju litri. Prazno polje zadržava ranije unetu cenu. [Obuhvat goriva](MASINSKE-OPERACIJE.md).
3. Kliknite **Pripremi cene iz izvora**. Jedan posao proverava poslednja STIPS izdanja, RZS godišnji izvod i javne prodajne cenovnike. Napredak ostaje sačuvan na serveru; možete zatvoriti ekran i ponovo otvoriti isti cenovnik. Priprema unosi predloge u nacrt, bez aktiviranja ili plaćanja.
4. Pregledajte broj spremnih proizvodnji. **Nedostajuće cene — zajednički unos** prikazuje input jednom, sa njegovom jedinicom. Ručna izmena raspoređuje se na sve nacrte sa istim materijalom i jedinicom, bez izbora kultura. Sačuvajte zajedničke izmene. Prazna cena nije nula; nula zahteva razlog.
5. Pšenica, kukuruz, soja i šećerna repa prikazane su prve. Ostale proizvodnje su sklopljene. Proširite proizvodnju samo radi pregleda cena, izvora ili posebnosti. **Otvori detalj normativa i alternative** omogućava pregled deklarativnog modela, bez izvršavanja Excel formula.
6. Označite jednu zajedničku potvrdu pregleda izvora, jedinica, alternativa i osnove, pa **Potvrdi spremne proizvodnje (N)**. Aktiviraju se samo potpuni modeli. Ostali ostaju u nacrtu u istom cenovniku. Nerešeni šampinjoni ne blokiraju pšenicu.

Spremnost proverava server, u istoj transakciji sa aktiviranjem. Nema aktiviranja nepotpunog modela. Zamena postojećih aktivnih verzija za isti proizvod/period traži vidljivu potvrdu arhiviranja. Snimljeni izveštaji ostaju nepromenjeni.

## Kako se biraju izvori

- **STIPS:** izvorni mesec, stvarno lokalno mesto, proizvod, proizvođač i pakovanje. Ne predstavlja nacionalni prosek Srbije. Automatski se predlažu tačno prepoznati ili ranije potvrđeni proizvodi i osnove; nejasne formulacije se ne proglašavaju jednakim.
- **RZS:** proverena tabela godišnjih otkupnih cena, kao zasebna referenca za odgovarajuće seme/hranivo. Ovaj izvod ne potvrđuje jedinicu (`0`/`nema`). Automatska priprema koristi samo ranije admin odobreno mapiranje jedinice/proizvoda. Prvo mapiranje proverava se u sklopljenom naprednom prikazu na istoj stranici. Indeksi cena se nikada ne koriste kao RSD/kg. [RZS granice](RZS-CENE.md).
- **Javni prodavci:** provereni adapteri za Ratar, Poljokomerc i Hemoslaviju, sa originalnim HTML-om, kontrolnom sumom, pakovanjem i datumom provere. Cena za registrovane kupce, paket više preparata ili cena susednog proizvoda se ne koristi. PDV i dostupnost ostaju označeni kao nepotvrđeni gde nisu jasno navedeni. Dostava nije uključena. [Javni izvori](JAVNE-CENE.md).

Bira se dokumentovana reprezentativna ponuda, bez tvrdnje da je najjeftinija ili zvanična prosečna cena. Tačna novija javna prodajna cena može zameniti stariju zvaničnu referencu u nacrtu. Ručno unete cene bez referentne veze čuvaju se pri ponovnoj pripremi.

Zamenska **cenovna** referenca dozvoljena je samo ako postoje izvorni podaci za oba proizvoda sa jednakim aktivnim materijama, koncentracijama, jedinicama koncentracije i formulacijom. Nepotpuno prepoznat sastav se odbija. Originalni preparat i normirana količina ostaju sačuvani. Ovo nije preporuka promene zaštite bilja. Nema izjednačavanja kg i l bez dokazive konverzije.

Kada izvor navodi pozitivne izvorne alternative, predlaže se prva sa proverljivom cenom. Ostale pozitivne alternative se isključuju uz sačuvan razlog i vezu ka odabranoj stavci; količine se ne brišu. Administrator ih pregleda jednom pre grupne potvrde. Nulte, neprimenljive stavke ne zahtevaju cenu. Pozitivna nejasna jedinica i dalje blokira taj model.

## Seme u setvenim jedinicama

Naziv „Seme (sj)“ potvrđuje osnovu SJ, ali ne broj semena u njoj. U **Osnova pakovanja semena (SJ)** unesite provereni broj semena za kukuruz i šećernu repu ako povezujete cenu pakovanja izraženu brojem semena. Bez tog podatka nema automatskog deljenja: možete uneti proverenu cenu neposredno u RSD/SJ. Brojevi korišćeni u testovima su sintetički i ne predstavljaju poslovni podrazumevani unos.

## RSD i opcioni EUR

Novi cenovnici i glavni izveštaji su u **RSD**. Dinarska proizvodnja, prodaja, trošak, uplata, isplata, vrednovanje zaliha i interni prenos rade bez kursa. Nepoznata EUR vrednost ostaje prazna, nikada nula.

Postojeći EUR cenovnici zadržavaju svoju valutu i istoriju. Za rad bez kursa napravite novi RSD cenovnik. Izvorna dinarska cena iz prethodnog unosa može se preneti bez današnjeg preračuna; čisto EUR cena bez potvrđenog kursa ostaje nedostajući dinarski podatak.

U **Izvoz i istorija obračuna** odaberite EUR samo kada je potreban. Pregled i PDF/XLSX koriste istu serverom obračunatu valutu. Ako nedostaje istorijska konverzija, zahtev za EUR daje konkretno objašnjenje; RSD prikaz nastavlja da radi. Unos novog kursa ne prepisuje stare poslovne događaje, plaćanja ili snapshot-e. Naknadno se usklađuju samo nerešene cene nacrta.

## Dopuna i revizije

Posle delimične aktivacije ostaju dostupni nacrti za dopunu. Cena materijala koja je već potvrđena u aktivnom delu istog cenovnika ne može postati drugačija u njegovom preostalom delu. Nova cena zahteva novi imenovani cenovnik. Aktivni modeli su nepromenljivi; otvoreni, nesačuvani izveštaji koriste važeće verzije, a snapshot čuva prethodni obračun.

Izvori imaju keš 24 h. Jedna javna priprema ima limit 120 zahteva ili približno 8 minuta za prodavce; prioritet imaju četiri testne kulture. Ponovna priprema koristi keš i obrađuje preostale inpute. Greške ostavljaju poslednje proverene podatke uz napomenu. Potpuna pokrivenost svih istorijskih preparata nije zagarantovana.

Migracije `007_rsd_pricing.sql` i `008_public_search_cache.sql` čuvaju postojeće podatke i dodaju RSD osnovu, javne dokumente i evidenciju poslova. Normalna nadogradnja aplikacije ih izvršava automatski. Za lokalni PGlite koristite jedan proces; pre nadogradnje napravite backup prema README-u. Privatni podaci i uloge gazdinstava ostaju odvojeni od globalnog cenovnika.

## Mesečni raspored troškovnika

Potvrđena kalendarska pravila od 03.11.2026. uključena su pri nadogradnji, uz očuvanje prethodno administratorski podešenih pravila. Pregled ulaganja automatski koristi aktivan cenovnik; ne unose se cene ponovo. [Mesečna ulaganja, B–F, sezona i zalihe u zemlji](MESECNA-ULAGANJA.md).
