# Integrations

This doc covers optional third-party integrations. If a service is not configured, the app will keep working and will simply hide/disable the affected UI via `GET /api/config`.

## Pinterest (boards → pins → Inspiration moodboard)

Roomify supports importing a Pinterest board into the Inspiration page moodboard (up to 6 pins) and generating a room concept using those images.

### What the app expects

- **OAuth callback URL**: `PUBLIC_APP_URL + "/api/auth/pinterest/callback"`
  - Local dev example: `http://localhost:8080/api/auth/pinterest/callback`
- **Scopes**: `boards:read`, `pins:read`, `user_accounts:read`
- **Image constraints** (enforced by the server):
  - Must be a public `https` URL
  - Max size 10MB per image
  - Max 6 images per moodboard generation

### Step-by-step setup

1. **Create a Pinterest app**
   - In the Pinterest developer portal, create an app.
   - Provide **Terms** and **Privacy Policy** URLs (the repo includes `/terms` and `/privacy` routes in the SPA).

2. **Configure OAuth redirect**
   - Add the redirect/callback URL:
     - `http://localhost:8080/api/auth/pinterest/callback` (local)
     - `https://YOUR_DOMAIN/api/auth/pinterest/callback` (production)

3. **Set server env vars**
   - In the root `.env` (or your deployment env settings), set:
     - `PUBLIC_APP_URL=http://localhost:8080`
     - `PINTEREST_APP_ID=...`
     - `PINTEREST_APP_SECRET=...`

4. **Run the app**
   - Start the app as normal (see `README.md`).
   - Visit `/settings` and confirm Pinterest shows **Configured**.

5. **Connect Pinterest (per user)**
   - Sign in to Roomify.
   - Go to `/settings`.
   - Click **Connect Pinterest** and complete the consent flow.
   - You should be redirected back to Settings with `?pinterest=connected`.

6. **Use Pinterest on the Inspiration page**
   - Go to `/inspiration`.
   - Switch the source to **Pinterest**.
   - Choose a board → click **Import board (up to 6)** or click individual pins.
   - Click **Generate from moodboard** to build the room concept and open it in `/dashboard`.

### Dev-only shortcut (no OAuth)

If you just want to test the UI without doing OAuth, you can set:

- `PINTEREST_DEV_ACCESS_TOKEN=...`

Then `/api/social/pinterest/*` will use that token when the signed-in user has no stored Pinterest token. This is intended for local testing only.

