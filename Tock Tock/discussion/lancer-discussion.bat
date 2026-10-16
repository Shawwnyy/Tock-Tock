@echo off
cd /d "%~dp0"
where node >nul 2>nul || (echo Node.js est introuvable : installe-le depuis https://nodejs.org puis relance. & pause & exit /b 1)
node serveur.mjs
pause
