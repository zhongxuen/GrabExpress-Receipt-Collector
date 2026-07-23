"""CLI entry point: wires gmail_client, receipt_parser, and exporter together."""

import argparse
import logging
import sys
from datetime import datetime

from dateutil.relativedelta import relativedelta

import config
import exporter
import gmail_client
from receipt_parser import ParseError, get_parser


def parse_args(argv):
    parser = argparse.ArgumentParser(description="Export GrabExpress receipts from Gmail to .xlsx")
    group = parser.add_mutually_exclusive_group()
    group.add_argument("--since", metavar="YYYY-MM-DD", help="Receipts on or after this date")
    group.add_argument("--month", metavar="YYYY-MM", help="Receipts in a single month")
    group.add_argument("--when", metavar="PHRASE", help='Natural phrase, e.g. "last 90 days", "last year", "this month", "2025"')
    parser.add_argument("--from", dest="date_from", metavar="YYYY-MM-DD", help="Range start (use with --to)")
    parser.add_argument("--to", dest="date_to", metavar="YYYY-MM-DD", help="Range end (use with --to)")
    return parser.parse_args(argv)


def resolve_date_range(args):
    """Translate CLI args into (after, before, filename_suffix).

    after/before are Gmail-query-formatted (YYYY/MM/DD) or None for no bound.
    filename_suffix is appended to the output filename, or "" for all receipts.
    """
    today = datetime.now()

    if args.since:
        d = datetime.strptime(args.since, "%Y-%m-%d")
        return d.strftime("%Y/%m/%d"), None, f"_since_{d.strftime('%Y%m%d')}"

    if args.month:
        d = datetime.strptime(args.month, "%Y-%m")
        after = d
        before = d + relativedelta(months=1)
        return after.strftime("%Y/%m/%d"), before.strftime("%Y/%m/%d"), f"_{d.strftime('%B%Y')}"

    if args.date_from or args.date_to:
        if not (args.date_from and args.date_to):
            raise ValueError("--from and --to must be used together")
        after = datetime.strptime(args.date_from, "%Y-%m-%d")
        before = datetime.strptime(args.date_to, "%Y-%m-%d") + relativedelta(days=1)
        return (
            after.strftime("%Y/%m/%d"),
            before.strftime("%Y/%m/%d"),
            f"_{after.strftime('%Y%m%d')}_{args.date_to.replace('-', '')}",
        )

    if args.when:
        return resolve_natural_phrase(args.when, today)

    return None, None, ""


def resolve_natural_phrase(phrase, today):
    phrase = phrase.strip().lower()

    if phrase in ("this month",):
        after = today.replace(day=1)
        before = after + relativedelta(months=1)
        return after.strftime("%Y/%m/%d"), before.strftime("%Y/%m/%d"), f"_{after.strftime('%B%Y')}"

    if phrase in ("last year",):
        year = today.year - 1
        return f"{year}/01/01", f"{year + 1}/01/01", f"_{year}"

    if phrase.isdigit() and len(phrase) == 4:
        year = int(phrase)
        return f"{year}/01/01", f"{year + 1}/01/01", f"_{year}"

    if phrase.startswith("since "):
        rest = phrase[len("since "):]
        d = _parse_month_year(rest)
        if d:
            return d.strftime("%Y/%m/%d"), None, f"_since_{d.strftime('%Y%m')}"

    if phrase.startswith("last ") and "day" in phrase:
        try:
            days = int(phrase.split()[1])
        except (IndexError, ValueError):
            raise ValueError(f"Could not parse phrase: {phrase!r}")
        after = today - relativedelta(days=days)
        return after.strftime("%Y/%m/%d"), None, f"_last{days}days"

    d = _parse_month_year(phrase)
    if d:
        after = d
        before = d + relativedelta(months=1)
        return after.strftime("%Y/%m/%d"), before.strftime("%Y/%m/%d"), f"_{after.strftime('%B%Y')}"

    raise ValueError(f"Could not parse phrase: {phrase!r}")


def _parse_month_year(text):
    for fmt in ("%B %Y", "%b %Y"):
        try:
            return datetime.strptime(text.strip(), fmt)
        except ValueError:
            continue
    return None


def setup_logging():
    config.LOG_DIR.mkdir(parents=True, exist_ok=True)
    log_path = config.LOG_DIR / f"{datetime.now().strftime('%Y-%m-%d')}.log"
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(message)s",
        handlers=[logging.FileHandler(log_path, encoding="utf-8"), logging.StreamHandler()],
    )
    return log_path


def main(argv=None):
    args = parse_args(argv or sys.argv[1:])
    log_path = setup_logging()
    logger = logging.getLogger(__name__)

    try:
        after, before, suffix = resolve_date_range(args)
    except ValueError as e:
        print(f"Error: {e}")
        return 1

    query = gmail_client.build_search_query(after=after, before=before)
    logger.info("Search query: %s", query)

    print("Authenticating with Gmail...")
    service = gmail_client.get_gmail_service()

    print("Searching Gmail...")
    message_ids = gmail_client.search_messages(service, query)
    print(f"Found {len(message_ids)} receipts")
    logger.info("Found %d matching messages", len(message_ids))

    if not message_ids:
        print("No receipts found for the given filters.")
        return 0

    print("Processing...")
    receipts = []
    seen_message_ids = set()
    seen_receipt_nos = set()

    for i, message_id in enumerate(message_ids, start=1):
        print(f"[{i} / {len(message_ids)}]", end="\r")

        if message_id in seen_message_ids:
            continue
        seen_message_ids.add(message_id)

        try:
            message = gmail_client.get_message(service, message_id)
            if not message["html"]:
                raise ParseError("No HTML body found")

            parser = get_parser(message["subject"] or config.SUBJECT)
            receipt = parser.parse(message["html"])
        except ParseError as e:
            logger.warning("Skipped: Message ID %s / Reason: %s", message_id, e)
            continue
        except Exception as e:
            logger.warning("Skipped: Message ID %s / Reason: Unexpected error: %s", message_id, e)
            continue

        if receipt.receipt_no in seen_receipt_nos:
            continue
        seen_receipt_nos.add(receipt.receipt_no)

        receipts.append(receipt)

    print()
    print("Exporting...")

    output_path = config.OUTPUT_DIR / f"grabexpress_receipts{suffix}.xlsx"
    exporter.export_receipts(receipts, output_path)
    logger.info("Exported %d receipts to %s", len(receipts), output_path)

    print(f"Done. Wrote {len(receipts)} receipts to {output_path}")
    print(f"Log: {log_path}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
