#!/usr/bin/env python3
"""Parse USPS Informed Delivery digest HTML to extract structured mailpiece data."""

import json
import os
import re
from pathlib import Path
from html.parser import HTMLParser


class MailpieceExtractor(HTMLParser):
    """Extract mailpiece info from USPS digest HTML body."""
    
    def __init__(self):
        super().__init__()
        self.mailpieces = []
        self.packages = []
        self._in_from = False
        self._current_from = ""
        self._capture_text = False
        self._text_buf = ""
        self._mail_count = None
        self._pkg_count = None
    
    def handle_data(self, data):
        text = data.strip()
        if not text:
            return
        
        # Look for mail count
        m = re.match(r"You have (\d+) mailpiece", text)
        if m:
            self._mail_count = int(m.group(1))
        
        # Look for package count
        m = re.match(r"You have (\d+) package", text)
        if m:
            self._pkg_count = int(m.group(1))
        
        # Capture FROM labels
        if text.startswith("FROM:"):
            self._current_from = text[5:].strip()
        elif self._in_from:
            self._current_from += " " + text


def parse_digest_html(html_path: str) -> dict:
    """
    Parse a USPS digest HTML file and extract:
    - Mail count
    - Package count  
    - FROM labels for each mailpiece
    - Image CID references
    - Tracking numbers
    """
    with open(html_path, "r", errors="replace") as f:
        html = f.read()
    
    result = {
        "mail_count": 0,
        "package_count": 0,
        "from_labels": [],
        "image_cids": [],
        "tracking_numbers": [],
        "has_no_image": False,
    }
    
    # Extract mail count
    m = re.search(r"You have (\d+) mailpiece", html)
    if m:
        result["mail_count"] = int(m.group(1))
    
    # Extract package count
    m = re.search(r"You have (\d+) package", html)
    if m:
        result["package_count"] = int(m.group(1))
    
    # Extract FROM labels
    from_matches = re.findall(r'(?:FROM|From):\s*([^<\n]+)', html)
    result["from_labels"] = [f.strip() for f in from_matches if f.strip()]
    
    # Extract CID image references (these are the inline mailpiece scans)
    cid_matches = re.findall(r'src="cid:([^"]+)"', html)
    result["image_cids"] = cid_matches
    
    # Extract tracking numbers (USPS format: 20-34 digits)
    tracking_matches = re.findall(r'\b((?:94|92|93|94)\d{18,30})\b', html)
    result["tracking_numbers"] = list(set(tracking_matches))
    
    # Check for "no image" placeholder text
    if "A scanned image of this mail piece" in html and "not available" in html:
        result["has_no_image"] = True
    
    return result


def parse_all_digests(base_dir: str) -> dict:
    """Parse all digest folders and return structured data keyed by date."""
    base = Path(base_dir)
    all_data = {}
    
    for date_dir in sorted(base.iterdir()):
        if not date_dir.is_dir() or not date_dir.name.startswith("20"):
            continue
        
        body_path = date_dir / "body.html"
        if not body_path.exists():
            continue
        
        parsed = parse_digest_html(str(body_path))
        
        # List actual image files
        images = sorted([
            f.name for f in date_dir.iterdir()
            if f.suffix == ".jpg" and not f.name.startswith("content-")
        ])
        
        parsed["date"] = date_dir.name
        parsed["images"] = images
        parsed["scan_images"] = [i for i in images if re.match(r'\d{10}-\d{3}\.jpg', i)]
        parsed["ad_images"] = [i for i in images if i.startswith("mailer-")]
        
        all_data[date_dir.name] = parsed
    
    return all_data


if __name__ == "__main__":
    import argparse
    
    parser = argparse.ArgumentParser(description="Parse USPS digest HTML files")
    parser.add_argument("input_dir", help="Directory containing date-based digest folders")
    parser.add_argument("--json", "-j", action="store_true", help="Output as JSON")
    args = parser.parse_args()
    
    data = parse_all_digests(args.input_dir)
    
    if args.json:
        print(json.dumps(data, indent=2))
    else:
        for date_str, info in sorted(data.items()):
            print(f"\n{date_str}:")
            print(f"  Mail pieces: {info['mail_count']}")
            print(f"  Packages: {info['package_count']}")
            print(f"  Scan images: {len(info['scan_images'])}")
            print(f"  Ad images: {len(info['ad_images'])}")
            if info['from_labels']:
                print(f"  FROM labels: {', '.join(info['from_labels'][:5])}")
            if info['tracking_numbers']:
                print(f"  Tracking: {', '.join(info['tracking_numbers'])}")
