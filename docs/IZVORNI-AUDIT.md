# Izvorni audit — Izvor 2017 — arhivski

SHA-256 originala: `422571958ad758ed1eaf206cce6b5751b4dc4546629940a7edad9aff53314a5a`. Original je kopiran bajt-po-bajt; izvorni prilog nije izmenjen.

| Izvorni sheet | Uloga | Karte | Formule |
|---|---|---:|---:|
| Usevi | production | 15 | 398 |
| Povrće | production | 19 | 568 |
| Voće | production | 14 | 348 |
| Plastenici | production | 10 | 301 |
| Ostalo | production | 2 | 21 |
| Zalihe na parceli | auxiliary | 0 | 654 |
| Aromatično i lekovito bilje | production | 4 | 101 |
| Stočarstvo niži nivo intenz. | production | 12 | 269 |
| Stočarstvo viši nivo intenz. | production | 12 | 269 |
| Priručnik | auxiliary | 0 | 62 |

Ukupno 88 predložaka; 44 spoljnih formula. Sve ćelije, izvorne formule, keširane vrednosti, komentari i zavisnosti su u source/inventory.json. Uvoz ne izvršava formule.

## Regresija istorijskih rezultata

- Usevi!F27: 355.5774 EUR — prolazi toleranciju 0,000001.
- Usevi!F62: 406.3616 EUR — prolazi toleranciju 0,000001.
- Plastenici!F24: 162.25996 EUR — prolazi toleranciju 0,000001.
- Plastenici!H24: 0.4056499 EUR — prolazi toleranciju 0,000001.
- Ostalo!F34: 2.77693 EUR — prolazi toleranciju 0,000001.

## Pravila i otvorena pitanja

- Sve cene 2017 su arhiva. Nema aktivnog cenovnika. Administrator klonira, potvrđuje jedinice, grupe, vremensku osnovu i alternative i odobrava cene.
- Prazna cena pri pozitivnoj količini blokira aktiviranje. Izričita nula zahteva razlog. Neprimenljiva količina nula ne zahteva cenu.
- Alternative „ili“ se ne biraju automatski. Administrator mora eksplicitno odabrati uključenu stavku ili potvrditi isključenje.
- Šampinjoni: košnice u E23:F23, vreće u A37 i Priručniku. Vreća je predlog; do potvrde aktivacija blokirana.
- Normativne raspodele 1/6 i 1/2 su već u izvornim količinama: ne primenjivati ih drugi put i ne stvarati plaćanja.
- Stočarski blokovi hraniva čuvaju zasebne SUM opsege. Cene hraniva nisu cene gotovog nacionalnog tržišta. Junice i ostale vremenske osnove zahtevaju admin potvrdu.
- Spoljne reference se mapiraju na stvarnu površinu i prinos gazdinstva. Nedostajući prinos je nepoznat podatak. Hektarski deficit bez prinosa prikazuje „Nedostaje prinos“.
- Zalihe na parceli ostaju pomoćni kumulativni modul; Priručnik je pregled postojećih normativa, bez duplog uvoza.
- Istorijske napomene i preparati su samo za admin pregled, nisu savremeni agronomski saveti.

## Obrada troškova

Količina × odobrena cena; puna decimalna preciznost do prikaza. ha → ostvarena ha, plastenik → m²/100, rasad → biljke/80000 ili /5000. Godišnji broj grla koristi prosečan broj i stvarni udeo godine; ciklus koristi broj završenih grla, bez godišnjeg skaliranja. Pokriveni su samo materijal, gorivo i odobrene izvorne operacije; ne puna dobit, rad, amortizacija ili porezi.