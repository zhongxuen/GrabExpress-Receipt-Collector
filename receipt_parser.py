"""Parses Receipt objects out of raw Grab receipt email HTML.

Built around a BaseReceiptParser so future Grab receipt types (GrabFood,
GrabCar, GrabMart) can be added as subclasses without changing the
contract main.py relies on: parse(html) -> Receipt.
"""

import re
from dataclasses import dataclass
from datetime import datetime

from bs4 import BeautifulSoup


class ParseError(Exception):
    """Raised when a required field can't be extracted from the receipt HTML."""


@dataclass
class Receipt:
    date: str  # YYYY-MM-DD
    receipt_no: str
    amount: float


class BaseReceiptParser:
    """Common HTML-to-text plumbing shared by all Grab receipt types."""

    def parse(self, html):
        raise NotImplementedError

    @staticmethod
    def _soup(html):
        return BeautifulSoup(html, "lxml")

    @staticmethod
    def _find_value_near_label(soup, label_pattern):
        """Look for text matching label_pattern, return the nearest sibling
        or parent-adjacent text as the associated value.

        Tolerant of minor layout drift: doesn't rely on fixed element
        positions, just proximity to the label text in the DOM.
        """
        label_re = re.compile(label_pattern, re.IGNORECASE)
        label_node = soup.find(string=label_re)
        if not label_node:
            return None

        container = label_node.find_parent()
        if container is None:
            return None

        # Try the label's own text with the label stripped out first
        # (handles "Booking Code: ABC123" in a single node).
        own_text = label_node.strip()
        stripped = label_re.sub("", own_text).strip(" : ")
        if stripped:
            return stripped

        # Otherwise look at sibling elements of the label's container.
        sibling = container.find_next_sibling()
        while sibling:
            text = sibling.get_text(strip=True)
            if text:
                return text
            sibling = sibling.find_next_sibling()

        # Fall back to the parent's full text, minus the label itself.
        parent_text = container.get_text(" ", strip=True)
        parent_text = label_re.sub("", parent_text).strip(" : ")
        return parent_text or None


class GrabExpressParser(BaseReceiptParser):
    """Parses "Your GrabExpress Receipt" emails.

    GrabExpress emails don't expose a separate invoice/receipt ID, so the
    Booking Code is used as the Receipt Number per the project spec.
    """

    BOOKING_CODE_LABEL = r"booking\s*code"
    AMOUNT_LABEL = r"total(?:\s*(?:paid|amount|fare))?"
    DATE_LABEL = r"\bdate\b"

    # Grab booking codes look like "A-9GOVVE8GX938AV": a short letter
    # prefix, a dash, then an alphanumeric run.
    BOOKING_CODE_RE = re.compile(r"\b[A-Z]-[A-Z0-9]{8,}\b")
    AMOUNT_RE = re.compile(r"(?:RM|MYR)?\s*([0-9]+(?:,[0-9]{3})*\.[0-9]{2})", re.IGNORECASE)

    def parse(self, html):
        soup = self._soup(html)
        text = soup.get_text(" ", strip=True)

        receipt_no = self._extract_booking_code(soup, text)
        amount = self._extract_amount(soup, text)
        date = self._extract_date(soup, text)

        return Receipt(date=date, receipt_no=receipt_no, amount=amount)

    def _extract_booking_code(self, soup, text):
        value = self._find_value_near_label(soup, self.BOOKING_CODE_LABEL)
        if value:
            match = self.BOOKING_CODE_RE.search(value)
            if match:
                return match.group(0)
            if value:
                return value

        match = self.BOOKING_CODE_RE.search(text)
        if match:
            return match.group(0)

        raise ParseError("Booking Code not found")

    def _extract_amount(self, soup, text):
        value = self._find_value_near_label(soup, self.AMOUNT_LABEL)
        if value:
            match = self.AMOUNT_RE.search(value)
            if match:
                return float(match.group(1).replace(",", ""))

        match = self.AMOUNT_RE.search(text)
        if match:
            return float(match.group(1).replace(",", ""))

        raise ParseError("Amount not found")

    def _extract_date(self, soup, text):
        value = self._find_value_near_label(soup, self.DATE_LABEL)
        candidates = [value] if value else []
        candidates.append(text)

        for candidate in candidates:
            if not candidate:
                continue
            parsed = self._parse_date_string(candidate)
            if parsed:
                return parsed

        raise ParseError("Date not found")

    @staticmethod
    def _parse_date_string(candidate):
        # Try a handful of common Grab date formats before giving up.
        formats = [
            "%d %b %Y",
            "%d %B %Y",
            "%Y-%m-%d",
            "%d/%m/%Y",
            "%d-%m-%Y",
        ]
        match = re.search(
            r"\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4}",
            candidate,
        )
        if not match:
            return None
        raw = match.group(0)
        for fmt in formats:
            try:
                return datetime.strptime(raw, fmt).strftime("%Y-%m-%d")
            except ValueError:
                continue
        return None


def get_parser(subject):
    """Return the appropriate parser for a receipt email subject.

    Only GrabExpress is implemented; this is the extension point for
    GrabFood/GrabCar/GrabMart parsers later.
    """
    if "grabexpress" in subject.lower():
        return GrabExpressParser()
    raise ParseError(f"No parser available for subject: {subject!r}")
