import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TopBar } from './components/TopBar';
import {
  VideoPlayerHandle,
  YouTubeScoutingPlayer,
} from './components/YouTubeScoutingPlayer';
import { AnalysisConfigPanel } from './components/AnalysisConfigPanel';
import { QuickTagBar } from './components/QuickTagBar';
import { AttackTable } from './components/AttackTable';
import { SummarySection } from './components/SummarySection';
import {
  AnalysisChunk,
  AttackEvent,
  buildChunks,
  buildCsvReport,
  buildMarkdownReport,
  DEFAULT_MATCH_CONFIG,
  extractYouTubeVideoId,
  MatchConfig,
  migrateLegacyZone,
  parseTimestampToSeconds,
} from './types/scouting';

const STORAGE_PREFIX = 'volleyscout_v1_';

function storageKeyFor(config: MatchConfig): string {
  const vid = extractYouTubeVideoId(config.youtubeUrl) ?? 'custom';
  return `${STORAGE_PREFIX}${vid}_${config.startTime}_${config.endTime}`;
}

async function readNdjsonResult<T extends Record<string, unknown>>(
  response: Response
): Promise<
  | { ok: true; data: T }
  | { ok: false; error: string; code?: string; retryAfterSeconds?: number }
> {
  const contentType = (response.headers.get('content-type') || '').toLowerCase();

  if (!response.ok) {
    if (contentType.includes('application/json')) {
      try {
        const errJson = (await response.json()) as {
          error?: string;
          code?: string;
          retryAfterSeconds?: number;
        };
        return {
          ok: false,
          code: errJson.code,
          retryAfterSeconds: errJson.retryAfterSeconds,
          error: errJson.error || `Serverfout (${response.status})`,
        };
      } catch {
        return { ok: false, error: `Serverfout (${response.status})` };
      }
    }
    return {
      ok: false,
      error:
        response.status === 504 || response.status === 502
          ? 'De server reageerde te traag voor dit fragment (gateway-timeout). Probeer dit blok opnieuw of kies Turbo.'
          : `Onverwachte serverreactie (${response.status}). Probeer het opnieuw.`,
    };
  }

  if (contentType.includes('application/json')) {
    try {
      const json = (await response.json()) as T & {
        error?: string;
        code?: string;
        retryAfterSeconds?: number;
      };
      if (json.error) {
        return {
          ok: false,
          code: json.code,
          retryAfterSeconds: json.retryAfterSeconds,
          error: json.error,
        };
      }
      return { ok: true, data: json };
    } catch {
      return { ok: false, error: 'Ongeldig JSON-antwoord ontvangen van de server.' };
    }
  }

  if (!response.body) {
    return { ok: false, error: 'Leeg antwoord ontvangen van de server.' };
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let finalResult: T | null = null;
  let streamError: string | null = null;
  let streamCode: string | undefined;
  let streamRetryAfter: number | undefined;

  const processLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    try {
      const msg = JSON.parse(trimmed) as Record<string, unknown>;
      if (msg.type === 'result') {
        finalResult = msg as T;
      } else if (msg.type === 'error') {
        streamError =
          typeof msg.error === 'string'
            ? msg.error
            : 'Fout tijdens video-analyse.';
        streamCode = typeof msg.code === 'string' ? msg.code : undefined;
        streamRetryAfter =
          typeof msg.retryAfterSeconds === 'number'
            ? msg.retryAfterSeconds
            : undefined;
      }
    } catch {
      // ignore non-JSON noise
    }
  };

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const line of lines) {
      processLine(line);
    }
  }
  if (buffer.trim()) {
    processLine(buffer);
  }

  if (streamError) {
    return {
      ok: false,
      code: streamCode,
      retryAfterSeconds: streamRetryAfter,
      error: streamError,
    };
  }
  if (finalResult) {
    return { ok: true, data: finalResult };
  }
  return {
    ok: false,
    error: 'De verbinding werd verbroken voordat de analyse klaar was. Probeer dit blok opnieuw.',
  };
}

function sleepWithAbort(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new DOMException('Aborted', 'AbortError'));
      return;
    }
    const timer = window.setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      window.clearTimeout(timer);
      reject(new DOMException('Aborted', 'AbortError'));
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

export default function App() {
  const [config, setConfig] = useState<MatchConfig>(DEFAULT_MATCH_CONFIG);
  const videoId = useMemo(
    () => extractYouTubeVideoId(config.youtubeUrl),
    [config.youtubeUrl]
  );
  const startSeconds = useMemo(
    () => parseTimestampToSeconds(config.startTime) ?? 1904,
    [config.startTime]
  );
  const endSeconds = useMemo(
    () => parseTimestampToSeconds(config.endTime) ?? 3180,
    [config.endTime]
  );

  const [chunks, setChunks] = useState<AnalysisChunk[]>(() =>
    buildChunks(startSeconds, endSeconds, config.chunkDurationSeconds)
  );
  const [attacks, setAttacks] = useState<AttackEvent[]>([]);
  const [currentSeconds, setCurrentSeconds] = useState<number>(startSeconds);
  const [activeAttackId, setActiveAttackId] = useState<string | null>(null);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [verifyingId, setVerifyingId] = useState<string | null>(null);
  const [isBatchAuditing, setIsBatchAuditing] = useState(false);
  const [globalError, setGlobalError] = useState<string | null>(null);
  const [statusNotice, setStatusNotice] = useState<string | null>(null);
  const [copiedFeedback, setCopiedFeedback] = useState(false);

  const playerHandleRef = useRef<VideoPlayerHandle | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Load persisted data for current video + range
  useEffect(() => {
    const freshChunks = buildChunks(
      startSeconds,
      endSeconds,
      config.chunkDurationSeconds
    );
    try {
      const savedRaw = window.localStorage.getItem(storageKeyFor(config));
      if (savedRaw) {
        const parsed = JSON.parse(savedRaw) as {
          attacks?: AttackEvent[];
          chunks?: AnalysisChunk[];
        };
        if (Array.isArray(parsed.attacks)) {
          setAttacks(
            parsed.attacks.map((a) => ({
              ...a,
              positionZone: migrateLegacyZone(String(a.positionZone)),
            }))
          );
        } else {
          setAttacks([]);
        }
        if (
          Array.isArray(parsed.chunks) &&
          parsed.chunks.length === freshChunks.length
        ) {
          setChunks(
            parsed.chunks.map((c) => ({
              ...c,
              status: c.status === 'analyzing' ? 'idle' : c.status,
            }))
          );
        } else {
          setChunks(freshChunks);
        }
      } else {
        setAttacks([]);
        setChunks(freshChunks);
      }
    } catch {
      setAttacks([]);
      setChunks(freshChunks);
    }
    setCurrentSeconds(startSeconds);
  }, [config.youtubeUrl, config.startTime, config.endTime, startSeconds, endSeconds, config.chunkDurationSeconds]);

  // Persist attacks & chunk results
  useEffect(() => {
    try {
      window.localStorage.setItem(
        storageKeyFor(config),
        JSON.stringify({ attacks, chunks })
      );
    } catch {
      // ignore storage quota errors
    }
  }, [attacks, chunks, config]);

  const analyzeChunkAt = useCallback(
    async (
      chunk: AnalysisChunk,
      signal: AbortSignal
    ): Promise<{ ok: boolean; error?: string; code?: string; retryAfterSeconds?: number }> => {
      setChunks((prev) =>
        prev.map((c) =>
          c.index === chunk.index
            ? { ...c, status: 'analyzing', errorMessage: undefined }
            : c
        )
      );

      try {
        const response = await fetch('/api/analyze-chunk', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal,
          body: JSON.stringify({
            youtubeUrl: config.youtubeUrl,
            startSeconds: chunk.startSeconds,
            endSeconds: chunk.endSeconds,
            teamDescription: config.teamDescription,
            fps: config.fps,
            speedMode: config.speedMode,
            debugMode: config.debugMode,
          }),
        });

        const parsed = await readNdjsonResult<{
          cameraNote?: string;
          attacks?: AttackEvent[];
        }>(response);

        if (!parsed.ok) {
          setChunks((prev) =>
            prev.map((c) =>
              c.index === chunk.index
                ? { ...c, status: 'error', errorMessage: parsed.error }
                : c
            )
          );
          return {
            ok: false,
            error: parsed.error,
            code: parsed.code,
            retryAfterSeconds: parsed.retryAfterSeconds,
          };
        }

        const incoming = (parsed.data.attacks ?? []).map((a) => ({
          ...a,
          positionZone: migrateLegacyZone(String(a.positionZone)),
          chunkIndex: chunk.index,
        }));

        // Replace previous AI-only rows in this chunk's window while keeping manual/verified entries
        setAttacks((prev) => {
          const kept = prev.filter((item) => {
            const inChunkRange =
              item.chunkIndex === chunk.index ||
              (item.timestampSeconds >= chunk.startSeconds &&
                item.timestampSeconds <= chunk.endSeconds);
            if (inChunkRange && item.source === 'ai') return false;
            return true;
          });
          return [...kept, ...incoming].sort(
            (a, b) => a.timestampSeconds - b.timestampSeconds
          );
        });

        setChunks((prev) =>
          prev.map((c) =>
            c.index === chunk.index
              ? {
                  ...c,
                  status: 'done',
                  attackCount: incoming.length,
                  cameraNote: parsed.data.cameraNote || undefined,
                  errorMessage: undefined,
                }
              : c
          )
        );

        return { ok: true };
      } catch (err: unknown) {
        if (err instanceof DOMException && err.name === 'AbortError') {
          setChunks((prev) =>
            prev.map((c) =>
              c.index === chunk.index ? { ...c, status: 'idle' } : c
            )
          );
          return { ok: false, error: 'ABORTED' };
        }
        const msg =
          err instanceof Error
            ? err.message
            : 'Netwerkfout tijdens het analyseren van het fragment.';
        setChunks((prev) =>
          prev.map((c) =>
            c.index === chunk.index
              ? { ...c, status: 'error', errorMessage: msg }
              : c
          )
        );
        return { ok: false, error: msg };
      }
    },
    [config.youtubeUrl, config.teamDescription, config.fps, config.speedMode, config.debugMode]
  );

  const handleStopAnalysis = useCallback(() => {
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    setIsAnalyzing(false);
    setStatusNotice('Analyse gestopt. Reeds gescande blokken blijven bewaard.');
  }, []);

  const handleAnalyzeSingleChunk = useCallback(
    async (chunkIndex: number) => {
      const target = chunks.find((c) => c.index === chunkIndex);
      if (!target || isAnalyzing) return;

      setGlobalError(null);
      setStatusNotice(null);
      const controller = new AbortController();
      abortControllerRef.current = controller;
      setIsAnalyzing(true);

      const res = await analyzeChunkAt(target, controller.signal);
      if (!res.ok && res.error && res.error !== 'ABORTED') {
        setGlobalError(res.error);
      }

      abortControllerRef.current = null;
      setIsAnalyzing(false);
    },
    [chunks, isAnalyzing, analyzeChunkAt]
  );

  const handleAnalyzeAll = useCallback(async () => {
    if (isAnalyzing) return;
    setGlobalError(null);
    setStatusNotice(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;
    setIsAnalyzing(true);

    const pendingChunks = chunks.filter((c) => c.status !== 'done');
    const queue = [...(pendingChunks.length > 0 ? pendingChunks : chunks)];
    // Use 1 steady worker for MEDIUM/HIGH resolution (2 FPS) to prevent 429 bursts; 2 staggered only in Turbo 1 FPS
    const initialConcurrency =
      config.speedMode === 'turbo' && config.fps === 1 ? 2 : 1;

    let fatalStop = false;
    let rateLimitedOnce = false;
    let cooldownUntil = 0;
    const retryMap = new Map<number, number>();

    const worker = async (workerIdx: number) => {
      // Stagger 2nd worker by 2.5s to avoid simultaneous burst
      if (workerIdx > 0) {
        try {
          await sleepWithAbort(2500 * workerIdx, controller.signal);
        } catch {
          return;
        }
      }

      while (!fatalStop && !controller.signal.aborted) {
        // If rate limit was hit, let only worker 0 finish remaining chunks calmly
        if (rateLimitedOnce && workerIdx > 0) break;

        if (Date.now() < cooldownUntil) {
          const waitMs = cooldownUntil - Date.now();
          setStatusNotice(
            `Even pauze voor API-quotum (${Math.ceil(waitMs / 1000)}s)… analyse hervat daarna automatisch.`
          );
          try {
            await sleepWithAbort(waitMs, controller.signal);
          } catch {
            return;
          }
          setStatusNotice(null);
        }

        const chunk = queue.shift();
        if (!chunk) break;

        const result = await analyzeChunkAt(chunk, controller.signal);
        if (result.ok) {
          setGlobalError(null);
          // Gentle 2.5s breather between chunks so RPM/TPM buckets stay smooth
          if (queue.length > 0) {
            try {
              await sleepWithAbort(2500, controller.signal);
            } catch {
              return;
            }
          }
          continue;
        }
        if (result.error === 'ABORTED') break;

        if (result.code === 'DAILY_QUOTA') {
          setGlobalError(
            result.error ??
              'Daglimiet bereikt op deze API-sleutel. Schakel naar Turbo of gebruik een betaalde API-sleutel via Settings > Secrets.'
          );
          fatalStop = true;
          controller.abort();
          break;
        }

        if (result.code === 'RATE_LIMIT') {
          const retries = retryMap.get(chunk.index) ?? 0;
          if (retries < 2) {
            retryMap.set(chunk.index, retries + 1);
            rateLimitedOnce = true;
            const waitSec = result.retryAfterSeconds ?? 45;
            cooldownUntil = Date.now() + waitSec * 1000;
            setChunks((prev) =>
              prev.map((c) =>
                c.index === chunk.index
                  ? {
                      ...c,
                      status: 'idle',
                      errorMessage: `Wacht ${waitSec}s op minuut-quotum en herprobeert automatisch…`,
                    }
                  : c
              )
            );
            queue.unshift(chunk);
            continue;
          }
        }

        setGlobalError(result.error ?? 'Onbekende fout tijdens video-analyse.');
        if (
          result.error &&
          (result.error.includes('API-sleutel') ||
            result.error.includes('publiek toegankelijk'))
        ) {
          fatalStop = true;
          controller.abort();
          break;
        }
      }
    };

    const workerCount = Math.min(initialConcurrency, queue.length);
    await Promise.all(Array.from({ length: workerCount }, (_, idx) => worker(idx)));

    setStatusNotice(null);
    abortControllerRef.current = null;
    setIsAnalyzing(false);
  }, [chunks, isAnalyzing, config.speedMode, config.fps, analyzeChunkAt]);

  const handleJumpToAttack = useCallback((attack: AttackEvent) => {
    setActiveAttackId(attack.id);
    const seekTarget = Math.max(0, attack.timestampSeconds - 3);
    playerHandleRef.current?.seekAndPlay(seekTarget);
  }, []);

  const handleJumpToTime = useCallback((seconds: number) => {
    playerHandleRef.current?.seekAndPlay(seconds);
  }, []);

  const handleAddManualAttack = useCallback(
    (entry: Omit<AttackEvent, 'id'>) => {
      const created: AttackEvent = {
        ...entry,
        id: `manual-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      };
      setAttacks((prev) =>
        [...prev, created].sort((a, b) => a.timestampSeconds - b.timestampSeconds)
      );
      setActiveAttackId(created.id);
    },
    []
  );

  const handleUpdateAttack = useCallback(
    (id: string, patch: Partial<AttackEvent>) => {
      setAttacks((prev) =>
        prev
          .map((item) => (item.id === id ? { ...item, ...patch } : item))
          .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
      );
    },
    []
  );

  const handleDeleteAttack = useCallback((id: string) => {
    setAttacks((prev) => prev.filter((item) => item.id !== id));
    setActiveAttackId((curr) => (curr === id ? null : curr));
  }, []);

  const handleVerifyAttack = useCallback(
    async (attack: AttackEvent) => {
      if (verifyingId || isAnalyzing) return;
      setVerifyingId(attack.id);
      setGlobalError(null);
      setStatusNotice(null);

      try {
        const res = await fetch('/api/verify-moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: config.youtubeUrl,
            timestampSeconds: attack.timestampSeconds,
            currentZone: attack.positionZone,
            currentOutcome: attack.outcome,
            teamDescription: config.teamDescription,
            debugMode: config.debugMode,
          }),
        });
        const parsed = await readNdjsonResult<{
          isTargetTeamAttack?: boolean;
          timestampSeconds?: number;
          timestamp?: string;
          positionZone?: AttackEvent['positionZone'];
          outcome?: AttackEvent['outcome'];
          confidence?: AttackEvent['confidence'];
          note?: string;
          debugCoordinates?: AttackEvent['debugCoordinates'];
        }>(res);

        if (!parsed.ok) {
          setGlobalError(parsed.error);
        } else if (parsed.data.isTargetTeamAttack === false) {
          setAttacks((prev) =>
            prev.map((item) =>
              item.id === attack.id
                ? {
                    ...item,
                    confidence: 'Onzeker',
                    debugCoordinates:
                      parsed.data.debugCoordinates ?? item.debugCoordinates,
                    note: `4 FPS hercheck: mogelijk geen aanval van zwart/geel team — ${parsed.data.note || 'controleer handmatig'}`,
                  }
                : item
            )
          );
          setStatusNotice(
            `4 FPS hercheck op ${attack.timestamp}: twijfel of dit een aanval van het zwart/gele team was. Bekijk het fragment en verwijder indien nodig.`
          );
        } else {
          const data = parsed.data;
          setAttacks((prev) =>
            prev
              .map((item) =>
                item.id === attack.id
                  ? {
                      ...item,
                      timestampSeconds:
                        data.timestampSeconds ?? item.timestampSeconds,
                      timestamp: data.timestamp ?? item.timestamp,
                      positionZone: data.positionZone ?? item.positionZone,
                      outcome: data.outcome ?? item.outcome,
                      confidence: data.confidence ?? item.confidence,
                      note: data.note || item.note,
                      debugCoordinates:
                        data.debugCoordinates ?? item.debugCoordinates,
                      source: 'geverifieerd' as const,
                    }
                  : item
              )
              .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
          );
          setStatusNotice(
            `4 FPS hercheck rond ${attack.timestamp} afgerond en bijgewerkt in de tabel.`
          );
        }
      } catch (err: unknown) {
        setGlobalError(
          err instanceof Error
            ? err.message
            : 'Netwerkfout tijdens 4 FPS hercheck.'
        );
      } finally {
        setVerifyingId(null);
      }
    },
    [verifyingId, isAnalyzing, config.youtubeUrl, config.teamDescription, config.debugMode]
  );

  const handleAuditDirectPoints = useCallback(async () => {
    if (isAnalyzing || verifyingId || isBatchAuditing) return;
    const targets = attacks
      .filter((a) => a.outcome === 'Direct punt' && a.source === 'ai')
      .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
    if (targets.length === 0) return;

    setIsBatchAuditing(true);
    setGlobalError(null);
    let correctedCount = 0;

    try {
      for (let i = 0; i < targets.length; i += 1) {
        const target = targets[i];
        setVerifyingId(target.id);
        setStatusNotice(
          `4 FPS blok-audit bezig: ${i + 1} van ${targets.length} (${target.timestamp})…`
        );

        const res = await fetch('/api/verify-moment', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            youtubeUrl: config.youtubeUrl,
            timestampSeconds: target.timestampSeconds,
            currentZone: target.positionZone,
            currentOutcome: target.outcome,
            teamDescription: config.teamDescription,
            debugMode: config.debugMode,
          }),
        });

        const parsed = await readNdjsonResult<{
          isTargetTeamAttack?: boolean;
          timestampSeconds?: number;
          timestamp?: string;
          positionZone?: AttackEvent['positionZone'];
          outcome?: AttackEvent['outcome'];
          confidence?: AttackEvent['confidence'];
          note?: string;
          debugCoordinates?: AttackEvent['debugCoordinates'];
        }>(res);

        if (!parsed.ok) {
          setGlobalError(parsed.error);
          break;
        }

        const data = parsed.data;
        if (data.isTargetTeamAttack === false) {
          correctedCount += 1;
          setAttacks((prev) =>
            prev.map((item) =>
              item.id === target.id
                ? {
                    ...item,
                    confidence: 'Onzeker',
                    debugCoordinates: data.debugCoordinates ?? item.debugCoordinates,
                    note: `4 FPS audit: mogelijk geen aanval van zwart/geel — ${data.note || 'controleer handmatig'}`,
                  }
                : item
            )
          );
        } else {
          if (data.outcome && data.outcome !== target.outcome) {
            correctedCount += 1;
          }
          setAttacks((prev) =>
            prev
              .map((item) =>
                item.id === target.id
                  ? {
                      ...item,
                      timestampSeconds: data.timestampSeconds ?? item.timestampSeconds,
                      timestamp: data.timestamp ?? item.timestamp,
                      positionZone: data.positionZone ?? item.positionZone,
                      outcome: data.outcome ?? item.outcome,
                      confidence: data.confidence ?? item.confidence,
                      note: data.note || item.note,
                      debugCoordinates: data.debugCoordinates ?? item.debugCoordinates,
                      source: 'geverifieerd' as const,
                    }
                  : item
              )
              .sort((a, b) => a.timestampSeconds - b.timestampSeconds)
          );
        }
      }

      setStatusNotice(
        `4 FPS audit van ${targets.length} Direct punten afgerond (${correctedCount} ${correctedCount === 1 ? 'uitkomst aangepast' : 'uitkomsten aangepast'}).`
      );
    } catch (err: unknown) {
      setGlobalError(
        err instanceof Error
          ? err.message
          : 'Netwerkfout tijdens 4 FPS blok-audit.'
      );
    } finally {
      setVerifyingId(null);
      setIsBatchAuditing(false);
    }
  }, [
    attacks,
    isAnalyzing,
    verifyingId,
    isBatchAuditing,
    config.youtubeUrl,
    config.teamDescription,
    config.debugMode,
  ]);

  const handleClearAll = useCallback(() => {
    setAttacks([]);
    setChunks((prev) =>
      prev.map((c) => ({
        ...c,
        status: 'idle',
        attackCount: 0,
        cameraNote: undefined,
        errorMessage: undefined,
      }))
    );
    setActiveAttackId(null);
    setStatusNotice(null);
  }, []);

  const handleCopyMarkdown = useCallback(async () => {
    const md = buildMarkdownReport(config, attacks, chunks);
    try {
      await navigator.clipboard.writeText(md);
      setCopiedFeedback(true);
      window.setTimeout(() => setCopiedFeedback(false), 2500);
    } catch {
      setGlobalError('Kopiëren naar klembord werd geblokkeerd door de browser.');
    }
  }, [config, attacks, chunks]);

  const handleDownloadCsv = useCallback(() => {
    const csv = buildCsvReport(attacks);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `aanvalsanalyse_${config.startTime.replace(':', '-')}_${config.endTime.replace(':', '-')}.csv`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  }, [attacks, config.startTime, config.endTime]);

  return (
    <div id="top" className="min-h-screen bg-[#F8F9FA] text-slate-900 flex flex-col">
      <TopBar
        isAnalyzing={isAnalyzing}
        onStartFullAnalysis={handleAnalyzeAll}
        onStopAnalysis={handleStopAnalysis}
      />

      <main className="flex-1 max-w-[1440px] w-full mx-auto px-6 py-7 space-y-7">
        {/* Page Heading & Match Context */}
        <section className="flex flex-wrap items-end justify-between gap-4">
          <div className="space-y-1 max-w-3xl">
            <div className="flex flex-wrap items-center gap-2 text-xs text-slate-500 font-medium">
              <span>YouTube Wedstrijdanalyse</span>
              <span aria-hidden="true">·</span>
              <span className="font-mono tabular-nums text-slate-700">
                {config.startTime} – {config.endTime}
              </span>
              <span aria-hidden="true">·</span>
              <span>Altijd focus op zwart/geel tenue + libero geel/zwart</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-bold tracking-tight text-slate-900 [text-wrap:balance]">
              Aanvalsanalyse &amp; Video-scouting
            </h1>
          </div>

          {statusNotice && (
            <p className="text-xs font-medium text-amber-800 bg-amber-50 border border-amber-200 px-3 py-1.5 rounded-md">
              {statusNotice}
            </p>
          )}
        </section>

        {/* Primary Split: Video Player + AI Chunk Scanner */}
        <section
          id="video-analyse"
          className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start"
        >
          <div className="lg:col-span-8 space-y-4">
            <YouTubeScoutingPlayer
              videoId={videoId}
              youtubeUrl={config.youtubeUrl}
              startSeconds={startSeconds}
              endSeconds={endSeconds}
              attacks={attacks}
              activeAttackId={activeAttackId}
              onSelectAttack={handleJumpToAttack}
              onTimeUpdate={setCurrentSeconds}
              playerHandleRef={playerHandleRef}
            />
            <QuickTagBar
              currentSeconds={currentSeconds}
              onAddManualAttack={handleAddManualAttack}
            />
          </div>

          <div className="lg:col-span-4">
            <AnalysisConfigPanel
              config={config}
              chunks={chunks}
              isAnalyzing={isAnalyzing}
              globalError={globalError}
              onUpdateConfig={setConfig}
              onAnalyzeAll={handleAnalyzeAll}
              onAnalyzeSingleChunk={handleAnalyzeSingleChunk}
              onJumpToTime={handleJumpToTime}
            />
          </div>
        </section>

        {/* 1. Attack Log Table */}
        <AttackTable
          attacks={attacks}
          activeAttackId={activeAttackId}
          isAnalyzing={isAnalyzing}
          verifyingId={verifyingId}
          isBatchAuditing={isBatchAuditing}
          debugMode={config.debugMode}
          onJumpToAttack={handleJumpToAttack}
          onUpdateAttack={handleUpdateAttack}
          onDeleteAttack={handleDeleteAttack}
          onVerifyAttack={handleVerifyAttack}
          onAuditDirectPoints={handleAuditDirectPoints}
          onClearAll={handleClearAll}
          onCopyMarkdown={handleCopyMarkdown}
          onDownloadCsv={handleDownloadCsv}
          onStartFullAnalysis={handleAnalyzeAll}
          copiedFeedback={copiedFeedback}
        />

        {/* 2. Summary & Zone Breakdown & 3. Honest Camera Notes */}
        <SummarySection
          attacks={attacks}
          chunks={chunks}
          verifyingId={verifyingId}
          isAnalyzing={isAnalyzing}
          debugMode={config.debugMode}
          onJumpToAttack={handleJumpToAttack}
          onVerifyAttack={handleVerifyAttack}
        />
      </main>

      <footer className="border-t border-slate-200 bg-white mt-12 no-print">
        <div className="max-w-[1440px] mx-auto px-6 py-4 flex flex-wrap items-center justify-between gap-4 text-xs text-slate-500">
          <span>VolleyScout — Aanvalsanalyse</span>
          <span>
            Aanvalsrendement berekend volgens standaard volleybalformule: (Direct punt − Fout − Geblokt) / Totaal aanvallen
          </span>
        </div>
      </footer>
    </div>
  );
}
