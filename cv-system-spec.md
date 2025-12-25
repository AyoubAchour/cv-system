## CV System (Local + Offline) — Project Specification (v1)

### 1) What we are building
A local-only web app that ingests multiple CVs (PDF), analyzes them, and ranks candidates for a selected Project + Role using:
- Project/Role requirements (from JSON spec files)
- User settings (budget + contract length + weights)
- Candidate metadata entered in UI (salary expectation + contract preference/availability)

This is an independent project (NOT built inside Voice2Work). We include an initial project spec file for Voice2Work so the CV system can rank candidates for that project.

### 2) Hard constraints
- Local-only (runs on the same machine)
- Offline (no external APIs like OpenAI/Cohere; no outbound calls required to function)
- CV PDFs are mostly text; ignore embedded photos
- Typical batch size: ~30 PDFs
- Multiple projects and multiple roles; switchable

### 2.1) Recommended tech stack (MVP)
- **App type**: Local web app (runs on `localhost`) with server-side filesystem access
- **Runtime**: Node.js (LTS)
- **Frontend**: React + Next.js (App Router) + TypeScript
- **UI**: Tailwind CSS (component library optional)
- **Backend**: Next.js Route Handlers / server actions for:
  - PDF upload handling
  - Local folder scanning/import (server-only)
  - Parsing pipeline execution
  - Real-time progress streaming to UI (SSE or WebSocket)
- **Local storage**:
  - SQLite (candidate records, settings, score history)
  - Filesystem for PDFs + cached extracted text/features
- **PDF text extraction**: `pdf-parse` (or `pdfjs-dist`)
- **OCR fallback**: `tesseract.js` (only when text extraction is insufficient)
- **Matching helpers**: `fuse.js` for fuzzy matching + project `skillAliases`

### 3) Key user flows
- Load project specs from `specs/*.project.json`
- Select Project → select Role
- Add CVs:
  - Upload multiple PDFs
  - Import PDFs from a local folder inside the project directory (e.g. `data/cv-inbox/`)
- Parse CVs and show progress + errors
- Enter candidate metadata (UI):
  - Expected salary (monthly OR yearly)
  - Contract preference (months) and optional availability notes
- Adjust ranking settings (budget/contract length/weights) and see ranking update instantly
- Click a candidate to see:
  - Score breakdown
  - Matched skills + missing must-haves
  - Evidence snippets from the CV text
  - Candidate metadata fields (editable)

### 4) File/folder conventions (in the CV system project)
- `specs/`
  - `cv-system-spec.md` (this file)
  - `*.project.json` (project/role specs)
- `data/` (NOT committed to git)
  - `cv-inbox/` (user drops PDFs here for folder import)
  - `cv-original/` (stored PDFs, renamed by hash/id)
  - `cv-cache/` (parsed text + extracted features, JSON)

### 5) Project/Role spec format (JSON only)
Each `specs/<projectId>.project.json` must follow:

- Top-level:
  - `version`: number
  - `projectId`: string
  - `name`: string
  - `summary`: string
  - `domainKeywords`: string[]
  - `techStack`: object (arrays of strings)
  - `roles`: Role[]
  - `skillAliases`: map<string, string[]>

- Role:
  - `roleId`, `title`
  - `minYearsExperience` (number)
  - `mustHaveSkills`: { skill, weight }[]
  - `niceToHaveSkills`: { skill, weight }[]
  - `keywords`: string[]
  - `responsibilities`: string[]
  - `defaults`:
    - `salary`: { currency, period: "monthly"|"yearly", min, max }
    - `contractLengthMonths`: number
  - `scoring`:
    - `weights`: mustHaveSkills/niceToHaveSkills/experience/budget/contract (sum ≈ 1.0)
    - `hardFilters`: minMustHaveMatchRatio, requireAllMustHaveSkills (optional)

### 6) CV ingestion requirements
- Upload:
  - Multi-select PDFs
  - Validate type and size
- Folder import:
  - Read only within `data/cv-inbox/`
  - “Import” button (scan folder + import new files)
  - Deduplicate by file hash

### 7) Parsing requirements (offline)
Pipeline per CV:
1) Extract text from PDF (primary)
2) If extracted text is too short → OCR fallback (page images → OCR)
3) Normalize text (remove extra whitespace; keep line breaks for evidence)
4) Extract features:
   - Skill matches using role skill lists + aliases (fuzzy match allowed)
   - Keyword hits
   - Approximate years of experience (date-range heuristics, best-effort)

Notes:
- Photos are ignored.
- If parsing confidence is low, show warning and fall back to simple keyword scoring.

### 8) Candidate metadata (entered in UI)
Because resumes rarely contain salary/contract info reliably:
- `expectedSalary`:
  - `amount`
  - `period`: monthly|yearly
  - `currency`
- `contractPreferenceMonths` (optional)
- `availabilityNotes` (optional)
- These fields must be editable and immediately affect ranking.

### 9) Ranking model (MVP)
Output per candidate:
- `overallScore` (0–100)
- breakdown:
  - mustHaveSkillsScore (0–1)
  - niceToHaveSkillsScore (0–1)
  - experienceScore (0–1)
  - budgetScore (0–1)
  - contractScore (0–1)

Core scoring:
- Must-have skill match:
  - weighted ratio = (sum weights of matched must-haves) / (sum weights of all must-haves)
- Nice-to-have match:
  - same formula
- Experience:
  - min(1, candidateYears / minYearsExperience) (if unknown, 0.5)
- Budget:
  - if candidate expected salary missing → 0.5
  - else convert monthly↔yearly and score:
    - 1.0 if within range
    - penalty if above max (configurable)
- Contract:
  - if candidate contract preference missing → 0.5
  - else score based on closeness to required contract length

Final score:
- weighted sum using `role.scoring.weights`

Hard filters:
- If mustHaveMatchRatio < `minMustHaveMatchRatio`, mark candidate as “below threshold” (still visible but separated or deprioritized).

### 10) Explainability (required)
For each candidate:
- Matched must-have skills + evidence snippets (where found)
- Missing must-have skills list
- Keyword hits list + evidence snippets
- Score breakdown panel (numbers and weights)

### 11) Non-functional requirements
- Performance: handle 30 PDFs smoothly; cache parsing results
- Deterministic ranking: same inputs → same outputs
- Local privacy: no network calls required for ranking/parsing
- Safety:
  - Only read files within allowed local folders
  - Never use protected attributes (age/gender/nationality/photo) for ranking

### 12) MVP acceptance criteria
- Import 30 PDFs (upload or folder import)
- Select Voice2Work project + role and see ranked candidates
- Update:
  - budget (monthly/yearly)
  - contract length (months)
  - weights
  and ranking updates instantly
- Candidate details page shows why they ranked higher, with evidence snippets
- Candidate salary fields editable and affect budget scoring

### 13) Included initial project spec
This spec set includes `specs/voice2work.project.json` as a starting project/role definition for matching candidates to the Voice2Work project.


