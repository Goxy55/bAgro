# Javne cenovne reference inputa

Adapteri su ograničeni na tri proverena HTTPS domena:

| Prodavac | Provereni javni upit | Čitanje cene |
| --- | --- | --- |
| Ratar | `/search?proizvod=...` | Naslov proizvoda i zasebno zaglavlje `CENA:`; popust za registrovane se izostavlja |
| Poljokomerc | `/?s=...&post_type=product` | Product JSON-LD za isti URL i RSD, odnosno neposredna cena proizvoda; bez navigacionih/susednih cena |
| Hemoslavija | `/shop.php?search=...` | Identitet `detail.php?artsif=...`, red `Cena (mpc)`, deklarisana jedinica i pakovanje |

Upiti su pročitani iz stvarnih javnih obrazaca. Ne koriste se plaćeni servisi ili izmišljeni API-ji. Preuzimaju se samo javne GET stranice nakon robots provere. Nema prijave, kupovine, korpe, slanja ponuda ili kontaktiranja dobavljača. Preusmerenje ostaje na istom dozvoljenom domenu i proverava politiku izvora. Zahtevi su vremenski i veličinski ograničeni, uz razmak najmanje jedne sekunde. Promena strukture zaustavlja parsiranje te stranice.

Cena pakovanja skalira se decimalno: npr. izvornih 1.950 RSD za 150 ml znači 13.000 RSD/l, pa se množena količina uzima iz normativa. Ovo je stvarno pročitana javna ponuda u trenutku provere, bez tvrdnje o tekućoj dostupnosti ili nacionalnom proseku. Jedinice kg/g i l/ml ostaju različite dimenzije. Višestruki paketi i nedvosmisleno neprepoznata pakovanja se ne procenjuju.

Originalni HTML i SHA-256 čuvaju se u `public_price_documents`, a strukturisani podaci u `public_input_prices`. Jednako semantičko stanje ne pravi nove dokumente zbog HTML nonce-a: ažurira se datum poslednje provere. Promena cene/dostupnosti čuva reviziju. Novija nedostupna ponuda ne vraća automatski raniju dostupnu cenu. Greška mreže zadržava istoriju uz upozorenje i stari datum provere. U snapshot cene ulaze izvor, pakovanje, osnovica, izvorna cena, datum provere i eventualni dokaz jednakog sastava zamenske reference.

Provera stvarnog čitanja 31.10.2026: tri javne stranice za Sekator 150 ml, sve HTTP 200; Ratar 1.950 RSD, Poljokomerc 1.890 RSD, Hemoslavija 1.784,48 RSD. Ovo potvrđuje strukturu tri adaptera, **ne potpun cenovnik za sve četiri kulture ili svih 88 modela**. Sastav je potpuno strukturisan samo gde je prepoznat; njegov izostanak ne potvrđuje zamensku referencu.

[Audit sa URL-ovima i sumama](../source/public-price-audit-2026-10-31.json). Ponovna operaterska provera bez pristupa poslovnoj bazi:

```sh
npx tsx scripts/audit-public-prices.ts
```

Za dodavanje drugog prodavca potrebni su pregled javnog obrasca, pravila pristupa i strukture proizvoda, ograničenje domena i test pakovanja/cene/sastava. Nema univerzalnog pretraživača koji svaku cenu iz bilo kog teksta automatski proglašava odgovarajućom referencom.
