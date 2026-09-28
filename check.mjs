import { existsSync, readFileSync, writeFileSync } from "node:fs";

const SIDE = "https://plushusene.dk/lokationer/bofaellesskabet-i-ballerup/vaelg-bolig-i-ballerup/";
const STATE_FIL = "status.json";

const topic = process.env.NTFY_TOPIC;
if (!topic) {
  throw new Error("NTFY_TOPIC mangler");
}

const res = await fetch(SIDE, { headers: { "User-Agent": "Mozilla/5.0 (boligovervaagning)" } });
if (!res.ok) {
  throw new Error(`Siden svarede ${res.status}`);
}
const html = await res.text();

const rens = (s) => s.replace(/<[^>]*>/g, "").replace(/&amp;/g, "&").trim();

// Hver bolig er en <tr data-row_id=...> i tabellen; kolonnerne ligger i fast rækkefølge.
const boliger = [...html.matchAll(/<tr data-row_id[^>]*>([\s\S]*?)<\/tr>/g)]
  .map((m) => [...m[1].matchAll(/<td[^>]*>([\s\S]*?)<\/td>/g)].map((c) => rens(c[1])))
  .filter((c) => c.length >= 22)
  .map((c) => ({
    id: c[0],
    adresse: c[3],
    fra: c[20],
    status: c[21],
  }));

if (boliger.length === 0) {
  throw new Error("Fandt ingen boliger. Har siden skiftet format?");
}

// Alle boliger der ikke er udlejet, med deres status. En bolig der ikke står i filen, var udlejet sidst.
const ikkeUdlejede = boliger.filter((b) => b.status !== "Udlejet");
const kendte = existsSync(STATE_FIL) ? JSON.parse(readFileSync(STATE_FIL, "utf8")) : {};
const aendrede = boliger.filter((b) => (kendte[b.id] ?? "Udlejet") !== b.status);

console.log(`${boliger.length} boliger, ${ikkeUdlejede.length} ikke udlejet, ${aendrede.length} ændret`);

for (const b of aendrede) {
  const svar = await fetch(`https://ntfy.sh/${topic}`, {
    method: "POST",
    headers: { Title: `Bolig i Ballerup: ${b.status}`, Click: SIDE, Tags: "house" },
    body: `${b.adresse}\nStatus: ${b.status} (før: ${kendte[b.id] ?? "Udlejet"})\nFra ${b.fra}`,
  });
  if (!svar.ok) {
    throw new Error(`ntfy svarede ${svar.status}`);
  }
}

const nyState = Object.fromEntries(ikkeUdlejede.map((b) => [b.id, b.status]).sort());
writeFileSync(STATE_FIL, JSON.stringify(nyState, null, 2) + "\n");
