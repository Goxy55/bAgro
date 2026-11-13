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
