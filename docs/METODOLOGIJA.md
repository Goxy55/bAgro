# Obračunska pravila prve faze

Podaci su obrađeni na serveru. UI formatira prikaz; PDF i XLSX koriste isti `report()` i isti skup podataka. Novac se računa pomoću Decimal.js (36 značajnih cifara, HALF_UP); novčani prikaz ima dve decimale. Numerički izvoz u Excel zadržava numerički tip, dok se tekst koji počinje `=`, `+`, `-` ili `@` štiti apostrofom. Originalna valuta i kurs nisu zamenjeni današnjim vrednostima.

## Osnove

- Biljna proizvodnja: ostvarena ha × odobrena cena/ha. Unos m² konvertuje se /10000.
- Plastenici: ukupna m² /100 × referentni trošak. Pretpostavka je proporcionalno skaliranje, eksplicitno navedena u formi.
- Rasad: broj biljaka /80000 ili /5000, prema zasebnom predlošku.
- Šampinjoni: nacrt do admin potvrde jedinice vreća. Greška „košnice“ nikad ne stvara pčelarstvo.
- Stočarstvo: godišnja osnova koristi prosečan broj grla × broj dana/stvarni broj dana godine. Ciklus koristi ostvareni broj grla i ne primenjuje godišnji faktor. Hranidbeni blokovi imaju zasebne osnove i zasebne sume 100%. Rast telesne mase menja odgovarajuću količinu uz izvorni odnos težina; drugi tipovi formula se ne izvršavaju.
- Alternative „ili“ nisu kumulativni obavezni troškovi. Admin eksplicitno isključuje alternativu uz razlog. Izvorne raspodele 1/6 i 1/2 već su uključene u ekstrahovane količine i ne primenjuju se ponovo.

Arhivska suma koristi nedostajuće cene kao Excel nulu ISKLJUČIVO za regresiju 2017. Aktivacija novog modela zabranjuje praznu cenu pri pozitivnoj količini; nula zahteva razlog. Cena nije obavezna za neprimenljivu količinu nula. Zatvoren obračun čuva model i sve kursne snapshot-e. Aktivni normativ je nepromenljiv: nova verzija zahteva kloniranje, nove cene, pregled i odobrenje. Nema dva aktivna perioda koja se preklapaju za isti predložak.

## Rezultati i zalihe

Prihod: priznata eksterna prodaja + priznati ostali prihodi; subvencije se prikazuju zasebno i u rezultatu sa subvencijama. Potraživana subvencija je isključena. Uplata subvencije ulazi u tok samo iz evidencije plaćanja i ne ponavlja se kao novi prihod.

Ukupan normativni trošak ostvarene proizvodnje prikazuje se u detalju (`normativeTotal`). Pripisani trošak eksternog rezultata je trošak × eksterno prodata količina / ostvarena količina (najviše 1); završna zaliha i sopstvena potrošnja po trošku prikazuju se odvojeno. Ciklus sa neprodatom proizvodnjom ili nepotpunim troškovima je privremen. Ako je stvarno ostvarena količina nula, puni trošak neuspele proizvodnje ostaje trošak perioda. Nepoznata količina je označena, ne pretvorena u potvrđenu nulu.

Prva faza ima glavni proizvod i zasebne količinske evidencije nusproizvoda. Administrator može odobriti raspodelu zajedničkog troška na tačne nazive nusproizvoda, u procentima; glavni proizvod dobija preostali udeo do 100%. Nusproizvodi se evidentiraju u zalihama i mogu prodavati/prenositi/trošiti u sopstvenom domaćinstvu. Trošak eksternog rezultata sabira udeo svakog proizvoda × prodatu količinu / ostvarenu količinu u njegovoj jedinici. Različite fizičke jedinice se ne sabiraju. Bez odobrene raspodele ili ostvarene količine takav obračun ostaje nepotpun. Ne pretpostavlja se da kg mleka, grlo i komad jajeta imaju istu troškovnu osnovu.

Stvarni rezultat koristi samo stvarno evidentirane varijabilne troškove. Nabavka zalihe nije dodatni rashod pri nabavci: vrednost ulazi u trošak pri potrošnji. Trošak sa normativnom vezom ne zamenjuje normativ automatski; `replaceNorm` to eksplicitno radi samo u „Kombinovanom obračunu“. Jedna stavka ima najviše jednu direktnu zamenu. Ostali dodatni troškovi ulaze u kombinovani prikaz samo eksplicitnim izborom. Glavni normativni prikaz ostaje zaseban.

Interni prenos je atomski uparen izlaz/ulaz sa istim količinama, jedinicama i RSD/EUR vrednostima. Vrednost se dobija iz sledljivog odobrenog normativa izvora ili kompletne stvarne evidencije; korisnik ne unosi tržišnu cenu prenosa. Prenos ne stvara prihod ili plaćanje. Potrošnja u odredišnoj proizvodnji povlači vrednost zalihe. Povezana normativna stavka hrane dobija sledljivu vrednost umesto odgovarajućeg dela referentnog hraniva, bez dodatnog eksternog rashoda na nivou gazdinstva. Neiskorišćena preneta hrana ostaje zaliha odredišta.

Početno stanje + proizvodnja + nabavke − prodaja − interni izlazi + interni ulazi − potrošnja − otpis = završno stanje. Korekcija i početno stanje zahtevaju obrazloženje. Promene su serijalizovane zaključavanjem reda gazdinstva, tako da paralelna prodaja ne može potrošiti istu zalihu dvaput. kg/t i m²/ha konvertuju se eksplicitno; neusklađene dimenzije se odbijaju.

„Zalihe na parceli“ su mesečna kumulativna ulaganja u toku, u posebnoj tabeli. Nisu gotovi proizvodi, nisu mesečni novčani rashodi i ne sabiraju se kao nove isplate.

## Kurs i novac

NBS liste unosi administrator sa datumom objave, zvaničnim URL-om i tačnim intervalom važenja. Vikend/praznik mora biti obuhvaćen važenjem prethodne zvanične liste; aplikacija ne produžava staru listu proizvoljno. Za događaj se uzima datum događaja, a za plaćanje datum plaćanja. Bez važeće liste moguć je nacrt, ne finalizovan konvertovan iznos. U istoriji ostaju originalni iznos, valuta, RSD, EUR, kurs, datum liste i izvor. EUR × kurs = RSD; RSD / kurs = EUR.

Početno stanje + primljene uplate − izvršene isplate = završno stanje. Bez početnog stanja prikazuje se neto tok, a saldo je nepoznat. Prenos između sopstvenih računa ne ulazi u eksterni tok. Zajam/ulaganje vlasnika su novčane kategorije i ne stvaraju automatski maržu. Ograničenje zbirnih plaćanja proverava se u valuti izvornog događaja uz kurs konkretnog plaćanja; dokumentovani kursni dobici/gubici i bankarske provizije nisu poseban računovodstveni modul prve faze.

## Granice

Ovo je obračunska marža pokrivenih varijabilnih troškova, ne puna dobit, poreska prijava ili kompletan računovodstveni bilans. Ne obračunava se PDV, amortizacija, porodični rad ili opšti troškovi. Istorijski preparati i opisni prinosi dostupni su administratoru kao izvorni sadržaj, bez aktuelnih agronomskih preporuka.
