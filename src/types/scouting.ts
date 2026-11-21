export type AttackZone =
  | 'Buiten (Pos 4)'
  | 'Midden (Pos 3)'
  | 'Diagonaal (Pos 2)'
  | 'Achterveld links / Pipe (Pos 5)'
  | 'Pipe midden (Pos 6)'
  | 'Achterveld rechts (Pos 1)'
  | 'Overig / 2e bal';

export type AttackOutcome =
  | 'Direct punt'
  | 'Fout'
  | 'Geblokt'
  | 'Kill-blok mee'
  | 'Verdedigd/doorgespeeld';

export type ConfidenceLevel = 'Zeker' | 'Onzeker';

export type BlockContactType =
  | 'geen-blok'
  | 'kill-blok-tegen'
  | 'kill-blok-mee-zwart-geel'
  | 'blok-touch-uit-voor-zwart-geel'
  | 'blok-verdedigd'
  | 'onduidelijk';

export type TeamSignal = 'zwart-geel' | 'tegenstander' | 'rally-door' | 'onduidelijk';

export type ScoreboardCue = 'zwart-geel-omhoog' | 'tegenstander-omhoog' | 'niet-leesbaar';

export interface ZoneCoordinateDebug {
  takeoffX: number; // 0.00 (links in eigen veld) -> 1.00 (rechts in eigen veld)
  takeoffY: number; // 0.00 (bij net) -> 0.33 (3m-lijn) -> 1.00 (achterlijn)
  courtSide: 'nabij' | 'ver';
  behindThreeMeterLine: boolean;
  rawZoneLabel: string;
  resolvedBy: 'model' | 'coordinaten-correctie';
  reasoning: string;
  blockContact?: BlockContactType;
  ballLandingSide?: string;
  celebratingTeam?: 'zwart-geel' | 'tegenstander' | 'geen-rally-door' | 'onduidelijk';
  nextServerTeam?: 'zwart-geel' | 'tegenstander' | 'rally-door' | 'niet-zichtbaar';
  scoreboardCue?: ScoreboardCue;
  pointWinner?: TeamSignal;
  rawOutcomeLabel?: string;
  outcomeResolvedBy?: 'model' | 'uitkomst-correctie';
}

export interface AttackEvent {
  id: string;
  timestampSeconds: number;
  timestamp: string; // MM:SS
  positionZone: AttackZone;
  outcome: AttackOutcome;
  confidence: ConfidenceLevel;
  note: string;
  source: 'ai' | 'handmatig' | 'geverifieerd';
  chunkIndex?: number;
  debugCoordinates?: ZoneCoordinateDebug;
}

export interface AnalysisChunk {
  index: number;
  startSeconds: number;
  endSeconds: number;
  label: string;
  status: 'idle' | 'analyzing' | 'done' | 'error';
  attackCount: number;
  cameraNote?: string;
  errorMessage?: string;
}

export type AnalysisSpeedMode = 'turbo' | 'balanced' | 'precise';

export interface MatchConfig {
  youtubeUrl: string;
  startTime: string; // MM:SS
  endTime: string;   // MM:SS
  teamDescription: string;
  fps: 1 | 2 | 3;
  chunkDurationSeconds: number;
  speedMode: AnalysisSpeedMode;
  debugMode: boolean;
}

export interface AttackSummary {
  total: number; // Totaal aantal eigen aanvallen (excl. eigen defensieve kill-blokken mee)
  scores: number; // Direct punt (incl. blok-uit)
  errors: number; // Fouten (uitgeslagen ballen & netfouten)
  blocked: number; // Kill-blok tegen (punt tegen zwart/geel)
  defended: number;
  killBlocksFor: number; // Eigen kill-blok mee (punt voor zwart/geel)
  killBlocksAgainst: number; // Kill-blok tegen (punt tegen zwart/geel)
  blockBalance: number; // killBlocksFor - killBlocksAgainst
  uncertainCount: number;
  scorePercentage: number | null;
  attackEfficiency: number | null;
}

export interface ZoneBreakdownRow {
  zone: AttackZone;
  shortLabel: string;
  total: number;
  scores: number;
  errors: number;
  blocked: number;
  killBlocksFor: number;
  defended: number;
  scorePercentage: number | null;
  attackEfficiency: number | null;
}

export const ATTACK_ZONES: AttackZone[] = [
  'Buiten (Pos 4)',
  'Midden (Pos 3)',
  'Diagonaal (Pos 2)',
  'Achterveld links / Pipe (Pos 5)',
  'Pipe midden (Pos 6)',
  'Achterveld rechts (Pos 1)',
  'Overig / 2e bal',
];

export const ATTACK_OUTCOMES: AttackOutcome[] = [
  'Direct punt',
  'Fout',
  'Geblokt',
  'Kill-blok mee',
  'Verdedigd/doorgespeeld',
];

export function formatOutcomeLabel(outcome: AttackOutcome): string {
  switch (outcome) {
    case 'Geblokt':
      return 'Kill-blok tegen';
    case 'Kill-blok mee':
      return 'Kill-blok mee';
    default:
      return outcome;
  }
}

export function formatOutcomeOptionLabel(outcome: AttackOutcome): string {
  switch (outcome) {
    case 'Direct punt':
      return 'Direct punt (incl. blok-uit)';
    case 'Fout':
      return 'Fout (uit / netfout)';
    case 'Geblokt':
      return 'Kill-blok tegen (punt tegen)';
    case 'Kill-blok mee':
      return 'Kill-blok mee (punt voor)';
    case 'Verdedigd/doorgespeeld':
      return 'Verdedigd/doorgespeeld';
  }
}

export const TARGET_TEAM_IDENTITY =
  'Altijd het team in zwart/geel tenue met 1 libero in geel/zwart (ongeacht aan welke kant van het net zij spelen)';

export const DEFAULT_MATCH_CONFIG: MatchConfig = {
  youtubeUrl: 'https://www.youtube.com/watch?v=qAru-EPNss4',
  startTime: '31:44',
  endTime: '53:00',
  teamDescription: TARGET_TEAM_IDENTITY,
  fps: 1,
  chunkDurationSeconds: 150, // 2m30s blokken @ 1 FPS (~15k tokens/blok) — voorkomt 429 quotum-pieken
  speedMode: 'balanced',
  debugMode: true,
};

export function migrateLegacyZone(zone: string): AttackZone {
  if ((ATTACK_ZONES as string[]).includes(zone)) return zone as AttackZone;
  if (zone === 'Pipe (Pos 6)') return 'Pipe midden (Pos 6)';
  if (zone === 'Achterveld (Pos 1)') return 'Achterveld rechts (Pos 1)';
  return 'Overig / 2e bal';
}

export function extractYouTubeVideoId(url: string): string | null {
  try {
    const parsed = new URL(url.trim());
    if (parsed.hostname === 'youtu.be') {
      const id = parsed.pathname.replace('/', '').trim();
      return /^[a-zA-Z0-9_-]{11}$/.test(id) ? id : null;
    }
    if (
      parsed.hostname === 'www.youtube.com' ||
      parsed.hostname === 'youtube.com' ||
      parsed.hostname === 'm.youtube.com'
    ) {
      const v = parsed.searchParams.get('v');
      if (v && /^[a-zA-Z0-9_-]{11}$/.test(v)) return v;
      const match = parsed.pathname.match(/\/(embed|shorts|live)\/([a-zA-Z0-9_-]{11})/);
      if (match) return match[2];
    }
    return null;
  } catch {
    return null;
  }
}

export function parseTimestampToSeconds(value: string): number | null {
  const cleaned = value.trim();
  const parts = cleaned.split(':').map((p) => Number(p));
  if (parts.some((n) => !Number.isFinite(n) || n < 0)) return null;
  if (parts.length === 2) {
    const [m, s] = parts;
    if (s >= 60) return null;
    return Math.round(m * 60 + s);
  }
  if (parts.length === 3) {
    const [h, m, s] = parts;
    if (m >= 60 || s >= 60) return null;
    return Math.round(h * 3600 + m * 60 + s);
  }
  return null;
}

export function formatSecondsToMMSS(totalSeconds: number): string {
  const safe = Math.max(0, Math.round(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

export function buildChunks(
  startSeconds: number,
  endSeconds: number,
  chunkDurationSeconds: number
): AnalysisChunk[] {
  if (endSeconds <= startSeconds) return [];
  const step = Math.max(60, Math.min(360, chunkDurationSeconds));
  const chunks: AnalysisChunk[] = [];
  let cursor = startSeconds;
  let index = 0;

  while (cursor < endSeconds) {
    const nextEnd = Math.min(endSeconds, cursor + step);
    // Avoid a tiny trailing sliver (< 45s) by extending the previous chunk
    if (endSeconds - nextEnd > 0 && endSeconds - nextEnd < 45) {
      chunks.push({
        index,
        startSeconds: cursor,
        endSeconds,
        label: `${formatSecondsToMMSS(cursor)} – ${formatSecondsToMMSS(endSeconds)}`,
        status: 'idle',
        attackCount: 0,
      });
      break;
    }
    chunks.push({
      index,
      startSeconds: cursor,
      endSeconds: nextEnd,
      label: `${formatSecondsToMMSS(cursor)} – ${formatSecondsToMMSS(nextEnd)}`,
      status: 'idle',
      attackCount: 0,
    });
    cursor = nextEnd;
    index += 1;
  }

  return chunks;
}

export function computeAttackSummary(attacks: AttackEvent[]): AttackSummary {
  let total = 0;
  let scores = 0;
  let errors = 0;
  let blocked = 0;
  let defended = 0;
  let killBlocksFor = 0;
  let uncertainCount = 0;

  for (const attack of attacks) {
    if (attack.outcome === 'Kill-blok mee') {
      killBlocksFor += 1;
    } else {
      total += 1;
      if (attack.outcome === 'Direct punt') scores += 1;
      else if (attack.outcome === 'Fout') errors += 1;
      else if (attack.outcome === 'Geblokt') blocked += 1;
      else defended += 1;
    }

    if (attack.confidence === 'Onzeker') uncertainCount += 1;
  }

  const scorePercentage = total > 0 ? (scores / total) * 100 : null;
  const attackEfficiency =
    total > 0 ? ((scores - errors - blocked) / total) * 100 : null;

  return {
    total,
    scores,
    errors,
    blocked,
    defended,
    killBlocksFor,
    killBlocksAgainst: blocked,
    blockBalance: killBlocksFor - blocked,
    uncertainCount,
    scorePercentage,
    attackEfficiency,
  };
}

export function computeZoneBreakdown(attacks: AttackEvent[]): ZoneBreakdownRow[] {
  const shortLabels: Record<AttackZone, string> = {
    'Buiten (Pos 4)': 'Buiten (P4)',
    'Midden (Pos 3)': 'Midden (P3)',
    'Diagonaal (Pos 2)': 'Diagonaal (P2)',
    'Achterveld links / Pipe (Pos 5)': 'Linksachter / Pipe (P5)',
    'Pipe midden (Pos 6)': 'Pipe midden (P6)',
    'Achterveld rechts (Pos 1)': 'Achterveld (P1)',
    'Overig / 2e bal': 'Overig / 2e bal',
  };

  return ATTACK_ZONES.map((zone) => {
    const items = attacks.filter((a) => a.positionZone === zone);
    const s = computeAttackSummary(items);
    return {
      zone,
      shortLabel: shortLabels[zone],
      total: s.total,
      scores: s.scores,
      errors: s.errors,
      blocked: s.blocked,
      killBlocksFor: s.killBlocksFor,
      defended: s.defended,
      scorePercentage: s.scorePercentage,
      attackEfficiency: s.attackEfficiency,
    };
  });
}

export function formatDutchPercent(value: number | null, signed = false): string {
  if (value === null) return '—';
  const sign = signed && value > 0 ? '+' : '';
  return `${sign}${value.toFixed(1).replace('.', ',')}%`;
}

export function buildMarkdownReport(
  config: MatchConfig,
  attacks: AttackEvent[],
  chunks: AnalysisChunk[]
): string {
  const sorted = [...attacks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const summary = computeAttackSummary(sorted);
  const killBlocks = sorted.filter(
    (a) => a.outcome === 'Geblokt' || a.outcome === 'Kill-blok mee'
  );

  const lines: string[] = [
    `# Aanvals- & Blokanalyse (${config.startTime} – ${config.endTime})`,
    '',
    `- **Video**: ${config.youtubeUrl}`,
    `- **Focus**: ${config.teamDescription}`,
    '',
    '## 1. Tabel per aanval & kill-blok',
    '',
    '| Tijdstip | Positie/Zone | Uitkomst | Zekerheid / Toelichting |',
    '| :--- | :--- | :--- | :--- |',
  ];

  if (sorted.length === 0) {
    lines.push('| — | Nog geen acties geregistreerd | — | — |');
  } else {
    for (const row of sorted) {
      const conf =
        row.confidence === 'Onzeker'
          ? `Niet 100% zeker — ${row.note || 'camerahoek/snelheid'}`
          : row.note || 'Zeker';
      lines.push(
        `| ${row.timestamp} | ${row.positionZone} | ${formatOutcomeOptionLabel(row.outcome)} | ${conf.replace(/\|/g, '/')} |`
      );
    }
  }

  lines.push(
    '',
    '## 2. Samenvatting aanvallen',
    '',
    `- **Totaal aantal aanvallen**: ${summary.total}`,
    `- **Aantal scores (Direct punt, incl. blok-uit)**: ${summary.scores}`,
    `- **Aantal fouten (uit / netfout)**: ${summary.errors}`,
    `- **Aantal kill-blokken tegen (Geblokt — punt tegen)**: ${summary.killBlocksAgainst}`,
    `- **Verdedigd / doorgespeeld**: ${summary.defended}`,
    `- **Scorepercentage**: ${formatDutchPercent(summary.scorePercentage)}`,
    `- **Aanvalsrendement** *(Scores − Fouten − Kill-blok tegen) / Totaal*: ${formatDutchPercent(summary.attackEfficiency, true)}`,
    '',
    '## 3. Kill-blokken (apart — punt vóór & punt tegen)',
    '',
    `- **Kill-blok mee (punt voor zwart/geel)**: ${summary.killBlocksFor}`,
    `- **Kill-blok tegen (punt tegen zwart/geel)**: ${summary.killBlocksAgainst}`,
    `- **Blok-saldo (mee − tegen)**: ${summary.blockBalance > 0 ? `+${summary.blockBalance}` : summary.blockBalance}`,
    ''
  );

  if (killBlocks.length > 0) {
    lines.push('| Tijdstip | Type | Positie/Zone | Toelichting |', '| :--- | :--- | :--- | :--- |');
    for (const kb of killBlocks) {
      lines.push(
        `| ${kb.timestamp} | ${formatOutcomeOptionLabel(kb.outcome)} | ${kb.positionZone} | ${(kb.note || '—').replace(/\|/g, '/')} |`
      );
    }
    lines.push('');
  }

  const uncertainRows = sorted.filter((a) => a.confidence === 'Onzeker');
  const chunkNotes = chunks.filter((c) => c.cameraNote);

  if (uncertainRows.length > 0 || chunkNotes.length > 0) {
    lines.push('## 4. Kanttekeningen over camerahoek & zichtbaarheid', '');
    if (uncertainRows.length > 0) {
      lines.push(
        `Bij **${uncertainRows.length}** acties was het balcontact of de uitkomst door de camerahoek of snelheid niet met 100% zekerheid vast te stellen:`
      );
      for (const u of uncertainRows) {
        lines.push(
          `- **${u.timestamp}** (${u.positionZone}, ${formatOutcomeLabel(u.outcome)}): ${u.note || 'Onzeker balcontact'}`
        );
      }
      lines.push('');
    }
    if (chunkNotes.length > 0) {
      for (const c of chunkNotes) {
        lines.push(`- Fragment ${c.label}: ${c.cameraNote}`);
      }
    }
  }

  return lines.join('\n');
}

export function buildCsvReport(attacks: AttackEvent[]): string {
  const sorted = [...attacks].sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const header = ['Tijdstip', 'Seconden', 'Positie/Zone', 'Uitkomst', 'Zekerheid', 'Notitie', 'Bron'];
  const escapeCsv = (val: string | number) => {
    const str = String(val);
    if (/[",;\n]/.test(str)) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };
  const rows = sorted.map((a) =>
    [
      a.timestamp,
      a.timestampSeconds,
      a.positionZone,
      formatOutcomeOptionLabel(a.outcome),
      a.confidence,
      a.note,
      a.source,
    ]
      .map(escapeCsv)
      .join(';')
  );
  return [header.join(';'), ...rows].join('\n');
}
