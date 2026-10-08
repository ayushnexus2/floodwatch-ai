const $ = id => document.getElementById(id);
let coords = null;
const API = "/api"; // Local FastAPI fallback for development
const LAMBDA_API = "https://5uc6zopvibuo27ynqhvu2dsqsy0jhcpn.lambda-url.ap-southeast-2.on.aws";
const GEOCODE_API = "https://geocoding-api.open-meteo.com/v1/search";

$("locate").onclick = locate;
$("refresh").onclick = () => coords ? load(coords.lat, coords.lon) : setStatus("● Choose a location first");
$("searchPlace").onclick = searchPlace;
$("placeInput").addEventListener("keydown", e => { if (e.key === "Enter") searchPlace(); });

function setStatus(text) { $("status").textContent = text; }

function locate() {
    if (!window.isSecureContext && location.hostname !== "localhost" && location.hostname !== "127.0.0.1") {
        setStatus("● GPS needs HTTPS");
        $("locationHelp").textContent = "GPS works on HTTPS or localhost. You can use manual location search instead.";
        return;
    }
    if (!navigator.geolocation) {
        setStatus("● GPS unavailable");
        $("locationHelp").textContent = "This browser does not provide GPS. Use manual location search.";
        return;
    }
    setStatus("● Requesting GPS permission...");
    navigator.geolocation.getCurrentPosition(
        p => {
            coords = { lat: p.coords.latitude, lon: p.coords.longitude };
            $("placeInput").value = "";
            load(coords.lat, coords.lon);
        },
        e => {
            console.error("Geolocation error", e);
            setStatus("● GPS permission blocked");
            const msg = e.code === 1
                ? "Location permission was denied/blocked. In browser site settings, allow Location for this site, then try again. Or use manual location search below."
                : e.code === 2
                    ? "Your device could not determine GPS location. Try again or use manual location search."
                    : "GPS request timed out. Try again or use manual location search.";
            $("locationHelp").textContent = msg;
            $("riskMsg").textContent = "GPS unavailable — manual location search is ready.";
        },
        { enableHighAccuracy: true, timeout: 15000, maximumAge: 300000 }
    );
}

let searchResults = [];
let activeSuggestion = -1;
let searchTimer = null;

async function searchPlace() {
    const q = $("placeInput").value.trim();
    if (!q) {
        $("locationHelp").textContent = "Enter a city, town, village or locality.";
        $("placeInput").focus();
        return;
    }
    setStatus("● Searching location...");
    hideSuggestions();
    try {
        const r = await fetch(`${GEOCODE_API}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
        const raw = await r.json();
        const d = {
            results: (raw.results || []).map(x => ({
                name: x.name,
                latitude: x.latitude,
                longitude: x.longitude,
                display_name: [x.name, x.admin1, x.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")
            }))
        };
        if (!r.ok || !d.results.length) {
            throw new Error("Location not found. Try a nearby city or a more specific place.");
        }
        selectLocation(d.results[0]);
    } catch (e) {
        console.error(e);
        setStatus("● Location search failed");
        $("locationHelp").textContent = e.message;
    }
}

function selectLocation(x) {
    coords = { lat: Number(x.latitude), lon: Number(x.longitude) };
    $("placeInput").value = x.display_name || x.name || "Selected location";
    $("locationHelp").textContent = `Selected: ${x.display_name || x.name}. Loading live environmental data...`;
    hideSuggestions();
    load(coords.lat, coords.lon);
}

async function fetchSuggestions(q) {
    if (q.length < 2) { hideSuggestions(); return; }
    try {
        const r = await fetch(`${GEOCODE_API}?name=${encodeURIComponent(q)}&count=5&language=en&format=json`);
        const raw = await r.json();
        if (!r.ok || !Array.isArray(raw.results)) throw new Error("Search unavailable");
        searchResults = raw.results.map(x => ({
            name: x.name,
            latitude: x.latitude,
            longitude: x.longitude,
            display_name: [x.name, x.admin1, x.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")
        }));
        activeSuggestion = -1;
        renderSuggestions();
    } catch (e) {
        console.error(e);
        hideSuggestions();
    }
}

function renderSuggestions() {
    const box = $("searchSuggestions");
    if (!searchResults.length) {
        box.innerHTML = `<div class="search-loading">No locations found. Try a nearby city or a simpler name.</div>`;
        box.style.display = "block";
        return;
    }
    box.innerHTML = searchResults.map((x, i) => `
        <button type="button" class="suggestion ${i === activeSuggestion ? "active" : ""}" data-index="${i}" role="option">
            <strong>${escapeHtml(x.name || "Unknown place")}</strong>
            <small>${escapeHtml(x.display_name || "")}</small>
        </button>
    `).join("");
    box.style.display = "block";
    box.querySelectorAll(".suggestion").forEach(btn => {
        btn.addEventListener("click", () => selectLocation(searchResults[Number(btn.dataset.index)]));
    });
}

function escapeHtml(value) {
    return String(value).replace(/[&<>'"]/g, c => ({"&":"&amp;","<":"&lt;",">":"&gt;","'":"&#39;",'"':"&quot;"}[c]));
}

function hideSuggestions() {
    const box = $("searchSuggestions");
    if (box) box.style.display = "none";
}

function updateClearButton() {
    $("clearSearch").style.display = $("placeInput").value ? "block" : "none";
}

$("placeInput").addEventListener("input", e => {
    updateClearButton();
    clearTimeout(searchTimer);
    const q = e.target.value.trim();
    searchTimer = setTimeout(() => fetchSuggestions(q), 300);
});

$("placeInput").addEventListener("keydown", e => {
    if (e.key === "Enter") {
        e.preventDefault();
        if (activeSuggestion >= 0 && searchResults[activeSuggestion]) {
            selectLocation(searchResults[activeSuggestion]);
        } else {
            searchPlace();
        }
        return;
    }
    if (e.key === "Escape") { hideSuggestions(); return; }
    if (!searchResults.length) return;
    if (e.key === "ArrowDown") {
        e.preventDefault();
        activeSuggestion = Math.min(activeSuggestion + 1, searchResults.length - 1);
        renderSuggestions();
    } else if (e.key === "ArrowUp") {
        e.preventDefault();
        activeSuggestion = Math.max(activeSuggestion - 1, 0);
        renderSuggestions();
    }
});

$("clearSearch").addEventListener("click", () => {
    $("placeInput").value = "";
    searchResults = [];
    activeSuggestion = -1;
    updateClearButton();
    hideSuggestions();
    $("locationHelp").textContent = "Type a place and select a result, or press Enter. GPS is optional.";
    $("placeInput").focus();
});

document.addEventListener("click", e => {
    if (!e.target.closest(".search-input-wrap")) hideSuggestions();
});

updateClearButton();

async function load(lat, lon) {
    setStatus("● Fetching live environmental data...");
    try {
        const r = await fetch(`${LAMBDA_API}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        const d = await r.json();
        if (!r.ok) throw new Error(d.detail || "Environmental API error");
        render(d);
        setStatus("● Live data connected");
    } catch (e) {
        console.error(e);
        setStatus("● Data error");
        $("warning").textContent = e.message;
    }
}

function render(d) {
    $("place").textContent = d.location.name || `${d.location.latitude.toFixed(4)}, ${d.location.longitude.toFixed(4)}`;
    $("coords").textContent = `${d.location.latitude.toFixed(5)}, ${d.location.longitude.toFixed(5)}`;
    $("rain").textContent = d.weather.current_precipitation.toFixed(1);
    $("rain24").textContent = d.weather.rain_24h.toFixed(1);
    $("river").textContent = d.flood.river_discharge_today == null ? "—" : d.flood.river_discharge_today.toFixed(1);
    $("temp").textContent = d.weather.temperature.toFixed(1);
    $("updated").textContent = new Date().toLocaleTimeString();
    $("risk").textContent = d.risk.level;
    $("riskMsg").textContent = d.risk.message;
    $("warning").textContent = d.risk.warning;
    $("risk").className = d.risk.class;
    const riverText = d.flood.river_discharge_today == null ? "unavailable" : `${d.flood.river_discharge_today.toFixed(1)} m³/s`;
    const rankText = d.flood.river_discharge_percentile_rank == null ? "n/a" : `${d.flood.river_discharge_percentile_rank}th percentile` ;
    $("details").innerHTML = `<span class="pill">Risk score: ${d.risk.score}/100</span><span class="pill">Rain next 24h: ${d.weather.rain_24h.toFixed(1)} mm</span><span class="pill">Modelled river: ${riverText}</span><span class="pill">River context: ${rankText}</span>`;
    $("dataNote").textContent = d.flood.river_data_definition;
}
