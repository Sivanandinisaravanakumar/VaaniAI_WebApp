@echo off
setlocal
cd /d "%~dp0"
if not exist "backend\.venv\Scripts\python.exe" (
  echo Please run setup_windows.bat first.
  pause
  exit /b 1
)
if not exist "backend\.env" (
  echo backend\.env is missing. Copy backend\.env.example to backend\.env and add your API keys.
  pause
  exit /b 1
)
if not exist "frontend\node_modules" (
  echo Frontend packages are missing. Please run setup_windows.bat first.
  pause
  exit /b 1
)

start "VaaniAI Backend" cmd /k "cd /d %~dp0backend && .venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000"
start "VaaniAI Frontend" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo VaaniAI is starting...
echo Frontend: http://localhost:5173
echo Backend docs: http://127.0.0.1:8000/docs
echo Keep both terminal windows open while using the app.
pause
