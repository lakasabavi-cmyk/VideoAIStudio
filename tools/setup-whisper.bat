@echo off
REM One-time setup for the Transcript Editor (faster-whisper).
REM Creates a private Python environment in tools\whisper-env and
REM installs faster-whisper into it. VideoAI Studio only needs the
REM python.exe inside that environment (Settings -> Transcript).
setlocal
cd /d %~dp0

where py >nul 2>nul
if %errorlevel%==0 (
  set "PYLAUNCH=py -3"
) else (
  set "PYLAUNCH=python"
)

%PYLAUNCH% --version >nul 2>nul
if %errorlevel% neq 0 (
  echo Python was not found on PATH.
  echo Install Python 3.10+ from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)

echo Creating environment in %CD%\whisper-env ...
%PYLAUNCH% -m venv whisper-env
if %errorlevel% neq 0 (
  echo Failed to create the Python environment.
  pause
  exit /b 1
)

echo Installing faster-whisper (this downloads a few hundred MB) ...
whisper-env\Scripts\python.exe -m pip install --upgrade pip
REM av must stay below 14: faster-whisper passes a decode option
REM that PyAV 14 removed, and transcription fails without the pin.
whisper-env\Scripts\python.exe -m pip install faster-whisper "av<14"
if %errorlevel% neq 0 (
  echo pip install failed - check the messages above.
  pause
  exit /b 1
)

echo.
echo DONE. In VideoAI Studio, open Settings -^> Transcript and set
echo "faster-whisper python" to:
echo %CD%\whisper-env\Scripts\python.exe
echo.
pause
