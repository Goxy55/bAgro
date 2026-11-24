# Unos i praćenje proizvodnje

## Nova proizvodnja u tri koraka

**Moje proizvodnje → Dodaj proizvodnju**

1. **Vrsta:** ratarstvo, povrtarstvo, voćarstvo, plastenici, stočarstvo, začinsko i lekovito bilje, ostalo. Svaka vrsta objedinjuje izvorne kategorije kataloga.
2. **Kultura:** izbor iz kataloga (uz pretragu). Kod stoke se bira vrsta, pa niži ili viši intenzitet.
3. **Količina:** površina (ha ili m²), broj biljaka, vreća ili grla, uz datum početka (unapred popunjen). Kod ciklusne stoke opciono se unosi očekivani završetak ciklusa.

Dok se unosi količina, prikazuje se **procena troška**: ukupan trošak sezone i trošak do danas. Proizvodnja se čuva kao nacrt; prinos, prodaja, zalihe i novčani tok dopunjuju se kasnije u detalju proizvodnje, bez izmene postojećih podataka.

## Kako se računa trošak

| Osnova | Ukupan trošak | Do danas |
|---|---|---|
| Površina (ha, m²) | Odobren normativ × površina | Mesečni raspored troškova kulture (isti obračun kao „Zalihe na parceli“); tekući mesec je uračunat ceo |
| Stoka, godišnji normativ | Normativ × broj grla × udeo godine u periodu | Srazmerno proteklim danima perioda |
| Stoka, po ciklusu | Normativ ciklusa × broj grla | Srazmerno proteklom delu ciklusa, ako je unet očekivani završetak |
| Rasad, šampinjoni | Normativ | Nije dostupno (prikazuje se samo ukupan trošak) |

Cene dolaze isključivo iz odobrenog cenovnika. Kada nešto nedostaje (nema odobrenog cenovnika, nije potvrđen mesečni raspored, nedostaje kurs za EUR normativ, nisu potvrđene hranidbene osnove), prikaz navodi razlog na običnom jeziku, a iznos ostaje prazan; ne pretpostavljaju se nule.

## Pregled

Stranica **Moje proizvodnje** prikazuje zbir ukupnog troška i troška do danas, filtere po vrsti proizvodnje i karticu za svaku proizvodnju sa trakom napretka. Isti prikaz je na vrhu detalja proizvodnje.

API: `GET /api/production-costs` i `POST /api/production-costs/preview`.

## Prodaja: količina × cena

U **Prodaja i troškovi → Dodaj → Prodaja** unose se prodat proizvod, **prodata količina**, jedinica i **cena po jedinici**. Ukupan iznos se računa sam (količina × cena, zaokruženo na dve decimale) i odmah je prikazan; ne unosi se ručno. Server isti iznos računa ponovo i odbija zahtev čiji se iznos ne slaže. Nacrt može biti nepotpun; završena prodaja traži količinu i cenu. Zaliha se i dalje proverava. Ako gazdinstvo ima samo jednu proizvodnju, ona je unapred izabrana.

Prodaja ne stvara naplatu: naplaćeni iznos se evidentira zasebno kao priliv.

## Naplata po proizvodnji

U detalju proizvodnje, kartica **Naplata**:

- **Prodaja** nosi kupca i opcioni **rok plaćanja** (ne sme biti pre datuma prodaje).
- Za svaku prodaju prikazuju se iznos, naplaćeno, ostaje i status: čeka naplatu, delimično, naplaćeno ili **kasni N dana** (rok prošao, a nije naplaćeno).
- **Evidentiraj naplatu** unosi naplaćeni iznos i datum uplate; delimične naplate se sabiraju, a iznos veći od preostalog se odbija.
- **Primljen avans** evidentira novac primljen pre prodaje (kupac, iznos, datum). Avans je odmah novčani priliv, ali ne umanjuje potraživanje dok se ne poveže: **Poveži sa prodajom** raspoređuje ceo avans ili deo (ista proizvodnja, ista valuta, najviše do preostalog iznosa prodaje).
- Zbir prodato / naplaćeno / ostaje (i dospelo) prikazan je i na kartici proizvodnje.

API: `GET /api/receivables`, `POST /api/payments` (uz `advance`, `productionId`, `buyer`), `POST /api/payments/:id/allocate`. Migracija `015_collections.sql` dodaje vezu plaćanja sa proizvodnjom, kupca i oznaku avansa.
