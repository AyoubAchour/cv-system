# CV System (CV Parsing + Ranking)

A small web app that **parses CVs (PDF)** and **ranks candidates** against a role spec (skills, keywords, and estimated experience).

## What it does
- **Extracts text from PDFs** (`pdf-parse`) with **OCR fallback** (`tesseract.js`, `eng+fra`) for scanned/image-only CVs.
- **Normalizes messy PDF text** (NBSP, soft-hyphens, broken line breaks, control chars).
- **Estimates years of experience** from many real-world date formats (English/French, numeric, “present” tokens, full dates).
- **Matches skills/keywords** (with aliases) and produces an explainable score breakdown.
- **Extracts candidate contacts** (email, phone, LinkedIn, GitHub, portfolio) and filters out irrelevant company links.

## Privacy / data
- Put local CV PDFs under `cvs/` (example: `cvs/<roleId>/*.pdf`).
- `cvs/` and `.cv-cache/` are **gitignored** and **will not be committed**.

## Quick start
```bash
npm install
npm run dev
```

Open the app, choose a project + role, then run ranking.

## Configure roles & skills
Role specs live in `specs/` (example: `specs/voice2work.project.json`).
Update skills, aliases, keywords, and scoring weights there.

## Requirements / notes
- Node.js (recommended: current LTS)
- OCR uses local tessdata cached under `.cv-cache/`.


