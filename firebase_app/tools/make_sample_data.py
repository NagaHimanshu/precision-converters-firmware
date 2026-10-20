"""Generates public/data/sample.json and sample-data/*.csv from one definition.

Run: python tools/make_sample_data.py
The CSVs are for importing into the Google Sheet (File > Import > Upload).
"""
import csv
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

def maps(q):
    return "https://www.google.com/maps/search/?api=1&query=" + q.replace(" ", "+")

settings = [
    {"key": "bride", "value": "Ananya"},
    {"key": "groom", "value": "Rohan"},
    {"key": "wedding_date", "value": "2026-12-12"},
    {"key": "city", "value": "Hyderabad"},
    {"key": "tagline", "value": "Together with our families, we invite you to celebrate with us"},
    {"key": "announcement", "value": ""},
]

program = [
    {"date": "2026-12-10", "time": "10:00 AM", "event": "Pellikuthuru & haldi", "venue": "Lotus Garden", "note": "Wear yellow!"},
    {"date": "2026-12-10", "time": "1:00 PM", "event": "Lunch", "venue": "Lotus Garden", "note": ""},
    {"date": "2026-12-10", "time": "6:30 PM", "event": "Mehendi & music night", "venue": "Lotus Garden", "note": "Dance floor opens at 8"},
    {"date": "2026-12-11", "time": "11:00 AM", "event": "Welcome brunch", "venue": "Hotel Sapphire", "note": ""},
    {"date": "2026-12-11", "time": "7:00 PM", "event": "Sangeet", "venue": "Royal Convention Hall", "note": "Family performances from 8 PM"},
    {"date": "2026-12-12", "time": "6:00 AM", "event": "Baraat", "venue": "Royal Convention Hall", "note": "Gather at the main gate"},
    {"date": "2026-12-12", "time": "7:45 AM", "event": "Muhurtham", "venue": "Royal Convention Hall", "note": ""},
    {"date": "2026-12-12", "time": "12:30 PM", "event": "Wedding lunch", "venue": "Royal Convention Hall", "note": ""},
    {"date": "2026-12-12", "time": "7:30 PM", "event": "Reception", "venue": "Grand Ballroom", "note": "Dinner served from 8 PM"},
]

first = ["Ravi", "Lakshmi", "Suresh", "Padma", "Kiran", "Anjali", "Venkat", "Sita", "Arjun", "Meena",
         "Prakash", "Kavya", "Srinivas", "Radha", "Mahesh", "Divya", "Naresh", "Swathi", "Gopal", "Usha"]
last = ["Kumar", "Reddy", "Rao", "Sharma"]
hotels = ["Hotel Sapphire", "Green Park Residency"]
accommodation = []
for i in range(40):
    hotel = hotels[i % 2]
    accommodation.append({
        "sno": str(i + 1),
        "name": f"{first[i % 20]} {last[i // 10]}",
        "hotel": hotel,
        "room": str(101 + (i // 2) + (100 if i >= 20 else 0)),
        "note": "Check-in from 12 PM" if i % 7 == 0 else "",
    })

locations = [
    {"name": "Royal Convention Hall", "address": "Road No. 1, Banjara Hills", "map_link": maps("Royal Convention Hall Banjara Hills"), "note": "Parking at the back gate"},
    {"name": "Lotus Garden", "address": "Jubilee Hills", "map_link": maps("Lotus Garden Jubilee Hills"), "note": ""},
    {"name": "Grand Ballroom", "address": "Hitech City", "map_link": maps("Grand Ballroom Hitech City"), "note": ""},
    {"name": "Hotel Sapphire", "address": "Begumpet", "map_link": maps("Hotel Sapphire Begumpet"), "note": "Guest stay"},
]

contacts = [
    {"name": "Sample Coordinator 1", "role": "Rooms & check-in", "phone": "9000000001", "whatsapp": "yes"},
    {"name": "Sample Coordinator 2", "role": "Transport", "phone": "9000000002", "whatsapp": "yes"},
    {"name": "Sample Coordinator 3", "role": "Venue help", "phone": "+91 90000 00003", "whatsapp": "no"},
]

tabs = {
    "Settings": settings,
    "Program": program,
    "Accommodation": accommodation,
    "Locations": locations,
    "Contacts": contacts,
}

(ROOT / "public" / "data" / "sample.json").write_text(json.dumps(tabs, indent=2, ensure_ascii=False), encoding="utf-8")
for name, rows in tabs.items():
    with open(ROOT / "sample-data" / f"{name}.csv", "w", newline="", encoding="utf-8") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)
print("wrote sample.json and", len(tabs), "CSVs")
