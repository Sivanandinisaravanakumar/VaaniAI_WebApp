# VaaniAI Web App (React + FastAPI)

A professional web-app version of VaaniAI, an English-first voice-based placement interview practice application.

## What's included

- React + Vite frontend with a custom responsive dark interface
- Python FastAPI backend
- Gnani Prisma v3.0 Speech-to-Text integration (`en-IN`, `verbatim`)
- Gnani Timbre Text-to-Speech integration with gTTS fallback
- Gemini-generated interview questions, answer feedback, contextual follow-ups and final reports
- Transparent local question/feedback/report fallback when Gemini is unavailable or quota is exhausted
- Student review of the original transcript before the verified answer is evaluated
- Second attempt comparison (up to two attempts per question)
- Session memory based on terms explicitly present in the verified answer
- SQLite interview history and progress dashboard
- Browser microphone recording, converted to 16 kHz mono WAV before upload
- Basic response timings for transcription, evaluation and voice generation

## Requirements

- Windows 10/11
- Python 3.11 or newer
- Node.js 20.19+ or 22.12+
- Chrome or Edge recommended for microphone recording
- Gnani API key with Prisma STT and Timbre TTS access
- Google Gemini API key (the app can still run in local fallback mode if Gemini is unavailable)

## First-time setup on Windows

1. Extract this ZIP to a folder, for example `C:\Users\YOUR_USER\Downloads\VaaniAI_WebApp`.
2. Double-click `setup_windows.bat`.
3. Open `backend\.env` and add your API keys:

   ```env
   GNANI_API_KEY=your_gnani_key
   GEMINI_API_KEY=your_gemini_key
   ```

4. Keep the existing model and voice settings in `backend\.env` unless your API dashboard shows different enabled model IDs.
5. Double-click `run_windows.bat`.
6. Open `http://localhost:5173` in Chrome or Edge.

The backend API documentation is at `http://127.0.0.1:8000/docs`.

## Manual setup

### Backend

```powershell
cd backend
py -3 -m venv .venv
.venv\Scripts\activate
pip install -r requirements.txt
copy .env.example .env
# Edit .env and add your API keys
python -m uvicorn main:app --reload --host 127.0.0.1 --port 8000
```

### Frontend (new terminal)

```powershell
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`.

## API endpoints

- `GET /api/health` – backend and configured-provider status (no keys returned)
- `GET /api/config/public` – safe frontend settings
- `POST /api/interviews/start` – create an interview and first question
- `POST /api/interviews/{id}/transcribe` – upload a WAV recording to Gnani Prisma
- `POST /api/interviews/{id}/answer` – evaluate a candidate-verified answer
- `POST /api/interviews/{id}/select-attempt` – choose an attempt and advance or finish
- `GET /api/history` – recent interview summaries
- `GET /api/history/{id}` – full saved report and answers

## Important behavior and limitations

- **Original transcript is not rewritten.** The UI displays the STT output as read-only and allows the student to edit a separate verified copy. Only that verified copy is sent for answer evaluation.
- If Prisma is unavailable, the user can type the answer manually. The app labels the source as manual entry.
- If Gemini is unavailable or the configured model quota is exhausted, the app uses a transparent local question/feedback/report fallback. The fallback does not claim to be Gemini evaluation.
- If Timbre is unavailable, gTTS is used as a voice fallback.
- The fallback does not provide unlimited AI usage. Real Gemini and Gnani use still depends on API access, account credits, quotas and billing.
- Interview history is stored in `backend/vaaniai.db` on the computer running the backend.
- This is a **local prototype**, not yet a production multi-user service. Before making it public, add authentication, per-user authorization, rate limiting, HTTPS, secure deployment secrets, database backups, privacy/retention controls and abuse prevention. Do not expose the backend directly to the public internet in its current state.
- The browser needs microphone permission. Microphone access works on `localhost` in supported browsers; remote production deployment should use HTTPS.

## Security

- Never place Gnani or Gemini API keys in `frontend/` or any `VITE_` variable.
- Never commit `backend/.env`, the SQLite database, or real student interview records to GitHub.
- Use synthetic/demo answers or consented recordings in public demonstrations.

## Troubleshooting

- **Backend offline:** confirm the backend terminal is running at port 8000.
- **Frontend cannot connect:** confirm `frontend/.env.local` contains `VITE_API_BASE_URL=http://127.0.0.1:8000`, then restart Vite.
- **Microphone blocked:** use Chrome/Edge, open the site on localhost, and allow microphone permission.
- **Prisma rejects audio:** record a shorter answer (under 120 seconds) and try again. The frontend sends 16 kHz mono WAV.
- **Gemini quota exhausted:** check model availability and quota in Google AI Studio. Local question and feedback fallback can keep the practice session moving, but does not replace live AI evaluation.
- **Timbre unavailable:** check that the Gnani account has TTS access and credits; gTTS fallback is attempted automatically.
