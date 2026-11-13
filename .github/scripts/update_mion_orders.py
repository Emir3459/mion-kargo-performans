#!/usr/bin/env python3
import json
import os
import urllib.request
from datetime import datetime, time, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

ISTANBUL = ZoneInfo("Europe/Istanbul")
API_URL = "https://koala.ms.pt360.app/api/shipments/query?page=0&size=20"
DATA_PATH = Path("data/orders.json")


def iso_z(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")


def target_dates():
    requested_many = os.environ.get("TARGET_DATES", "").strip()
    if requested_many:
        return [
            datetime.strptime(value.strip(), "%Y-%m-%d").date()
            for value in requested_many.split(",")
            if value.strip()
        ]
    requested = os.environ.get("TARGET_DATE", "").strip()
    if requested:
        return [datetime.strptime(requested, "%Y-%m-%d").date()]
    return [datetime.now(ISTANBUL).date() - timedelta(days=1)]


def find_total(value):
    if isinstance(value, dict):
        for key in ("totalElements", "total_elements", "total"):
            total = value.get(key)
            if isinstance(total, int) and total >= 0:
                return total
        for nested in value.values():
            total = find_total(nested)
            if total is not None:
                return total
    elif isinstance(value, list):
        for nested in value:
            total = find_total(nested)
            if total is not None:
                return total
    return None


def fetch_total(day):
    start_local = datetime.combine(day, time.min, ISTANBUL)
    end_local = start_local + timedelta(days=1) - timedelta(milliseconds=1)
    payload = {
        "clientIds": [68],
        "companyIds": [820],
        "storeIds": [10000000000000],
        "statuses": ["CREATED"],
        "startDate": iso_z(start_local),
        "endDate": iso_z(end_local),
    }
    request = urllib.request.Request(
        API_URL,
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json", "Accept": "application/json"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=45) as response:
        body = json.load(response)

    total = find_total(body)
    if body.get("successful") is False or total is None:
        top_level = sorted(body.keys()) if isinstance(body, dict) else [type(body).__name__]
        raise RuntimeError(f"Core MS error: status={body.get('status')}, messageKey={body.get('messageKey')}, developerMessage={body.get('developerMessage')}, reasons={body.get('reasons')}, keys={top_level}")
    return total


def update_file(day, total):
    payload = json.loads(DATA_PATH.read_text(encoding="utf-8"))
    date_text = day.isoformat()
    days = payload["days"]
    existing = next((item for item in days if item["date"] == date_text), None)

    if existing:
        if existing.get("status") == "closed" and total == 0:
            existing["orders"] = None
        else:
            existing["orders"] = total
            existing["status"] = "active" if total > 0 else "no_orders"
    else:
        last = datetime.strptime(payload["period_end"], "%Y-%m-%d").date()
        if day != last + timedelta(days=1):
            raise RuntimeError(f"Expected {last + timedelta(days=1)}, received {day}")
        days.append({
            "date": date_text,
            "orders": total,
            "status": "active" if total > 0 else "no_orders",
        })

    days.sort(key=lambda item: item["date"])
    payload["source"] = "migpack"
    payload["source_state"] = "connected"
    payload["updated_at"] = datetime.now(ISTANBUL).isoformat(timespec="seconds")
    payload["snapshot_date"] = datetime.now(ISTANBUL).date().isoformat()
    payload["period_end"] = days[-1]["date"]
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


def main():
    for day in target_dates():
        total = fetch_total(day)
        update_file(day, total)
        print(f"Updated {day.isoformat()} with {total} MION shipments")


if __name__ == "__main__":
    main()
