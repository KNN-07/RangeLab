@echo off
setlocal
pushd "%~dp0rangelab\dist" || exit /b 1
where py.exe >nul 2>nul
if errorlevel 1 (
  set "RANGELAB_PYTHON=python"
) else (
  set "RANGELAB_PYTHON=py -3"
)
echo Opening RangeLab at http://127.0.0.1:8734/
echo Keep this window open while studying. Press Ctrl+C to stop the local server.
%RANGELAB_PYTHON% -c "from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler; import webbrowser; server = ThreadingHTTPServer(('127.0.0.1', 8734), SimpleHTTPRequestHandler); webbrowser.open('http://127.0.0.1:8734/'); server.serve_forever()"
if errorlevel 1 pause
popd
