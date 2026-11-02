@echo off
rem OpenMausBot pour Windows : installe (la premiere fois), met a jour, puis ouvre MausBot.
rem Double-clic suffit. Ce fichier n'utilise que des lettres sans accents, expres.
setlocal
chcp 65001 >nul
title OpenMausBot

set "APPDIR=%USERPROFILE%\Documents\OpenMausBot"
set "REPO=https://github.com/Monkey4lt/OpenMausBot.git"
set "PSRUN=powershell -NoProfile -ExecutionPolicy Bypass -Command"

rem Lance depuis le dossier de l'appli, ce fichier pourrait etre remplace par la mise a jour
rem pendant qu'il tourne : on travaille alors sur une copie.
if /I not "%~dp0"=="%APPDIR%\scripts\windows\" goto copy_ok
copy /y "%~f0" "%TEMP%\OpenMausBot-lancement.bat" >nul
if errorlevel 1 goto copy_ok
"%TEMP%\OpenMausBot-lancement.bat"
:copy_ok
cd /d "%USERPROFILE%"

rem Petits programmes PowerShell (ports 5199 = interface, 8799 = serveur).
set "PS_READY=try { foreach ($p in 5199,8799) { $c = New-Object Net.Sockets.TcpClient; $c.Connect('127.0.0.1', $p); $c.Close() }; exit 0 } catch { exit 1 }"
set "PS_BUSY=if (Get-NetTCPConnection -State Listen -LocalPort 5199,8799 -ErrorAction SilentlyContinue) { exit 1 }; exit 0"
set "PS_WHO=Get-NetTCPConnection -State Listen -LocalPort 5199,8799 -ErrorAction SilentlyContinue | ForEach-Object { $n = (Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue).ProcessName; Write-Output ('      port ' + $_.LocalPort + ' : ' + $n) }"
set "PS_STOP=$d = $env:APPDIR; Get-Process -Name electron -ErrorAction SilentlyContinue | Where-Object { $_.Path -and $_.Path.StartsWith($d, [StringComparison]::OrdinalIgnoreCase) } | ForEach-Object { taskkill.exe /F /T /PID $_.Id | Out-Null }; Get-NetTCPConnection -State Listen -LocalPort 5199,8799 -ErrorAction SilentlyContinue | ForEach-Object { $p = Get-Process -Id $_.OwningProcess -ErrorAction SilentlyContinue; if ($p -and $p.ProcessName -eq 'node') { taskkill.exe /F /T /PID $p.Id | Out-Null } }"

echo.
echo  ==========================================
echo    OpenMausBot - installation et lancement
echo  ==========================================
echo.
echo  Laisse cette fenetre ouverte. La premiere fois, ca peut prendre 10 minutes.
echo.

rem ---------- Fermer une MausBot deja ouverte ----------
call :close_old
call :stop_previous

rem ---------- [1/6] Node.js, version 24 ou plus ----------
call :node_version
if "%NODEOK%"=="1" goto node_ok
echo  [1/6] Installation de Node.js...
call :need_winget
if errorlevel 1 goto fail_winget
echo        Si Windows demande l'autorisation, clique sur "Oui".
winget install -e --id OpenJS.NodeJS.LTS --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\nodejs;%PATH%"
call :node_version
if not "%NODEOK%"=="1" goto fail_node
:node_ok
echo  [1/6] Node.js est pret.

rem ---------- [2/6] Git ----------
where git >nul 2>nul
if not errorlevel 1 goto git_ok
echo  [2/6] Installation de Git...
call :need_winget
if errorlevel 1 goto fail_winget
echo        Si Windows demande l'autorisation, clique sur "Oui".
winget install -e --id Git.Git --accept-source-agreements --accept-package-agreements
set "PATH=%ProgramFiles%\Git\cmd;%PATH%"
where git >nul 2>nul
if errorlevel 1 goto fail_git
:git_ok
echo  [2/6] Git est pret.

rem ---------- [3/6] pnpm ----------
set "PATH=%APPDATA%\npm;%PATH%"
where pnpm >nul 2>nul
if not errorlevel 1 goto pnpm_ok
echo  [3/6] Installation de pnpm...
call npm install -g pnpm@10
where pnpm >nul 2>nul
if errorlevel 1 goto fail_pnpm
:pnpm_ok
echo  [3/6] pnpm est pret.

rem ---------- [4/6] Telecharger ou mettre a jour MausBot ----------
set "NOUPDATE=0"
if exist "%APPDIR%\.git\" goto update
if not exist "%APPDIR%\" goto clone
dir /b /a "%APPDIR%" 2>nul | findstr "^" >nul
if not errorlevel 1 goto fail_folder
:clone
echo  [4/6] Telechargement de MausBot...
git clone "%REPO%" "%APPDIR%"
if errorlevel 1 goto fail_clone
goto install

:update
echo  [4/6] Mise a jour de MausBot...
cd /d "%APPDIR%"
rem Ce fichier est reecrit par l'installation : on le remet comme avant pour que la mise a jour passe.
git checkout -- pnpm-lock.yaml >nul 2>nul
git pull --ff-only
if not errorlevel 1 goto install
set "DIRTY=0"
for /f "delims=" %%s in ('git status --porcelain 2^>nul') do set "DIRTY=1"
if "%DIRTY%"=="0" goto update_failed
echo.
echo  [!] La mise a jour bloque : des fichiers du dossier MausBot ont ete modifies.
choice /C ON /N /M "      Je les mets de cote, sans rien effacer, et je reessaie ? Tape O pour oui, N pour non : "
if errorlevel 2 goto update_failed
git -c user.name=MausBot -c user.email=mausbot@localhost stash push --include-untracked -m "mis de cote par OpenMausBot.bat"
git pull --ff-only
if errorlevel 1 goto update_failed
echo        Mise a jour faite. Tes modifications sont gardees de cote.
goto install

:update_failed
set "NOUPDATE=1"
echo.
echo  [!] La mise a jour n'a pas pu se faire.
echo      Le plus souvent, c'est la connexion Internet. J'ouvre la version deja installee.
echo      Pour avoir la nouvelle version, relance ce fichier plus tard.
echo.

rem ---------- [5/6] Installer les morceaux necessaires ----------
:install
cd /d "%APPDIR%"
echo  [5/6] Installation des morceaux necessaires, plusieurs minutes la premiere fois...
call pnpm install --config.confirmModulesPurge=false
if not errorlevel 1 goto launch
if not "%NOUPDATE%"=="1" goto fail_install
if not exist "%APPDIR%\node_modules\" goto fail_install
echo  [!] Installation incomplete, j'essaie quand meme d'ouvrir la version deja installee.

rem ---------- [6/6] Ouvrir MausBot ----------
:launch
call :close_old
call :stop_previous
%PSRUN% "%PS_BUSY%" >nul 2>nul
if errorlevel 1 goto fail_ports_busy

echo.
echo  [6/6] Ouverture de MausBot...
echo        Deux petites fenetres vont s'ouvrir : "MausBot - Serveur" et "MausBot - Interface".
echo        Laisse-les ouvertes : ce sont les moteurs de MausBot.
start "MausBot - Serveur" /min /D "%APPDIR%" cmd /k pnpm dev:server
start "MausBot - Interface" /min /D "%APPDIR%" cmd /k pnpm dev

echo        Demarrage en cours, patiente. Ca peut prendre quelques minutes...
set /a TRIES=0
:waitloop
set /a TRIES+=1
%PSRUN% "%PS_READY%" >nul 2>nul
if not errorlevel 1 goto ready
if %TRIES% GEQ 90 goto fail_start
timeout /t 2 /nobreak >nul
goto waitloop

:ready
rem Laisser le serveur et l'interface finir de demarrer : trop tot, la fenetre restait noire.
timeout /t 3 /nobreak >nul
echo.
echo  C'est pret : la fenetre MausBot s'ouvre.
echo  Pour arreter MausBot, ferme sa fenetre. Si son icone reste pres de l'horloge,
echo  fais un clic droit dessus, puis "Quit OpenMaus Bot".
echo.
cd /d "%APPDIR%"
call pnpm dev:desktop
set "DESKTOP_EXIT=%errorlevel%"
echo.
echo  MausBot est fermee. J'arrete aussi le serveur et l'interface...
call :stop_previous
if not "%DESKTOP_EXIT%"=="0" goto fail_desktop
echo  Tout est arrete. Pour rouvrir MausBot, double-clique a nouveau sur ce fichier.
echo.
pause
exit /b 0


rem ======================= Sous-programmes =======================

:close_old
rem L'ancienne MausBot installee s'appelle OpenMausBot.exe. Ouverte, elle prend la place de la nouvelle :
rem la nouvelle se contente alors de montrer l'ancienne.
tasklist /FI "IMAGENAME eq OpenMausBot.exe" /NH 2>nul | find /I "OpenMausBot.exe" >nul
if errorlevel 1 exit /b 0
echo.
echo  [!] Une ancienne MausBot est deja ouverte sur cet ordinateur.
echo      Il faut la fermer, sinon la nouvelle ne peut pas s'ouvrir.
echo      Tes conversations ne sont pas perdues : les deux utilisent les memes donnees.
echo.
choice /C ON /N /M "      Je la ferme pour toi ? Tape O pour oui, N pour non : "
if errorlevel 2 goto close_old_manual
echo        Fermeture de l'ancienne MausBot...
taskkill /IM OpenMausBot.exe >nul 2>nul
set /a WAITED=0
:close_old_wait
timeout /t 1 /nobreak >nul
tasklist /FI "IMAGENAME eq OpenMausBot.exe" /NH 2>nul | find /I "OpenMausBot.exe" >nul
if errorlevel 1 goto close_old_done
set /a WAITED+=1
if %WAITED% LSS 10 goto close_old_wait
rem Elle ne s'est pas fermee d'elle-meme en 10 secondes : on la ferme de force.
taskkill /F /T /IM OpenMausBot.exe >nul 2>nul
timeout /t 2 /nobreak >nul
tasklist /FI "IMAGENAME eq OpenMausBot.exe" /NH 2>nul | find /I "OpenMausBot.exe" >nul
if errorlevel 1 goto close_old_done
echo  [!] Je n'arrive pas a la fermer.
:close_old_manual
echo.
echo      Ferme-la toi-meme : en bas a droite de l'ecran, pres de l'horloge,
echo      fais un clic droit sur l'icone de MausBot, puis "Quit OpenMaus Bot".
echo      Tu ne vois pas l'icone ? Clique d'abord sur la petite fleche vers le haut, pres de l'horloge.
echo      Quand c'est fait, appuie sur une touche dans cette fenetre.
pause >nul
goto close_old
:close_old_done
echo        C'est fait.
echo.
exit /b 0

:stop_previous
rem Ferme ce qu'un lancement precedent de ce fichier a laisse ouvert : la fenetre MausBot,
rem le serveur et l'interface.
taskkill /FI "WINDOWTITLE eq MausBot - Serveur*" /T /F >nul 2>nul
taskkill /FI "WINDOWTITLE eq MausBot - Interface*" /T /F >nul 2>nul
%PSRUN% "%PS_STOP%" >nul 2>nul
exit /b 0

:node_version
set "NODEOK=0"
set "NV="
for /f "tokens=1 delims=." %%v in ('node -v 2^>nul') do set "NV=%%v"
if not defined NV exit /b 0
set "NV=%NV:v=%"
if not defined NV exit /b 0
if %NV% GEQ 24 set "NODEOK=1"
exit /b 0

:need_winget
where winget >nul 2>nul
exit /b %errorlevel%


rem ======================= Messages d'erreur =======================

:fail_winget
echo.
echo  [!] Il manque l'outil d'installation de Windows, "winget".
echo      Ouvre le Microsoft Store, cherche "Programme d'installation d'application",
echo      clique sur "Installer" ou "Mettre a jour", puis relance ce fichier.
goto end_fail

:fail_node
echo.
echo  [!] Node.js n'a pas pu etre installe, ou une version trop ancienne est restee.
echo      1. Ferme cette fenetre.
echo      2. Dans les Parametres de Windows, puis Applications, desinstalle "Node.js" s'il y est.
echo      3. Redemarre l'ordinateur, puis relance ce fichier.
goto end_fail

:fail_git
echo.
echo  [!] Git n'a pas pu etre installe.
echo      Redemarre l'ordinateur, puis relance ce fichier.
goto end_fail

:fail_pnpm
echo.
echo  [!] pnpm n'a pas pu etre installe.
echo      Verifie ta connexion Internet, ferme cette fenetre et relance ce fichier.
goto end_fail

:fail_folder
echo.
echo  [!] Le dossier "Documents\OpenMausBot" existe deja, mais ce n'est pas MausBot.
echo      Renomme-le, par exemple en "OpenMausBot-ancien", puis relance ce fichier.
goto end_fail

:fail_clone
echo.
echo  [!] Le telechargement de MausBot n'a pas marche.
echo      Verifie ta connexion Internet, puis relance ce fichier.
goto end_fail

:fail_install
echo.
echo  [!] L'installation des morceaux necessaires n'a pas marche.
echo      Verifie ta connexion Internet, puis relance ce fichier.
echo      Si ton antivirus a affiche une alerte, autorise le dossier Documents\OpenMausBot.
goto end_fail

:fail_ports_busy
echo.
echo  [!] Un autre programme occupe la place dont MausBot a besoin :
%PSRUN% "%PS_WHO%" 2>nul
echo      Redemarre l'ordinateur, puis relance ce fichier.
goto end_fail

:fail_start
echo.
echo  [!] MausBot met trop de temps a demarrer.
echo      En bas de l'ecran, dans la barre des taches, ouvre les fenetres "MausBot - Serveur"
echo      et "MausBot - Interface". Fais une capture de celle qui affiche une erreur.
goto end_fail

:fail_desktop
echo.
echo  [!] La fenetre MausBot s'est fermee avec une erreur, voir les messages au-dessus.
goto end_fail

:end_fail
echo.
echo  Rien n'est casse. Tu peux relancer ce fichier quand tu veux.
echo  Si le probleme revient, fais une capture de cette fenetre et envoie-la a Claude.
echo.
pause
exit /b 1
