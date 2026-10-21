# data/

The server keeps the health record here. Git ignores everything in this folder except this file.

| File | What it is |
|---|---|
| `health.json` | The whole record: profile, doctors, appointments, medications, diagnoses, tests and results, check-ins, questions, chats, imported documents, and every AI run. |
| `backups/health-YYYY-MM-DD.json` | A copy taken before the first change of each day. The newest 30 are kept. |
| `documents/FILE-n.*` | Uploaded files, as uploaded. |
| `documents/FILE-n.read.json` | The text code read from each upload, which the chat uses. |

Set `CLEARCARE_DATA_DIR` to keep the record somewhere else, such as an encrypted volume.
