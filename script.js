/* ===========================================
   Brand – Danmarkskort (trin 1)
   - Basiskort
   - DAWA adressesøgning + valg
   - Tastatur-navigation i resultater (↑/↓/Enter/Esc)
   - Clear-knap (x) der rydder søgning og lukker alt
   - Klar til netselskab-opslag via proxy (slået fra)
   =========================================== */

// Sæt denne til din Cloudflare Worker, når du er klar med proxyen.
// Lad den være tom ("") for at slå elnet-opslag fra.
const PROXY_BASE = ""; // fx: "https://brand-elnet-proxy.anderskabel.workers.dev"

// Leaflet-kort
const map = L.map("map", { zoomControl: true, attributionControl: true })
  .setView([56.2639, 9.5018], 7);

L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
  maxZoom: 19,
  attribution: '&copy; OpenStreetMap-bidragydere'
}).addTo(map);

// UI refs
const searchInput = document.getElementById("searchInput");
const resultsBox  = document.getElementById("results");
const infoTpl     = document.getElementById("info-template");
const clearBtn    = document.getElementById("clearBtn");

let marker = null;
let activeIndex = -1;   // til tastatur-navigation
let lastResults  = [];  // sidst viste resultater

/* ---------- Hjælpere ---------- */
function debounce(fn, ms) {
  let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); };
}
function escapeHtml(s) {
  return String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}
function setActive(index) {
  const nodes = [...resultsBox.querySelectorAll(".item")];
  nodes.forEach(n => n.classList.remove("active"));
  if (index >= 0 && index < nodes.length) {
    nodes[index].classList.add("active");
    const id = nodes[index].id || "";
    searchInput.setAttribute("aria-activedescendant", id);
    // scroll item i view hvis nødvendigt
    const el = nodes[index];
    const box = resultsBox;
    const top = el.offsetTop;
    const bottom = top + el.offsetHeight;
    if (top < box.scrollTop) box.scrollTop = top;
    else if (bottom > box.scrollTop + box.clientHeight) box.scrollTop = bottom - box.clientHeight;
  } else {
    searchInput.setAttribute("aria-activedescendant", "");
  }
  activeIndex = index;
}
function hideResults() {
  resultsBox.style.display = "none";
  resultsBox.innerHTML = "";
  searchInput.setAttribute("aria-expanded", "false");
  activeIndex = -1;
  lastResults = [];
}
function showClear(show) {
  clearBtn.style.display = show ? "inline-block" : "none";
}

/* ---------- DAWA søgning ---------- */
async function dawaAutocomplete(q) {
  const url = `https://api.dataforsyningen.dk/adresser/autocomplete?q=${encodeURIComponent(q)}&fuzzy=`;
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("Adresse-autocomplete fejlede");
  return r.json();
}
async function dawaGetById(id) {
  const url = `https://api.dataforsyningen.dk/adresser/${id}`;
  const r = await fetch(url, { headers: { "Accept": "application/json" } });
  if (!r.ok) throw new Error("Adresseopslag fejlede");
  return r.json();
}

/* ---------- Elnet via proxy (valgfri) ---------- */
async function elnetAutocomplete(fullAddress) {
  if (!PROXY_BASE) return [];
  const url = `${PROXY_BASE}/elnet/autocomplete?q=${encodeURIComponent(fullAddress)}`;
  const r = await fetch(url, { headers: { "Accept": "application/json" }});
  if (!r.ok) throw new Error("Elnet autocomplete via proxy fejlede");
  return r.json();
}
async function elnetSupplierByExternalId(externalId) {
  if (!PROXY_BASE) return [];
  const url = `${PROXY_BASE}/elnet/supplier?externalId=${encodeURIComponent(externalId)}`;
  const r = await fetch(url, { headers: { "Accept": "application/json" }});
  if (!r.ok) throw new Error("Elnet supplier via proxy fejlede");
  return r.json();
}

/* ---------- UI: vis forslag ---------- */
function showResults(items) {
  lastResults = items || [];
  if (!items || !items.length) {
    hideResults();
    return;
  }
  resultsBox.innerHTML = items.slice(0, 50).map((x, i) => {
    const id = `res-${i}`;
    return `<div class="item" id="${id}" role="option" aria-selected="false" data-id="${x.adresse.id}" data-tekst="${escapeHtml(x.tekst)}">${escapeHtml(x.tekst)}</div>`;
  }).join("");
  resultsBox.style.display = "block";
  searchInput.setAttribute("aria-expanded", "true");
  setActive(-1);
}

/* ---------- Hovedflow: vælg adresse ---------- */
async function onPickAddress(adresseId, visningstekst) {
  try {
    const adr = await dawaGetById(adresseId);
    const [lon, lat] = adr.adgangsadresse.adgangspunkt.koordinater;
    const position = [lat, lon];

    if (!marker) marker = L.marker(position).addTo(map);
    marker.setLatLng(position);
    map.setView(position, 16);

    let supplier = null;
    if (PROXY_BASE) {
      const auto = await elnetAutocomplete(visningstekst);
      const best = Array.isArray(auto) && auto.length ? auto[0] : null;
      if (best?.ExternalSupplierId) {
        const res = await elnetSupplierByExternalId(best.ExternalSupplierId);
        supplier = (Array.isArray(res) && res.length) ? res[0] : null;
      }
    }

    const node = infoTpl.content.cloneNode(true);
    node.querySelector('[data-bind="address"]').textContent = visningstekst;

    const netWrap = node.querySelector(".net");
    if (supplier) {
      node.querySelector('[data-bind="name"]').textContent = supplier.Name ?? "";
      node.querySelector('[data-bind="phone"]').textContent = supplier.PhoneNumber ? `Tlf.: ${supplier.PhoneNumber}` : "";
      const a = node.querySelector('[data-bind="website"]');
      if (supplier.Website) {
        a.href = supplier.Website.startsWith("http") ? supplier.Website : `https://${supplier.Website}`;
        a.textContent = supplier.Website;
      } else { a.remove(); }
      const logo = node.querySelector('[data-bind="logo"]');
      if (supplier.LogoUrl) logo.src = supplier.LogoUrl; else logo.remove();
    } else {
      netWrap.innerHTML = "<strong>Netselskab</strong><br><em>( slået fra eller ikke fundet )</em>";
    }

    marker.bindPopup(node, { maxWidth: 320 }).openPopup();
  } catch (err) {
    console.error(err);
    alert("Der opstod en fejl under opslag. Se Console for detaljer.");
  }
}

/* ---------- Events ---------- */
// Input → fetch forslag (debounced)
searchInput.addEventListener("input", debounce(async (e) => {
  const q = e.target.value.trim();
  showClear(q.length > 0);
  if (q.length < 3) { hideResults(); return; }
  try {
    const res = await dawaAutocomplete(q);
    showResults(res);
  } catch (err) {
    console.error(err);
    hideResults();
  }
}, 200));

// Klik på forslag
resultsBox.addEventListener("click", (e) => {
  const item = e.target.closest(".item");
  if (!item) return;
  const id = item.getAttribute("data-id");
  const tekst = item.getAttribute("data-tekst");
  hideResults();
  searchInput.value = tekst;
  showClear(true);
  onPickAddress(id, tekst);
});

// Tastatur i inputfeltet
searchInput.addEventListener("keydown", (e) => {
  const items = [...resultsBox.querySelectorAll(".item")];
  if (e.key === "ArrowDown") {
    e.preventDefault();
    if (!items.length) return;
    setActive(activeIndex < items.length - 1 ? activeIndex + 1 : 0);
  } else if (e.key === "ArrowUp") {
    e.preventDefault();
    if (!items.length) return;
    setActive(activeIndex > 0 ? activeIndex - 1 : items.length - 1);
  } else if (e.key === "Enter") {
    if (activeIndex >= 0 && activeIndex < items.length) {
      e.preventDefault();
      items[activeIndex].click();
    }
  } else if (e.key === "Escape") {
    hideResults();
  }
});

// Luk forslag når man klikker udenfor
document.addEventListener("click", (e) => {
  if (!resultsBox.contains(e.target) && e.target !== searchInput) {
    hideResults();
  }
});

// Clear-knap
clearBtn.addEventListener("click", () => {
  searchInput.value = "";
  showClear(false);
  hideResults();
  if (marker) {
    map.removeLayer(marker);
    marker = null;
  }
  // luk evt. popup
  map.closePopup();
});
