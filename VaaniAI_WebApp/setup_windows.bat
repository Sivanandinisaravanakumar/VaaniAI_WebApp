@echo off
setlocal
cd /d "%~dp0"

echo ========================================
echo  VaaniAI Web App - First Time Setup
echo ========================================

where py >nul 2>nul
if errorlevel 1 (
  echo Python launcher was not found. Install Python 3.11 or newer and try again.
  pause
  exit /b 1
)
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js was not found. Install Node.js 20.19+ or 22.12+ and try again.
  pause
  exit /b 1
)

if not exist "backend\.venv" (
  echo Creating Python virtual environment...
  py -3 -m venv backend\.venv
  if errorlevel 1 goto :failed
)

echo Installing backend packages...
backend\.venv\Scripts\python.exe -m pip install --upgrade pip
backend\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
if errorlevel 1 goto :failed

if not exist "backend\.env" (
  copy "backend\.env.example" "backend\.env" >nul
  echo Created backend\.env. Add your API keys to that file.
)

if not exist "frontend\.env.local" (
  copy "frontend\.env.example" "frontend\.env.local" >nul
)

echo Installing frontend packages...
cd frontend
call npm install
if errorlevel 1 goto :failed
cd ..

echo.
echo Setup completed.
echo 1. Add GNANI_API_KEY and GEMINI_API_KEY to backend\.env
 echo 2. Run run_windows.bat
pause
exit /b 0

:failed
echo.
echo Setup failed. Check the error shown above.
pause
exit /b 1
