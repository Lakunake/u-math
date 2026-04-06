@echo off
echo ==============================
echo   U-MAt(hematics) Sunucusu
echo ==============================
echo.
echo Bagimliliklar yukleniyor...
call npm install --silent
echo.
echo Sunucu baslatiliyor...
npm start
pause
