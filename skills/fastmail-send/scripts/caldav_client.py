#!/usr/bin/env python3
"""CalDAV client library for calendar event management.

Implements RFC 4791 (CalDAV) and RFC 4918 (WebDAV) over HTTP(S) using
Python stdlib only (urllib, xml.etree.ElementTree, base64).

Supported operations:
  PROPFIND    – discover calendars and event metadata
  MKCALENDAR  – create a new calendar collection
  PUT         – create or update a calendar event (.ics resource)
  DELETE      – remove a calendar event
  REPORT      – query events by time range or UID (calendar-query)

Key public API:
  CalDAVClient        – HTTP client wrapping the above operations
  CalDAVError         – exception raised on HTTP/protocol errors
  parse_ical_event    – extract key fields from an iCalendar string
  update_ical_vevent  – patch specific properties inside a VCALENDAR string
"""

import base64
import re
import xml.etree.ElementTree as ET
from datetime import datetime
from urllib.error import HTTPError
from urllib.request import Request, urlopen

# ── XML namespaces ────────────────────────────────────────────────────────────

NS_DAV    = "DAV:"
NS_CALDAV = "urn:ietf:params:xml:ns:caldav"
NS_CS     = "http://calendarserver.org/ns/"
NS_ICAL   = "http://apple.com/ns/ical/"

# Register prefixes so ET serialises them readably
ET.register_namespace("d",  NS_DAV)
ET.register_namespace("c",  NS_CALDAV)
ET.register_namespace("cs", NS_CS)
ET.register_namespace("i",  NS_ICAL)


def _q(ns: str, local: str) -> str:
    """Return a Clark-notation qualified name: {ns}local."""
    return f"{{{ns}}}{local}"


# Commonly-used Clark names
_HREF         = _q(NS_DAV,    "href")
_DISPLAYNAME  = _q(NS_DAV,    "displayname")
_RESOURCETYPE = _q(NS_DAV,    "resourcetype")
_GETETAG      = _q(NS_DAV,    "getetag")
_CALENDAR     = _q(NS_CALDAV, "calendar")
_CALDATA      = _q(NS_CALDAV, "calendar-data")
_CALDESC      = _q(NS_CALDAV, "calendar-description")
_CALCOLOR     = _q(NS_ICAL,   "calendar-color")


# ── Exceptions ────────────────────────────────────────────────────────────────

class CalDAVError(Exception):
    """Raised when a CalDAV/WebDAV operation fails.

    Attributes:
        status_code: HTTP status code if the error originated from an HTTP
                     response; None for protocol-level errors.
    """

    def __init__(self, message: str, status_code: int | None = None):
        super().__init__(message)
        self.status_code = status_code


# ── CalDAVClient ──────────────────────────────────────────────────────────────

class CalDAVClient:
    """Simple CalDAV client using stdlib HTTP only.

    All path arguments may be:
      - A relative path (resolved against *base_url*)
      - An absolute URL (used as-is)

    Attributes:
        base_url: CalDAV server base URL, always ends with "/".
        username: Account username / e-mail address.
        password: Account password or app-specific password.
        timeout:  HTTP request timeout in seconds (default 30).
    """

    def __init__(self, base_url: str, username: str, password: str, timeout: int = 30):
        self.base_url = base_url.rstrip("/") + "/"
        self.username = username
        self.password = password
        self.timeout  = timeout
        creds = base64.b64encode(f"{username}:{password}".encode()).decode()
        self._auth = f"Basic {creds}"

    # ── Internal HTTP layer ───────────────────────────────────────────────────

    def _url(self, path: str) -> str:
        """Resolve *path* to an absolute URL."""
        if path.startswith(("http://", "https://")):
            return path
        return self.base_url + path.lstrip("/")

    def _request(
        self,
        method: str,
        path: str,
        headers: dict | None = None,
        body: bytes | None = None,
    ) -> tuple[int, dict, bytes]:
        """Execute an HTTP request; return (status, response_headers, body).

        Args:
            method:  HTTP/WebDAV method string (GET, PUT, DELETE, PROPFIND, …).
            path:    Relative path or absolute URL.
            headers: Additional request headers merged with the auth header.
            body:    Request body bytes; may be None for body-less requests.

        Returns:
            Tuple of (HTTP status code, response headers dict, response body).

        Raises:
            CalDAVError: On 4xx/5xx HTTP responses or network failures.
        """
        all_headers: dict = {"Authorization": self._auth}
        if headers:
            all_headers.update(headers)

        url = self._url(path)
        req = Request(url, data=body, headers=all_headers, method=method)
        try:
            with urlopen(req, timeout=self.timeout) as resp:
                return resp.status, dict(resp.headers), resp.read()
        except HTTPError as exc:
            snippet = exc.read()[:200] if exc.fp else b""
            raise CalDAVError(
                f"HTTP {exc.code} {exc.reason} for {method} {url}: {snippet!r}",
                status_code=exc.code,
            ) from exc

    # ── Raw WebDAV / CalDAV operations ────────────────────────────────────────

    def propfind(
        self,
        path: str,
        depth: str = "1",
        body: bytes | None = None,
    ) -> ET.Element:
        """Execute a PROPFIND and return the parsed XML multistatus root.

        Args:
            path:  Collection or resource path.
            depth: WebDAV ``Depth`` header value ("0", "1", or "infinity").
            body:  XML request body. When None, requests ``allprop``.

        Returns:
            Parsed ``d:multistatus`` XML root element.

        Raises:
            CalDAVError: On HTTP errors.
        """
        if body is None:
            body = (
                b'<?xml version="1.0" encoding="utf-8"?>'
                b'<d:propfind xmlns:d="DAV:"><d:allprop/></d:propfind>'
            )
        headers = {
            "Depth": depth,
            "Content-Type": "application/xml; charset=utf-8",
        }
        _, _, resp_body = self._request("PROPFIND", path, headers, body)
        return ET.fromstring(resp_body)

    def mkcalendar(
        self,
        path: str,
        display_name: str = "",
        description: str = "",
    ) -> None:
        """Create a new calendar collection (MKCALENDAR).

        Args:
            path:         Path for the new calendar (must not already exist).
            display_name: Human-readable name for the calendar.
            description:  Optional plain-text description.

        Raises:
            CalDAVError: If the server rejects the creation request.
        """
        root = ET.Element(_q(NS_CALDAV, "mkcalendar"))
        set_el  = ET.SubElement(root, _q(NS_DAV, "set"))
        prop_el = ET.SubElement(set_el, _q(NS_DAV, "prop"))
        if display_name:
            dn = ET.SubElement(prop_el, _DISPLAYNAME)
            dn.text = display_name
        if description:
            desc = ET.SubElement(prop_el, _CALDESC)
            desc.text = description

        body = ET.tostring(root, encoding="unicode").encode()
        headers = {"Content-Type": "application/xml; charset=utf-8"}
        self._request("MKCALENDAR", path, headers, body)

    def put(
        self,
        path: str,
        ical_data: str,
        etag: str | None = None,
    ) -> str:
        """Create or update a calendar resource (PUT).

        Args:
            path:      Path for the ``.ics`` resource.
            ical_data: iCalendar (RFC 5545) payload as a string.
            etag:      If not None and not ``"*"``: sent as ``If-Match`` for
                       conditional PUT (prevents overwriting a changed resource).
                       If ``"*"``: sent as ``If-None-Match: *`` (create-only).

        Returns:
            ``ETag`` returned by the server, or an empty string if not provided.

        Raises:
            CalDAVError: On HTTP errors (e.g. 412 Precondition Failed).
        """
        headers: dict = {"Content-Type": "text/calendar; charset=utf-8"}
        if etag is not None:
            if etag == "*":
                headers["If-None-Match"] = "*"
            else:
                headers["If-Match"] = etag

        body = ical_data.encode("utf-8")
        _, resp_headers, _ = self._request("PUT", path, headers, body)
        return resp_headers.get("ETag", "").strip('"')

    def delete(self, path: str, etag: str | None = None) -> None:
        """Delete a calendar resource (DELETE).

        Args:
            path: Path to the ``.ics`` resource.
            etag: Optional ``If-Match`` ETag for conditional delete.

        Raises:
            CalDAVError: On HTTP errors (e.g. 404 Not Found, 412 Precondition).
        """
        headers: dict = {}
        if etag:
            headers["If-Match"] = etag
        self._request("DELETE", path, headers or None)

    def report(
        self,
        path: str,
        report_xml: bytes,
        depth: str = "1",
    ) -> ET.Element:
        """Execute a CalDAV REPORT and return the parsed multistatus XML root.

        Args:
            path:       Calendar collection path.
            report_xml: XML body (``calendar-query``, ``calendar-multiget``, …).
            depth:      WebDAV ``Depth`` header (typically "1").

        Returns:
            Parsed ``d:multistatus`` XML root element.

        Raises:
            CalDAVError: On HTTP errors.
        """
        headers = {
            "Depth": depth,
            "Content-Type": "application/xml; charset=utf-8",
        }
        _, _, resp_body = self._request("REPORT", path, headers, report_xml)
        return ET.fromstring(resp_body)

    # ── High-level calendar operations ────────────────────────────────────────

    def discover_calendars(self, path: str = "") -> list[dict]:
        """Discover available calendar collections via PROPFIND.

        Sends a ``Depth: 1`` PROPFIND requesting ``displayname``,
        ``resourcetype``, ``calendar-description``, and ``calendar-color``.

        Args:
            path: Starting path; defaults to the base URL root.

        Returns:
            List of dicts, each with keys ``href``, ``display_name``,
            ``description``, and ``color``.  Returns an empty list if the
            request fails or no calendars are found.
        """
        root_el = ET.Element(_q(NS_DAV, "propfind"))
        prop_el = ET.SubElement(root_el, _q(NS_DAV, "prop"))
        for name in (_DISPLAYNAME, _RESOURCETYPE, _CALDESC, _CALCOLOR):
            ET.SubElement(prop_el, name)
        body = ET.tostring(root_el, encoding="unicode").encode()

        try:
            ms = self.propfind(path or "", depth="1", body=body)
        except CalDAVError:
            return []

        calendars: list[dict] = []
        for response in ms.iter(_q(NS_DAV, "response")):
            href_el = response.find(_HREF)
            if href_el is None:
                continue
            href = (href_el.text or "").strip()

            rt_el = response.find(f".//{_RESOURCETYPE}")
            if rt_el is None or rt_el.find(_CALENDAR) is None:
                continue  # not a calendar collection

            def _text(tag: str) -> str:
                el = response.find(f".//{tag}")
                return (el.text or "").strip() if el is not None else ""

            calendars.append({
                "href":         href,
                "display_name": _text(_DISPLAYNAME),
                "description":  _text(_CALDESC),
                "color":        _text(_CALCOLOR),
            })
        return calendars

    def get_calendar_events(
        self,
        calendar_path: str,
        start: datetime | None = None,
        end: datetime | None = None,
    ) -> list[dict]:
        """Retrieve events from a calendar, optionally filtered by date range.

        Uses a ``calendar-query`` REPORT with an optional ``time-range``
        filter on the VEVENT component.

        Args:
            calendar_path: Path to the calendar collection.
            start:         Start of the time range filter (UTC); inclusive.
            end:           End of the time range filter (UTC); exclusive.

        Returns:
            List of event dicts (see :func:`parse_ical_event` for keys), plus
            ``href`` and ``etag`` fields from the server.
            Returns an empty list if the request fails or no events match.
        """
        root_el = ET.Element(_q(NS_CALDAV, "calendar-query"))
        root_el.set("xmlns:d", NS_DAV)
        root_el.set("xmlns:c", NS_CALDAV)

        prop_el = ET.SubElement(root_el, _q(NS_DAV, "prop"))
        ET.SubElement(prop_el, _HREF)
        ET.SubElement(prop_el, _GETETAG)
        ET.SubElement(prop_el, _CALDATA)

        filter_el   = ET.SubElement(root_el, _q(NS_CALDAV, "filter"))
        vcal_filter = ET.SubElement(filter_el, _q(NS_CALDAV, "comp-filter"))
        vcal_filter.set("name", "VCALENDAR")
        vevent_filter = ET.SubElement(vcal_filter, _q(NS_CALDAV, "comp-filter"))
        vevent_filter.set("name", "VEVENT")

        if start or end:
            tr = ET.SubElement(vevent_filter, _q(NS_CALDAV, "time-range"))
            if start:
                tr.set("start", start.strftime("%Y%m%dT%H%M%SZ"))
            if end:
                tr.set("end", end.strftime("%Y%m%dT%H%M%SZ"))

        report_xml = ET.tostring(root_el, encoding="unicode").encode()
        try:
            ms = self.report(calendar_path, report_xml)
        except CalDAVError:
            return []
        return _parse_event_multistatus(ms)

    def get_event_by_uid(self, calendar_path: str, uid: str) -> dict | None:
        """Fetch a single event by its UID using a ``calendar-query`` REPORT.

        Args:
            calendar_path: Path to the calendar collection.
            uid:           Exact event UID to match.

        Returns:
            Event dict (as from :func:`parse_ical_event`, plus ``href`` and
            ``etag``), or ``None`` if not found.
        """
        root_el = ET.Element(_q(NS_CALDAV, "calendar-query"))
        root_el.set("xmlns:d", NS_DAV)
        root_el.set("xmlns:c", NS_CALDAV)

        prop_el = ET.SubElement(root_el, _q(NS_DAV, "prop"))
        ET.SubElement(prop_el, _HREF)
        ET.SubElement(prop_el, _GETETAG)
        ET.SubElement(prop_el, _CALDATA)

        filter_el   = ET.SubElement(root_el, _q(NS_CALDAV, "filter"))
        vcal_filter = ET.SubElement(filter_el, _q(NS_CALDAV, "comp-filter"))
        vcal_filter.set("name", "VCALENDAR")
        vevent_filter = ET.SubElement(vcal_filter, _q(NS_CALDAV, "comp-filter"))
        vevent_filter.set("name", "VEVENT")

        prop_filter = ET.SubElement(vevent_filter, _q(NS_CALDAV, "prop-filter"))
        prop_filter.set("name", "UID")
        text_match = ET.SubElement(prop_filter, _q(NS_CALDAV, "text-match"))
        text_match.set("collation", "i;octet")
        text_match.text = uid

        report_xml = ET.tostring(root_el, encoding="unicode").encode()
        try:
            ms = self.report(calendar_path, report_xml)
        except CalDAVError:
            return None
        events = _parse_event_multistatus(ms)
        return events[0] if events else None

    def create_event(self, calendar_path: str, uid: str, ical_data: str) -> str:
        """Create a new calendar event resource via PUT.

        The resource is stored at ``<calendar_path>/<safe_uid>.ics`` using
        ``If-None-Match: *`` to prevent overwriting an existing resource.

        Args:
            calendar_path: Path to the calendar collection.
            uid:           Event UID used to derive the resource filename.
            ical_data:     Complete iCalendar (RFC 5545) payload.

        Returns:
            The full path of the created resource.

        Raises:
            CalDAVError: If the server rejects the creation (e.g. 412 if an
                         event with the same UID already exists).
        """
        safe_uid = re.sub(r"[^a-zA-Z0-9._-]", "_", uid)
        resource_path = calendar_path.rstrip("/") + f"/{safe_uid}.ics"
        self.put(resource_path, ical_data, etag="*")
        return resource_path

    def update_event(
        self,
        event_href: str,
        ical_data: str,
        etag: str | None = None,
    ) -> str:
        """Update an existing calendar event resource via conditional PUT.

        Args:
            event_href: Full path or URL to the ``.ics`` resource.
            ical_data:  Updated iCalendar payload.
            etag:       Current ETag from a previous GET/REPORT (recommended to
                        detect concurrent modifications).

        Returns:
            New ETag returned by the server.

        Raises:
            CalDAVError: On HTTP errors (e.g. 412 if the ETag no longer matches).
        """
        return self.put(event_href, ical_data, etag=etag)

    def delete_event(self, event_href: str, etag: str | None = None) -> None:
        """Delete a calendar event resource via DELETE.

        Args:
            event_href: Full path or URL to the ``.ics`` resource.
            etag:       Optional ETag for conditional delete.

        Raises:
            CalDAVError: On HTTP errors.
        """
        self.delete(event_href, etag=etag)


# ── Parsing helpers ───────────────────────────────────────────────────────────

def _parse_event_multistatus(root: ET.Element) -> list[dict]:
    """Parse a ``d:multistatus`` XML root into a list of event dicts.

    Each ``d:response`` element that contains ``c:calendar-data`` is parsed
    via :func:`parse_ical_event`.

    Args:
        root: The parsed XML root element of a REPORT response.

    Returns:
        List of event dicts.  Each dict includes the parsed iCalendar fields
        plus ``href`` (resource path) and ``etag`` keys.
    """
    events: list[dict] = []
    for response in root.iter(_q(NS_DAV, "response")):
        href_el = response.find(_HREF)
        if href_el is None:
            continue
        href = (href_el.text or "").strip()

        etag_el = response.find(f".//{_GETETAG}")
        etag = (etag_el.text or "").strip().strip('"') if etag_el is not None else ""

        caldata_el = response.find(f".//{_CALDATA}")
        ical = (caldata_el.text or "").strip() if caldata_el is not None else ""
        if not ical:
            continue

        parsed = parse_ical_event(ical)
        parsed["href"] = href
        parsed["etag"] = etag
        parsed["ical"] = ical
        events.append(parsed)
    return events


def _ical_unescape(s: str) -> str:
    """Reverse RFC 5545 §3.3.11 text-value escaping.

    Processes the string character by character so that a literal ``\\n``
    (escaped backslash followed by the letter ``n``) is correctly preserved
    as backslash + ``n`` rather than being converted to a newline.
    """
    result: list[str] = []
    i = 0
    while i < len(s):
        if s[i] == "\\" and i + 1 < len(s):
            nxt = s[i + 1]
            if nxt in ("n", "N"):
                result.append("\n")
            elif nxt == ",":
                result.append(",")
            elif nxt == ";":
                result.append(";")
            elif nxt == "\\":
                result.append("\\")
            else:
                result.append("\\")
                result.append(nxt)
            i += 2
        else:
            result.append(s[i])
            i += 1
    return "".join(result)


def parse_ical_event(ical_data: str) -> dict:
    """Extract key fields from a VCALENDAR/VEVENT iCalendar string.

    Handles RFC 5545 line unfolding and property parameter parsing.  Only
    the *first* VEVENT component is parsed.

    Args:
        ical_data: Raw iCalendar text (any line-ending style).

    Returns:
        Dict with the following keys (all default to empty string / empty
        list if the property is absent):

        ``uid``, ``summary``, ``dtstart``, ``dtend``, ``duration``,
        ``location``, ``description``, ``organizer``, ``status``,
        ``sequence`` (int, default 0),
        ``attendees`` (list of dicts with keys ``email``, ``name``,
        ``partstat``, ``rsvp``).
    """
    # Unfold continuation lines: CRLF + SPACE/TAB → nothing (RFC 5545 §3.1)
    unfolded = re.sub(r"\r?\n[ \t]", "", ical_data)

    result: dict = {
        "uid":         "",
        "summary":     "",
        "dtstart":     "",
        "dtend":       "",
        "duration":    "",
        "location":    "",
        "description": "",
        "organizer":   "",
        "status":      "",
        "sequence":    0,
        "attendees":   [],
    }
    attendees: list[dict] = []
    in_vevent = False

    for raw_line in unfolded.splitlines():
        line = raw_line.rstrip("\r")
        if line == "BEGIN:VEVENT":
            in_vevent = True
            continue
        if line == "END:VEVENT":
            break  # stop after first VEVENT
        if not in_vevent or ":" not in line:
            continue

        # Split name (with optional parameters) from value
        name_part, _, value = line.partition(":")
        prop_name = name_part.split(";")[0].upper()

        # Parse parameters  name;KEY=VAL;KEY2="VAL2":value
        params: dict = {}
        for seg in name_part[len(prop_name):].lstrip(";").split(";"):
            if "=" in seg:
                k, _, v = seg.partition("=")
                params[k.upper()] = v.strip('"')

        value = _ical_unescape(value)

        if prop_name == "UID":
            result["uid"] = value
        elif prop_name == "SUMMARY":
            result["summary"] = value
        elif prop_name == "DTSTART":
            result["dtstart"] = value
        elif prop_name == "DTEND":
            result["dtend"] = value
        elif prop_name == "DURATION":
            result["duration"] = value
        elif prop_name == "LOCATION":
            result["location"] = value
        elif prop_name == "DESCRIPTION":
            result["description"] = value
        elif prop_name == "STATUS":
            result["status"] = value.lower()
        elif prop_name == "SEQUENCE":
            try:
                result["sequence"] = int(value)
            except ValueError:
                pass
        elif prop_name == "ORGANIZER":
            result["organizer"] = value.removeprefix("mailto:")
        elif prop_name == "ATTENDEE":
            attendees.append({
                "email":    value.removeprefix("mailto:"),
                "name":     params.get("CN", ""),
                "partstat": params.get("PARTSTAT", "NEEDS-ACTION"),
                "rsvp":     params.get("RSVP", "FALSE").upper() == "TRUE",
            })

    result["attendees"] = attendees
    return result


def update_ical_vevent(ical_data: str, **patches: str | None) -> str:
    """Patch specific properties inside a VCALENDAR string.

    Replaces or removes the specified iCalendar properties within the first
    VEVENT.  Properties not mentioned in *patches* are preserved verbatim.

    Args:
        ical_data: Original iCalendar string (any line-ending style).
        **patches: Property names (uppercase) mapped to new string values, or
                   ``None`` to remove that property entirely.
                   Example: ``SUMMARY="New Title", SEQUENCE="1"``.

    Returns:
        Updated iCalendar string using ``\\r\\n`` line endings (RFC 5545).
    """
    # Normalise to LF-only for processing; we'll convert back at the end
    text = re.sub(r"\r\n", "\n", ical_data)
    # Unfold so each logical property is on one line
    unfolded = re.sub(r"\n[ \t]", "", text)

    out_lines: list[str] = []
    in_vevent    = False
    handled_keys: set[str] = set()

    for line in unfolded.splitlines():
        if line == "BEGIN:VEVENT":
            in_vevent = True
            out_lines.append(line)
            continue

        if line == "END:VEVENT":
            in_vevent = False
            # Append any patches that weren't already encountered
            for prop, val in patches.items():
                if prop not in handled_keys and val is not None:
                    out_lines.append(f"{prop}:{val}")
            out_lines.append(line)
            continue

        if not in_vevent:
            out_lines.append(line)
            continue

        # Determine the property name of this line
        prop_name = line.split(";")[0].split(":")[0].upper()

        if prop_name in patches:
            handled_keys.add(prop_name)
            if patches[prop_name] is not None:
                # Replace entire line with patched value (no parameters kept)
                out_lines.append(f"{prop_name}:{patches[prop_name]}")
            # else: None means remove this property (skip line)
        else:
            out_lines.append(line)

    return "\r\n".join(out_lines)
