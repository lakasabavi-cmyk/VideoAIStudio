@echo off
REM One-time setup for the Transcript Editor (faster-whisper).
REM Creates a private Python environment in tools\whisper-env and
REM installs faster-whisper into it. VideoAI Studio only needs
REM the python.exe inside that environment - see Settings,
REM Transcript tab.
REM
REM Python 3.12 or 3.13, 64-bit, is required: faster-whisper
REM needs PyAV below 14, and PyAV ships no prebuilt wheel for
REM Python 3.14+ - pip then tries to compile it from source and
REM fails without the Visual C++ Build Tools. This script picks
REM a suitable Python automatically when one is installed.
REM
REM NOTE for editors: never put parentheses in echo text inside
REM a parenthesized if-block - cmd.exe reads the closing paren
REM as the end of the block and runs the rest of the line as a
REM command. That was the v0.3.2 "from was unexpected" bug.
REM
REM This script re-runs itself with all output logged to
REM setup-whisper-log.txt next to it, and the window stays open
REM at the end. If anything fails, send that log file back.
if not defined WHISPER_SETUP_LOGGED (
  set WHISPER_SETUP_LOGGED=1
  call "%~f0" %* > "%~dp0setup-whisper-log.txt" 2>&1
  echo.
  echo Finished - the full log is in setup-whisper-log.txt
  echo next to this file. If setup failed, send that file back.
  pause
  exit /b
)
setlocal
cd /d %~dp0

REM Pick the newest suitable Python: prefer 3.12, then 3.13.
set "PYLAUNCH="
py -3.12 --version >nul 2>nul && set "PYLAUNCH=py -3.12"
py -3.13 --version >nul 2>nul && if not defined PYLAUNCH set "PYLAUNCH=py -3.13"
where py >nul 2>nul && if not defined PYLAUNCH set "PYLAUNCH=py -3"
if not defined PYLAUNCH set "PYLAUNCH=python"

%PYLAUNCH% --version >nul 2>nul
if %errorlevel% neq 0 (
  echo Python was not found.
  echo Install Python 3.12 or 3.13, 64-bit, from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this file again.
  exit /b 1
)
for /f "tokens=*" %%v in ('%PYLAUNCH% --version') do echo Using %%v

REM Recreate the environment if a previous run built it with an
REM unsuitable Python such as 3.14, which cannot install PyAV.
set "ENV_OK=0"
if exist whisper-env\Scripts\python.exe whisper-env\Scripts\python.exe -c "import sys; raise SystemExit(0 if sys.version_info[:2] in ((3,12),(3,13)) else 1)" && set "ENV_OK=1"
if exist whisper-env\Scripts\python.exe if "%ENV_OK%"=="0" (
  echo Existing whisper-env uses an unsuitable Python version - recreating it.
  rmdir /s /q whisper-env
)
set "VENV_FAILED=0"
if not exist whisper-env\Scripts\python.exe (
  echo Creating environment in %CD%\whisper-env ...
  %PYLAUNCH% -m venv whisper-env
  if errorlevel 1 set "VENV_FAILED=1"
)
if "%VENV_FAILED%"=="1" (
  echo Failed to create the Python environment.
  exit /b 1
)

echo Installing faster-whisper - this downloads a few hundred MB ...
whisper-env\Scripts\python.exe -m pip install --upgrade pip
REM --only-binary: never fall back to compiling from source.
REM av must stay below 14: faster-whisper passes a decode option
REM that PyAV 14 removed, and transcription fails without the pin.
whisper-env\Scripts\python.exe -m pip install --only-binary=:all: faster-whisper "av<14"
if %errorlevel% neq 0 (
  echo.
  echo pip could not find prebuilt packages for this Python.
  echo This happens on Python 3.14+ or 32-bit Python. Install
  echo Python 3.12 or 3.13, 64-bit, from https://www.python.org/downloads/
  echo then run this file again - it will pick that version up
  echo automatically. No Visual C++ Build Tools are needed.
  exit /b 1
)

echo.
echo DONE. In VideoAI Studio, open Settings - Transcript and set
echo "faster-whisper python" to:
echo %CD%\whisper-env\Scripts\python.exe
echo.
