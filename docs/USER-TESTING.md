# Agro portal — koraci za testere

Vlasnik testiranja šalje vam jedan HTTPS link aktivne aplikacije. Ne morate instalirati ništa niti imati GitHub/Render nalog. Radite sa označenim test podacima, na primer `TEST Gazdinstvo Ana`, kako bi se test unosi jasno razlikovali od poslovne evidencije.

1. Otvorite link, izaberite registraciju i napravite svoj nalog. Lozinka ima najmanje 12 znakova. Otvorite sopstveno gazdinstvo i izaberite obračunsku godinu i valutu.
2. Dodajte proizvodnju iz kataloga, na primer ječam, površinu **2,5 ha** i ostvarenu količinu. Sačuvajte prvo nepotpun nacrt, ponovo ga otvorite, dopunite i sačuvajte ostvarenu proizvodnju. Proverite da li razumete poruke o nedostajućim podacima i ulaz količine na zalihu.
3. U „Prodaja i troškovi“ unesite test prodaju dela raspoložive količine. Zatim evidentirajte samo deo naplate, sa datumom u drugom mesecu. Ako administrator još nije uneo kurs za taj datum, sačuvajte nacrt i zabeležite poruku; konačnu naplatu proverite kada kurs bude pripremljen.
4. Proverite nenaplaćeni ostatak i „Novčani tok“: prodaja pripada datumu prodaje, a stvarni priliv mesecu naplate. Bez početnog stanja očekuje se neto tok, bez izmišljenog završnog salda.
5. Unesite dodatni stvarni trošak. Proverite da li se jasno razlikuju „Obračun po normativu“ i „Evidentirani stvarni rezultat“. Trošak ne treba automatski da napravi isplatu. Bez odobrenog normativa obračun ostaje nepotpun; cene iz 2017. su arhiva.
6. Pogledajte zalihe, sopstvenu potrošnju i prenos između proizvodnji ako ih koristite. Interni prenos ne treba da stvori novčani priliv/odliv. Neprodati proizvod nije naplaćen prihod.
7. Otvorite „Tržište Srbije“, izaberite proizvod i proverite istoriju, jedinice i izvor. Nedostajuće godine ostaju prazne; lokalne STIPS cene imaju stvarni geografski obuhvat. RZS/STIPS podaci zavise od uspešnog uvoza vlasnika.
8. Izvezite zbirni PDF i XLSX i detalj proizvodnje. Uporedite period, valutu, iznose i oznaku kompletnosti sa ekranom. Proverite srpska slova i prikaz na telefonu.
9. Odjavite se i ponovo prijavite; podaci treba da ostanu sačuvani. Zaboravljenu lozinku proveravajte kada vlasnik potvrdi da je slanje email poruka uključeno.

Svaki tester koristi svoj nalog. Ne delite lozinku. Ako naiđete na podatke drugog testera, odmah prijavite vlasniku; nemojte ih menjati ili slati dalje.

Za svaki problem pošaljite vlasniku:

```text
Uređaj i pregledač:
Ekran i koraci koje sam ponovio:
Očekivani rezultat:
Dobijeni rezultat / tačna poruka:
Datum i vreme:
Slika ekrana bez lozinki ili drugih tajni, ako pomaže:
```

Vlasnik odvojeno beleži greške, nejasne korake i predloge. Nepotpun obračun zbog odsutnog odobrenog normativa/kursa je očekivano stanje; nerazumljiva poruka o tome je koristan nalaz testiranja.
