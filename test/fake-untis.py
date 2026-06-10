#!/usr/bin/env python3
"""
Fake WebUntis JSON-RPC server for local integration testing.
Usage:  py test/fake-untis.py
Listens on http://localhost:8889

To use with the app, also run a local CORS proxy that allows localhost:
  py test/local-proxy.py          (port 8890, passes through to any target)

Then in the wizard set:
  Server-URL  = http://localhost:8889
  Schule      = test-school
  Benutzer    = test
  Passwort    = test
And update WEBUNTIS_PROXY in src/config.js temporarily to http://localhost:8890.
"""

from http.server import HTTPServer, BaseHTTPRequestHandler
from datetime import date, timedelta
import json

PORT = 8889

FAKE_SESSION   = 'fake-session-deadbeef'
FAKE_PERSON_ID = 999
FAKE_PERSON_TYPE = 5  # student

SCHEDULE_DOW = {
    1: [  # Monday
        {'p': 1, 'su': 'MA',  'ro': 'R204',       'te': 'SCH', 'c': ''},
        {'p': 2, 'su': 'MA',  'ro': 'R204',       'te': 'SCH', 'c': ''},
        {'p': 3, 'su': 'DE',  'ro': 'R101',       'te': 'MUE', 'c': ''},
        {'p': 4, 'su': 'EN',  'ro': 'R202',       'te': 'WEB', 'c': ''},
        {'p': 5, 'su': 'GE',  'ro': 'R105',       'te': 'BRA', 'c': 'cancelled'},
        {'p': 6, 'su': 'SP',  'ro': 'Sporthalle', 'te': 'FIS', 'c': ''},
    ],
    2: [  # Tuesday
        {'p': 1, 'su': 'PH',  'ro': 'R310', 'te': 'KLE', 'c': ''},
        {'p': 2, 'su': 'BI',  'ro': 'R308', 'te': 'LAN', 'c': ''},
        {'p': 3, 'su': 'CH',  'ro': 'R307', 'te': 'WOL', 'c': 'irregular'},
        {'p': 4, 'su': 'INF', 'ro': 'R405', 'te': 'SCZ', 'c': ''},
        {'p': 5, 'su': 'INF', 'ro': 'R405', 'te': 'SCZ', 'c': ''},
        {'p': 6, 'su': 'PB',  'ro': 'R103', 'te': 'BRA', 'c': ''},
    ],
    3: [  # Wednesday
        {'p': 1, 'su': 'DE',  'ro': 'R101',      'te': 'MUE', 'c': ''},
        {'p': 2, 'su': 'MA',  'ro': 'R204',      'te': 'SCH', 'c': ''},
        {'p': 3, 'su': 'EN',  'ro': 'R202',      'te': 'WEB', 'c': ''},
        {'p': 4, 'su': 'EN',  'ro': 'R202',      'te': 'WEB', 'c': ''},
        {'p': 5, 'su': 'PB',  'ro': 'R103',      'te': 'BRA', 'c': ''},
        {'p': 6, 'su': 'MU',  'ro': 'Musikraum', 'te': 'MEY', 'c': ''},
    ],
    4: [  # Thursday
        {'p': 1, 'su': 'BI',  'ro': 'R308',       'te': 'LAN', 'c': ''},
        {'p': 2, 'su': 'CH',  'ro': 'R307',       'te': 'WOL', 'c': ''},
        {'p': 3, 'su': 'GE',  'ro': 'R105',       'te': 'BRA', 'c': ''},
        {'p': 4, 'su': 'SP',  'ro': 'Sporthalle', 'te': 'FIS', 'c': ''},
        {'p': 5, 'su': 'SP',  'ro': 'Sporthalle', 'te': 'FIS', 'c': ''},
        {'p': 6, 'su': 'MA',  'ro': 'R204',       'te': 'SCH', 'c': ''},
    ],
    5: [  # Friday
        {'p': 1, 'su': 'EN',  'ro': 'R202', 'te': 'WEB', 'c': ''},
        {'p': 2, 'su': 'PH',  'ro': 'R310', 'te': 'KLE', 'c': ''},
        {'p': 3, 'su': 'PH',  'ro': 'R310', 'te': 'KLE', 'c': ''},
        {'p': 4, 'su': 'INF', 'ro': 'R405', 'te': 'SCZ', 'c': ''},
        {'p': 5, 'su': 'PB',  'ro': 'R103', 'te': 'BRA', 'c': 'cancelled'},
    ],
}

PERIOD_TIMES = {
    1: (745, 830), 2: (830, 915), 3: (930, 1015),
    4: (1015, 1100), 5: (1115, 1200), 6: (1200, 1245),
    7: (1330, 1415), 8: (1415, 1500), 9: (1500, 1545),
}


def date_int(d):
    return d.year * 10000 + d.month * 100 + d.day


def from_date_int(i):
    return date(i // 10000, (i % 10000) // 100, i % 100)


def get_timetable(start_int, end_int):
    start = from_date_int(start_int)
    end   = from_date_int(end_int)
    periods = []
    cur = start
    while cur <= end:
        dow = cur.isoweekday()  # 1=Mon, 7=Sun
        for entry in SCHEDULE_DOW.get(dow, []):
            s, e = PERIOD_TIMES[entry['p']]
            periods.append({
                'date': date_int(cur),
                'startTime': s,
                'endTime': e,
                'lstype': 'ls',
                'code': entry['c'],
                'su': [{'name': entry['su']}],
                'ro': [{'name': entry['ro']}],
                'te': [{'name': entry['te']}],
            })
        cur += timedelta(days=1)
    return periods


class Handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self._cors()
        self.end_headers()

    def do_POST(self):
        length = int(self.headers.get('Content-Length', 0))
        body   = json.loads(self.rfile.read(length))
        method = body.get('method')
        params = body.get('params', {})
        req_id = body.get('id', 1)

        if method == 'authenticate':
            result = {
                'sessionId': FAKE_SESSION,
                'personId': FAKE_PERSON_ID,
                'personType': FAKE_PERSON_TYPE,
                'klasseId': 1,
            }
        elif method == 'getTimetable':
            result = get_timetable(params.get('startDate', 0), params.get('endDate', 0))
        elif method == 'logout':
            result = True
        else:
            result = None

        payload = json.dumps({'id': req_id, 'jsonrpc': '2.0', 'result': result}).encode()
        self.send_response(200)
        self._cors()
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def _cors(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type, Cookie, X-Untis-Session')

    def log_message(self, fmt, *args):
        print(f'[fake-untis] {fmt % args}')


if __name__ == '__main__':
    print(f'Fake WebUntis JSON-RPC auf http://localhost:{PORT}')
    print('  authenticate  →  gibt session zurück')
    print('  getTimetable  →  liefert Testdaten Mo–Fr')
    print('  logout        →  kein-op')
    HTTPServer(('localhost', PORT), Handler).serve_forever()
