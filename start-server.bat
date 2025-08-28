@echo off
echo Starting WMS Netsis Integration Server...
cd /d "C:\Users\Irmak\wms-netsis-entegre"

:RESTART
echo.
echo ======================================
echo Starting server at %date% %time%
echo ======================================
node backend/server.js

echo.
echo Server stopped at %date% %time%
echo Restarting in 5 seconds...
timeout /t 5 /nobreak >nul

goto RESTART