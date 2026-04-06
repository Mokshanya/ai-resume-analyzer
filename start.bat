@echo off
echo =========================================================
echo Setting up the Smart Resume Analyzer Backend...
echo =========================================================
echo.
echo Step 1: Installing required libraries...
pip install Flask Flask-Cors PyPDF2 python-docx
echo.
echo Step 2: Starting the AI Engine...
python app.py
pause
