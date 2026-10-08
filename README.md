# FloodWatch AI — Real Prototype

A cross-platform web prototype for local waterlogging/flood-risk decision support.

## Features
- Browser GPS location (when permitted)
- Manual location search fallback
- Live weather/rainfall data from Open-Meteo
- GloFAS-based river discharge data through Open-Meteo Flood API
- Transparent risk score and early-warning message
- Responsive UI for desktop and mobile browsers
- FastAPI backend

## Run

```bash
./run.sh
```

Then open http://localhost:8000

### If GPS permission does not work
Use **Or enter a location manually**. GPS can be blocked by browser/site settings. For deployed production use, serve the app over HTTPS.

## Important
This is a decision-support prototype, not an official emergency warning system. Risk thresholds are transparent prototype thresholds and should be calibrated/validated against local historical flood observations before public safety use.


## AWS Lambda connection

The frontend is configured to call the AWS Lambda Function URL directly for `/analyze`:
`https://5uc6zopvibuo27ynqhvu2dsqsy0jhcpn.lambda-url.ap-southeast-2.on.aws`

Location search uses the Open-Meteo geocoding API directly, so the frontend no longer depends on the local FastAPI `/geocode` route.

For browser access, the Lambda Function URL must return a CORS header such as:
`Access-Control-Allow-Origin: *`

The Lambda test response shown during setup already returned this header.
# floodwatch-ai6
