# Mašinske operacije — jedna cena goriva

U **Administracija → Zajednički cenovnik** otvorite nacrt. Odmah ispod naziva cenovnika nalazi se **Mašinske operacije — zajednička cena goriva**.

1. Unesite **Cenu goriva po litru** u RSD ili EUR. Jedinica je fiksna: litar.
2. Proverite datum cene/kursa. Razlog ima početnu vrednost koju možete dopuniti.
3. Označite **Potvrđujem zajedničku cenu goriva** i kliknite **Primeni cenu goriva na sve operacije**.

Jedan unos raspoređuje cenu na sve povezane operacije svih kultura u tom cenovniku. **Operacije povezane sa cenom goriva** otvaraju pregled naziva i obuhvata. Nema pojedinačnog označavanja stotina redova. Posle povezivanja te operacije imaju samo zajedničko polje cene goriva; ne ponavljaju se u osnovnoj tabeli inputa.

Svaka operacija čuva svoj izvorni naziv, ćelije, normiranu količinu, alternative, uključenost i eventualnu višegodišnju raspodelu. Broj stavki i postojeće količine ne menjaju se. Na primer, oranje 20,28 l/ha i tanjiranje 3,78 l/ha po istoj ceni daju odvojene troškove, koji se skaliraju ostvarenom površinom. Normativna potrošnja već umanjena za 1/6 ili 1/2 ne deli se ponovo.

To je **trošak goriva**, a ne puna cena rada, amortizacije, mašine ili usluge izvođača. Stavka koja je već potvrđena kao „usluga“, „ha“, „sat“, kg ili druga poznata jedinica ne pretvara se automatski u litre. Takve stavke prikazane su odvojeno radi provere.

## Kako je utvrđen obuhvat

Programski su pročitane izvorne formule pored oznake **Potrošnja goriva**. U 54 zbirna reda pronađene su izričite reference na 714 postojećih normativnih stavki, u 54 predloška, sa 165 originalnih naziva operacija. [Dokumentovan obuhvat](../source/fuel-operations.json) čuva originalni hash, sheet, ćelije, formule i vezu sa stavkom.

Cena 1,23 EUR iz istorijskog Excela nije korišćena kao kriterijum za izbor. Ne pretpostavlja se da je svaka numerisana operacija gorivo. Konopac, folije, ručni rad i nejasne usluge ne pridružuju se po sličnoj ceni ili nazivu.

Za plastenike/rasad (zalivanje, obrada, zaštita i transport), nepovezane operacije vađenja/žetve i nulte stavke bez jasne osnove zatražen je izbor naručioca 31.10.2026. Dok izbor nije konkretno dat, ostaju odvojene. Unos cene ne popunjava nedostajuću količinu niti pretvara nultu potrošnju u stvarnu potrošnju.

Audit dodatno beleži četiri reference heljde (`Usevi!E490`, `E492`, `E494`, `E496`) koje postoje u izvornom zbiru, ali nemaju stavku u ranijem normalizovanom katalogu zato što su njihovi F iznosi izvorno broj, a ne formula. One nisu izmišljene niti automatski dodate u postojeće uređene normative ovom promenom cene. Potrebna je posebna provera/dopuna uvoza; izvorne ćelije ostaju sačuvane u inventaru. Zajednički unos obuhvata potvrđene postojeće stavke i ne predstavlja potvrdu potpunosti svake karte.

Za ponovno pravljenje audita, bez promene originala ili poslovne baze:

```sh
npx tsx scripts/audit-fuel.ts
```

## Kurs, istorija i prava

Nedostajući NBS kurs ostavlja originalni RSD iznos i datum sa statusom čekanja. Naknadni unos odgovarajuće proverene liste dopunjava samo nacrte. Nema pretpostavljenog kursa.

Promena cene goriva i povezivanje operacija čuvaju se u jednoj transakciji i auditu, sa prethodnom jedinicom, dokazom iz izvora, autorom i razlogom. Neobrazložena nula ili druga greška poništava celu primenu. Revizija sprečava da stari prozor prepiše novije cene. Nesačuvan unos goriva privremeno zaključava primenu drugih cena; može se sačuvati ili odbaciti.

Samo administrator menja nacrt. Aktivni/arhivski normativi i sačuvani izveštaji ne menjaju se; za novu cenu aktivnog cenovnika napravite novi nacrt. Aktivacija ostaje završni grupni korak i zahteva rešene ostale nalaze. Gorivo ne stvara automatski stvarni rashod, uplatu ili isplatu.

Nije potrebna nova SQL migracija: povezivanje i poreklo čuvaju se u verzionisanom modelu normativa i postojećem auditu. Originalni Excel ostaje neizmenjen.
