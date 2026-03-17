# YouTube AI Automation

## Local Run

PowerShell from repo root:

```powershell
$env:PYTHONPATH="src"
python -m youtube_ai_automation.main --news --upload --count 1
```

Alternate modes:

```powershell
$env:PYTHONPATH="src"
python -m youtube_ai_automation.main --auto --upload --count 1
```

```powershell
$env:PYTHONPATH="src"
python -m youtube_ai_automation.main --optimized --upload --count 1 --niche "your niche" --topic "optional topic"
```

## Required Files

- `config/client_secret.json` from Google Cloud OAuth
- `config/.env` with `YOUTUBE_CLIENT_SECRET_FILE=config/client_secret.json`

## Notes

- First run requires OAuth consent to create `token.json`.
- Ensure `TOKEN_PATH` points to a persisted location if running in containers.
