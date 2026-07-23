"""Shared configuration constants for the GrabExpress receipt collector."""

from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent

CREDENTIALS_PATH = BASE_DIR / "credentials.json"
TOKEN_PATH = BASE_DIR / "token.json"

OUTPUT_DIR = BASE_DIR / "outputs"
LOG_DIR = BASE_DIR / "logs"

GMAIL_SCOPES = ["https://www.googleapis.com/auth/gmail.readonly"]

SENDER = "no-reply@grab.com"
SUBJECT = "Your GrabExpress Receipt"
