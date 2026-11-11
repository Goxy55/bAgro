# Procena cene po sličnom artiklu

Za stavke troškovnika koje nisu pronađene u STIPS/RZS cenovnicima i javnim izvorima administrator može dobiti **procenu**. Procena nikad nije izvorna cena i nikad se ne primenjuje automatski.

## Postupak

U zajedničkoj tabeli cena (nacrt) otvorite **Procena cene po sličnom artiklu** → **Pronađi slične artikle**.

- Pretražuju se samo stavke **bez cene i bez ikakvog STIPS/RZS predloga**. Isključeni su seme, rasad, stočarstvo, gorivo i usluge.
- Kandidati su STIPS artikli iste kategorije (pesticidi, đubriva) iz izabranog mesta, sa pakovanjem koje se može preračunati u jedinicu stavke.
- **Sličnost (0–100%)**: zajedničke reči u nazivu; kod đubriva blizina odnosa hraniva (npr. NPK 15:15:20 ≈ 15:15:15) ili istog hraniva u procentu; kod ostalih različita brojčana oznaka (npr. koncentracija) umanjuje ocenu. Prag za predlog je 40%; prikazuje se do pet kandidata, uz objašnjenje.
- **Orijentir grupe**: min – medijana – max cena svih uporedivih artikala iste kategorije (najmanje 3). Samo se prikazuje; ne može se primeniti.
- Za primenu izaberite kandidata, označite **Primeni** i potvrdite da su cene procene. Server ponovo računa cenu iz izvornog opažanja; razlika se odbija.

## Šta se čuva i gde se vidi

- Cena se upisuje samo u **nacrt** i označena je (`priceInput.estimate`): osnova, sličan artikal, pakovanje, period cene, ko je i kada potvrdio. Ne stvara se zapamćena veza proizvoda (`input_price_links`).
- Ručna promena cene stavke uklanja oznaku procene.
- Na Pregledu gazdinstva kartica „Šta nedostaje i koliko to vredi“ prikazuje **Normativ koristi procenjene cene**: iznos i udeo u trošku normativa.
- Aktivaciju normativa i dalje potvrđuje administrator kao i inače.

## Ograničenja

- Ista pretraga ne važi za potpuno nepoznate normative (ceo normativ kulture); kopiranje normativa sličnog useva je zasebna agronomska odluka i nije deo ove funkcije.
- Procena zavisi od uvezenih STIPS cenovnika; bez njih nema predloga.
- Sličnost naziva nije dokaz iste ili zamenljive formulacije. Proverite sastav pre potvrde.
