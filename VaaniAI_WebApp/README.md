# VaaniAI Web App (React + FastAPI + Supabase)

VaaniAI is an English-first voice-based placement interview practice application.

## Included

- React + Vite responsive frontend
- Python FastAPI backend
- Supabase email/password authentication
- Student-owned interview records stored in Supabase PostgreSQL
- Backend verifies every Supabase access token before interview/history operations
- Every database lookup/update is filtered by the verified Supabase user ID
- Gnani Prisma v3.0 speech-to-text (`en-IN`, verbatim)
- Gnani Timbre text-to-speech with gTTS fallback
- Gemini questions, feedback, adaptive follow-ups and final reports
- Local rule-based fallback if Gemini is unavailable or quota is exhausted
- Original transcript preserved separately from student-verified answer
- Second attempt comparison, session memory, performance reports and history dashboard

## 1. Requirements

- Python 3.11+
- Node.js 20.19+ or 22.12+
- A Supabase project
- Gnani API key with Prisma/Timbre access
- Google Gemini API key (optional; local interview fallback still works without it)

## 2. Create the Supabase table

1. Open your Supabase project.
2. Open **SQL Editor**.
3. Open `supabase_schema.sql` from this project, copy its full contents, paste into SQL Editor, and click **Run**.
4. Confirm that `public.interviews` was created.

The table has an `owner_id` that references `auth.users`. Row Level Security is enabled with per-user policies. The backend also filters every query by the user ID returned by Supabase Auth.

## 3. Get Supabase keys

In Supabase Dashboard, open **Settings → API Keys** (or the project's Connect dialog):

- Project URL: `https://YOUR_PROJECT_REF.supabase.co`
- Publishable key: starts with `sb_publishable_...` (safe for the browser; it does not grant access by itself)
- Secret key: starts with `sb_secret_...` (backend only; never expose it to the browser or GitHub)

If your dashboard only shows legacy keys, use the `anon` key as the publishable key and `service_role` as the backend secret key. New publishable/secret keys are preferred.

## 4. Backend environment

Copy `backend/.env.example` to `backend/.env` and fill in:

```env
GNANI_API_KEY=your_gnani_key
GEMINI_API_KEY=your_gemini_key
SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
SUPABASE_SECRET_KEY=sb_secret_...
REQUIRE_AUTH=true
FRONTEND_ORIGINS=http://localhost:5173
```

Keep all secrets in `backend/.env` or hosting provider secret settings. Never add the Supabase secret key, Gnani key or Gemini key to the frontend.

## 5. Frontend environment

Create `frontend/.env.local` from `frontend/.env.example`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8000
VITE_SUPABASE_URL=https://YOUR_PROJECT_REF.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=sb_publishable_...
```

Only the Supabase publishable key belongs in the frontend. Vite exposes every `VITE_` variable to the browser, so NEVER put a secret/service-role key there.

## 6. Configure Supabase Auth

In Supabase Dashboard → **Authentication → URL Configuration**:

- For local testing, add `http://localhost:5173` to the allowed redirect URLs.
- For production, add the final Vercel/Render frontend URL as an allowed redirect URL.
- Keep email confirmation enabled for a public student-facing application. Users need to confirm their email before signing in if confirmation is enabled.

The app includes email/password sign-up and sign-in. If sign-up does not immediately create a session, the UI asks the student to confirm their email.

## 7. Run locally

Backend terminal:

```powershell
cd backend
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Edit backend/.env with real keys; set REQUIRE_AUTH=true after Supabase is ready
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

Frontend terminal:

```powershell
cd frontend
npm install
copy .env.example .env.local
# Edit frontend/.env.local with Supabase URL + publishable key
npm run dev
```

Open `http://localhost:5173`.

For local-only UI testing without Supabase, leave the frontend Supabase variables empty and set backend `REQUIRE_AUTH=false`; this uses local SQLite and is not suitable for public deployment.

## 8. Public deployment (Vercel frontend + Render backend)

### Backend on Render

- New → Web Service → connect this GitHub repo.
- Root directory: `backend`
- Build command: `pip install -r requirements.txt`
- Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
- Add backend environment variables from section 4.
- Set `REQUIRE_AUTH=true`.
- Set `FRONTEND_ORIGINS` to the exact deployed frontend URL.

### Frontend on Vercel

- Import the same GitHub repository.
- Root directory: `frontend`
- Framework preset: Vite
- Build command: `npm run build`
- Output directory: `dist`
- Set `VITE_API_BASE_URL` to the Render backend URL.
- Set `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`.

After deploying the frontend, update the backend `FRONTEND_ORIGINS` with the exact Vercel URL and redeploy the backend. Add the production frontend URL to Supabase Auth allowed redirects.

Free Render web services sleep after 15 minutes without traffic and can take about a minute to wake. Their filesystem is ephemeral, which is why this production configuration uses Supabase PostgreSQL rather than SQLite for interview records. Free tiers are suitable for a demo/prototype, not a guaranteed always-on production service.

## API security model

- Frontend sends the signed-in user's Supabase access token as a Bearer token.
- FastAPI verifies the token through Supabase Auth `/auth/v1/user`.
- The verified `user.id` is used as `owner_id`; the client cannot choose another user's ID.
- The Supabase Secret key is stored on the backend only and sent in the `apikey` header for database REST operations.
- Database operations always filter by both interview ID and verified owner ID.
- RLS is enabled on `public.interviews` as an additional protection.

Do not publish the app until the SQL schema has been run, Supabase Auth has been configured, `REQUIRE_AUTH=true` is set on the deployed backend, and two-account privacy testing succeeds.

## Important limits

- Gnani and Gemini quotas/credits still apply; fallback does not provide unlimited AI usage.
- Render Free Web Services sleep on inactivity. A cold start can take around a minute.
- Supabase Free projects may pause after a period of inactivity; review current plan limits in your dashboard.
- The app stores candidate interview transcripts and scores. Provide a privacy notice and avoid collecting unnecessary sensitive personal data.

## Existing local history

The older local SQLite interview history is not automatically copied into Supabase. New signed-in interviews are stored in Supabase under the authenticated student account. Keep a private backup of the old `backend/vaaniai.db` file if you need those earlier local reports.
