# VaaniAI architecture

```text
React + Vite browser app
  - Overview / Dashboard
  - Interview setup
  - Interview room + browser microphone
  - Original transcript + editable verified transcript
  - Attempt review / comparison
  - Performance report / history
          |
          | JSON + WAV multipart over HTTP
          v
FastAPI backend (Python)
  - Interview/session orchestration
  - Session-aware contextual memory
  - Gemini provider with bounded model fallback
  - Transparent local question/feedback/report fallback
  - Gnani Prisma transcription
  - Gnani Timbre TTS + gTTS fallback + audio cache
  - SQLite interview history
          |
          +---- Gnani Prisma v3.0 (STT)
          +---- Gnani Timbre (TTS)
          +---- Google Gemini (interview reasoning)
          +---- SQLite (local persistence)
```

The browser never receives provider API keys. All external API requests are made from the backend.
