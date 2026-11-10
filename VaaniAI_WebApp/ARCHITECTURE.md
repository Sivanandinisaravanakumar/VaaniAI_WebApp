# VaaniAI architecture

- React + Vite: public UI and Supabase Auth sign-in/sign-up.
- FastAPI: interview orchestration, Gnani/Gemini integrations and authorization checks.
- Supabase Auth: validates each student's access token.
- Supabase PostgreSQL: persistent interview sessions, answer history, memory and reports.
- Gnani Prisma: student voice transcription.
- Gnani Timbre: interviewer voice generation (gTTS fallback).
- Gemini: adaptive interview questions, answer evaluation and reports (local fallback when quota is unavailable).

## User data isolation

The browser never sends an owner ID. FastAPI validates the bearer token against Supabase Auth, extracts the verified user ID, and scopes all interview reads and writes by that ID. Supabase RLS is enabled on `public.interviews`. The Supabase Secret key is only stored in backend environment variables.
