# Mesečni troškovnik i zalihe u zemlji

Pregled **Zalihe na parceli** automatski računa kumulativno normativno ulaganje u evidentiranu površinu do izabranog meseca. Dostupan je i kroz detalj biljne proizvodnje → **Ulaganja po mesecima**. Ne zahteva prinos, gotov proizvod ili unos svakog stvarnog troška. Koristi odobrenu verziju normativa i cenovnika; arhivske cene 2017. se ne aktiviraju.

## Obračun B–F

| Kolona karte | Značenje u obračunu |
| --- | --- |
| B | Vrsta troška ili operacije, sa očuvanim izvornim identitetom reda |
| C | Mesec nastanka ili potvrđena mesečna raspodela |
| D | Promenljiva jedinična cena iz odobrenog cenovnika |
| E | Fiksna normirana potrošnja po referentnoj osnovi |
| F | Ponovo izračunat trošak referentne osnove: D × E |

Za hektarsku kartu: **trošak reda za površinu = D × E × ha**. Kumulativno ulaganje je zbir samo delova tih redova pripisanih mesecima od početka sezone do izabranog meseca. Plastenici sa odobrenim kalendarom koriste svoju površinu i referencu, npr. m²/100, uz pravilnu konverziju m²/ha. Stočarski normativi se ne mešaju sa ovim obračunom površina.

**Povećanja u mesecima** mogu se sabrati za trošak sezone. **Kumulativna stanja meseci ne sabiraju se međusobno.** Ako je oktobarsko stanje preneto u novembar, decembar i januar, taj iznos je i dalje nastao samo jednom.

## Potvrđena početna pravila — 03.11.2026.

Naručilac je izričito potvrdio sva četiri pravila. Migracija `010_confirmed_calendar.sql` ih postavlja kada instalacija nema svoja aktivna pravila; nisu potrebne ponovne potvrde istih odluka u interfejsu. Postojeće administratorske izmene pravila se čuvaju.

1. Prazan mesec inputa preuzima mesec pripadajućeg bloka operacija. Ostaje vidljiva veza sa ćelijom bloka. Na primer, pšenično seme i NPK pripadaju oktobarskom bloku.
2. Višemesečni red se ravnomerno raspoređuje po navedenim mesecima kao normativna pretpostavka, kada nema preciznije usaglašene raspodele. Raspon IV–VIII obuhvata april–avgust; lista III,V,VII samo mart, maj i jul. Ukupan red se računa jednom, bez množenja cele norme brojem meseci.
3. Sezona uključuje pripremne radove prethodne godine. Za kukuruz sezone 2026 jul–novembar pripreme pripada 2025, a prolećna setva i jesenja berba 2026. Pšenica počinje oktobarskim blokom 2025, koji se prenosi u januar 2026. Obrazac biljne proizvodnje dozvoljava početak u prethodnoj godini. Godišnje stočarske osnove ostaju unutar svoje godine.
4. Izričita raspodela iz pomoćnog sheeta ima prednost kada su meseci saglasni sa C i udeli daju tačno jednu ukupnu normu. Za zaštitu repe IV–VIII: april 1/6, maj 1/6, jun 2/6, jul 1/6, avgust 1/6. Betanal ima posebnu raspodelu april/maj, a pojedini drugi preparati svoj mesec. Neusaglašena pomoćna formula se ne kopira.

Priprema i rast koriste jedan odobren cenovnik obračunske sezone. Prethodnoj jeseni se ovde pripisuje normativna vrednost po tom cenovniku, a ne izmišljeni istorijski iznos nabavke ili plaćanja. Kod površinskih proizvodnji deo sezone pre januara ne zahteva zaseban cenovnik prethodne godine. Snimljeni mesečni obračun čuva korišćene cene, normative i pravila.

Tekući mesec obuhvata celu mesečnu normativnu potrošnju, kao jasno označenu pretpostavku. Za pregled završenih meseci izaberite prethodni mesec. Nije moguće birati budući mesec kao ostvareni pregled.

## Korišćenje

1. Evidentirajte proizvodnju i površinu. Može ostati nacrt dok prinos ili proizvodnja nisu poznati.
2. Otvorite **Zalihe na parceli**, izaberite mesec i, opciono, proizvodnju. Videćete ulaganje u tom mesecu, kumulativno ulaganje i zasebno zalihu u zemlji.
3. Proširite proizvodnju radi pregleda mesečnih povećanja i redova B–F, normirane količine za vašu površinu, mesečnih udela i izvora. Mesečna tabela staje na telefon; širi troškovnik pomera se vodoravno.
4. Potvrdite stvarno stanje proizvodnje: **U toku** ili **Završena**, uz stvarni datum završetka. Stari status unosa „nacrt/final“ nije pretpostavljen datum žetve. Dok stanje nije potvrđeno, kalkulacija ulaganja je dostupna, a zaliha u zemlji označena kao nepotpun podatak.
5. Posle završetka zaliha u zemlji je 0 od tog meseca, dok kumulativni trošak i raniji meseci ostaju u istoriji. Ova radnja ne stvara gotov proizvod, prodaju ili plaćanje; ostvarena količina se evidentira kroz proizvodnju.
6. **Sačuvaj mesečni obračun** čuva nepromenljiv snimak. PDF/XLSX iz trenutnog pregleda koriste isti serverski rezultat; izvoz iz sačuvane istorije koristi sačuvani rezultat. Novi snimak istog meseca beleži vezu ka prethodnom.

Ručna mesečna stanja iz ranije evidencije ostaju u zasebnom sklopljenom prikazu. Ne dodaju se automatski novoj kalkulaciji i ne stvaraju dupli trošak. Uplate i isplate ostaju isključivo u novčanom toku sa svojim datumima.

## Administracija i istorija

**Administracija → Zajednički cenovnik → Pravila mesečnog troškovnika** prikazuje važeću verziju pravila. Njihova izmena pravi novu verziju, sa autorom, razlogom i audit zapisom; snimljeni izveštaji se ne menjaju. Zastareo prozor ne prepisuje novija pravila.

U nacrtu pojedinačnog normativa dostupni su **Mesec nastanka — C**, **Godina troška u sezoni** i opciona raspodela po mesecima u procentima. Ručni udeli moraju dati tačno 100%. Aktivni model se menja novom normativnom verzijom. Prazni ili nejasni meseci, zimski rasponi bez potvrđene godine, nedostajuća cena pri pozitivnoj potrošnji i nepoznate jedinice ostaju konkretni nalazi, ne nule.

Mesečni obračuni čuvaju `farm_id`, verziju normativa sa modelom, verziju pravila, metod obračuna, izvorni hash, datum pregleda i korišćeni kurs. Server proverava članstvo pri svakom pregledu, izmeni stanja, snimanju i izvozu. Administrator normativa time ne dobija pristup privatnim gazdinstvima.

Novi RSD normativi rade bez kursa. Za stariji EUR normativ potreban je proveren kurs za kraj izabranog meseca; u tekućem mesecu koristi se proverena lista koja važi na dan pregleda. Nedostajući kurs daje nepotpun podatak. Snimljena konverzija se ne prepisuje naknadnim unosom kursa.

## Izvorni audit i granice

[Programski audit rasporeda](../source/monthly-calendar-audit.json) povezuje 53 hektarske karte i 1.216 postojećih normativnih redova. U 354 reda C je prazna. Audit čita originalni XLSX bez izmene; linearne veze pomoćnog sheeta parsiraju se deklarativno, bez izvršavanja koda iz formula.

Proverena neslaganja:

- Pomoćni zbir pšenice izostavlja Duet ultra `Usevi!F57`. Mesečni obračun ga uključuje prema pripadajućem majskom bloku, kada je stavka uključena u odobreni normativ.
- Pomoćni sheet neke pripremne radove kukuruza stavlja u oktobar, dok C navodi jul. Primarna je C; neslaganje je zabeleženo u poreklu reda.
- Četiri ranije neuvezena brojčana reda heljde (`F490`, `F492`, `F494`, `F496`) nisu prećutno dodata aktivnim modelima. Mesečni pregled takvog modela je nepotpun do administratorskog usaglašavanja. Njihovi izvorni fiksni iznosi se takođe ne poklapaju sa aktuelnim množenjem izvornog D × E.
- Dvosmisleni zapisi poput `IV/VI,VII` i zimski raspon bez pouzdane godine traže admin ispravku ili eksplicitnu raspodelu. Ne pretpostavlja se treća kalendarska godina sezone.

Potpuno su regresiono proverene četiri početne kulture. Ne tvrdi se da su svi specifični višegodišnji ciklusi, sukcesivne proizvodnje i delimične berbe metodološki potvrđeni. Zatvaranje zalihe u ovoj iteraciji odnosi se na ceo evidentirani proizvodni ciklus; složenije slučajeve treba odvojiti u proizvodne evidencije i potvrditi raspodelu.

Pokretanje audita i provera:

```sh
python3 scripts/audit-months.py
npm test
npm run build
npx tsx scripts/monthly-wip-browser-check.ts
```

Browser skripta pravi i uklanja posebnu TEST bazu, koristi izvorne rasporede i jasno sintetičke cene. Ne povezuje se sa poslovnom bazom i ne aktivira test cenovnik na hostingu. Migracije 009/010 ne menjaju privatne poslovne događaje, istorijske normative ili ručna mesečna stanja. Postojeće backup/restore procedure obuhvataju nove tabele.
