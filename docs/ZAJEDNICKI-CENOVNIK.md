# Zajednički admin cenovnik normativa

U **Administracija → Zajednički cenovnik** ista stavka i jedinica imaju jedno polje za cenu. Kolone kultura zadržavaju njihove normirane količine i pripadajući trošak. Korisnik gazdinstva nastavlja da unosi ostvarenu proizvodnju; ove cene menja samo administrator.

## Rad kroz tabelu

Za preuzete referentne cene početni tok je **Popuni cene iz STIPS-a**. Predlozi proizvoda, pakovanja i cena se prikazuju automatski pri otvaranju nacrta; izaberite samo nejasne veze i jednom potvrdite grupnu primenu. Izbor se pamti za sledeću verziju. Kartice **Predlozi**, **Bez STIPS cene** i **Već popunjene** skraćuju pregled. Detaljna matrica je pod **Ručni unos i raspored cena po kulturama**. [Pravila prepoznavanja, izvora i pakovanja](STIPS-INPUTI.md#primena-u-zajedničkom-cenovniku).

1. Izaberite izvornu kategoriju, početno „Usevi“. Kategorije i nazivi iz izvornog Excela ostaju sačuvani.
2. Ako nemate nacrte, izaberite kulture, izvornu verziju svake kulture, naziv nove serije, period i razlog. **Pripremi izabrane nacrte** pravi više nacrta odjednom. Normirane količine i izvorne ćelije ostaju iste, a nove cene su prazne. Ponovljen isti zahtev ne pravi duplikate.
3. Izaberite po jedan nacrt za svaku kulturu, sa istim periodom, i otvorite zajedničku tabelu. Za ručni rad otvorite sklopljeni detalj; možete pretraživati redove.
4. Unesite cenu jednom u odgovarajući red. Podržani su EUR i RSD i zajednički datum referentne cene/kursa. Kada potvrđujete nejasnu izvornu jedinicu, izaberite jasnu jedinicu i označite **Jedinica potvrđena**.
5. Navedite razlog i izaberite **Sačuvaj cene u nacrtima**. Čuvaju se samo izmenjeni redovi, u svim prikazanim kulturama u kojima stavka postoji. Količine se ne prepisuju niti dele među kulturama.
6. Dugme **Pregledaj [kulturu]** otvara pojedinačni normativ. Tu pregledajte osnovu, količine, jedinice, alternative, isključenja i sve ostale nalaze i eksplicitno aktivirajte kompletan model. Tabela zajedničkih cena sama ne aktivira normative.

Na primer, cena istog đubriva od 0,50 EUR/kg primenjuje se na 300 kg u jednoj karti i 200 kg u drugoj: odgovarajući troškovi su 150 i 100 EUR po njihovim referentnim osnovama. Ovo je ilustracija načina obračuna, ne aktuelna tržišna cena. Kasniji obračun ostvarene proizvodnje i dalje koristi ostvarenu površinu/broj grla i odgovarajuću referentnu osnovu.

## Pravila grupisanja

- Stavke se grupišu po istom nazivu i jedinici, uz ujednačavanje veličine slova i razmaka. Različiti preparati i formulacije đubriva ostaju odvojeni. Nema automatskog izjednačavanja sličnih naziva.
- Generički nazivi **seme, rasad, sadnice i veterinarski troškovi** ostaju zasebni po izvornom predlošku/kulturi ili kategoriji životinja. Naziv „seme“ ne znači da različite kulture imaju istu cenu semena.
- kg i t ne spajaju se kao ista cena. Promena poznate jedinice zahteva poseban proračun normative i nije deo ovog unosa. Potvrđivanje izvorne nejasne jedinice ne menja normiranu količinu.
- Ako se isti red javlja više puta u jednoj karti, svaka izvorna stavka ostaje vidljiva zasebno. Alternative i isključene stavke ne uključuju se ponovo čuvanjem zajedničke cene. Hranidbeni blokovi ostaju nezavisni; bez potvrđene osnove količina je nepoznata.
- Svaka kolona prikazuje svoju referentnu osnovu, npr. 1 ha, 100 m², seriju rasada ili broj grla po godini/ciklusu. Zbirovi različitih osnova ne sabiraju se preko kultura.
- Veliki broj izvornih operacija obuhvata gorivo i materijal. Zajednička cena ne pretvara taj iznos u kompletnu cenu usluge, rada i mehanizacije.

## Valute, nepotpuni podaci i istorija

Normativni model računa cenu u EUR. Uneta RSD cena deli se zvaničnim EUR/RSD kursom koji važi za datum referentne cene. Originalni iznos, valuta, datum, upotrebljeni kurs, period njegovog važenja i izvor čuvaju se uz stavku. Ako kurs nedostaje, RSD unos se čuva kao nepotpun, a EUR cena ostaje prazna. Posle proverenog admin uvoza kursa ponovite taj unos da biste ga izričito preračunali; nema prepisivanja istorije današnjim kursom.

Prazno polje nije nula. Nulta cena pri pozitivnoj ili nepoznatoj količini zahteva izričit razlog. Zbir poznatih stavki u dnu tabele nije potvrda da je normativ kompletan. Postojeće različite cene u istom redu prikazuju se kao različite dok administrator ne unese novu zajedničku cenu.

Primena je transakciona: greška bilo kog reda poništava celu primenu. Revizija štiti od prepisivanja novijih izmena iz drugog prozora, uključujući pojedinačni editor. Ako dobijete poruku da je cenovnik promenjen, sačuvajte belešku svojih unosa, odbacite lokalne izmene i ponovo otvorite tabelu.

Aktivne i arhivske verzije ne mogu se menjati kroz zajedničku tabelu. Svaka nacrt-verzija čuva kopiju primenjene cene, a audit log beleži autora, razlog, prethodne i nove vrednosti i zajedničku oznaku primene. Kasnije izmene drugih nacrta ne menjaju odobrene verzije i sačuvane izveštaje. Ovaj modul ne stvara stvarni trošak, račun ili novčano plaćanje.

Nije potrebna nova SQL migracija: prošireni podaci o unosu cene čuvaju se u postojećem modelu normativne verzije (`norm_versions.model`), a promene u postojećem audit logu. Originalni Excel i arhivski uvoz ostaju neizmenjeni.

## Provereno

`npm test`: 57 testova, bez padova ili preskakanja; uključeni su grupisanje, različite količine i jedinice, valute, nedostajući kurs, nule, atomarnost, revizije, pristupne uloge i zaštita istorije. Browser provera sa zasebnom sintetičkom bazom prolazi unos jedne cene za ječam i pšenicu, zasebno seme, trajnost posle ponovnog učitavanja i telefon širine 390 px. Produkcioni frontend build prolazi.

Za ponavljanje browser provere pripremite zasebnu TEST bazu/admina i server, pa postavite `PRICING_E2E_URL`, `PRICING_E2E_EMAIL` i `PRICING_E2E_PASSWORD` i pokrenite `npx tsx scripts/pricing-browser-check.ts`. Podrazumevani URL je lokalni port 3400; Chromium putanja je `/usr/bin/chromium` ili `CHROMIUM_PATH`. Ne koristiti poslovnu bazu.
