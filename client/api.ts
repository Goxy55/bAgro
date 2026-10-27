export let selectedFarm = localStorage.getItem("agro-farm") || "";
export function selectFarm(id: string) {
  selectedFarm = id;
  localStorage.setItem("agro-farm", id);
}
export async function api(path: string, body?: any, method?: string) {
  const res = await fetch("/api" + path, {
    method: method || (body ? "POST" : "GET"),
    headers: {
      "Content-Type": "application/json",
      ...(selectedFarm ? { "X-Farm-Id": selectedFarm } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const result = await res.json();
  if (!res.ok)
    throw Error(result.error || result.message || "Zahtev nije uspeo.");
  return result;
}
export async function download(
  format: string,
  productionId?: string,
  snapshotId?: string,
) {
  const q = new URLSearchParams();
  if (productionId) q.set("productionId", productionId);
  if (snapshotId) q.set("snapshotId", snapshotId);
  const res = await fetch(`/api/export/${format}?${q}`, {
    headers: selectedFarm ? { "X-Farm-Id": selectedFarm } : {},
  });
  if (!res.ok) {
    const e = await res.json();
    throw Error(e.error);
  }
  const href = URL.createObjectURL(await res.blob());
  const a = document.createElement("a");
  a.href = href;
  a.download = `agro-izvestaj.${format}`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
export async function uploadStips(form: FormData) {
  const response = await fetch("/api/admin/stips/upload", {
    method: "POST",
    headers: selectedFarm ? { "X-Farm-Id": selectedFarm } : {},
    body: form,
  });
  const result = await response.json();
  if (!response.ok) throw Error(result.error || "Uvoz biltena nije uspeo.");
  return result;
}
export async function downloadStips(
  id: string,
  admin = false,
  filename?: string,
) {
  const response = await fetch(
    `/api/${admin ? "admin/" : ""}stips/documents/${id}/file`,
    { headers: selectedFarm ? { "X-Farm-Id": selectedFarm } : {} },
  );
  if (!response.ok) {
    const result = await response.json();
    throw Error(result.error || "Dokument nije dostupan.");
  }
  const href = URL.createObjectURL(await response.blob()),
    a = document.createElement("a");
  a.href = href;
  a.download =
    filename ||
    (response.headers.get("content-type")?.includes("html")
      ? "stips-bilten.html"
      : "stips-bilten.pdf");
  a.click();
  setTimeout(() => URL.revokeObjectURL(href), 1000);
}
