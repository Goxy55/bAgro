# Fiksni kurs i procena uticaja na pregledu

## Fiksni kurs

**Administracija → NBS kursevi** → uključite „Fiksni (interni) kurs“, unesite period (npr. 2026-01-01 do 2026-12-31), kurs i obrazloženje. Dok ne postoji zvanični kurs za isti datum, fiksni kurs se koristi za događaje, plaćanja i EUR normative. Čim se unese zvanični kurs za deo perioda, on ima prednost (fiksni ostaje za ostale datume). Fiksni kurs se može ukloniti; zvanične liste se ne brišu.

U svakom obračunu izvor kursa glasi „Fiksni kurs gazdinstva (nije zvanični NBS kurs): <obrazloženje>”, a snimak novca čuva `rateKind: "fixed"`. Postojeći snimljeni obračuni se ne menjaju. Nacrti cenovnika koji su čekali kurs preračunavaju se kao i kod zvaničnog kursa.

## Kartica „Šta nedostaje i koliko to vredi“

Prikazuje se na Pregledu gazdinstva (`impact` u odgovoru `/api/report`). To je **procena**: ne ulazi u obračun, maržu ni PDF/XLSX izvoz, a obračun ostaje nepotpun dok se podaci ne dopune.

| Stavka | Procena |
|---|---|
| Nedostaje kurs | Normativ u EUR × najbliži poznati kurs (zvanični ima prednost); bez ijednog kursa — ne može se proceniti |
| Nedovršeni događaji | Zbir iznosa iz nacrta, troškovi i prihodi odvojeno; nacrti bez iznosa se broje posebno |
| Neprodata količina | Količina po normativnom trošku proizvodnje (nije prihod); bez normativa — ne može se proceniti |
| Evidencija nije potvrđena | Bez iznosa; vodi na proizvodnje |

Svaka stavka ima kratko objašnjenje kako je izračunata i dugme koje vodi na ispravku (za kurs — administratoru).
