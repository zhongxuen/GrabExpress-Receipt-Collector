"""Gmail authentication, search, and raw message retrieval.

Contains no parsing logic — callers get back raw HTML bodies and Gmail
message IDs, and are responsible for interpreting the content.
"""

import base64
import logging

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build

import config

logger = logging.getLogger(__name__)


def get_gmail_service():
    """Authenticate with Gmail via OAuth2 and return an API service client.

    Reuses a persisted token from token.json when available and valid,
    refreshing it silently if expired. Falls back to an interactive
    browser login (using credentials.json) only when no usable token
    exists yet.
    """
    creds = None

    if config.TOKEN_PATH.exists():
        creds = Credentials.from_authorized_user_file(
            str(config.TOKEN_PATH), config.GMAIL_SCOPES
        )

    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not config.CREDENTIALS_PATH.exists():
                raise FileNotFoundError(
                    f"Missing {config.CREDENTIALS_PATH}. Download an OAuth "
                    "client ID (Desktop app) from Google Cloud Console and "
                    "save it there as credentials.json."
                )
            flow = InstalledAppFlow.from_client_secrets_file(
                str(config.CREDENTIALS_PATH), config.GMAIL_SCOPES
            )
            creds = flow.run_local_server(port=0)

        config.TOKEN_PATH.write_text(creds.to_json())

    return build("gmail", "v1", credentials=creds)


def build_search_query(after=None, before=None):
    """Build a Gmail search query string for GrabExpress receipt emails.

    after/before are date strings in YYYY/MM/DD format, matching Gmail's
    native query syntax. Either may be omitted.
    """
    parts = [f"from:{config.SENDER}", f'subject:"{config.SUBJECT}"']
    if after:
        parts.append(f"after:{after}")
    if before:
        parts.append(f"before:{before}")
    return " ".join(parts)


def search_messages(service, query):
    """Return a list of message IDs matching the given Gmail search query."""
    message_ids = []
    page_token = None

    while True:
        response = (
            service.users()
            .messages()
            .list(userId="me", q=query, pageToken=page_token)
            .execute()
        )
        message_ids.extend(m["id"] for m in response.get("messages", []))
        page_token = response.get("nextPageToken")
        if not page_token:
            break

    return message_ids


def get_message(service, message_id):
    """Fetch a message by ID and return its subject and decoded HTML body."""
    message = (
        service.users()
        .messages()
        .get(userId="me", id=message_id, format="full")
        .execute()
    )
    payload = message.get("payload", {})
    return {
        "id": message_id,
        "subject": _extract_header(payload, "Subject") or "",
        "html": _extract_html(payload),
    }


def _extract_header(payload, name):
    for header in payload.get("headers", []):
        if header.get("name", "").lower() == name.lower():
            return header.get("value")
    return None


def _extract_html(payload):
    """Recursively search a Gmail message payload for a text/html part."""
    mime_type = payload.get("mimeType", "")
    body_data = payload.get("body", {}).get("data")

    if mime_type == "text/html" and body_data:
        return _decode_body(body_data)

    for part in payload.get("parts", []):
        html = _extract_html(part)
        if html:
            return html

    return None


def _decode_body(data):
    return base64.urlsafe_b64decode(data.encode("UTF-8")).decode("utf-8", errors="replace")
