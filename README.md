# 🛡️ Nirdosh Vault
### Verify Before You Apply.

**An AI-powered Consensus Identity Engine that catches document inconsistencies before they cause government application rejections.**

> India already has digital document infrastructure — DigiLocker, UMANG, India Stack. The missing layer is *intelligence*. Nirdosh Vault doesn't replace them; it adds a pre-submission verification layer that detects, explains, and helps resolve cross-document inconsistencies before a citizen ever faces rejection.

[![Live Demo](https://img.shields.io/badge/demo-live-brightgreen)](https://nirdosh-vault-seven.vercel.app/)
![Status](https://img.shields.io/badge/status-hackathon%20MVP-orange)
![Frontend](https://img.shields.io/badge/frontend-React%2019%20%7C%20TypeScript%20%7C%20Tailwind-blue)
![Backend](https://img.shields.io/badge/backend-Node.js%20%7C%20Express-green)
![AI](https://img.shields.io/badge/AI-Gemini%20multimodal-purple)
![License](https://img.shields.io/badge/license-unlicensed%20(student%20prototype)-lightgrey)

**🔗 Live Prototype:** [nirdosh-vault-seven.vercel.app](https://nirdosh-vault-seven.vercel.app/)

**📦 Repository:** [https://github.com/0504Siddhi/NirdoshVault_](https://github.com/0504Siddhi/NirdoshVault_)

**Submission for the Lenovo LEAP AI Hackathon 2026**
**Theme:** Digital Inclusion & Public Access | **Aligned with the IndiaAI Mission**


---

## Table of Contents

- [The Problem](#the-problem)
- [What Nirdosh Vault Does](#what-nirdosh-vault-does)
- [Core Innovation: The Consensus Identity Engine](#core-innovation-the-consensus-identity-engine)
- [Identity Resolution Confidence (IRC)](#identity-resolution-confidence-irc)
- [Correction Guidance Engine](#correction-guidance-engine)
- [Digital Inclusion & Accessibility](#digital-inclusion--accessibility)
- [System Architecture](#system-architecture)
- [Tech Stack](#tech-stack)
- [Results & Validation](#results--validation)
- [Why This Wins on the Judging Criteria](#why-this-wins-on-the-judging-criteria)
- [Social Impact & SDG Alignment](#social-impact--sdg-alignment)
- [What's Built vs. In Progress vs. Roadmap](#whats-built-vs-in-progress-vs-roadmap)
- [Privacy & Compliance](#privacy--compliance)
- [Getting Started](#getting-started)
- [Official References](#official-references)
- [Team](#team)

---

## The Problem

**Small document inconsistencies. Big consequences.**

Citizens applying for scholarships, welfare schemes, admissions, and public services routinely hold multiple *valid* identity documents that quietly disagree with each other — a name spelled "Sanjay Patil" on one document and "S.P. Patil" on another can silently block a scholarship, a PM-KISAN subsidy, or a college admission. These mismatches are usually invisible until a government authority flags them during formal verification — by which point the application is already delayed, defective, or rejected.

| Source | Finding |
|---|---|
| NITI Aayog, Frontier Tech Hub, Quarterly Insight (2025) | Erroneous or duplicate beneficiary records are estimated to inflate welfare outlays by **4–7% annually** through fiscal leakage. |
| UIDAI — PAN–Aadhaar Linking Guidance | Demographic mismatches (name, gender, DOB) between PAN and Aadhaar can prevent successful linking. |

**Our user research:** A family applying for their child's higher-education admission discovered their Birth Certificate and School Leaving Certificate listed different places of birth. The school redirected them to a Maha e-Seva centre, which couldn't correct the record directly — they were quoted ~₹500 for an affidavit just to *begin* the correction process. The admission stalled. **No existing platform proactively audits a citizen's own documents against each other before submission** — this is the gap Nirdosh Vault fills.

---

## What Nirdosh Vault Does

Nirdosh Vault does **not** decide which document is legally correct, and it does **not** replace any government authority. It:

1. **Detects** inconsistencies across a citizen's own uploaded documents
2. **Explains** them in plain language, backed by evidence
3. **Guides** the citizen toward the right correction path and issuing authority

The legal correction always remains with the issuing authority (UIDAI, Income Tax Dept, Registrar of Births, etc.). Nirdosh Vault solves the problem that happens *before* government verification — not government verification itself.

### How it compares

| Capability | DigiLocker | UMANG | India Stack | **Nirdosh Vault** |
|---|:---:|:---:|:---:|:---:|
| Stores/shares documents | ✅ | Via DigiLocker | Infrastructure only | Temporary processing only |
| Cross-document comparison | ❌ | ❌ | ❌ | ✅ |
| Detects name/DOB/address mismatches | ❌ | ❌ | ❌ | ✅ |
| Explains *why* verification may fail | ❌ | ❌ | ❌ | ✅ (plain-language) |
| Suggests corrective action | ❌ | ❌ | ❌ | ✅ |

Nirdosh Vault is purpose-built to be **complementary**: existing Digital Public Infrastructure remains the document and service layer; Nirdosh Vault is the pre-submission intelligence and consistency layer on top of it.

---

## Core Innovation: The Consensus Identity Engine

Most identity-verification approaches implicitly designate one document (often Aadhaar) as the master record and check everything else against it — an assumption that fails the moment that document itself contains an error.

**Nirdosh Vault instead compares every uploaded document against every other, field by field:**
- Where a **majority agree** → that becomes the consensus value; the minority is flagged as a likely outlier.
- Where there's **no clear majority** (e.g. a 2-vs-2 split) → the system doesn't guess. It reports the conflict and recommends manual verification.

```
✅ Consensus Established
Field: Name
Consensus Value: Sanjay Patil
Supporting (4): Aadhaar, PAN, Passport, School Leaving Certificate
Outlier: Birth Certificate → "Sanjay Paatil"
Confidence: High (4 of 5 documents agree)
```

```
⚠️ Conflicting Evidence — No Consensus Reached
Field: Date of Birth
Group A (2): Aadhaar, PAN — 12-05-2004
Group B (2): Passport, Birth Certificate — 13-05-2004
Confidence: Insufficient — no majority
Recommendation: Please verify original records with the relevant issuing authority.
```

Confidence is always a **category tied to a real agreement count** — never a fabricated percentage. A document reporting only a birth year against another reporting a full date is classified as an **incomplete-date conflict**, consistent with UIDAI's own declared/approximate DOB provisions — not silently treated as a mismatch or a match.

---

## Identity Resolution Confidence (IRC)

The Consensus Engine decides *what* the agreed identity is. **IRC decides *how much that agreement should be trusted*** — a deterministic, formula-driven score (**never LLM-generated**) that caps confidence when evidence is thin, even if the little evidence that exists agrees perfectly.

**Pipeline:** Document Evidence → Comparable Identity Fields → [Agreement Strength, Independent Corroboration, Extraction Reliability] → Field Resolution Score → Field Importance Weighting → Profile Coverage → Independent-Evidence Cap → **IRC (Score + Tier + Explanation)**

**Field Resolution Score (per field *i*):**

```
FRSᵢ = max(0, 0.53·Aᵢ + 0.35·Cᵢ + 0.12·Eᵢ − Pᵢ)
```
- **Aᵢ** — Agreement strength across documents
- **Cᵢ** — Independent corroboration (distinct document *types*, not repeated uploads — uploading the same Aadhaar 3× doesn't raise confidence)
- **Eᵢ** — Extraction reliability
- **Pᵢ** — Severity penalty for detected inconsistency

**Independent-evidence cap** — more evidence never *automatically* means more truth, but thin evidence should never produce an artificially high score:

| Independent Document Types | Max Confidence (Cap) |
|:---:|:---:|
| 1 | 45% |
| 2 | 70% |
| 3 | 82% |
| 4 | 91% |
| 5 | 95% |
| 6 | 98% |

**Field importance weights:** Full Name 30% · Date of Birth 30% · Parent/Guardian Name 15% · Address 15% · Gender 10%. A missing field reduces *Profile Coverage* rather than being silently treated as a conflict.

Every score is decomposed into **four inspectable pillars**: Agreement, Independent Corroboration, Coverage, Extraction Reliability — shown directly in the live product, never as a bare number.

---

## Correction Guidance Engine

When an outlier is flagged, Nirdosh Vault generates evidence-backed, **advisory** correction guidance — never a definitive legal instruction:

- Evidence summary from the Consensus Engine
- Correction-path recommendation using hedged language
- A draft declaration, generated only where our verified rule base confirms that's the actual required path
- Supporting-documents checklist and recommended authority (UIDAI Seva Kendra, municipal registrar, CSC, etc.)
- Every output carries: *"Draft for review — verify with the relevant authority before notarization or submission."*

Rules are retrieved via **Qdrant (RAG)** for citations only — **never for the match decision itself** — and each rule record is sourced with title, issuing authority, official URL/section, and last-verified date.

---

## Digital Inclusion & Accessibility
Designed explicitly for the Lenovo LEAP Hackathon's Digital Inclusion theme, the platform is built for older adults and citizens with disabilities:
*   **Regional Language Support (i18n):** Native language switcher to navigate the interface in regional dialects.
*   **Text-to-Speech (TTS):** Auditory guidance for users with visual impairments or literacy barriers.
*   **Dynamic Font Scaling:** Adjustable UI text sizes for older adults.

---

## System Architecture

```
Document Upload
      │
      ▼
OpenCV Quality Gate (blur, brightness, orientation)
      │
      ▼
Gemini Multimodal Extraction → JSON Schema Validation
      │
      ▼
Deterministic Normalization (dates, names, addresses)
      │
      ▼
Pairwise Consensus Engine (majority vote per field)
      │
   ┌──┴──────────────┐
   ▼                  ▼
Consensus Reached   No Consensus
   │                  │
   ▼                  ▼
Outlier Flagged     "Conflicting evidence —
                      manual verification required"
      │
      ▼
Correction Guidance Engine (rule lookup +  citation retrieval)
      │
      ▼
Gemini Explanation Layer (plain-language output)
      │
      ▼
Correction Kit (evidence + hedged guidance + disclaimer)
```

**Why deterministic, not black-box?** We evaluated fuzzy string matching (fails on structurally different but semantically identical text) and semantic embeddings like SBERT (researched, but not adopted for the live match decision). The final match/mismatch call stays deterministic and rule-based — a smaller, fully-explainable engine over a larger opaque model, by deliberate choice, for an auditable, high-stakes identity context.

---

## Tech Stack

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS |
| Backend | Node.js, TypeScript, Express.js |
| Document Extraction | Gemini multimodal (extraction + plain-language explanation) |
| Input Quality Gate | OpenCV — blur, brightness, resolution, orientation checks |
| Output Validation | Zod / Pydantic + JSON Schema |
| Field Matching | Deterministic rule engine — not black-box ML |
| Rule Storage | Structured, versioned rule database (separate from retrieval layer) |
| Guidance Retrieval | Rule-based engine (Qdrant RAG integration in Roadmap) |
| Database | MongoDB |
| Nearby Assistance | Browser Geolocation API + Google Places API, Haversine distance sort, Google Maps deep link |
| Authentication & Security | JWT, bcrypt, Helmet, CORS, environment-based secrets |
| Deployment | Vercel (frontend), Render (backend) |

---

## Results & Validation

All results below are from **live runs on the deployed application** — not mockups.

> A weaker system would hide a 68/100 result. Nirdosh Vault surfaces it: the run below correctly returned **"Needs Review"** because the evidence contained an unresolved conflict — that's the intended behavior, not a shortfall.

**Live consensus run:** 68/100 ("Needs Review") — Agreement 88% · Independent Evidence 82% · Coverage 80% · Extraction Reliability 97%.

### Controlled Behavioural Validation (A–F)

Six controlled test cases verified that the system forms consensus only when evidence supports it, and exposes uncertainty rather than guessing:

| Test | Condition | System Behaviour | Evidence |
|---|---|---|---|
| A | 3 doc types, strong agreement, partial corroboration | Consensus formed, confidence capped below max | IRC 72/100 |
| B | 3 doc types, deliberate 1-year DOB conflict | Conflict isolated to DOB only | IRC 46/100 · DOB FRS 51 · Name FRS 97 |
| C | English/Hindi spelling variation | Flagged for review, not silently resolved | "Expected Variation / Review" |
| D | 4 documents, no strict majority | Refused to pick an arbitrary winner | "No Consensus" |
| E | 2 documents, contradictory addresses (Pune/Nashik) | Conflict isolated, correction target withheld | FRS 13/100 · No Consensus |
| F | Blurred/unreadable document | Intercepted before entering the pipeline | "Failed — poor quality" |

**Key findings:** conflict isolation (a DOB error doesn't drag down unrelated fields), refusal to guess under ambiguity, evidence-aware confidence (100% agreement ≠ 100/100 score when corroboration is thin), and pre-extraction quality protection.

---

## Why This Wins on the Judging Criteria

| Criterion | How Nirdosh Vault delivers |
|---|---|
| **Innovation & Creativity** | Consensus-based identity resolution — no single "trusted" document — is a genuine departure from standard verification approaches, backed by a from-scratch deterministic scoring methodology (IRC), not a wrapped LLM call. |
| **Technical Excellence** | Explicit rejection of easier approaches (exact/fuzzy matching, LLM-only judgment) with documented failure modes; deterministic, auditable scoring formula; quality-gated ingestion; RAG used only for citations, never decisions. |
| **Real-World Impact** | Grounded in a real user-research case (a stalled college admission) and a documented national-scale problem (4–7% welfare leakage, NITI Aayog). |
| **Scalability** | Rule-engine architecture extends to new document types and user segments (Students, Farmers today → Passport/PAN/other categories "Coming Soon") without re-architecting the consensus core. |
| **User Experience** | Plain-language explanations, a Visual Identity Evidence Graph, and a Correction Kit — not a raw confidence number — with every score decomposed into four inspectable pillars. |
| **Presentation Quality** | Working live deployment, real (not staged) screenshots, and a validation section that reports honest results, including a "Needs Review" run, rather than only best-case demos. |

---

## Social Impact & SDG Alignment

| SDG | Relevance |
|---|---|
| **SDG 4 — Quality Education** | Reduces document-related delays/rejections in scholarship and admission applications. |
| **SDG 10 — Reduced Inequalities** | Citizens without legal/administrative support or spare funds for affidavits are disproportionately harmed; a free pre-check narrows this gap. |
| **SDG 16 — Peace, Justice & Strong Institutions** | Improves transparency of citizen interaction with public verification systems, reducing avoidable institutional load. |

**Who benefits (MVP focus):** Students (NSP/MahaDBT scholarships, admissions) and Farmers (PM-KISAN and related schemes). Other segments (Passport, PAN, Aadhaar updates) are scoped as "Coming Soon," expandable via the same rule-engine architecture. CSC/Maha e-Seva operators can also use Nirdosh Vault as a pre-check step before assisting a citizen's formal submission.

---

## What's Built vs. In Progress vs. Roadmap

**✅ Implemented**
- Document upload & extraction (working end-to-end on live deployment)
- Field normalization & deterministic comparison
- Pairwise consensus & outlier detection (verified on real multi-document runs)
- Qualitative, agreement-ratio-based confidence labels
- Correction Kit interface with deterministic, rule-based guidance
- Nearby assistance-centre discovery (Geolocation + Places API)
- **Digital Inclusion Suite:** Regional language switcher (i18n), Text-to-Speech (TTS), and Font Scaling.
- **"Try Sample Documents" Feature:** 1-click synthetic document testing for safe evaluation without uploading real PII.


**🔧 Integration in Progress**
- Broader document-type coverage for live Gemini multimodal extraction
- OpenCV quality-gate hardening
- RAG citation retrieval extended to PAN, Birth Certificate, and other document types
- Automatic temporary-file deletion (privacy-by-design cleanup flow)

**🗺️ Roadmap**
- Live DigiLocker API integration
- CSC-operator interface
- Expanded document/rule coverage
- Full Bhashini multilingual support
- Government API integration, institutional verification dashboard
- Multi-state DPI ecosystem deployment
- **Qdrant Vector DB Integration:** Transitioning the Correction Engine to a fully dynamic RAG architecture for live UIDAI/government rule citations.

---

## Privacy & Compliance

The intended production design processes documents temporarily and deletes them after verification, with explicit granular consent, purpose limitation, and data minimization — designed in accordance with the core principles of the **Digital Personal Data Protection (DPDP) Act, 2023**. This is a student prototype and **has not undergone formal legal compliance certification**.

> ⚠️ **Privacy Notice:** This is a hackathon prototype. Please use the built-in "Try Sample Documents" feature or upload redacted documents instead of real sensitive personal documents.

AI assists with document understanding and field extraction only. **The final Identity Resolution Confidence score is produced entirely by the deterministic scoring engine — never by an LLM.** The score measures cross-document consistency only; it does not establish document authenticity, legal correctness, ownership, or government approval of any kind.

---

## Getting Started

### Prerequisites
- Node.js (LTS recommended)
- npm
- MongoDB
- Google Gemini API access
- Google Places API key (for nearby-centre discovery)

```bash
git clone [https://github.com/0504Siddhi/NirdoshVault_.git](https://github.com/0504Siddhi/NirdoshVault_.git)
cd NirdoshVault_
npm install
```

### Environment Variables

```env
GEMINI_MODEL=gemini-<model-version>
GEMINI_API_KEY=your_key_here
QDRANT_URL=your_qdrant_instance
MONGODB_URI=your_mongodb_connection
GOOGLE_PLACES_KEY=your_server_side_key
JWT_SECRET=your_jwt_secret
```

> Never commit `.env` or real API keys to the repository.

### Repository Structure

```
nirdosh-vaultapp/
├── api/     # Node.js / TypeScript / Express backend
├── ui/      # React 19 / TypeScript frontend
├── How to Setup.md
├── SETUP_GUIDE.md
└── README.md
```

See `How to Setup.md` and `SETUP_GUIDE.md` in the repo root for full local setup steps.

---

## Official References

- UIDAI official guidance and FAQs — uidai.gov.in
- UIDAI Exception Handling SOP (28 Oct 2021)
- PAN Form 49A instructions — Protean (NSDL) / Income Tax Department
- Registration of Births and Deaths Act, 1969 (Sections 13, 14, 15) + 2023 Amendment
- NITI Aayog Frontier Tech Hub, Quarterly Insight (fiscal-leakage estimate)
- DBT Bharat portal — dbtbharat.gov.in

---

## Team

**Team Nexovate**
---

*Nirdosh Vault is a hackathon MVP under active development. It does not determine document authenticity, legal correctness, or scheme eligibility — it verifies cross-document consistency and always defers final authority to the relevant government issuing body.*
