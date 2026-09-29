# StockLens

StockLens is a glass-style market intelligence interface for Indian equities.

## Current status

- Live quote API route: `/api/quote?ticker=RELIANCE`
- Supported quotes: RELIANCE, TCS, HDFCBANK, INFY, NIFTY, SENSEX, BANKNIFTY
- Fallback values are clearly labelled when the quote provider is unavailable.
- Financial/fundamental tabs are intentionally marked as requiring a financial-data connector; they do not pretend that illustrative values are live.
- Cloudflare deployment workflow runs on pushes to `main`.

## Deployment

The repository includes `.github/workflows/deploy.yml`.

Add these GitHub Actions repository secrets:

- `CLOUDFLARE_API_TOKEN`
- `CLOUDFLARE_ACCOUNT_ID`

The token needs permission to deploy the Worker for the target Cloudflare account.

After the secrets are added, every push to `main` builds and deploys StockLens with Wrangler.

## Data

The current quote route uses Yahoo Finance's chart endpoint as the quote source. This is suitable for the current prototype/validation stage. Before commercial launch, replace it with a licensed market-data provider appropriate to the intended users, redistribution rights, latency and exchange requirements.

The fundamental analysis layer still needs a dedicated financial-data source before it should be presented as production financial analysis.
