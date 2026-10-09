# Fellowship of the Sells

A private, locally-run dashboard for my own Etsy print-on-demand shop, presented as a
fantasy village (Three.js). Each "agent" in the village is a real task in progress, and
the treasury tracks only real money: what was spent and what was earned.

**Scout (live):** researches product niches using the public Etsy Open API v3
(active listing search and public shop stats) together with Claude, so I can decide which
original designs to create. The other agents are still simulated.

## Run locally

```bash
npm install
cp .env.example .env.local   # add your Etsy keystring + shared secret and a Claude API key
npm run dev                  # http://localhost:5173
```

API keys stay in the local dev server (`server/`) and are never sent to the browser.

---

The term "Etsy" is a trademark of Etsy, Inc. This application uses the Etsy API but is not
endorsed or certified by Etsy, Inc.
