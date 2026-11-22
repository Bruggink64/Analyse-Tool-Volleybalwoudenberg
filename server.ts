import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { timingSafeEqual } from 'node:crypto';
import { GoogleGenAI, MediaResolution, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = process.env.GEMINI_MODEL || 'gemini-4-hydrogen';
const FAST_MODEL_NAME = process.env.GEMINI_FAST_MODEL || 'gemini-3.1-flash-lite';

// Optionele toegangscode: als APP_ACCESS_CODE is gezet, mogen alleen mensen met deze code
// de (betaalde) Gemini-analyse starten. Zonder code kan iedereen met de publieke URL je quotum opmaken.
const ACCESS_CODE = (process.env.APP_ACCESS_CODE || '').trim();

// Eenvoudige limiet per IP-adres tegen misbruik of per ongeluk eindeloos herhalen.
const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT_MAX = Number(process.env.RATE_LIMIT_MAX || 60);

const ALWAYS_TARGET_TEAM =
  'UITSLUITEND het team dat speelt in een zwart/geel tenue (zwarte shirts/broekjes met gele accenten) met 1 libero in het omgekeerde geel/zwarte tenue (geel shirt met zwarte accenten). Volg ALTIJD ditzelfde zwart/gele team, ook als teams na een setwissel van speelhelft wisselen!';

const VALID_ZONES = [
  'Buiten (Pos 4)',
  'Midden (Pos 3)',
  'Diagonaal (Pos 2)',
  'Achterveld links / Pipe (Pos 5)',
  'Pipe midden (Pos 6)',
  'Achterveld rechts (Pos 1)',
  'Overig / 2e bal',
] as const;

type ValidZone = (typeof VALID_ZONES)[number];

const VALID_OUTCOMES = [
  'Direct punt',
  'Fout',
  'Geblokt',
  'Kill-blok mee',
  'Verdedigd/doorgespeeld',
] as const;

function getAiClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey || apiKey === 'MY_GEMINI_API_KEY') {
    throw new Error('GEMINI_API_KEY_MISSING');
  }
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      timeout: 180_000,
      headers: {
        'User-Agent': 'aistudio-build',
      },
    },
  });
}

function validateYouTubeUrl(rawUrl: unknown): string | null {
  if (typeof rawUrl !== 'string') return null;
  try {
    const parsed = new URL(rawUrl.trim());
    let videoId: string | null = null;
    if (parsed.hostname === 'youtu.be') {
      const candidate = parsed.pathname.replace('/', '').trim();
      if (/^[a-zA-Z0-9_-]{11}$/.test(candidate)) videoId = candidate;
    } else if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com' ||
      parsed.hostname === 'm.youtube.com'
    ) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) {
        videoId = v;
      } else {
        const match = parsed.pathname.match(/\/(embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
        if (match) videoId = match[2];
      }
    }
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  }
}

function formatMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

function parseMMSS(raw: unknown): number | null {
  if (typeof raw !== 'string') return null;
  const parts = raw.trim().split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) return parts[0] * 60 + parts[1];
  if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
  return null;
}

function normalizeZone(raw: unknown): ValidZone {
  const s = String(raw || '').toLowerCase();
  if (s.includes('pos 5') || s.includes('positie 5') || s.includes('linksachter') || s.includes('5 (pipe)')) {
    return 'Achterveld links / Pipe (Pos 5)';
  }
  if (s.includes('pos 1') || s.includes('positie 1') || s.includes('rechtsachter')) {
    return 'Achterveld rechts (Pos 1)';
  }
  if (s.includes('pipe') || s.includes('pos 6') || s.includes('positie 6') || s.includes('middenachter')) {
    return 'Pipe midden (Pos 6)';
  }
  if (s.includes('diagonaal') || s.includes('pos 2') || s.includes('positie 2') || s.includes('rechtsvoor') || s.includes('rechts')) {
    return 'Diagonaal (Pos 2)';
  }
  if (s.includes('midden') || s.includes('pos 3') || s.includes('positie 3') || s.includes('mid')) {
    return 'Midden (Pos 3)';
  }
  if (s.includes('buiten') || s.includes('pos 4') || s.includes('positie 4') || s.includes('linksvoor') || s.includes('links')) {
    return 'Buiten (Pos 4)';
  }
  if (s.includes('achterveld')) {
    return 'Achterveld rechts (Pos 1)';
  }
  return 'Overig / 2e bal';
}

function clampUnit(value: unknown, fallback: number): number {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.round(Math.max(0, Math.min(1, n)) * 100) / 100;
}

/**
 * Resolves the final volleyball attack zone by cross-checking the model's text label
 * against the detected normalized takeoff coordinates (takeoffX, takeoffY, behindThreeMeterLine).
 * Especially prevents Pos 2 (right front), Pos 1 (right back), and Pos 5 (left-back / pipe)
 * from being mislabeled as Pos 4 or Pos 3.
 */
function resolveZoneWithCoordinates(input: {
  rawZoneLabel: string;
  takeoffX: number;
  takeoffY: number;
  behindThreeMeterLine: boolean;
}): { zone: ValidZone; resolvedBy: 'model' | 'coordinaten-correctie' } {
  const modelZone = normalizeZone(input.rawZoneLabel);

  // Respect explicit 2nd-ball / setter dumps when labeled as Overig / 2e bal
  if (modelZone === 'Overig / 2e bal' && input.rawZoneLabel.toLowerCase().includes('2e')) {
    return { zone: modelZone, resolvedBy: 'model' };
  }

  const isBackRow = input.behindThreeMeterLine || input.takeoffY >= 0.37;
  let coordZone: ValidZone;
  if (isBackRow) {
    if (input.takeoffX <= 0.38) {
      coordZone = 'Achterveld links / Pipe (Pos 5)';
    } else if (input.takeoffX >= 0.62) {
      coordZone = 'Achterveld rechts (Pos 1)';
    } else {
      coordZone = 'Pipe midden (Pos 6)';
    }
  } else {
    if (input.takeoffX <= 0.36) {
      coordZone = 'Buiten (Pos 4)';
    } else if (input.takeoffX >= 0.64) {
      coordZone = 'Diagonaal (Pos 2)';
    } else {
      coordZone = 'Midden (Pos 3)';
    }
  }

  // Correct obvious contradictions (e.g. back-row takeoff labeled as front-row, or right-side takeoff labeled as left-side)
  const frontRowZones: ValidZone[] = ['Buiten (Pos 4)', 'Midden (Pos 3)', 'Diagonaal (Pos 2)'];
  const backRowZones: ValidZone[] = [
    'Achterveld links / Pipe (Pos 5)',
    'Pipe midden (Pos 6)',
    'Achterveld rechts (Pos 1)',
  ];

  const rowMismatch =
    (isBackRow && frontRowZones.includes(modelZone)) ||
    (!isBackRow && input.takeoffY <= 0.30 && backRowZones.includes(modelZone));

  const sideMismatch =
    (input.takeoffX >= 0.68 && modelZone === 'Buiten (Pos 4)') ||
    (input.takeoffX <= 0.32 && modelZone === 'Diagonaal (Pos 2)') ||
    (isBackRow && input.takeoffX <= 0.34 && modelZone === 'Achterveld rechts (Pos 1)') ||
    (isBackRow && input.takeoffX >= 0.66 && modelZone === 'Achterveld links / Pipe (Pos 5)');

  if (rowMismatch || sideMismatch) {
    return { zone: coordZone, resolvedBy: 'coordinaten-correctie' };
  }

  return { zone: modelZone, resolvedBy: 'model' };
}

function normalizeOutcome(raw: unknown): (typeof VALID_OUTCOMES)[number] {
  const s = String(raw || '').toLowerCase();
  if (
    s.includes('kill-blok mee') ||
    s.includes('kill blok mee') ||
    s.includes('blok mee') ||
    s.includes('eigen blok') ||
    (s.includes('blok') && s.includes('punt voor'))
  ) {
    return 'Kill-blok mee';
  }
  if (s.includes('direct') || s.includes('punt voor') || s.includes('score') || s.includes('kill') && !s.includes('blok')) {
    return 'Direct punt';
  }
  if (s.includes('geblokt') || s.includes('blok') || s.includes('block')) {
    return 'Geblokt';
  }
  if (s.includes('fout') || s.includes('out') || s.includes('uit') || s.includes('net') || s.includes('error')) {
    return 'Fout';
  }
  return 'Verdedigd/doorgespeeld';
}

type BlockContactType =
  | 'geen-blok'
  | 'kill-blok-tegen'
  | 'kill-blok-mee-zwart-geel'
  | 'blok-touch-uit-voor-zwart-geel'
  | 'blok-verdedigd'
  | 'onduidelijk';

type TeamSignal = 'zwart-geel' | 'tegenstander' | 'rally-door' | 'onduidelijk';
type ScoreboardCue = 'zwart-geel-omhoog' | 'tegenstander-omhoog' | 'niet-leesbaar';

function normalizePointWinner(raw: unknown): TeamSignal {
  const s = String(raw || '').toLowerCase();
  if (s.includes('tegenstander') || s.includes('opponent') || s.includes('verloren')) {
    return 'tegenstander';
  }
  if (s.includes('zwart') || s.includes('geel') || s.includes('woudenberg') || s.includes('eigen')) {
    return 'zwart-geel';
  }
  if (s.includes('rally') || s.includes('door')) {
    return 'rally-door';
  }
  return 'onduidelijk';
}

function normalizeScoreboardCue(raw: unknown): ScoreboardCue {
  const s = String(raw || '').toLowerCase();
  if (s.includes('tegenstander')) return 'tegenstander-omhoog';
  if (s.includes('zwart') || s.includes('geel') || s.includes('woudenberg')) return 'zwart-geel-omhoog';
  return 'niet-leesbaar';
}

function normalizeCelebratingTeam(
  raw: unknown
): 'zwart-geel' | 'tegenstander' | 'geen-rally-door' | 'onduidelijk' {
  const s = String(raw || '').toLowerCase();
  if (s.includes('tegenstander') || s.includes('opponent')) return 'tegenstander';
  if (s.includes('zwart') || s.includes('geel') || s.includes('woudenberg')) return 'zwart-geel';
  if (s.includes('rally') || s.includes('geen')) return 'geen-rally-door';
  return 'onduidelijk';
}

function normalizeNextServerTeam(
  raw: unknown
): 'zwart-geel' | 'tegenstander' | 'rally-door' | 'niet-zichtbaar' {
  const s = String(raw || '').toLowerCase();
  if (s.includes('tegenstander') || s.includes('opponent')) return 'tegenstander';
  if (s.includes('zwart') || s.includes('geel') || s.includes('woudenberg')) return 'zwart-geel';
  if (s.includes('rally') || s.includes('door')) return 'rally-door';
  return 'niet-zichtbaar';
}

function normalizeBlockContact(raw: unknown): BlockContactType {
  const s = String(raw || '').toLowerCase();
  if (s.includes('mee') || s.includes('eigen-blok') || s.includes('zwart-geel-blok')) {
    return 'kill-blok-mee-zwart-geel';
  }
  if (s.includes('kill') || s.includes('tegen') || s.includes('terug')) {
    return 'kill-blok-tegen';
  }
  if (s.includes('touch') || s.includes('uit-voor') || s.includes('blok-uit')) {
    return 'blok-touch-uit-voor-zwart-geel';
  }
  if (s.includes('verdedig')) {
    return 'blok-verdedigd';
  }
  if (s.includes('geen')) {
    return 'geen-blok';
  }
  return 'onduidelijk';
}

/**
 * Strictly reconciles the model's outcome against 5 independent post-rally cues:
 * 1. blockContact (kill-blok tegen, eigen kill-blok mee, blok-uit touché, or no block)
 * 2. ballLandingSide (own floor vs opponent floor vs out/net vs rally continues)
 * 3. celebratingTeam (which kit color huddles/celebrates right after the whistle)
 * 4. nextServerTeam (in volleyball, the team that won the point ALWAYS serves next)
 * 5. scoreboardCue (optional check of the small scoreboard on the right side of the frame)
 */
function reconcileOutcome(input: {
  rawOutcome: unknown;
  rawConfidence: unknown;
  blockContact: BlockContactType;
  ballLandingSide: string;
  celebratingTeam: 'zwart-geel' | 'tegenstander' | 'geen-rally-door' | 'onduidelijk';
  nextServerTeam: 'zwart-geel' | 'tegenstander' | 'rally-door' | 'niet-zichtbaar';
  scoreboardCue: ScoreboardCue;
  pointWinner: TeamSignal;
  note: string;
}): {
  outcome: (typeof VALID_OUTCOMES)[number];
  confidence: 'Zeker' | 'Onzeker';
  note: string;
  pointWinner: TeamSignal;
  outcomeResolvedBy: 'model' | 'uitkomst-correctie';
} {
  const modelOutcome = normalizeOutcome(input.rawOutcome);
  let confidence: 'Zeker' | 'Onzeker' = String(input.rawConfidence || '')
    .toLowerCase()
    .includes('onzeker')
    ? 'Onzeker'
    : 'Zeker';
  let note = input.note.trim();
  const landing = input.ballLandingSide.toLowerCase();
  const noteLower = note.toLowerCase();

  const bouncedOwnFloor =
    landing.includes('eigen') || landing.includes('zwart-geel') || landing.includes('terug');
  const outOrNet = landing.includes('uit') || landing.includes('net');
  const rallyContinued =
    landing.includes('rally') ||
    input.celebratingTeam === 'geen-rally-door' ||
    input.nextServerTeam === 'rally-door';

  const opponentWonSignals =
    (input.nextServerTeam === 'tegenstander' ? 2 : 0) +
    (input.celebratingTeam === 'tegenstander' ? 2 : 0) +
    (input.scoreboardCue === 'tegenstander-omhoog' ? 2 : 0) +
    (input.pointWinner === 'tegenstander' ? 1 : 0) +
    (input.blockContact === 'kill-blok-tegen' ? 2 : 0) +
    (bouncedOwnFloor ? 2 : 0);

  const woudenbergWonSignals =
    (input.nextServerTeam === 'zwart-geel' ? 2 : 0) +
    (input.celebratingTeam === 'zwart-geel' ? 2 : 0) +
    (input.scoreboardCue === 'zwart-geel-omhoog' ? 2 : 0) +
    (input.pointWinner === 'zwart-geel' ? 1 : 0) +
    (input.blockContact === 'blok-touch-uit-voor-zwart-geel' ? 1 : 0) +
    (input.blockContact === 'kill-blok-mee-zwart-geel' ? 2 : 0) +
    (landing.includes('tegenstander') ? 1 : 0);

  const hasWoudenbergWinProof =
    input.celebratingTeam === 'zwart-geel' ||
    input.nextServerTeam === 'zwart-geel' ||
    input.scoreboardCue === 'zwart-geel-omhoog';

  // Case 1: Rally clearly continued
  if (rallyContinued && opponentWonSignals === 0 && input.celebratingTeam !== 'zwart-geel') {
    const corrected = modelOutcome !== 'Verdedigd/doorgespeeld';
    return {
      outcome: 'Verdedigd/doorgespeeld',
      confidence,
      note,
      pointWinner: 'rally-door',
      outcomeResolvedBy: corrected ? 'uitkomst-correctie' : 'model',
    };
  }

  // Case 2: Strong evidence that opponent won the point -> NEVER Direct punt or Kill-blok mee!
  const clearOpponentPoint =
    input.nextServerTeam === 'tegenstander' ||
    input.celebratingTeam === 'tegenstander' ||
    input.scoreboardCue === 'tegenstander-omhoog' ||
    input.blockContact === 'kill-blok-tegen' ||
    bouncedOwnFloor ||
    (input.pointWinner === 'tegenstander' && woudenbergWonSignals < 2);

  if (clearOpponentPoint) {
    const conflictingServe =
      input.nextServerTeam === 'zwart-geel' &&
      (input.celebratingTeam === 'tegenstander' ||
        input.scoreboardCue === 'tegenstander-omhoog' ||
        input.blockContact === 'kill-blok-tegen');

    if (conflictingServe) {
      confidence = 'Onzeker';
      if (!noteLower.includes('tegenstrijdig') && !noteLower.includes('check')) {
        note = `${note ? `${note} · ` : ''}Tegenstrijdige signalen (juichen/scorebord/blok vs. volgende opslag) — check 4 FPS`;
      }
      return {
        outcome: modelOutcome,
        confidence,
        note,
        pointWinner: 'onduidelijk',
        outcomeResolvedBy: 'model',
      };
    }

    // Let op: een notitie als "geen blok" of "uit zonder blok" mag GEEN kill-blok tegen opleveren.
    const noteMentionsBlock =
      (noteLower.includes('blok') || noteLower.includes('block')) &&
      !/(geen|zonder|no)[\s-]+(blok|block)/.test(noteLower) &&
      !noteLower.includes('blok-uit') &&
      !noteLower.includes('blok uit');
    const isBlockLoss =
      input.blockContact === 'kill-blok-tegen' ||
      bouncedOwnFloor ||
      modelOutcome === 'Geblokt' ||
      noteMentionsBlock;

    const correctedOutcome: (typeof VALID_OUTCOMES)[number] = isBlockLoss ? 'Geblokt' : 'Fout';
    const wasOverridden = modelOutcome !== correctedOutcome;

    if (wasOverridden) {
      const reason =
        correctedOutcome === 'Geblokt'
          ? 'Gecorrigeerd naar Kill-blok tegen (punt tegenstander / bal terug in eigen veld)'
          : 'Gecorrigeerd naar Fout (uit/netfout — punt ging naar tegenstander)';
      note = note ? `${note} · ${reason}` : reason;
    }

    return {
      outcome: correctedOutcome,
      confidence,
      note,
      pointWinner: 'tegenstander',
      outcomeResolvedBy: wasOverridden ? 'uitkomst-correctie' : 'model',
    };
  }

  // Case 3: Own kill-block by zwart/geel (Kill-blok mee = punt voor zwart/geel!)
  if (modelOutcome === 'Kill-blok mee' || input.blockContact === 'kill-blok-mee-zwart-geel') {
    if (!hasWoudenbergWinProof) {
      confidence = 'Onzeker';
      if (!noteLower.includes('juich') && !noteLower.includes('opslag') && !noteLower.includes('onzeker')) {
        note = `${note ? `${note} · ` : ''}Kill-blok mee niet eenduidig bevestigd via juichen/opslag/scorebord`;
      }
    }
    return {
      outcome: 'Kill-blok mee',
      confidence,
      note,
      pointWinner: hasWoudenbergWinProof ? 'zwart-geel' : 'onduidelijk',
      outcomeResolvedBy: modelOutcome === 'Kill-blok mee' ? 'model' : 'uitkomst-correctie',
    };
  }

  // Case 4: Model claims Direct punt (incl. blok-uit) — require at least ONE observable win cue
  if (modelOutcome === 'Direct punt') {
    if (outOrNet && input.blockContact !== 'blok-touch-uit-voor-zwart-geel') {
      const reason = 'Uitgeslagen bal of netfout zonder blok-touché — gecorrigeerd naar Fout';
      return {
        outcome: 'Fout',
        confidence: 'Onzeker',
        note: note ? `${note} · ${reason}` : reason,
        pointWinner: 'tegenstander',
        outcomeResolvedBy: 'uitkomst-correctie',
      };
    }

    if (input.blockContact === 'blok-touch-uit-voor-zwart-geel' && !noteLower.includes('blok-uit')) {
      note = note ? `${note} (via blok-uit)` : 'Direct punt via blok-uit';
    }

    if (!hasWoudenbergWinProof) {
      confidence = 'Onzeker';
      if (!noteLower.includes('juich') && !noteLower.includes('opslag') && !noteLower.includes('onzeker')) {
        note = `${note ? `${note} · ` : ''}Puntwinnaar niet eenduidig bevestigd via juichen, volgende opslag of scorebord — controleer op 4 FPS`;
      }
    }

    return {
      outcome: 'Direct punt',
      confidence,
      note,
      pointWinner: hasWoudenbergWinProof ? 'zwart-geel' : 'onduidelijk',
      outcomeResolvedBy: 'model',
    };
  }

  return {
    outcome: modelOutcome,
    confidence,
    note,
    pointWinner: input.pointWinner,
    outcomeResolvedBy: 'model',
  };
}

function isRetryableError(err: unknown): boolean {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : 0;
  // NEVER retry 429 inside a tight server loop — retrying after 2s/4s burns the same 60s TPM bucket!
  if (status === 429) return false;
  if (status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
  if (msg.includes('resource_exhausted') || msg.includes('quota')) {
    return false;
  }
  return (
    msg.includes('fetch failed') ||
    msg.includes('econnreset') ||
    msg.includes('etimedout') ||
    msg.includes('socket hang up') ||
    msg.includes('network') ||
    msg.includes('timeout') ||
    msg.includes('unavailable') ||
    msg.includes('internal') ||
    msg.includes('aborted')
  );
}

async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 2): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err: unknown) {
      lastError = err;
      if (!isRetryableError(err) || attempt === maxRetries) {
        throw err;
      }
      const delayMs = 2000 * Math.pow(2, attempt);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function parseRetryAfterSeconds(rawMessage: string): number {
  const retryInMatch = rawMessage.match(/retry\s+in\s+(\d+(?:\.\d+)?)s/i);
  if (retryInMatch) {
    return Math.min(90, Math.max(25, Math.ceil(Number(retryInMatch[1])) + 3));
  }
  const retryDelayMatch = rawMessage.match(/retryDelay["']?\s*:\s*["']?(\d+(?:\.\d+)?)s/i);
  if (retryDelayMatch) {
    return Math.min(90, Math.max(25, Math.ceil(Number(retryDelayMatch[1])) + 3));
  }
  return 45;
}

function formatApiError(err: unknown): {
  status: number;
  code?: string;
  retryAfterSeconds?: number;
  message: string;
} {
  if (err instanceof Error && err.message === 'GEMINI_API_KEY_MISSING') {
    return {
      status: 500,
      message:
        'De Gemini API-sleutel is niet geconfigureerd. Controleer de sleutel in Settings > Secrets.',
    };
  }

  const rawStatus =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : 500;
  const rawMessage = err instanceof Error ? err.message : String(err);
  const lower = rawMessage.toLowerCase();

  if (rawStatus === 403 || rawMessage.includes('PERMISSION_DENIED') || rawMessage.includes('API_KEY_INVALID')) {
    return {
      status: 403,
      message:
        'Geen toegang tot de Gemini API (controleer je API-sleutel in Settings > Secrets).',
    };
  }
  if (rawStatus === 429 || rawMessage.includes('RESOURCE_EXHAUSTED')) {
    console.warn(`[VolleyScout 429] ${rawMessage.slice(0, 400)}`);
    const isDaily =
      lower.includes('perday') ||
      lower.includes('per_day') ||
      lower.includes('daily') ||
      lower.includes('requestsperday');

    if (isDaily) {
      return {
        status: 429,
        code: 'DAILY_QUOTA',
        message:
          'Daglimiet van dit Gemini-model bereikt op de huidige API-sleutel. Schakel naar "Turbo" (eigen quotum) of kies een betaalde API-sleutel via Settings > Secrets.',
      };
    }

    const retryAfterSeconds = parseRetryAfterSeconds(rawMessage);
    return {
      status: 429,
      code: 'RATE_LIMIT',
      retryAfterSeconds,
      message: `Minuut-quotum (TPM/RPM) van de Gemini API bereikt. Wacht ${retryAfterSeconds}s (of schakel naar Turbo / 1 FPS voor ~5× minder tokens).`,
    };
  }
  if (rawStatus === 404 || rawMessage.includes('NOT_FOUND')) {
    return {
      status: 404,
      message:
        'De video of het model kon niet worden geladen. Controleer of de YouTube-video publiek toegankelijk is.',
    };
  }
  if (lower.includes('fetch failed') || lower.includes('timeout') || lower.includes('econnreset')) {
    return {
      status: 504,
      message:
        'Verbinding met de Gemini video-API verliep tijdens het verwerken van dit fragment. Probeer dit blok opnieuw of kies Turbo.',
    };
  }
  return {
    status: rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500,
    message: `Fout tijdens video-analyse: ${rawMessage}`,
  };
}

function startNdjsonStream(req: express.Request, res: express.Response): {
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
} {
  req.setTimeout(0);
  res.setTimeout(0);
  res.status(200);
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const send = (payload: Record<string, unknown>) => {
    if (!res.writableEnded) {
      res.write(`${JSON.stringify(payload)}\n`);
    }
  };

  send({ type: 'ping' });
  const heartbeat = setInterval(() => {
    send({ type: 'ping' });
  }, 3000);

  const close = () => {
    clearInterval(heartbeat);
    if (!res.writableEnded) {
      res.end();
    }
  };

  res.on('close', () => {
    clearInterval(heartbeat);
  });

  return { send, close };
}

function accessCodeMatches(given: unknown): boolean {
  if (!ACCESS_CODE) return true;
  if (typeof given !== 'string') return false;
  const a = Buffer.from(given.trim());
  const b = Buffer.from(ACCESS_CODE);
  return a.length === b.length && timingSafeEqual(a, b);
}

const requestLog = new Map<string, number[]>();

function protectApi(
  req: express.Request,
  res: express.Response,
  next: express.NextFunction
): void {
  if (!accessCodeMatches(req.get('x-access-code'))) {
    res.status(401).json({
      code: 'ACCESS_CODE',
      error: 'Toegangscode ontbreekt of is onjuist. Vraag de code aan de beheerder.',
    });
    return;
  }

  const now = Date.now();
  const key = req.ip || 'onbekend';
  const recent = (requestLog.get(key) || []).filter((t) => now - t < RATE_LIMIT_WINDOW_MS);
  if (recent.length >= RATE_LIMIT_MAX) {
    const retryAfterSeconds = Math.ceil((RATE_LIMIT_WINDOW_MS - (now - recent[0])) / 1000);
    res.status(429).json({
      code: 'RATE_LIMIT',
      retryAfterSeconds,
      error: `Te veel analyse-aanvragen achter elkaar. Probeer het over ${retryAfterSeconds}s opnieuw.`,
    });
    return;
  }
  recent.push(now);
  requestLog.set(key, recent);
  // Houd de map klein
  if (requestLog.size > 500) {
    for (const [ip, times] of requestLog) {
      if (times.every((t) => now - t >= RATE_LIMIT_WINDOW_MS)) requestLog.delete(ip);
    }
  }
  next();
}

function cleanShortLabel(raw: unknown, fallback: string): string {
  if (typeof raw !== 'string') return fallback;
  const cleaned = raw.replace(/[`"\n\r]/g, ' ').trim().slice(0, 60);
  return cleaned || fallback;
}

async function createServer() {
  const app = express();
  // Render / Cloud Run zitten achter een proxy: nodig voor het juiste IP-adres bij de limiet.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, accessCodeRequired: Boolean(ACCESS_CODE) });
  });

  app.use(['/api/analyze-chunk', '/api/verify-moment'], protectApi);

  app.post('/api/analyze-chunk', async (req, res) => {
    const { youtubeUrl, startSeconds, endSeconds, teamDescription, fps, speedMode, debugMode } =
      req.body ?? {};
    const cleanUrl = validateYouTubeUrl(youtubeUrl);
    if (!cleanUrl) {
      res.status(400).json({ error: 'Ongeldige YouTube-URL. Gebruik een volledige youtube.com of youtu.be link.' });
      return;
    }

    const startSec = Number(startSeconds);
    const endSec = Number(endSeconds);
    if (!Number.isFinite(startSec) || !Number.isFinite(endSec) || startSec < 0 || endSec <= startSec) {
      res.status(400).json({ error: 'Ongeldig tijdsinterval voor dit fragment.' });
      return;
    }
    if (endSec - startSec > 420) {
      res.status(400).json({ error: 'Fragment is te lang (maximaal 7 minuten per analyse-aanvraag).' });
      return;
    }

    const safeFps = [1, 2, 3].includes(Number(fps)) ? Number(fps) : 1;
    const isTurbo = speedMode === 'turbo';
    const isPrecise = speedMode === 'precise';
    const isDebug = Boolean(debugMode);
    const selectedModel = isTurbo ? FAST_MODEL_NAME : MODEL_NAME;
    // Keep Snel ('balanced') at LOW media resolution (~15k tokens/chunk at 1 FPS instead of ~87k!)
    // so free-tier TPM limits aren't blown while post-rally cues (celebration + next serve) stay clearly visible.
    const selectedThinking = isTurbo
      ? ThinkingLevel.LOW
      : isPrecise
      ? ThinkingLevel.HIGH
      : ThinkingLevel.MEDIUM;
    const selectedResolution = isPrecise
      ? MediaResolution.MEDIA_RESOLUTION_MEDIUM
      : MediaResolution.MEDIA_RESOLUTION_LOW;
    const extraTeamContext =
      typeof teamDescription === 'string' && teamDescription.trim().length > 0
        ? teamDescription.trim().slice(0, 260)
        : '';

    const durationSec = Math.round(endSec - startSec);
    // Add +8s look-ahead padding to the video clip so attacks near the end of a chunk still show celebration + next serve!
    const lookAheadSec = 8;
    const videoEndSec = Math.round(endSec + lookAheadSec);
    const startLabel = formatMMSS(startSec);
    const endLabel = formatMMSS(endSec);

    const stream = startNdjsonStream(req, res);

    try {
      const prompt = `Je bent een uiterst nauwkeurige volleybal-videoanalist (DataVolley / Nevobo-niveau).
Analyseer alle aanvallen én eigen kill-blokpunten (Kill-blok mee) van het zwart/gele team waarvan het balcontact valt tussen ${startLabel} en ${endLabel} (duur: ${durationSec} seconden).
*(BELANGRIJK: De video loopt ter controle ${lookAheadSec} seconden door tot ${formatMMSS(videoEndSec)} — log GEEN acties ná ${endLabel}, maar gebruik die extra seconden puur om bij late rally's te zien welk team juicht, of het scorebord rechts oploopt, en wie de volgende opslag neemt!)*

VERPLICHTE TEAM-IDENTITEIT (NOOIT VAN AFWIJKEN):
- ${ALWAYS_TARGET_TEAM}
${extraTeamContext ? `- Aanvullende context: ${extraTeamContext}` : ''}
- Tel GEEN aanvallen van de tegenstander (behalve als zwart/geel die aanval direct afblokt voor een punt → dat log je als \`"Kill-blok mee"\` op de netpositie van de zwart/gele blokkeerder!).
- Bepaal per actie aan welke speelhelft het zwart/gele team speelt:
  - \`courtSide = "nabij"\`: zwart/geel speelt op de speelhelft dicht bij de camera (met de rug naar de camera).
  - \`courtSide = "ver"\`: zwart/geel speelt na een veldwissel op de speelhelft aan de overkant van het net (gezicht naar de camera).
- Tel GEEN opslagen (serves) of puur verdedigende vrije ballen zonder aanvalsintentie.

GENORMALISEERDE VELDCOÖRDINATEN VAN HET AFZETPUNT (ALTIJD vanuit het EIGEN perspectief van zwart/geel kijkend richting het net!):
- \`takeoffX\` (0.00 t/m 1.00): horizontale afzetpositie in het eigen veld:
  - 0.00 – 0.36 = LINKS (Pos 4 voorveld, Pos 5 achterveld)
  - 0.36 – 0.64 = MIDDEN (Pos 3 voorveld, Pos 6 achterveld)
  - 0.64 – 1.00 = RECHTS (Pos 2 voorveld, Pos 1 achterveld)
  *(LET OP: als \`courtSide = "ver"\`, spiegel links/rechts in beeld naar het eigen perspectief van zwart/geel richting het net!)*
- \`takeoffY\` (0.00 t/m 1.00): afstand tot het net op het moment dat de voeten de vloer verlaten (afzet!):
  - 0.00 – 0.33 = VOORVELD (vóór de 3-meterlijn bij het net; bij eigen Kill-blok mee aan het net: \`takeoffY ≈ 0.05–0.12\`)
  - 0.34 – 1.00 = ACHTERVELD (afzet ACHTER de 3-meterlijn — zet \`behindThreeMeterLine = true\`!)

EXPLICIETE HERKENNINGSTRAINING VOOR POSITIES 1, 2 EN 5 (PIPE-AANVALLEN — EXTRA SCHERP OP LETTEN!):
1. **Positie 2 — "Diagonaal (Pos 2)"** (\`takeoffX ≈ 0.68–0.95\`, \`takeoffY ≈ 0.08–0.32\`, \`behindThreeMeterLine = false\`):
   - Aanvaller (of blokkeerder bij Kill-blok mee) springt aan de **rechterkant bij het net** (rechter antenne).
   - Verwar Pos 2 NOOIT met Buiten (Pos 4). Controleer of de speler rechts of links van het midden bij het net springt!
2. **Positie 1 — "Achterveld rechts (Pos 1)"** (\`takeoffX ≈ 0.64–0.92\`, \`takeoffY ≈ 0.38–0.65\`, \`behindThreeMeterLine = true\`):
   - Achterveldaanval die **achter de 3-meterlijn aan de rechterkant** afzet en naar voren in het veld springt.
3. **Positie 5 — "Achterveld links / Pipe (Pos 5)"** (\`takeoffX ≈ 0.10–0.38\`, \`takeoffY ≈ 0.38–0.65\`, \`behindThreeMeterLine = true\`):
   - Pipe- of achterveldaanval waarbij de speler **achter de 3-meterlijn vanaf linksachter (Pos 5)** aanvalt.
4. Overige posities:
   - **"Buiten (Pos 4)"**: linksvoor bij het net (\`takeoffX ≤ 0.36\`, \`takeoffY ≤ 0.33\`)
   - **"Midden (Pos 3)"**: midden bij het net (\`takeoffX 0.37–0.63\`, \`takeoffY ≤ 0.33\`)
   - **"Pipe midden (Pos 6)"**: rechte pipe midden achter 3m-lijn (\`takeoffX 0.39–0.61\`, \`takeoffY ≥ 0.35\`, \`behindThreeMeterLine = true\`)
   - **"Overig / 2e bal"**: spelverdeler-doortikbal (2e bal)

EXACTE SCOREREGELS & ANTI-VALS-POSITIEF PROTOCOL (5 BEWIJSSTUKKEN!):
Vanuit een achterlijncamera lijkt een kill-blok van de tegenstander vaak op een directe score aan het net. GOK NOOIT op "Direct punt" puur omdat de rally stopt!
Hanteer deze 5 exacte uitkomstcategorieën:
- **"Direct punt"**: aanval van zwart/geel scoort direct, **INCLUSIEF blok-uit** (bal gaat via blokhanden van tegenstander uit en levert punt vóór zwart/geel op — zet dan "via blok-uit" in \`note\`!).
- **"Fout"**: **uitgeslagen bal** (zonder blok-touché) of **netfout** (bal in het net of speler raakt net) door zwart/geel → punt tegen!
- **"Geblokt"**: **Kill-blok TEGEN** — aanval van zwart/geel wordt door het blok van de tegenstander direct afgeblokt (bal terug in eigen veld zwart/geel) → punt tegen!
- **"Kill-blok mee"**: **Eigen kill-blok MEE** — een speler van zwart/geel blokt aan het net een aanval van de tegenstander direct terug op de vloer van de tegenstander → punt vóór zwart/geel! (Zet \`blockContact = "kill-blok-mee-zwart-geel"\` en de netpositie Pos 4 / Pos 3 / Pos 2.)
- **"Verdedigd/doorgespeeld"**: bal wordt verdedigd en rally loopt door.

Controleer bij ELKE actie VERPLICHT deze 5 bewijsstukken in de 3 tot 7 seconden NÁ het balcontact:
1. **\`blockContact\`**: \`"geen-blok"\`, \`"kill-blok-tegen"\` (blok tegenstander = punt tegen), \`"kill-blok-mee-zwart-geel"\` (eigen blok zwart/geel = punt voor), \`"blok-touch-uit-voor-zwart-geel"\` (blok-uit = Direct punt!), \`"blok-verdedigd"\`, of \`"onduidelijk"\`.
2. **\`ballLandingSide\`**: \`"in-eigen-veld-zwart-geel"\` (punt tegen → Geblokt of Fout!), \`"uit-of-net"\` (Fout!), \`"bij-tegenstander"\` (Direct punt of Kill-blok mee), \`"rally-door"\`, of \`"onduidelijk"\`.
3. **\`celebratingTeam\`**: Lichaamstaal ná het fluitje: draait zwart/geel naar binnen voor huddle/high-fives (\`"zwart-geel"\`), of lopen ze verslagen weg / duiken ze naar de bal op eigen vloer terwijl de tegenstander juicht (\`"tegenstander"\`)?
4. **\`nextServerTeam\`** (DE VOLLEYBALWET): In volleybal serveert ALTIJD de puntwinnaar de volgende bal! Kijk 4–7s later welk team de bal pakt / naar de achterlijn loopt voor de volgende opslag (\`"zwart-geel"\`, \`"tegenstander"\`, \`"rally-door"\`, \`"niet-zichtbaar"\`).
5. **\`scoreboardCue\`** (KLEIN SCOREBORD RECHTS IN BEELD): Aan de **rechterkant van het beeld** staat een klein scorebord. Kijk of je na de rally duidelijk een punt ziet bijkomen voor zwart/geel (\`"zwart-geel-omhoog"\`) of voor de tegenstander (\`"tegenstander-omhoog"\`). Omdat het bord klein is: zet eerlijk \`"niet-leesbaar"\` als de cijfers niet scherp te lezen zijn — gok NOOIT!

REGEL VOOR ZEKERHEID:
- Zet \`confidence = "Zeker"\` ALLEEN voor "Direct punt" of "Kill-blok mee" als je daadwerkelijk hebt gezien dat **zwart/geel** juicht, de volgende opslag krijgt, of het scorebord oploopt!
- Bij twijfel over contact, touché of puntwinnaar: zet \`confidence = "Onzeker"\` en licht kort toe in \`note\`.
- Geef \`offsetSeconds\` (0 t/m ${durationSec}, 0 = ${startLabel}) én \`absoluteTimestamp\` (MM:SS tussen ${startLabel} en ${endLabel}). Verzin NOOIT acties tijdens time-outs.`;

      const ai = getAiClient();

      const response = await generateWithRetry(
        () =>
          ai.models.generateContent({
            model: selectedModel,
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    fileData: {
                      fileUri: cleanUrl,
                      mimeType: 'video/mp4',
                    },
                    videoMetadata: {
                      startOffset: `${Math.round(startSec)}s`,
                      endOffset: `${videoEndSec}s`,
                      fps: safeFps,
                    },
                  },
                  { text: prompt },
                ],
              },
            ],
            config: {
              mediaResolution: selectedResolution,
              thinkingConfig: {
                thinkingLevel: selectedThinking,
              },
              responseMimeType: 'application/json',
              responseSchema: {
                type: Type.OBJECT,
                properties: {
                  cameraNote: {
                    type: Type.STRING,
                    description:
                      'Zeer korte observatie over dit fragment (bijv. veldwissel zwart/geel, time-out of zicht; anders lege string).',
                  },
                  attacks: {
                    type: Type.ARRAY,
                    items: {
                      type: Type.OBJECT,
                      properties: {
                        offsetSeconds: {
                          type: Type.NUMBER,
                          description: `Seconden vanaf start van dit fragment (0 tot ${durationSec}) op het moment van balcontact.`,
                        },
                        absoluteTimestamp: {
                          type: Type.STRING,
                          description: `Absolute tijd in volledige video in MM:SS tussen ${startLabel} en ${endLabel}.`,
                        },
                        courtSide: {
                          type: Type.STRING,
                          description: 'nabij (zwart/geel met rug naar camera) of ver (zwart/geel aan overzijde)',
                        },
                        takeoffX: {
                          type: Type.NUMBER,
                          description: 'Genormaliseerde X-afzetpositie in eigen veld (0.00 links -> 0.50 midden -> 1.00 rechts).',
                        },
                        takeoffY: {
                          type: Type.NUMBER,
                          description: 'Genormaliseerde Y-afzetpositie vanaf net (0.00 net -> 0.33 3m-lijn -> 1.00 achterlijn).',
                        },
                        behindThreeMeterLine: {
                          type: Type.BOOLEAN,
                          description: 'True als de aanvaller achter de 3-meterlijn afzet (Pos 5, Pos 6 pipe, of Pos 1).',
                        },
                        positionZone: {
                          type: Type.STRING,
                          description:
                            'Een van: Buiten (Pos 4), Midden (Pos 3), Diagonaal (Pos 2), Achterveld links / Pipe (Pos 5), Pipe midden (Pos 6), Achterveld rechts (Pos 1), Overig / 2e bal',
                        },
                        zoneReasoning: {
                          type: Type.STRING,
                          description: 'Korte debug-uitleg van afzetpunt (max 10 woorden, bijv. "Rechts achter 3m-lijn afzet -> Pos 1").',
                        },
                        blockContact: {
                          type: Type.STRING,
                          description:
                            'Een van: geen-blok, kill-blok-tegen, kill-blok-mee-zwart-geel, blok-touch-uit-voor-zwart-geel, blok-verdedigd, onduidelijk',
                        },
                        ballLandingSide: {
                          type: Type.STRING,
                          description:
                            'Een van: bij-tegenstander, in-eigen-veld-zwart-geel, uit-of-net, rally-door, onduidelijk',
                        },
                        celebratingTeam: {
                          type: Type.STRING,
                          description:
                            'Welk team juicht / vormt huddle na de rally: zwart-geel, tegenstander, geen-rally-door, of onduidelijk',
                        },
                        nextServerTeam: {
                          type: Type.STRING,
                          description:
                            'Welk team neemt de volgende opslag 4-7s na de actie (winnaar van het punt): zwart-geel, tegenstander, rally-door, of niet-zichtbaar',
                        },
                        scoreboardCue: {
                          type: Type.STRING,
                          description:
                            'Klein scorebord rechts in beeld: zwart-geel-omhoog, tegenstander-omhoog, of niet-leesbaar (gok nooit!)',
                        },
                        pointWinner: {
                          type: Type.STRING,
                          description:
                            'Wie wint het punt op basis van lichaamstaal, bal, volgende opslag & scorebord: zwart-geel, tegenstander, rally-door, of onduidelijk',
                        },
                        outcome: {
                          type: Type.STRING,
                          description:
                            'Een van: Direct punt (incl. blok-uit), Fout (uit/netfout), Geblokt (kill-blok tegen = punt tegen!), Kill-blok mee (eigen kill-blok zwart/geel = punt voor!), Verdedigd/doorgespeeld',
                        },
                        confidence: {
                          type: Type.STRING,
                          description: 'Zeker (alleen bij eenduidig zicht op winnaar/contact) of Onzeker',
                        },
                        note: {
                          type: Type.STRING,
                          description:
                            'Korte feitelijke toelichting (max 12 woorden, bijv. "Kill-blok tegenstander", "Eigen kill-blok zwart/geel", "Direct punt via blok-uit", "Bal uit geslagen").',
                        },
                      },
                      required: [
                        'offsetSeconds',
                        'absoluteTimestamp',
                        'courtSide',
                        'takeoffX',
                        'takeoffY',
                        'behindThreeMeterLine',
                        'positionZone',
                        'zoneReasoning',
                        'blockContact',
                        'ballLandingSide',
                        'celebratingTeam',
                        'nextServerTeam',
                        'scoreboardCue',
                        'pointWinner',
                        'outcome',
                        'confidence',
                        'note',
                      ],
                    },
                  },
                },
                required: ['cameraNote', 'attacks'],
              },
            },
          }),
        2
      );

      const rawText = (response.text ?? '{}').trim();
      let parsed: { cameraNote?: string; attacks?: Array<Record<string, unknown>> } = {};
      try {
        parsed = JSON.parse(rawText);
      } catch {
        const jsonMatch = rawText.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          parsed = JSON.parse(jsonMatch[0]);
        } else {
          throw new Error('Model gaf geen geldig JSON-antwoord terug voor dit fragment.');
        }
      }

      const rawAttacks = Array.isArray(parsed.attacks) ? parsed.attacks : [];
      const normalizedAttacks = rawAttacks
        .map((item, idx) => {
          const offsetNum = Number(item.offsetSeconds);
          const absFromString = parseMMSS(item.absoluteTimestamp);

          let resolvedSeconds: number;
          if (
            absFromString !== null &&
            absFromString >= startSec - 3 &&
            absFromString <= endSec + 2
          ) {
            resolvedSeconds = Math.max(startSec, Math.min(endSec, Math.round(absFromString)));
          } else if (
            Number.isFinite(offsetNum) &&
            offsetNum >= -3 &&
            offsetNum <= durationSec + 2
          ) {
            resolvedSeconds = Math.max(
              startSec,
              Math.min(endSec, Math.round(startSec + Math.max(0, offsetNum)))
            );
          } else if (
            Number.isFinite(offsetNum) &&
            offsetNum >= startSec - 3 &&
            offsetNum <= endSec + 2
          ) {
            resolvedSeconds = Math.max(startSec, Math.min(endSec, Math.round(offsetNum)));
          } else {
            // Drop any attack that occurred inside the +8s look-ahead padding (will be captured by next chunk)
            return null;
          }

          const rawZoneLabel = String(item.positionZone || '');
          const takeoffX = clampUnit(item.takeoffX, 0.5);
          const takeoffY = clampUnit(item.takeoffY, 0.2);
          const behindThreeMeterLine = Boolean(item.behindThreeMeterLine) || takeoffY >= 0.37;
          const courtSide = String(item.courtSide || '').toLowerCase().includes('ver')
            ? ('ver' as const)
            : ('nabij' as const);

          const resolved = resolveZoneWithCoordinates({
            rawZoneLabel,
            takeoffX,
            takeoffY,
            behindThreeMeterLine,
          });

          const timestamp = formatMMSS(resolvedSeconds);
          const reasoning =
            typeof item.zoneReasoning === 'string' ? item.zoneReasoning.trim() : '';
          const rawNote = typeof item.note === 'string' ? item.note.trim() : '';
          const rawOutcomeLabel = String(item.outcome || '');
          const blockContact = normalizeBlockContact(item.blockContact);
          const ballLandingSide = String(item.ballLandingSide || 'onduidelijk').trim();
          const celebratingTeam = normalizeCelebratingTeam(item.celebratingTeam);
          const nextServerTeam = normalizeNextServerTeam(item.nextServerTeam);
          const scoreboardCue = normalizeScoreboardCue(item.scoreboardCue);
          const rawPointWinner = normalizePointWinner(item.pointWinner);

          const reconciled = reconcileOutcome({
            rawOutcome: rawOutcomeLabel,
            rawConfidence: item.confidence,
            blockContact,
            ballLandingSide,
            celebratingTeam,
            nextServerTeam,
            scoreboardCue,
            pointWinner: rawPointWinner,
            note: rawNote,
          });

          if (isDebug) {
            console.log(
              `[VolleyScout Debug] ${timestamp} | zone=${resolved.zone} (${resolved.resolvedBy}) | outcome=${reconciled.outcome} (${reconciled.outcomeResolvedBy}, raw="${rawOutcomeLabel}") | block=${blockContact} | landing=${ballLandingSide} | cheer=${celebratingTeam} | nextServe=${nextServerTeam} | sb=${scoreboardCue} | winner=${reconciled.pointWinner} | conf=${reconciled.confidence} | coords=(x=${takeoffX.toFixed(2)}, y=${takeoffY.toFixed(2)})`
            );
          }

          return {
            id: `ai-${Math.round(startSec)}-${resolvedSeconds}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            timestampSeconds: resolvedSeconds,
            timestamp,
            positionZone: resolved.zone,
            outcome: reconciled.outcome,
            confidence: reconciled.confidence,
            note: reconciled.note,
            source: 'ai' as const,
            debugCoordinates: {
              takeoffX,
              takeoffY,
              courtSide,
              behindThreeMeterLine,
              rawZoneLabel: rawZoneLabel || resolved.zone,
              resolvedBy: resolved.resolvedBy,
              reasoning,
              blockContact,
              ballLandingSide,
              celebratingTeam,
              nextServerTeam,
              scoreboardCue,
              pointWinner: reconciled.pointWinner,
              rawOutcomeLabel: rawOutcomeLabel || reconciled.outcome,
              outcomeResolvedBy: reconciled.outcomeResolvedBy,
            },
          };
        })
        .filter((x): x is NonNullable<typeof x> => x !== null)
        .sort((a, b) => a.timestampSeconds - b.timestampSeconds);

      stream.send({
        type: 'result',
        cameraNote: typeof parsed.cameraNote === 'string' ? parsed.cameraNote.trim() : '',
        attacks: normalizedAttacks,
      });
    } catch (err: unknown) {
      const formatted = formatApiError(err);
      stream.send({
        type: 'error',
        status: formatted.status,
        code: formatted.code,
        retryAfterSeconds: formatted.retryAfterSeconds,
        error: formatted.message,
      });
    } finally {
      stream.close();
    }
  });

  app.post('/api/verify-moment', async (req, res) => {
    const { youtubeUrl, timestampSeconds, currentZone, currentOutcome, debugMode } =
      req.body ?? {};
    const cleanUrl = validateYouTubeUrl(youtubeUrl);
    if (!cleanUrl) {
      res.status(400).json({ error: 'Ongeldige YouTube-URL.' });
      return;
    }

    const centerSec = Number(timestampSeconds);
    if (!Number.isFinite(centerSec) || centerSec < 0) {
      res.status(400).json({ error: 'Ongeldig tijdstip.' });
      return;
    }

    const clipStart = Math.max(0, Math.round(centerSec - 5));
    const clipEnd = Math.round(centerSec + 11);
    const isDebug = Boolean(debugMode);

    const stream = startNdjsonStream(req, res);

    try {
      const prompt = `Inspecteer dit slow-check fragment van ${formatMMSS(clipStart)} tot ${formatMMSS(clipEnd)} op hoge framerate (4 FPS, hoge resolutie).
VERPLICHTE TEAM-IDENTITEIT: ${ALWAYS_TARGET_TEAM}
Rond ${formatMMSS(centerSec)} is eerder een actie geregistreerd: Positie/Zone = "${cleanShortLabel(currentZone, 'onbekend')}", Uitkomst = "${cleanShortLabel(currentOutcome, 'onbekend')}".
WAARSCHUWING: Eerdere scans maakten vaak de fout om een **kill-blok van de tegenstander** (punt tegen zwart/geel!) of een **uit/netfout** aan te zien voor een "Direct punt". Wees extreem kritisch op deze uitkomst!

Controleer stap-voor-stap op 4 FPS:
1. Is dit daadwerkelijk een aanval of eigen kill-blok van het team in zwart/geel tenue (met 1 libero in geel/zwart)?
2. Bepaal het exacte afzetpunt in eigen veld: \`takeoffX\` (0.00 links -> 1.00 rechts), \`takeoffY\` (0.00 net -> 0.33 3m-lijn -> 1.00 achterlijn), \`behindThreeMeterLine\` en \`courtSide\` (nabij/ver). Let scherp op Pos 2, Pos 1 en Pos 5 (pipe).
3. CONTROLEER DE 5 BEWIJSSTUKKEN NÁ HET BALCONTACT (t/m 10 seconden ná het contact!):
   - \`blockContact\`: \`"kill-blok-tegen"\` (blok tegenstander = punt tegen), \`"kill-blok-mee-zwart-geel"\` (eigen blok zwart/geel = punt voor), \`"blok-touch-uit-voor-zwart-geel"\` (blok-uit = Direct punt!), \`"blok-verdedigd"\`, \`"geen-blok"\`, of \`"onduidelijk"\`.
   - \`ballLandingSide\`: Viel de bal op de eigen vloer van zwart/geel (\`"in-eigen-veld-zwart-geel"\`), bij de tegenstander (\`"bij-tegenstander"\`), uit/net (\`"uit-of-net"\`), of liep de rally door (\`"rally-door"\`)?
   - \`celebratingTeam\`: Welk team juicht / komt samen in een huddle na het fluitje? Kijken zwart/gele spelers verslagen of duiken ze naar de bal op eigen vloer?
   - \`nextServerTeam\`: Welk team pakt de bal / loopt naar de achterlijn om de VOLGENDE opslag te nemen? (In volleybal serveert ALTIJD de puntwinnaar!)
   - \`scoreboardCue\`: Aan de **rechterkant van het beeld** staat een klein scorebord. Kijk of je daar duidelijk een punt voor zwart/geel (\`"zwart-geel-omhoog"\`) of tegenstander (\`"tegenstander-omhoog"\`) ziet bijkomen — zet eerlijk \`"niet-leesbaar"\` als de cijfers te klein zijn!
4. Beslis daarna de \`outcome\`:
   - Kill-blok van tegenstander (punt tegen) → **Geblokt** (NOOIT Direct punt!).
   - Eigen kill-blok van zwart/geel op aanval tegenstander (punt voor) → **Kill-blok mee**.
   - Uitgeslagen bal (zonder blok-touché) of netfout → **Fout**.
   - Aanvalsscore zwart/geel **inclusief blok-uit** (punt voor zwart/geel) → **Direct punt** (noteer "via blok-uit" bij touché).
   - Twijfel of tegenstrijdigheid? Zet eerlijk \`confidence = "Onzeker"\` en licht precies toe wat je ziet.`;

      const ai = getAiClient();

      const response = await generateWithRetry(() =>
        ai.models.generateContent({
          model: MODEL_NAME,
          contents: [
            {
              role: 'user',
              parts: [
                {
                  fileData: {
                    fileUri: cleanUrl,
                    mimeType: 'video/mp4',
                  },
                  videoMetadata: {
                    startOffset: `${clipStart}s`,
                    endOffset: `${clipEnd}s`,
                    fps: 4,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: {
            mediaResolution: MediaResolution.MEDIA_RESOLUTION_HIGH,
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.HIGH,
            },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isTargetTeamAttack: {
                  type: Type.BOOLEAN,
                  description: 'True als dit echt een aanval van het zwart/gele team is, anders false.',
                },
                refinedOffsetSeconds: {
                  type: Type.NUMBER,
                  description: `Seconden vanaf start van dit 16s fragment (0 tot ${clipEnd - clipStart}) op exact moment van balcontact.`,
                },
                courtSide: {
                  type: Type.STRING,
                  description: 'nabij of ver',
                },
                takeoffX: {
                  type: Type.NUMBER,
                  description: 'Genormaliseerde X-afzetpositie (0.00 links -> 1.00 rechts in eigen veld).',
                },
                takeoffY: {
                  type: Type.NUMBER,
                  description: 'Genormaliseerde Y-afzetpositie (0.00 net -> 0.33 3m-lijn -> 1.00 achterlijn).',
                },
                behindThreeMeterLine: {
                  type: Type.BOOLEAN,
                  description: 'True als de aanvaller achter de 3-meterlijn afzet.',
                },
                positionZone: {
                  type: Type.STRING,
                  description:
                    'Een van: Buiten (Pos 4), Midden (Pos 3), Diagonaal (Pos 2), Achterveld links / Pipe (Pos 5), Pipe midden (Pos 6), Achterveld rechts (Pos 1), Overig / 2e bal',
                },
                zoneReasoning: {
                  type: Type.STRING,
                  description: 'Korte debug-uitleg van afzetpunt en zonekeuze.',
                },
                blockContact: {
                  type: Type.STRING,
                  description:
                    'Een van: geen-blok, kill-blok-tegen, kill-blok-mee-zwart-geel, blok-touch-uit-voor-zwart-geel, blok-verdedigd, onduidelijk',
                },
                ballLandingSide: {
                  type: Type.STRING,
                  description: 'bij-tegenstander, in-eigen-veld-zwart-geel, uit-of-net, rally-door, of onduidelijk',
                },
                celebratingTeam: {
                  type: Type.STRING,
                  description: 'zwart-geel, tegenstander, geen-rally-door, of onduidelijk',
                },
                nextServerTeam: {
                  type: Type.STRING,
                  description: 'zwart-geel, tegenstander, rally-door, of niet-zichtbaar',
                },
                scoreboardCue: {
                  type: Type.STRING,
                  description: 'Klein scorebord rechts in beeld: zwart-geel-omhoog, tegenstander-omhoog, of niet-leesbaar',
                },
                pointWinner: {
                  type: Type.STRING,
                  description: 'zwart-geel, tegenstander, rally-door, of onduidelijk',
                },
                outcome: {
                  type: Type.STRING,
                  description:
                    'Een van: Direct punt (incl. blok-uit), Fout (uit/netfout), Geblokt (kill-blok tegen!), Kill-blok mee (eigen kill-blok zwart/geel!), Verdedigd/doorgespeeld',
                },
                confidence: {
                  type: Type.STRING,
                  description: 'Zeker of Onzeker',
                },
                note: {
                  type: Type.STRING,
                  description:
                    'Eerlijke, specifieke Nederlandse toelichting over wat zichtbaar is bij dit balcontact, welk team juicht, wie de volgende opslag neemt en eventueel het scorebord rechts.',
                },
              },
              required: [
                'isTargetTeamAttack',
                'refinedOffsetSeconds',
                'courtSide',
                'takeoffX',
                'takeoffY',
                'behindThreeMeterLine',
                'positionZone',
                'zoneReasoning',
                'blockContact',
                'ballLandingSide',
                'celebratingTeam',
                'nextServerTeam',
                'scoreboardCue',
                'pointWinner',
                'outcome',
                'confidence',
                'note',
              ],
            },
          },
        })
      );

      const rawText = (response.text ?? '{}').trim();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = JSON.parse(rawText) as Record<string, unknown>;
      } catch {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) {
          parsed = JSON.parse(match[0]) as Record<string, unknown>;
        } else {
          throw new Error('Model gaf geen geldig JSON-antwoord terug bij de 4 FPS hercheck.');
        }
      }

      const offsetNum = Number(parsed.refinedOffsetSeconds);
      const refinedSeconds =
        Number.isFinite(offsetNum) && offsetNum >= 0 && offsetNum <= clipEnd - clipStart
          ? Math.round(clipStart + offsetNum)
          : Math.round(centerSec);

      const rawZoneLabel = String(parsed.positionZone || '');
      const takeoffX = clampUnit(parsed.takeoffX, 0.5);
      const takeoffY = clampUnit(parsed.takeoffY, 0.2);
      const behindThreeMeterLine = Boolean(parsed.behindThreeMeterLine) || takeoffY >= 0.37;
      const courtSide = String(parsed.courtSide || '').toLowerCase().includes('ver')
        ? ('ver' as const)
        : ('nabij' as const);
      const resolved = resolveZoneWithCoordinates({
        rawZoneLabel,
        takeoffX,
        takeoffY,
        behindThreeMeterLine,
      });
      const timestamp = formatMMSS(refinedSeconds);
      const reasoning =
        typeof parsed.zoneReasoning === 'string' ? parsed.zoneReasoning.trim() : '';
      const rawNote = typeof parsed.note === 'string' ? parsed.note.trim() : '';
      const rawOutcomeLabel = String(parsed.outcome || '');
      const blockContact = normalizeBlockContact(parsed.blockContact);
      const ballLandingSide = String(parsed.ballLandingSide || 'onduidelijk').trim();
      const celebratingTeam = normalizeCelebratingTeam(parsed.celebratingTeam);
      const nextServerTeam = normalizeNextServerTeam(parsed.nextServerTeam);
      const scoreboardCue = normalizeScoreboardCue(parsed.scoreboardCue);
      const rawPointWinner = normalizePointWinner(parsed.pointWinner);

      const reconciled = reconcileOutcome({
        rawOutcome: rawOutcomeLabel,
        rawConfidence: parsed.confidence,
        blockContact,
        ballLandingSide,
        celebratingTeam,
        nextServerTeam,
        scoreboardCue,
        pointWinner: rawPointWinner,
        note: rawNote,
      });

      if (isDebug) {
        console.log(
          `[VolleyScout Debug 4FPS] ${timestamp} | targetTeam=${Boolean(parsed.isTargetTeamAttack)} | zone=${resolved.zone} (${resolved.resolvedBy}) | outcome=${reconciled.outcome} (${reconciled.outcomeResolvedBy}, raw="${rawOutcomeLabel}") | block=${blockContact} | landing=${ballLandingSide} | cheer=${celebratingTeam} | nextServe=${nextServerTeam} | sb=${scoreboardCue} | winner=${reconciled.pointWinner} | coords=(x=${takeoffX.toFixed(2)}, y=${takeoffY.toFixed(2)})`
        );
      }

      stream.send({
        type: 'result',
        isTargetTeamAttack: Boolean(parsed.isTargetTeamAttack),
        timestampSeconds: refinedSeconds,
        timestamp,
        positionZone: resolved.zone,
        outcome: reconciled.outcome,
        confidence: reconciled.confidence,
        note: reconciled.note,
        debugCoordinates: {
          takeoffX,
          takeoffY,
          courtSide,
          behindThreeMeterLine,
          rawZoneLabel: rawZoneLabel || resolved.zone,
          resolvedBy: resolved.resolvedBy,
          reasoning,
          blockContact,
          ballLandingSide,
          celebratingTeam,
          nextServerTeam,
          scoreboardCue,
          pointWinner: reconciled.pointWinner,
          rawOutcomeLabel: rawOutcomeLabel || reconciled.outcome,
          outcomeResolvedBy: reconciled.outcomeResolvedBy,
        },
      });
    } catch (err: unknown) {
      const formatted = formatApiError(err);
      stream.send({
        type: 'error',
        status: formatted.status,
        code: formatted.code,
        retryAfterSeconds: formatted.retryAfterSeconds,
        error: formatted.message,
      });
    } finally {
      stream.close();
    }
  });

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.resolve(__dirname, 'dist');
    app.use(express.static(distPath));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`VolleyScout server listening on http://0.0.0.0:${PORT}`);
  });
}

createServer().catch((err) => {
  console.error('Failed to start server:', err);
  process.exit(1);
});
