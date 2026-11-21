import { AlertTriangle, Play, RefreshCw, Loader2, ShieldCheck, ShieldAlert } from 'lucide-react';
import {
  AnalysisChunk,
  AttackEvent,
  computeAttackSummary,
  computeZoneBreakdown,
  formatDutchPercent,
  formatOutcomeLabel,
  ZoneBreakdownRow,
} from '../types/scouting';

interface SummarySectionProps {
  attacks: AttackEvent[];
  chunks: AnalysisChunk[];
  verifyingId: string | null;
  isAnalyzing: boolean;
  debugMode: boolean;
  onJumpToAttack: (attack: AttackEvent) => void;
  onVerifyAttack: (attack: AttackEvent) => void;
}

function CourtZoneDiagram({
  rows,
  attacks,
  debugMode,
}: {
  rows: ZoneBreakdownRow[];
  attacks: AttackEvent[];
  debugMode: boolean;
}) {
  const byZone = Object.fromEntries(rows.map((r) => [r.zone, r])) as Record<
    string,
    ZoneBreakdownRow
  >;

  const emptyRow = (label: string): ZoneBreakdownRow => ({
    zone: 'Overig / 2e bal',
    shortLabel: label,
    total: 0,
    scores: 0,
    errors: 0,
    blocked: 0,
    killBlocksFor: 0,
    defended: 0,
    scorePercentage: null,
    attackEfficiency: null,
  });

  const cellFill = (count: number) => {
    if (count === 0) return '#F8FAFC';
    if (count <= 3) return '#FEF3C7';
    if (count <= 8) return '#FDE68A';
    return '#F59E0B';
  };

  const p4 = byZone['Buiten (Pos 4)'] ?? emptyRow('Buiten (P4)');
  const p3 = byZone['Midden (Pos 3)'] ?? emptyRow('Midden (P3)');
  const p2 = byZone['Diagonaal (Pos 2)'] ?? emptyRow('Diagonaal (P2)');
  const p5 = byZone['Achterveld links / Pipe (Pos 5)'] ?? emptyRow('Pos 5 (Pipe)');
  const p6 = byZone['Pipe midden (Pos 6)'] ?? emptyRow('Pipe (P6)');
  const p1 = byZone['Achterveld rechts (Pos 1)'] ?? emptyRow('Pos 1');
  const other = byZone['Overig / 2e bal'] ?? emptyRow('Overig / 2e bal');

  return (
    <div className="flex flex-col justify-between w-full">
      <div className="mb-3">
        <h3 className="text-sm font-semibold text-slate-900">
          Veldverdeling — Alle 6 posities (gezien vanuit camera)
        </h3>
        <p className="text-xs text-slate-500 mt-0.5">
          Voorveld: Pos 4 · Pos 3 · Pos 2 — Achterveld (achter 3m-lijn): Pos 5 (Pipe) · Pos 6 (Pipe) · Pos 1.
        </p>
      </div>

      <svg
        viewBox="0 0 360 272"
        className="w-full max-w-[390px] h-auto border border-slate-200 rounded-lg bg-white"
        role="img"
        aria-label="Volleybalveld met aanvalsverdeling op posities 1 tot en met 6"
      >
        {/* Net line at top */}
        <rect x="20" y="16" width="320" height="8" fill="#0F172A" rx="2" />
        <text
          x="180"
          y="12"
          textAnchor="middle"
          fontSize="10"
          fill="#64748B"
          fontWeight="600"
        >
          NET (tegenstander aan overzijde)
        </text>

        {/* Court outer boundary */}
        <rect
          x="20"
          y="24"
          width="320"
          height="220"
          fill="#FFFFFF"
          stroke="#CBD5E1"
          strokeWidth="1.5"
        />

        {/* Front row zones (3m line at y=114) */}
        {/* Pos 4 - Buiten */}
        <rect x="21" y="25" width="106" height="88" fill={cellFill(p4.total)} stroke="#E2E8F0" />
        <text x="74" y="52" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F172A">
          Pos 4 · Buiten
        </text>
        <text x="74" y="75" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p4.total}
        </text>
        <text x="74" y="95" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p4.scorePercentage)} score
        </text>

        {/* Pos 3 - Midden */}
        <rect x="127" y="25" width="106" height="88" fill={cellFill(p3.total)} stroke="#E2E8F0" />
        <text x="180" y="52" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F172A">
          Pos 3 · Midden
        </text>
        <text x="180" y="75" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p3.total}
        </text>
        <text x="180" y="95" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p3.scorePercentage)} score
        </text>

        {/* Pos 2 - Diagonaal */}
        <rect x="233" y="25" width="106" height="88" fill={cellFill(p2.total)} stroke="#E2E8F0" />
        <text x="286" y="52" textAnchor="middle" fontSize="11" fontWeight="700" fill="#0F172A">
          Pos 2 · Diagonaal
        </text>
        <text x="286" y="75" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p2.total}
        </text>
        <text x="286" y="95" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p2.scorePercentage)} score
        </text>

        {/* 3-meter attack line */}
        <line
          x1="20"
          y1="114"
          x2="340"
          y2="114"
          stroke="#0F172A"
          strokeWidth="1.5"
          strokeDasharray="5 3"
        />

        {/* Back row: Pos 5 (Linksachter / Pipe), Pos 6 (Pipe midden), Pos 1 (Achterveld rechts) */}
        <rect x="21" y="115" width="106" height="128" fill={cellFill(p5.total)} stroke="#E2E8F0" />
        <text x="74" y="156" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0F172A">
          Pos 5 · Pipe/LA
        </text>
        <text x="74" y="182" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p5.total}
        </text>
        <text x="74" y="202" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p5.scorePercentage)} score
        </text>

        {/* Pos 6 - Pipe midden */}
        <rect x="127" y="115" width="106" height="128" fill={cellFill(p6.total)} stroke="#E2E8F0" />
        <text x="180" y="156" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0F172A">
          Pos 6 · Pipe mid
        </text>
        <text x="180" y="182" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p6.total}
        </text>
        <text x="180" y="202" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p6.scorePercentage)} score
        </text>

        {/* Pos 1 - Achterveld rechts */}
        <rect x="233" y="115" width="106" height="128" fill={cellFill(p1.total)} stroke="#E2E8F0" />
        <text x="286" y="156" textAnchor="middle" fontSize="10.5" fontWeight="700" fill="#0F172A">
          Pos 1 · Achterv.
        </text>
        <text x="286" y="182" textAnchor="middle" fontSize="18" fontWeight="700" fontFamily="JetBrains Mono, monospace" fill="#0F172A">
          {p1.total}
        </text>
        <text x="286" y="202" textAnchor="middle" fontSize="10" fill="#475569" fontFamily="JetBrains Mono, monospace">
          {formatDutchPercent(p1.scorePercentage)} score
        </text>

        <text x="180" y="262" textAnchor="middle" fontSize="10" fill="#64748B" fontWeight="500">
          EIGEN SPEELHELFT ZWART/GEEL (net bovenaan · 3m-lijn stippellijn)
        </text>

        {/* Debug mode: plot exact detected takeoff coordinates (takeoffX, takeoffY) */}
        {debugMode &&
          attacks
            .filter((a) => Boolean(a.debugCoordinates))
            .map((a) => {
              const d = a.debugCoordinates!;
              const cx = 21 + d.takeoffX * 318;
              const cy = 25 + d.takeoffY * 218;
              const fill =
                a.outcome === 'Direct punt'
                  ? '#15803D'
                  : a.outcome === 'Fout'
                  ? '#B91C1C'
                  : a.outcome === 'Geblokt'
                  ? '#D97706'
                  : a.outcome === 'Kill-blok mee'
                  ? '#0284C7'
                  : '#334155';
              return (
                <circle
                  key={a.id}
                  cx={cx}
                  cy={cy}
                  r={4.5}
                  fill={fill}
                  stroke="#FFFFFF"
                  strokeWidth={1.5}
                >
                  <title>{`${a.timestamp} · ${a.positionZone} · ${formatOutcomeLabel(a.outcome)} · x=${d.takeoffX.toFixed(2)}, y=${d.takeoffY.toFixed(2)}`}</title>
                </circle>
              );
            })}
      </svg>

      <div className="mt-2.5 flex items-center justify-between text-xs text-slate-600 max-w-[390px] px-1">
        <span>Overig / 2e bal (spelverdeler)</span>
        <span className="font-mono tabular-nums font-semibold text-slate-900">
          {other.total} ({formatDutchPercent(other.scorePercentage)} score)
        </span>
      </div>
      {debugMode && (
        <p className="mt-1 text-[11px] text-slate-500 max-w-[390px] px-1">
          Debug-punten op het veld tonen het exact gedetecteerde afzetpunt (x, y) per aanval.
        </p>
      )}
    </div>
  );
}

export function SummarySection({
  attacks,
  chunks,
  verifyingId,
  isAnalyzing,
  debugMode,
  onJumpToAttack,
  onVerifyAttack,
}: SummarySectionProps) {
  const summary = computeAttackSummary(attacks);
  const zoneRows = computeZoneBreakdown(attacks);
  const killBlockEvents = attacks
    .filter((a) => a.outcome === 'Geblokt' || a.outcome === 'Kill-blok mee')
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const uncertainAttacks = attacks
    .filter((a) => a.confidence === 'Onzeker')
    .sort((a, b) => a.timestampSeconds - b.timestampSeconds);
  const chunkNotes = chunks.filter((c) => Boolean(c.cameraNote));

  const efficiencyColor =
    summary.attackEfficiency === null
      ? 'text-slate-900'
      : summary.attackEfficiency >= 20
      ? 'text-emerald-700'
      : summary.attackEfficiency >= 0
      ? 'text-slate-900'
      : 'text-red-700';

  return (
    <div className="space-y-6">
      {/* 2. Samenvatting KPI Strip */}
      <section
        id="samenvatting"
        className="bg-white border border-slate-200 rounded-xl overflow-hidden"
      >
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-baseline justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              2. Samenvatting aanvalsstatistieken
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Live berekend op basis van alle geregistreerde aanvallen in de tabel hierboven.
            </p>
          </div>
          <span className="text-xs text-slate-500 font-mono tabular-nums">
            Rendement = (Scores − Fouten − Geblokt) / Totaal
          </span>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 divide-y sm:divide-y-0 sm:divide-x divide-slate-200">
          <div className="p-4">
            <div className="text-xs text-slate-500 font-medium">Totaal aanvallen</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {summary.total}
            </div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500 font-medium">Direct punt</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-emerald-700 mt-1">
              {summary.scores}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">incl. blok-uit</div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500 font-medium">Fouten</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-red-700 mt-1">
              {summary.errors}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">uit / netfout</div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500 font-medium">Kill-blok tegen</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-amber-700 mt-1">
              {summary.blocked}
            </div>
            <div className="text-[11px] text-slate-400 mt-0.5">punt tegen</div>
          </div>

          <div className="p-4">
            <div className="text-xs text-slate-500 font-medium">Verdedigd</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-700 mt-1">
              {summary.defended}
            </div>
          </div>

          <div className="p-4 bg-slate-50/70">
            <div className="text-xs text-slate-600 font-semibold">Scorepercentage</div>
            <div className="text-2xl font-bold font-mono tabular-nums text-slate-900 mt-1">
              {formatDutchPercent(summary.scorePercentage)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
              {summary.total > 0 ? `${summary.scores} / ${summary.total}` : '—'}
            </div>
          </div>

          <div className="p-4 bg-amber-50/50">
            <div className="text-xs text-slate-700 font-semibold">Aanvalsrendement</div>
            <div className={`text-2xl font-bold font-mono tabular-nums mt-1 ${efficiencyColor}`}>
              {formatDutchPercent(summary.attackEfficiency, true)}
            </div>
            <div className="text-[11px] text-slate-500 font-mono tabular-nums mt-0.5">
              {summary.total > 0
                ? `(${summary.scores}−${summary.errors}−${summary.blocked}) / ${summary.total}`
                : '—'}
            </div>
          </div>
        </div>

        {/* Dedicated Kill-blokken apart (punt voor vs. punt tegen) */}
        <div className="border-t border-slate-200 bg-slate-50/60 px-5 py-4 space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h3 className="text-sm font-semibold text-slate-900">
                Kill-blokken apart — Punt vóór vs. Punt tegen
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Eigen kill-blokken (mee) tellen niet mee in het aanvalstotaal, zodat het aanvalsrendement zuiver blijft.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-5 text-xs font-mono tabular-nums">
              <div className="flex items-center gap-2">
                <ShieldCheck className="w-4 h-4 text-sky-700" aria-hidden="true" />
                <span className="font-sans text-slate-600">Kill-blok mee (punt voor):</span>
                <span className="text-base font-bold text-sky-700">{summary.killBlocksFor}</span>
              </div>
              <div className="flex items-center gap-2">
                <ShieldAlert className="w-4 h-4 text-amber-700" aria-hidden="true" />
                <span className="font-sans text-slate-600">Kill-blok tegen (punt tegen):</span>
                <span className="text-base font-bold text-amber-700">{summary.killBlocksAgainst}</span>
              </div>
              <div className="flex items-center gap-2 pl-4 border-l border-slate-300">
                <span className="font-sans text-slate-600">Blok-saldo:</span>
                <span
                  className={`text-base font-bold ${
                    summary.blockBalance > 0
                      ? 'text-emerald-700'
                      : summary.blockBalance < 0
                      ? 'text-red-700'
                      : 'text-slate-800'
                  }`}
                >
                  {summary.blockBalance > 0 ? `+${summary.blockBalance}` : summary.blockBalance}
                </span>
              </div>
            </div>
          </div>

          {killBlockEvents.length > 0 && (
            <div className="flex flex-wrap gap-2 pt-1">
              {killBlockEvents.map((kb) => (
                <button
                  key={kb.id}
                  type="button"
                  onClick={() => onJumpToAttack(kb)}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1 text-xs rounded-md border bg-white hover:bg-slate-50 transition-colors cursor-pointer ${
                    kb.outcome === 'Kill-blok mee'
                      ? 'border-sky-200 text-sky-900'
                      : 'border-amber-200 text-amber-900'
                  }`}
                >
                  <Play className="w-2.5 h-2.5 fill-current" aria-hidden="true" />
                  <span className="font-mono tabular-nums font-semibold">{kb.timestamp}</span>
                  <span>·</span>
                  <span>
                    {kb.outcome === 'Kill-blok mee' ? 'Mee (+)' : 'Tegen (−)'} · {kb.positionZone}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Zone breakdown + Court Diagram */}
      <section
        id="zone-overzicht"
        className="bg-white border border-slate-200 rounded-xl p-5 grid grid-cols-1 lg:grid-cols-12 gap-8 items-start"
      >
        <div className="lg:col-span-7 overflow-x-auto">
          <div className="mb-3">
            <h3 className="text-sm font-semibold text-slate-900">
              Verdeling per Positie/Zone
            </h3>
            <p className="text-xs text-slate-500 mt-0.5">
              Aanvalsvolume, scores, fouten, kill-blokken tegen (−) &amp; mee (+) en rendement per spelzone.
            </p>
          </div>

          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="border-b border-slate-200 text-slate-500 font-semibold">
                <th className="py-2 pr-3">Positie/Zone</th>
                <th className="py-2 px-2 text-right">Aanv.</th>
                <th className="py-2 px-2 text-right">Punt</th>
                <th className="py-2 px-2 text-right">Fout</th>
                <th className="py-2 px-2 text-right" title="Kill-blok tegen (punt tegen)">Blok −</th>
                <th className="py-2 px-2 text-right" title="Eigen kill-blok mee (punt voor)">Blok +</th>
                <th className="py-2 px-2 text-right">Verd.</th>
                <th className="py-2 px-2 text-right">Score %</th>
                <th className="py-2 pl-2 text-right">Rendement</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {zoneRows.map((row) => (
                <tr key={row.zone} className="hover:bg-slate-50/80">
                  <td className="py-2.5 pr-3 font-medium text-slate-800 whitespace-nowrap">
                    {row.zone}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {row.total}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-emerald-700">
                    {row.scores}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-red-700">
                    {row.errors}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-amber-700">
                    {row.blocked}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-sky-700">
                    {row.killBlocksFor}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-600">
                    {row.defended}
                  </td>
                  <td className="py-2.5 px-2 text-right font-mono tabular-nums text-slate-800">
                    {formatDutchPercent(row.scorePercentage)}
                  </td>
                  <td className="py-2.5 pl-2 text-right font-mono tabular-nums font-semibold text-slate-900">
                    {formatDutchPercent(row.attackEfficiency, true)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="lg:col-span-5 lg:pl-6 lg:border-l lg:border-slate-200 flex justify-center lg:justify-start">
          <CourtZoneDiagram rows={zoneRows} attacks={attacks} debugMode={debugMode} />
        </div>
      </section>

      {/* 3. Eerlijke camerahoek- & betrouwbaarheidsbeoordeling */}
      <section className="bg-white border border-slate-200 rounded-xl overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-200 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h2 className="text-base font-bold text-slate-900">
              3. Eerlijke beoordeling — Zichtbaarheid &amp; camerahoek
            </h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Momenten waarop een touché, blokcontact of in/uit-beoordeling door camerahoek of snelheid niet 100% zeker is.
            </p>
          </div>
          <span className="text-xs font-mono tabular-nums text-slate-600">
            {uncertainAttacks.length} onzekere {uncertainAttacks.length === 1 ? 'aanval' : 'aanvallen'}
          </span>
        </div>

        <div className="p-5 space-y-5">
          {uncertainAttacks.length === 0 ? (
            <p className="text-xs text-slate-600 leading-relaxed">
              {attacks.length === 0
                ? 'Zodra de video-analyse loopt, worden alle twijfelgevallen (zoals snelle touché-ballen of verre lijnballen) hier eerlijk en apart uitgelicht.'
                : 'Er zijn momenteel geen aanvallen gemarkeerd als onzeker. Gebruik de 4 FPS check of de slow-motion speler als je een specifieke rally wilt hercontroleren.'}
            </p>
          ) : (
            <div className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
              {uncertainAttacks.map((item) => {
                const isVerifying = verifyingId === item.id;
                return (
                  <div
                    key={item.id}
                    className="px-4 py-3 flex flex-wrap items-center justify-between gap-3 bg-amber-50/30"
                  >
                    <div className="min-w-0 space-y-0.5">
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <AlertTriangle
                          className="w-3.5 h-3.5 text-amber-600 shrink-0"
                          aria-hidden="true"
                        />
                        <button
                          type="button"
                          onClick={() => onJumpToAttack(item)}
                          className="font-mono tabular-nums font-semibold text-slate-900 hover:text-amber-700 underline-offset-2 hover:underline cursor-pointer"
                        >
                          {item.timestamp}
                        </button>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="font-medium text-slate-800">{item.positionZone}</span>
                        <span className="text-slate-300" aria-hidden="true">
                          ·
                        </span>
                        <span className="text-slate-700">{formatOutcomeLabel(item.outcome)}</span>
                      </div>
                      <p className="text-xs text-slate-600 pl-5">
                        {item.note || 'Balcontact niet 100% zeker zichtbaar door camerahoek of balsnelheid.'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 no-print">
                      <button
                        type="button"
                        onClick={() => onJumpToAttack(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-700 hover:text-slate-900 bg-white border border-slate-200 rounded-md cursor-pointer"
                      >
                        <Play className="w-3 h-3 fill-current" aria-hidden="true" />
                        <span>Bekijk</span>
                      </button>
                      <button
                        type="button"
                        disabled={isVerifying || isAnalyzing}
                        onClick={() => onVerifyAttack(item)}
                        className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-slate-900 bg-amber-100 hover:bg-amber-200/80 border border-amber-300 rounded-md disabled:opacity-45 cursor-pointer"
                      >
                        {isVerifying ? (
                          <Loader2 className="w-3 h-3 animate-spin" aria-hidden="true" />
                        ) : (
                          <RefreshCw className="w-3 h-3" aria-hidden="true" />
                        )}
                        <span>Hercheck (4 FPS)</span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {chunkNotes.length > 0 && (
            <div className="pt-2 border-t border-slate-200 space-y-2">
              <h3 className="text-xs font-semibold text-slate-700">
                Algemene fragment-observaties uit de AI-scan
              </h3>
              <ul className="space-y-1.5 text-xs text-slate-600">
                {chunkNotes.map((c) => (
                  <li key={c.index} className="flex items-baseline gap-2">
                    <span className="font-mono tabular-nums font-medium text-slate-800 shrink-0">
                      {c.label}
                    </span>
                    <span className="text-slate-300" aria-hidden="true">
                      —
                    </span>
                    <span>{c.cameraNote}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
