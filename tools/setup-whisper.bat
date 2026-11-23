@echo off
REM One-time setup for the Transcript Editor (faster-whisper).
REM Creates a private Python environment in tools\whisper-env and
REM installs faster-whisper into it. VideoAI Studio only needs the
REM python.exe inside that environment (Settings -> Transcript).
REM
REM Python 3.12 or 3.13 (64-bit) is required: faster-whisper
REM needs PyAV below 14, and PyAV ships no prebuilt wheel for
REM Python 3.14+ - pip then tries to compile it from source and
REM fails without the Visual C++ Build Tools. This script picks
REM a suitable Python automatically when one is installed.
setlocal
cd /d %~dp0

REM Pick the newest suitable Python: prefer 3.12, then 3.13.
set "PYLAUNCH="
py -3.12 --version >nul 2>nul && set "PYLAUNCH=py -3.12"
if defined PYLAUNCH goto have_python
py -3.13 --version >nul 2>nul && set "PYLAUNCH=py -3.13"
if defined PYLAUNCH goto have_python
where py >nul 2>nul && set "PYLAUNCH=py -3"
if defined PYLAUNCH goto have_python
set "PYLAUNCH=python"
:have_python

%PYLAUNCH% --version >nul 2>nul
if %errorlevel% neq 0 (
  echo Python was not found.
  echo Install Python 3.12 or 3.13 (64-bit) from https://www.python.org/downloads/
  echo and tick "Add python.exe to PATH", then run this file again.
  pause
  exit /b 1
)
for /f "tokens=*" %%v in ('%PYLAUNCH% --version') do echo Using %%v

REM Recreate the environment if a previous run built it with an
REM unsuitable Python (e.g. 3.14), which cannot install PyAV.
if not exist whisper-env\Scripts\python.exe goto create_env
whisper-env\Scripts\python.exe -c "import sys; raise SystemExit(0 if sys.version_info[:2] in ((3,12),(3,13)) else 1)" && goto install
echo Existing whisper-env uses an unsuitable Python version - recreating it.
rmdir /s /q whisper-env
:create_env
echo Creating environment in %CD%\whisper-env ...
%PYLAUNCH% -m venv whisper-env
if %errorlevel% neq 0 (
  echo Failed to create the Python environment.
  pause
  exit /b 1
)
:install

echo Installing faster-whisper (this downloads a few hundred MB) ...
whisper-env\Scripts\python.exe -m pip install --upgrade pip
REM --only-binary: never fall back to compiling from source.
REM av must stay below 14: faster-whisper passes a decode option
REM that PyAV 14 removed, and transcription fails without the pin.
whisper-env\Scripts\python.exe -m pip install --only-binary=:all: faster-whisper "av<14"
if %errorlevel% neq 0 (
  echo.
  echo pip could not find prebuilt packages for this Python.
  echo This happens on Python 3.14+ or 32-bit Python. Install
  echo Python 3.12 or 3.13 (64-bit) from https://www.python.org/downloads/
  echo then run this file again - it will pick that version up
  echo automatically. No Visual C++ Build Tools are needed.
  pause
  exit /b 1
)

echo.
echo DONE. In VideoAI Studio, open Settings -^> Transcript and set
echo "faster-whisper python" to:
echo %CD%\whisper-env\Scripts\python.exe
echo.
pause
