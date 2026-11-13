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


def fetch_total(day):
    start_local = datetime.combine(day, time.min, ISTANBUL)
    end_local = start_local + timedelta(days=1) - timedelta(milliseconds=1)
    payload = {
        "clientIds": [68],
        "companyIds": [820],
        "storeIds": [10000000000000],
        "microhubIds": [0],
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

    data = body.get("data") or {}
    page = data.get("page") or {}
    total = page.get("totalElements", data.get("totalElements"))
    if body.get("successful") is False or not isinstance(total, int) or total < 0:
        raise RuntimeError("Core MS response did not contain a valid totalElements")
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
