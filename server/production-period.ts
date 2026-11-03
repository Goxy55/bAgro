/** Surface crops may include preparation in the year preceding the harvest season. */
export function validateProductionPeriod(
  basis: string,
  year: number,
  details: any,
) {
  const start = details.start || `${year}-01-01`,
    end = details.end || `${year}-12-31`;
  if (start > end) throw Error("Početak perioda mora prethoditi završetku.");
  if (["ha", "m2"].includes(basis)) {
    if (
      start < `${year - 1}-01-01` ||
      start > `${year}-12-31` ||
      !end.startsWith(String(year))
    )
      throw Error(
        "Biljna sezona obuhvata pripremu prethodne godine i završetak u godini sezone.",
      );
  } else if (!start.startsWith(String(year)) || !end.startsWith(String(year)))
    throw Error(
      "Ova obračunska osnova zahteva period unutar obračunske godine.",
    );
}
