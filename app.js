const $ = id => document.getElementById(id);
let coords = null;
const API = "/api";
const LAMBDA_API = "https://5uc6zopvibuo27ynqhvu2dsqsy0jhcpn.lambda-url.ap-southeast-2.on.aws";

$("locate").onclick = locate;
$("refresh").onclick = () => coords ? load(coords.lat, coords.lon) : setStatus("● Choose a location first");
$("searchPlace").onclick = searchPlace;
$("placeInput").addEventListener("keydown", e => { if (e.key === "Enter") searchPlace(); });

function setStatus(text) { $("status").textContent = text; }

async function requestJson(url) {
    const response = await fetch(url);
    const text = await response.text();
    let payload = {};
    if (text) {
        try { payload = JSON.parse(text); }
        catch (error) {
            throw new Error("The weather service returned invalid data.");
        }
    }
    if (!response.ok) {
        const detail = payload.detail || payload.message || "Request failed.";
        throw new Error(detail);
    }
    return payload;
}

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
        const payload = await requestJson(`${API}/geocode?q=${encodeURIComponent(q)}`);
        const results = (payload.results || []).map(x => ({
            name: x.name,
            latitude: x.latitude,
            longitude: x.longitude,
            display_name: [x.name, x.admin1, x.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")
        }));
        if (!results.length) {
            throw new Error("Location not found. Try a nearby city or a more specific place.");
        }
        selectLocation(results[0]);
    } catch (error) {
        console.error(error);
        setStatus("● Location search failed");
        $("locationHelp").textContent = error.message || "Location search failed.";
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
        const payload = await requestJson(`${API}/geocode?q=${encodeURIComponent(q)}`);
        if (!Array.isArray(payload.results)) throw new Error("Search unavailable");
        searchResults = payload.results.map(x => ({
            name: x.name,
            latitude: x.latitude,
            longitude: x.longitude,
            display_name: [x.name, x.admin1, x.country].filter(Boolean).filter((v, i, a) => a.indexOf(v) === i).join(", ")
        }));
        activeSuggestion = -1;
        renderSuggestions();
    } catch (error) {
        console.error(error);
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
        let responseData = null;
        try {
            responseData = await requestJson(`${API}/analyze?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        } catch (localError) {
            responseData = await requestJson(`${LAMBDA_API}?lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        }
        render(responseData);
        setStatus("● Live data connected");
    } catch (error) {
        console.error(error);
        setStatus("● Data error");
        $("warning").textContent = error.message || "The environmental data request failed.";
        $("riskMsg").textContent = error.message || "The environmental data request failed.";
    }
}

function render(d) {
    const weather = d.weather || {};
    const flood = d.flood || {};
    const risk = d.risk || {};
    const location = d.location || {};
    const lat = Number(location.latitude ?? coords?.lat ?? 0);
    const lon = Number(location.longitude ?? coords?.lon ?? 0);

    $("place").textContent =
        location.name || (Number.isFinite(lat) && Number.isFinite(lon)
            ? `${lat.toFixed(4)}, ${lon.toFixed(4)}`
            : "Current location");

    $("coords").textContent = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
    $("rain").textContent = Number(weather.current_precipitation ?? 0).toFixed(1);
    $("rain24").textContent = Number(weather.rain_24h ?? 0).toFixed(1);

    const riverValue = flood.river_discharge_today;
    $("river").textContent = riverValue == null || Number.isNaN(Number(riverValue)) ? "—" : Number(riverValue).toFixed(1);

    $("temp").textContent = Number(weather.temperature ?? 0).toFixed(1);
    $("updated").textContent = new Date().toLocaleTimeString();
    $("risk").textContent = risk.level || "LOW RISK";
    $("riskMsg").textContent = risk.message || "Flood risk data loaded successfully.";
    $("warning").textContent = risk.warning || "Continue monitoring local conditions.";
    $("risk").className = String(risk.class || "low");

    $("details").innerHTML = `
        <span class="pill">Risk score: ${risk.score ?? 0}/100</span>
        <span class="pill">Rain next 24h: ${Number(weather.rain_24h ?? 0).toFixed(1)} mm</span>
        <span class="pill">Current rain: ${Number(weather.current_precipitation ?? 0).toFixed(1)} mm</span>
        <span class="pill">River discharge: ${riverValue == null || Number.isNaN(Number(riverValue)) ? "—" : Number(riverValue).toFixed(1)} m³/s</span>
    `;

    $("dataNote").textContent = flood.river_data_definition || "Weather and rainfall data provided by Open-Meteo.";
}
