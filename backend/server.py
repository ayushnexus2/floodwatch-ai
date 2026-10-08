from fastapi import FastAPI, Query, HTTPException
from fastapi.staticfiles import StaticFiles
import httpx
from pathlib import Path
from statistics import median

app = FastAPI(title="FloodWatch AI API", version="1.2")
BASE = Path(__file__).resolve().parent.parent


async def get_json(url, params):
    async with httpx.AsyncClient(timeout=25) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        return r.json()


def percentile_rank(value, series):
    vals = sorted(v for v in series if v is not None)
    if not vals:
        return None
    below = sum(v <= value for v in vals)
    return round(100 * below / len(vals), 1)


def risk_score(current_precip, rain24, river_today, river_p90):
    score = 0
    factors = []

    # Rainfall contribution: deliberately transparent prototype thresholds.
    if current_precip >= 20:
        score += 30
        factors.append("very heavy current precipitation")
    elif current_precip >= 10:
        score += 18
        factors.append("heavy current precipitation")
    elif current_precip >= 5:
        score += 8
        factors.append("moderate current precipitation")

    if rain24 >= 100:
        score += 40
        factors.append("very heavy 24-hour forecast rainfall")
    elif rain24 >= 60:
        score += 28
        factors.append("heavy 24-hour forecast rainfall")
    elif rain24 >= 30:
        score += 15
        factors.append("elevated 24-hour forecast rainfall")

    # Do NOT use an absolute discharge threshold across different rivers.
    # Compare the modelled value with the same location's recent model history.
    if river_today is not None and river_p90 is not None and river_p90 > 0:
        ratio = river_today / river_p90
        if ratio >= 1.25:
            score += 30
            factors.append("modelled river discharge above recent high-flow reference")
        elif ratio >= 1.0:
            score += 20
            factors.append("modelled river discharge near/above recent high-flow reference")
        elif ratio >= 0.8:
            score += 10
            factors.append("modelled river discharge elevated")

    return min(score, 100), factors


def classify(score):
    if score >= 75:
        return (
            "EXTREME RISK",
            "Multiple monitored environmental signals are strongly elevated.",
            "Avoid unnecessary travel through vulnerable areas and follow official local emergency instructions.",
            "extreme",
        )
    if score >= 50:
        return (
            "HIGH RISK",
            "Rainfall and/or modelled river conditions indicate increased local flooding potential.",
            "Stay alert, avoid known low-lying or waterlogged routes, and monitor official alerts.",
            "high",
        )
    if score >= 25:
        return (
            "MEDIUM RISK",
            "Current environmental conditions may cause localized water accumulation.",
            "Use caution near drains, underpasses and other low-lying areas.",
            "medium",
        )
    return (
        "LOW RISK",
        "Current monitored signals indicate relatively low immediate flood risk.",
        "No significant rainfall-based warning at this time; continue monitoring conditions.",
        "low",
    )


@app.get("/api/health")
async def health():
    return {"ok": True, "service": "FloodWatch AI"}


@app.get("/api/geocode")
async def geocode(q: str = Query(..., min_length=1, max_length=120)):
    try:
        data = await get_json(
            "https://geocoding-api.open-meteo.com/v1/search",
            {"name": q, "count": 5, "language": "en", "format": "json"},
        )
        results = []
        for x in data.get("results", []):
            parts = [x.get("name"), x.get("admin1"), x.get("country")]
            display = ", ".join(dict.fromkeys(str(v) for v in parts if v))
            results.append(
                {
                    "name": x.get("name"),
                    "latitude": x.get("latitude"),
                    "longitude": x.get("longitude"),
                    "display_name": display,
                }
            )
        return {"results": results}
    except Exception as e:
        raise HTTPException(502, detail=f"Location search provider error: {e}")


@app.get("/api/analyze")
async def analyze(
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
):
    try:
        weather = await get_json(
            "https://api.open-meteo.com/v1/forecast",
            {
                "latitude": lat,
                "longitude": lon,
                "current": "temperature_2m,precipitation,rain,showers",
                "hourly": "precipitation,rain,showers",
                "forecast_days": 2,
                "timezone": "auto",
            },
        )

        # GloFAS-based modelled river discharge. This is NOT a live gauge reading.
        flood = await get_json(
            "https://flood-api.open-meteo.com/v1/flood",
            {
                "latitude": lat,
                "longitude": lon,
                "daily": "river_discharge",
                "past_days": 30,
                "forecast_days": 3,
                "timezone": "auto",
            },
        )

        current = weather.get("current", {})
        hourly = weather.get("hourly", {})
        precipitation = [float(x or 0) for x in hourly.get("precipitation", [])]
        rain24 = sum(precipitation[:24])

        daily = flood.get("daily", {})
        times = daily.get("time", [])
        discharges = daily.get("river_discharge", [])
        pairs = [(t, float(v)) for t, v in zip(times, discharges) if v is not None]

        # First value is the earliest returned day; use today's matching date if available.
        today = flood.get("daily", {}).get("time", [None])[0]
        river_today = None
        if pairs:
            river_today = pairs[0][1]

        history = [v for _, v in pairs[:-3]] if len(pairs) > 3 else [v for _, v in pairs]
        history_sorted = sorted(history)
        river_p90 = history_sorted[max(0, int(0.9 * (len(history_sorted) - 1)))] if history_sorted else None
        river_rank = percentile_rank(river_today, history) if river_today is not None and history else None

        score, factors = risk_score(
            float(current.get("precipitation") or 0),
            rain24,
            river_today,
            river_p90,
        )
        level, msg, warning, cls = classify(score)

        return {
            "location": {"latitude": lat, "longitude": lon, "name": None},
            "weather": {
                "temperature": float(current.get("temperature_2m") or 0),
                "current_precipitation": float(current.get("precipitation") or 0),
                "current_precipitation_definition": "Model-estimated precipitation for the preceding hour",
                "rain_24h": rain24,
                "rain_24h_definition": "Sum of the next 24 hourly precipitation forecasts",
            },
            "flood": {
                "river_discharge_today": river_today,
                "river_discharge_reference_p90": river_p90,
                "river_discharge_percentile_rank": river_rank,
                "river_data_definition": "GloFAS-based modelled daily discharge for the largest river/grid cell near the requested coordinates; not a live gauge measurement",
                "river_source_resolution": "about 5 km",
                "selection_note": "The nearest river/grid cell may not always represent the exact local river or gauge.",
            },
            "risk": {
                "score": score,
                "level": level,
                "message": msg,
                "warning": warning,
                "class": cls,
                "factors": factors,
            },
            "sources": [
                "Open-Meteo Forecast API",
                "Open-Meteo Flood API (GloFAS-based)",
            ],
        }
    except Exception as e:
        raise HTTPException(502, detail=f"Environmental data provider error: {e}")


app.mount("/", StaticFiles(directory=str(BASE / "frontend"), html=True), name="frontend")
