@echo off
setlocal

echo ===================================================
echo   VideoCutterApp - Launching System
echo ===================================================
echo.

:: Check if node_modules exists in backend
if not exist "backend\node_modules\" (
    echo [WARNING] node_modules not found in backend. Attempting to install...
    cd backend && npm install && cd ..
)

:: Check if node_modules exists in frontend
if not exist "frontend\node_modules\" (
    echo [WARNING] node_modules not found in frontend. Attempting to install...
    cd frontend && npm install && cd ..
)

echo.
echo [1/2] Starting Backend Server (Port 5000)...
start "VideoCutter - Backend" cmd /k "cd backend && node server.js"

echo [2/2] Starting Frontend Dev Server (Vite)...
start "VideoCutter - Frontend" cmd /k "cd frontend && npm run dev"

echo.
echo ===================================================
echo   System is launching in separate windows.
echo   - Backend: http://localhost:5000
echo   - Frontend: Check Vite output (usually http://localhost:5173)
echo ===================================================
echo.
pause
