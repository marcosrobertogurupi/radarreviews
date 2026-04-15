@echo off
echo =======================================================
echo     REPUTEI - SISTEMA DE INICIALIZACAO COMPLETO
echo =======================================================
echo.

echo [1/4] Iniciando Motor Extrator (Scheduler)...
start "Motor Extrator (Scheduler)" cmd /k "npm run dev"

echo [2/4] Iniciando Servidor IA Copilot (porta 3001)...
start "Servidor IA Copilot" cmd /k "npm run dev:api"

echo [3/4] Iniciando Painel Admin (porta 5173)...
start "Painel Admin" cmd /k "cd admin && npm run dev"

echo [4/4] Iniciando Portal do Assinante (porta 5174)...
start "Portal Assinante" cmd /k "cd portal && npm run dev"

echo.
echo =======================================================
echo  Todos os servicos foram iniciados!
echo.
echo  Motor Extrator  : rodando em background
echo  IA Copilot API  : http://localhost:3001
echo  Painel Admin    : http://localhost:5173
echo  Portal Assinante: http://localhost:5174
echo =======================================================
echo.
pause
