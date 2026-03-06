#!/usr/bin/env python3
"""Search and read emails via Fastmail JMAP.

Searches the shared personal Inbox (jeff@steinbok.net) by default,
or the openclaw account's own mailboxes with --account openclaw.

Auth:
  Reads FASTMAIL_JMAP_TOKEN from env or ~/.fastmail_token.

Config env vars:
  FASTMAIL_JMAP_TOKEN      — API bearer token (required)

Examples:
  # Search recent inbox
  python3 fastmail_search.py inbox --limit 10

  # Search by keyword
  python3 fastmail_search.py search --query "flight confirmation"

  # Search by sender
  python3 fastmail_search.py search --from "amazon.com" --limit 5

  # Read a specific email by ID
  python3 fastmail_search.py read --id Mxxxxxxx

  # Search openclaw's own inbox
  python3 fastmail_search.py inbox --account openclaw --limit 5
"""

import argparse
import json
import os
import sys
from datetime import datetime, timedelta, timezone
from urllib.error import HTTPError
from urllib.request import Request, urlopen

JMAP_API = "https://api.fastmail.com/jmap/api/"
INBOX_ROLE = "inbox"


def get_token():
    t = os.environ.get("FASTMAIL_JMAP_TOKEN")
    if t:
        return t
    p = os.path.expanduser("~/.fastmail_token")
    if os.path.exists(p):
        with open(p) as f:
            return f.read().strip()
    sys.exit("FASTMAIL_JMAP_TOKEN not found (checked env + ~/.fastmail_token)")


def jmap(token, calls):
    body = json.dumps({
        "using": ["urn:ietf:params:jmap:core", "urn:ietf:params:jmap:mail"],
        "methodCalls": calls,
    }).encode()
    req = Request(JMAP_API, body, {
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    })
    try:
        with urlopen(req) as r:
            return json.loads(r.read())
    except HTTPError as e:
        body = e.read().decode()[:500]
        sys.exit(f"JMAP error {e.code}: {body}")


def get_inbox_id(token, account_id):
    resp = jmap(token, [
        ["Mailbox/get", {
            "accountId": account_id,
            "properties": ["name", "id", "role"],
        }, "mbox"]
    ])
    for mb in resp["methodResponses"][0][1].get("list", []):
        if mb.get("role") == INBOX_ROLE:
            return mb["id"]
    sys.exit("Could not find Inbox mailbox")


def format_sender(from_list):
    if not from_list:
        return "(unknown)"
    s = from_list[0]
    name = s.get("name", "")
    email = s.get("email", "")
    return f"{name} <{email}>" if name else email


def format_date(iso_str):
    if not iso_str:
        return ""
    try:
        dt = datetime.fromisoformat(iso_str.replace("Z", "+00:00"))
        now = datetime.now(timezone.utc)
        if dt.date() == now.date():
            return dt.strftime("%H:%M")
        elif dt.year == now.year:
            return dt.strftime("%b %d %H:%M")
        else:
            return dt.strftime("%Y-%m-%d")
    except Exception:
        return iso_str[:16]


def print_email_list(emails):
    if not emails:
        print("No emails found.")
        return
    for e in emails:
        sender = format_sender(e.get("from"))
        date = format_date(e.get("receivedAt"))
        subject = (e.get("subject") or "(no subject)")[:80]
        eid = e.get("id", "?")
        read = " " if e.get("keywords", {}).get("$seen") else "•"
        print(f"{read} {date:>12s}  {sender[:35]:<35s}  {subject}")
        print(f"  ID: {eid}")


def print_email_detail(email):
    sender = format_sender(email.get("from"))
    to_list = email.get("to") or []
    to_str = ", ".join(
        f"{t.get('name', '')} <{t.get('email', '')}>".strip() for t in to_list
    )
    cc_list = email.get("cc") or []
    cc_str = ", ".join(
        f"{c.get('name', '')} <{c.get('email', '')}>".strip() for c in cc_list
    )
    date = email.get("receivedAt", "")
    subject = email.get("subject") or "(no subject)"

    print(f"Subject: {subject}")
    print(f"From:    {sender}")
    print(f"To:      {to_str}")
    if cc_str:
        print(f"Cc:      {cc_str}")
    print(f"Date:    {date}")
    print(f"ID:      {email.get('id', '?')}")
    print("-" * 60)

    body = (email.get("textBody") or [{}])
    if body and body[0].get("partId"):
        # Body was fetched via bodyValues
        part_id = body[0]["partId"]
        bv = email.get("bodyValues", {}).get(part_id, {})
        print(bv.get("value", "(no text body)"))
    else:
        preview = email.get("preview", "(no preview)")
        print(preview)


# ── Commands ──────────────────────────────────────────────────

def cmd_inbox(args):
    token = get_token()
    account_id = args.account_id
    inbox_id = get_inbox_id(token, account_id)

    filter_obj = {"inMailbox": inbox_id}
    if args.unread:
        filter_obj["notKeyword"] = "$seen"

    resp = jmap(token, [
        ["Email/query", {
            "accountId": account_id,
            "filter": filter_obj,
            "sort": [{"property": "receivedAt", "isAscending": False}],
            "limit": args.limit,
        }, "q"],
        ["Email/get", {
            "accountId": account_id,
            "#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"},
            "properties": ["id", "from", "subject", "receivedAt", "keywords"],
        }, "g"],
    ])
    emails = resp["methodResponses"][1][1].get("list", [])
    total = resp["methodResponses"][0][1].get("total", "?")
    print(f"📬 Inbox ({total} total, showing {len(emails)})\n")
    print_email_list(emails)


def cmd_search(args):
    token = get_token()
    account_id = args.account_id

    filter_parts = []
    if args.query:
        filter_parts.append({"text": args.query})
    if args.sender:
        filter_parts.append({"from": args.sender})
    if args.to:
        filter_parts.append({"to": args.to})
    if args.subject:
        filter_parts.append({"subject": args.subject})
    if args.since:
        filter_parts.append({"after": args.since + "T00:00:00Z"})
    if args.before:
        filter_parts.append({"before": args.before + "T00:00:00Z"})

    inbox_id = get_inbox_id(token, account_id)
    filter_parts.append({"inMailbox": inbox_id})

    if len(filter_parts) == 1:
        filter_obj = filter_parts[0]
    else:
        filter_obj = {"operator": "AND", "conditions": filter_parts}

    resp = jmap(token, [
        ["Email/query", {
            "accountId": account_id,
            "filter": filter_obj,
            "sort": [{"property": "receivedAt", "isAscending": False}],
            "limit": args.limit,
        }, "q"],
        ["Email/get", {
            "accountId": account_id,
            "#ids": {"resultOf": "q", "name": "Email/query", "path": "/ids"},
            "properties": ["id", "from", "subject", "receivedAt", "keywords"],
        }, "g"],
    ])
    emails = resp["methodResponses"][1][1].get("list", [])
    total = resp["methodResponses"][0][1].get("total", "?")
    print(f"🔍 Search results ({total} matches, showing {len(emails)})\n")
    print_email_list(emails)


def cmd_read(args):
    token = get_token()
    account_id = args.account_id

    resp = jmap(token, [
        ["Email/get", {
            "accountId": account_id,
            "ids": [args.id],
            "properties": [
                "id", "from", "to", "cc", "subject", "receivedAt",
                "textBody", "bodyValues", "preview", "keywords",
            ],
            "fetchTextBodyValues": True,
            "maxBodyValueBytes": 50000,
        }, "g"],
    ])
    emails = resp["methodResponses"][0][1].get("list", [])
    if not emails:
        not_found = resp["methodResponses"][0][1].get("notFound", [])
        if not_found:
            sys.exit(f"Email not found: {args.id}")
        sys.exit("No email returned")
    print_email_detail(emails[0])


# ── CLI ───────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="Search and read Fastmail emails via JMAP")
    parser.add_argument("--account-id", required=True,
                        help="JMAP account ID to search")
    sub = parser.add_subparsers(dest="command", required=True)

    # inbox
    p_inbox = sub.add_parser("inbox", help="Show recent Inbox emails")
    p_inbox.add_argument("--limit", type=int, default=10)
    p_inbox.add_argument("--unread", action="store_true", help="Only show unread")

    # search
    p_search = sub.add_parser("search", help="Search emails")
    p_search.add_argument("--query", "-q", help="Full-text search")
    p_search.add_argument("--from", dest="sender", help="Filter by sender")
    p_search.add_argument("--to", help="Filter by recipient")
    p_search.add_argument("--subject", "-s", help="Filter by subject")
    p_search.add_argument("--since", help="Emails after date (YYYY-MM-DD)")
    p_search.add_argument("--before", help="Emails before date (YYYY-MM-DD)")
    p_search.add_argument("--limit", type=int, default=20)

    # read
    p_read = sub.add_parser("read", help="Read a specific email by ID")
    p_read.add_argument("--id", required=True, help="JMAP email ID")

    args = parser.parse_args()
    if args.command == "inbox":
        cmd_inbox(args)
    elif args.command == "search":
        cmd_search(args)
    elif args.command == "read":
        cmd_read(args)


if __name__ == "__main__":
    main()
