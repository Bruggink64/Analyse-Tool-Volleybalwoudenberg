# VolleyScout — Analyse-Tool Volleybal Woudenberg

Interactieve volleybal video-scouting en AI-aanvalsanalyse voor YouTube-wedstrijdbeelden van **Volleybal Woudenberg** (zwart/geel tenue met 1 libero in geel/zwart). De applicatie analyseert automatisch aanvallen per positie/zone en uitkomst, houdt kill-blokken voor en tegen apart bij, en berekent live het scorepercentage en aanvalsrendement.

## Functies

- **Vaste teamherkenning**: Volgt altijd het team in **zwart/geel** (met libero in **geel/zwart**), ook na setwissels.
- **Volledige positie- & zoneherkenning**: Herkent expliciet **Pos 4 (Buiten)**, **Pos 3 (Midden)**, **Pos 2 (Diagonaal)**, **Pos 5 (Linksachter / Pipe)**, **Pos 6 (Pipe midden)** en **Pos 1 (Achterveld rechts)** inclusief genormaliseerde afzetcoördinaten (`takeoffX`, `takeoffY`) en 3-meterlijn-detectie.
- **Uitkomstverificatie met 5 signalen**: Kijkt na elke aanval door naar blokcontact, landingskant, juichend team, volgende opslag en het scorebord rechts in beeld:
  - `Direct punt` (inclusief blok-uit)
  - `Fout` (uitgeslagen ballen en netfouten)
  - `Kill-blok tegen` (aanval zwart/geel direct afgeblokt — punt tegen)
  - `Kill-blok mee` (eigen kill-blok van zwart/geel — punt voor, apart van aanvalsrendement)
  - `Verdedigd/doorgespeeld`
- **Debug-modus**: Toont per aanval de afzetcoördinaten, speelhelft, 3m-lijnstatus, 5 uitkomstsignalen en een kopieerbaar debug-logboek + posities op het velddiagram.
- **YouTube-speler met tijdlijn & slow-motion** (`0.25x` – `1.5x`, `-5s/-2s/+2s/+5s`) en gerichte **4 FPS hercheck** per aanval of in batch.
- **Export** naar Markdown-tabel en CSV.

---

## Eigen publieke URL (extern benaderbaar)

Omdat de app een Node.js-backend (`server.ts`) gebruikt om veilig met de Gemini API te communiceren, heb je twee snelle opties voor een externe URL:

### Optie A: Direct vanuit AI Studio (snelst — 1 klik)
1. Klik rechtsboven in AI Studio op **Deploy / Share app** (Cloud Run).
2. Koppel je Google Cloud-project en klik op **Deploy**.
3. Je krijgt direct een eigen publieke `https://....run.app` URL die iedereen extern kan openen (zonder AI Studio-login).

### Optie B: Deployen vanuit GitHub via Render (`render.yaml` staat klaar)
1. Push eerst je laatste wijzigingen vanuit AI Studio naar GitHub (`Bruggink64/Analyse-Tool-Volleybalwoudenberg`).
2. Maak een account op [render.com](https://render.com) en klik op **New → Blueprint**.
3. Koppel `Bruggink64/Analyse-Tool-Volleybalwoudenberg` — Render herkent `render.yaml` en de `Dockerfile` automatisch.
4. Vul bij **Environment Variables** jouw `GEMINI_API_KEY` in en klik op **Apply**.
5. Na ~2 minuten is je eigen publieke `https://....onrender.com` URL live.

### Optie C: Google Cloud Run of Railway vanuit GitHub
- **Google Cloud Run**: *Deploy container → Continuously deploy from a repository* → selecteer `Bruggink64/Analyse-Tool-Volleybalwoudenberg` (Dockerfile), stel `GEMINI_API_KEY` in en zet *Allow unauthenticated invocations* aan.
- **Railway**: *New Project → Deploy from GitHub Repo* → stel `GEMINI_API_KEY` in en genereer een publiek domein onder *Settings → Networking*.

---

## Lokaal draaien (ontwikkeling)

Vereist **Node.js 22+**.

```bash
npm install
cp .env.example .env
# Vul GEMINI_API_KEY in .env in
npm run dev
```

Open daarna `http://localhost:3000`.

### Productiebuild testen

```bash
npm run build
NODE_ENV=production npm start
```
