import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, ThinkingLevel, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = Number(process.env.PORT || 3000);
const MODEL_NAME = 'gemini-4-hydrogen';
const FAST_MODEL_NAME = 'gemini-3.1-flash-lite';

const VALID_ZONES = [
  'Buiten (Pos 4)',
  'Midden (Pos 3)',
  'Diagonaal (Pos 2)',
  'Pipe (Pos 6)',
  'Achterveld (Pos 1)',
  'Overig / 2e bal',
] as const;

const VALID_OUTCOMES = [
  'Direct punt',
  'Fout',
  'Geblokt',
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

function normalizeZone(raw: unknown): (typeof VALID_ZONES)[number] {
  const s = String(raw || '').toLowerCase();
  if (s.includes('buiten') || s.includes('pos 4') || s.includes('links')) return 'Buiten (Pos 4)';
  if (s.includes('midden') || s.includes('pos 3') || s.includes('mid')) return 'Midden (Pos 3)';
  if (s.includes('diagonaal') || s.includes('pos 2') || s.includes('rechtsvoor')) return 'Diagonaal (Pos 2)';
  if (s.includes('pipe') || s.includes('pos 6')) return 'Pipe (Pos 6)';
  if (s.includes('achterveld') || s.includes('pos 1') || s.includes('rechtsachter')) return 'Achterveld (Pos 1)';
  return 'Overig / 2e bal';
}

function normalizeOutcome(raw: unknown): (typeof VALID_OUTCOMES)[number] {
  const s = String(raw || '').toLowerCase();
  if (s.includes('direct') || s.includes('punt') || s.includes('score') || s.includes('kill')) {
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

function isRetryableError(err: unknown): boolean {
  const status =
    typeof err === 'object' && err !== null && 'status' in err
      ? Number((err as { status?: number }).status)
      : 0;
  if (status === 429 || status === 500 || status === 502 || status === 503 || status === 504) {
    return true;
  }
  const msg = (err instanceof Error ? err.message : String(err)).toLowerCase();
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

async function generateWithRetry<T>(fn: () => Promise<T>, maxRetries = 3): Promise<T> {
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

function formatApiError(err: unknown): { status: number; message: string } {
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
    return {
      status: 429,
      message:
        'Tijdelijk quotum bereikt bij de Gemini API. Wacht enkele seconden en probeer dit blok opnieuw, of schakel naar 1 FPS.',
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
        'Verbinding met de Gemini video-API verliep tijdens het verwerken van dit fragment. Probeer dit blok opnieuw of kies 1 FPS.',
    };
  }
  return {
    status: rawStatus >= 400 && rawStatus < 600 ? rawStatus : 500,
    message: `Fout tijdens video-analyse: ${rawMessage}`,
  };
}

function startNdjsonStream(res: express.Response): {
  send: (payload: Record<string, unknown>) => void;
  close: () => void;
} {
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
  }, 4000);

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

async function createServer() {
  const app = express();
  app.use(express.json({ limit: '1mb' }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true, model: MODEL_NAME });
  });

  app.post('/api/analyze-chunk', async (req, res) => {
    const { youtubeUrl, startSeconds, endSeconds, teamDescription, fps, speedMode } = req.body ?? {};
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
    const selectedModel = isTurbo ? FAST_MODEL_NAME : MODEL_NAME;
    const selectedThinking = isTurbo ? ThinkingLevel.MINIMAL : ThinkingLevel.LOW;
    const safeTeam =
      typeof teamDescription === 'string' && teamDescription.trim().length > 0
        ? teamDescription.trim().slice(0, 300)
        : 'Het team dat met de rug naar de camera speelt (zwart/geel tenue, met 1 libero in geel/zwart)';

    const durationSec = Math.round(endSec - startSec);
    const startLabel = formatMMSS(startSec);
    const endLabel = formatMMSS(endSec);

    // Keep connection alive with NDJSON heartbeats so reverse proxies never return 504 HTML
    const stream = startNdjsonStream(res);

    try {
      const prompt = `Je bent een uiterst nauwkeurige en eerlijke volleybal-videoanalist (DataVolley / Nevobo-niveau).
Analyseer dit exacte wedstrijdfragment van ${startLabel} tot ${endLabel} (duur: ${durationSec} seconden).

STRIKTE FOCUS:
- Analyseer UITSLUITEND de aanvallen van: ${safeTeam}.
- Tel GEEN aanvallen van de tegenstander aan de overkant van het net (het team dat richting de camera speelt).
- Tel GEEN opslagen (serves), vrije ballen (free balls) zonder aanvallende intentie, of puur verdedigende passes terug over het net, tenzij het een echte aanvalspoging (smash, tipbal/prikbal, roll-shot of 2e-bal aanval) is.
- Als het team op een bepaald moment van speelhelft is gewisseld (set-wissel), meld dat expliciet in 'cameraNote' en houd je strikt aan het team dat op dat moment met de rug naar de camera speelt in zwart/geel (tenzij ze van kant wisselen — vermeld dit dan eerlijk!).

DEFINITIES POSITIE/ZONE (gezien vanaf achter het team met de rug naar de camera):
- "Buiten (Pos 4)": linksvoor bij het net
- "Midden (Pos 3)": midden bij het net (snelle middenaanval / steek / omloop)
- "Diagonaal (Pos 2)": rechtsvoor bij het net
- "Pipe (Pos 6)": achterveldaanval vanuit het midden (achter de 3-meterlijn)
- "Achterveld (Pos 1)": achterveldaanval vanaf rechtsachter (achter de 3-meterlijn)
- "Overig / 2e bal": spelverdeler-doortikbal (2e bal) of overige aanval

DEFINITIES UITKOMST:
- "Direct punt": aanval scoort direct op de vloer of via blok-uit (touché) met punt voor zwart/geel
- "Fout": aanval direct uit (zonder blokcontact), in het net, of netfout/voetfout bij de aanval
- "Geblokt": aanval wordt direct teruggeblokt door het blok van de tegenstander (kill block tegen, of direct punt tegen via blok)
- "Verdedigd/doorgespeeld": bal wordt door tegenstander verdedigd of afgeremd door blok waardoor de rally doorspeelt

TIJDSTIPPEN (ZEER BELANGRIJK):
- Geef voor elke aanval zowel \`offsetSeconds\` (aantal seconden vanaf het begin van DIT fragment: 0 t/m ${durationSec}, dus 0 = ${startLabel}) als \`absoluteTimestamp\` (exacte MM:SS in de volledige video tussen ${startLabel} en ${endLabel}).

EERLIJKHEID OVER ZICHTBAARHEID:
- Wees 100% eerlijk! Als een touché door het blok, in/uit bij de achterlijn, of het precieze balcontact door de camerahoek, afstand of snelheid NIET met 100% zekerheid te zien is:
  - Zet \`confidence\` op "Onzeker"
  - Leg in \`note\` kort in het Nederlands uit waarom (bijv. "Touché op blok niet 100% zichtbaar door camerahoek; punt ging naar zwart/geel").
- Verzin NOOIT aanvallen tijdens time-outs, setwissels of pauzes. Als er in dit fragment geen aanvallen zijn van het doelteam, geef dan een lege array \`attacks: []\` terug en licht dit toe in \`cameraNote\`.`;

      const ai = getAiClient();

      const response = await generateWithRetry(() =>
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
                    endOffset: `${Math.round(endSec)}s`,
                    fps: safeFps,
                  },
                },
                { text: prompt },
              ],
            },
          ],
          config: {
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
                    'Zeer korte observatie over dit fragment (alleen bij time-out, setwissel of slecht zicht; anders lege string).',
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
                      positionZone: {
                        type: Type.STRING,
                        description:
                          'Een van: Buiten (Pos 4), Midden (Pos 3), Diagonaal (Pos 2), Pipe (Pos 6), Achterveld (Pos 1), Overig / 2e bal',
                      },
                      outcome: {
                        type: Type.STRING,
                        description:
                          'Een van: Direct punt, Fout, Geblokt, Verdedigd/doorgespeeld',
                      },
                      confidence: {
                        type: Type.STRING,
                        description: 'Zeker of Onzeker',
                      },
                      note: {
                        type: Type.STRING,
                        description:
                          'Korte toelichting (max 10 woorden). Verplicht bij Onzeker; leeg laten bij standaard heldere aanval.',
                      },
                    },
                    required: [
                      'offsetSeconds',
                      'absoluteTimestamp',
                      'positionZone',
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
        })
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
            absFromString >= startSec - 5 &&
            absFromString <= endSec + 5
          ) {
            resolvedSeconds = Math.max(startSec, Math.min(endSec, Math.round(absFromString)));
          } else if (
            Number.isFinite(offsetNum) &&
            offsetNum >= -5 &&
            offsetNum <= durationSec + 5
          ) {
            resolvedSeconds = Math.max(
              startSec,
              Math.min(endSec, Math.round(startSec + Math.max(0, offsetNum)))
            );
          } else if (
            Number.isFinite(offsetNum) &&
            offsetNum >= startSec - 5 &&
            offsetNum <= endSec + 5
          ) {
            resolvedSeconds = Math.max(startSec, Math.min(endSec, Math.round(offsetNum)));
          } else {
            return null;
          }

          const confidence =
            String(item.confidence || '').toLowerCase().includes('onzeker')
              ? ('Onzeker' as const)
              : ('Zeker' as const);

          return {
            id: `ai-${Math.round(startSec)}-${resolvedSeconds}-${idx}-${Math.random().toString(36).slice(2, 6)}`,
            timestampSeconds: resolvedSeconds,
            timestamp: formatMMSS(resolvedSeconds),
            positionZone: normalizeZone(item.positionZone),
            outcome: normalizeOutcome(item.outcome),
            confidence,
            note: typeof item.note === 'string' ? item.note.trim() : '',
            source: 'ai' as const,
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
        error: formatted.message,
      });
    } finally {
      stream.close();
    }
  });

  app.post('/api/verify-moment', async (req, res) => {
    const { youtubeUrl, timestampSeconds, currentZone, currentOutcome, teamDescription } =
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

    const clipStart = Math.max(0, Math.round(centerSec - 7));
    const clipEnd = Math.round(centerSec + 9);
    const safeTeam =
      typeof teamDescription === 'string' && teamDescription.trim().length > 0
        ? teamDescription.trim().slice(0, 300)
        : 'Team met rug naar de camera (zwart/geel tenue, libero geel/zwart)';

    const stream = startNdjsonStream(res);

    try {
      const prompt = `Inspecteer dit korte slow-check fragment van ${formatMMSS(clipStart)} tot ${formatMMSS(clipEnd)} op hoge framerate (4 FPS).
Rond ${formatMMSS(centerSec)} is eerder een aanval geregistreerd van: ${safeTeam}.
Eerdere registratie: Positie/Zone = "${currentZone || 'onbekend'}", Uitkomst = "${currentOutcome || 'onbekend'}".

Controleer uiterst zorgvuldig en EERLIJK:
1. Is dit daadwerkelijk een aanval van het doelteam (met rug naar de camera, zwart/geel)?
2. Vanuit welke Positie/Zone komt de aanval exact?
3. Wat is het exacte balcontact en de uitkomst (Direct punt, Fout, Geblokt, Verdedigd/doorgespeeld)?
4. Als het balcontact, eventuele touché via het blok, of in/uit door de camerahoek of balsnelheid nog steeds NIET 100% zeker te zien is, zeg dat dan eerlijk (confidence = "Onzeker") en leg precies uit wat er wel en niet zichtbaar is.`;

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
            thinkingConfig: {
              thinkingLevel: ThinkingLevel.MEDIUM,
            },
            responseMimeType: 'application/json',
            responseSchema: {
              type: Type.OBJECT,
              properties: {
                isTargetTeamAttack: {
                  type: Type.BOOLEAN,
                  description: 'True als dit echt een aanval van het doelteam is, anders false.',
                },
                refinedOffsetSeconds: {
                  type: Type.NUMBER,
                  description: `Seconden vanaf start van dit 16s fragment (0 tot ${clipEnd - clipStart}) op exact moment van balcontact.`,
                },
                positionZone: {
                  type: Type.STRING,
                  description:
                    'Een van: Buiten (Pos 4), Midden (Pos 3), Diagonaal (Pos 2), Pipe (Pos 6), Achterveld (Pos 1), Overig / 2e bal',
                },
                outcome: {
                  type: Type.STRING,
                  description:
                    'Een van: Direct punt, Fout, Geblokt, Verdedigd/doorgespeeld',
                },
                confidence: {
                  type: Type.STRING,
                  description: 'Zeker of Onzeker',
                },
                note: {
                  type: Type.STRING,
                  description:
                    'Eerlijke, specifieke Nederlandse toelichting over wat zichtbaar is bij dit balcontact.',
                },
              },
              required: [
                'isTargetTeamAttack',
                'refinedOffsetSeconds',
                'positionZone',
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

      stream.send({
        type: 'result',
        isTargetTeamAttack: Boolean(parsed.isTargetTeamAttack),
        timestampSeconds: refinedSeconds,
        timestamp: formatMMSS(refinedSeconds),
        positionZone: normalizeZone(parsed.positionZone),
        outcome: normalizeOutcome(parsed.outcome),
        confidence: String(parsed.confidence || '').toLowerCase().includes('onzeker')
          ? 'Onzeker'
          : 'Zeker',
        note: typeof parsed.note === 'string' ? parsed.note.trim() : '',
      });
    } catch (err: unknown) {
      const formatted = formatApiError(err);
      stream.send({
        type: 'error',
        status: formatted.status,
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
