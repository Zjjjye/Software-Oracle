import React, { useState, useRef, useMemo, useEffect } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { OrbitControls, Float, Stars, Environment } from '@react-three/drei';
import { motion, AnimatePresence } from 'framer-motion';
import { Loader2, ArrowRight, Github, Sparkles } from 'lucide-react';
import * as THREE from 'three';

// --- Types ---
interface AnalysisItem {
  metric: string;
  element: string;
  reason: string;
  logic_chain?: string;
}

type Elements = { metal: number; wood: number; water: number; fire: number; earth: number };

interface OracleResult {
  elements: Elements;
  hexagram: string;
  judgment: string;
  forecast: string;
  advice: string;
  repoStars?: number;
  repoForks?: number;
  repoLanguage?: string;
  repoCreatedAt?: string;
  repoPushedAt?: string;
  repoOpenIssues?: number;
  repoSize?: number;
  repoLicense?: string;
  repoSubscribersCount?: number;
  bazi?: string;
  destiny_type?: string;
  innate_elements?: Elements;
  acquired_elements?: Elements;
  analysis?: AnalysisItem[];
  lifecycle?: { stage: string; hexagram: string; ageYears: number; focus: string; warning: string };
}

// --- Constants ---
function toNum(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : 0.2;
}

const ELEMENT_COLORS: Record<keyof OracleResult['elements'], string> = {
  metal: '#E5E7EB',
  wood: '#10B981',
  water: '#3B82F6',
  fire: '#EF4444',
  earth: '#B45309',
};

const API_BASE = '';

/** 将 ISO 日期格式化为 Repository Natal Date 展示用（日期 + 时间精确到分钟） */
function formatNatalDate(iso: string): string {
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    const day = d.getDate();
    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const month = months[d.getMonth()];
    const year = d.getFullYear();
    const h = d.getHours();
    const m = d.getMinutes();
    const time = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
    return `${day} ${month} ${year}, ${time}`;
  } catch {
    return iso;
  }
}

/** 根据 repoCreatedAt 计算仓库年龄（年） */
function getRepoAgeYears(iso: string): number {
  try {
    const created = new Date(iso).getTime();
    if (Number.isNaN(created)) return 0;
    return (Date.now() - created) / (365.25 * 24 * 60 * 60 * 1000);
  } catch {
    return 0;
  }
}

/** 判断 analysis 中是否已有基于生辰的条目 */
function hasNatalAnalysis(items: AnalysisItem[]): boolean {
  const natalKeys = ['生辰', '仓库年龄', 'Repository Age', '创建时间', 'Natal', 'birthDate'];
  return items.some(
    (i) =>
      natalKeys.some((k) => i.metric?.includes(k) || i.reason?.includes(k)) ||
      /年龄|创建于|诞生于/.test(i.reason || '')
  );
}

/** 生成基于生辰的兜底因果拆解（当 AI 未返回时使用） */
function buildNatalAnalysisFallback(repoCreatedAt: string): AnalysisItem {
  const years = getRepoAgeYears(repoCreatedAt);
  const dateStr = formatNatalDate(repoCreatedAt);
  const isOld = years >= 8;
  const element = isOld ? '土' : '木';
  const reason =
    years >= 10
      ? `仓库创建于 ${dateStr}，至今已逾 ${years.toFixed(0)} 年，属老成之象。年深日久沉淀土性与金性，根基稳固、器质坚硬，宜守成与稳健迭代。`
      : years >= 5
        ? `仓库创建于 ${dateStr}，迄今约 ${years.toFixed(0)} 年，处于成熟期。土金渐显，既有活力又见沉淀，宜平衡创新与稳定。`
        : `仓库创建于 ${dateStr}，至今约 ${years.toFixed(0)} 年，属新生之象。木火之气较旺，生机勃发，宜顺势生长、快速迭代。`;
  return { metric: 'Repository Natal Date / 生辰', element, reason };
}

/** 若 analysis 中缺少土属性条目，返回一条兜底的土属性因果拆解 */
function buildEarthAnalysisFallback(): AnalysisItem {
  return {
    metric: 'Stability / 稳固性',
    element: '土',
    reason: '土主沉淀与根基。建议通过文档完备度、测试覆盖、CI 稳定性与依赖管理来补足土性，使项目根基稳固、可长期维护。',
  };
}

/** 判断 analysis 中是否已有某属性的条目 */
function hasElementInAnalysis(items: AnalysisItem[], element: string): boolean {
  return items.some((i) => i.element === element || i.element?.includes(element));
}

// --- 因果链：底层数据源 -> 命理转化 -> 现实影响 ---
function getDataSourceLabel(item: AnalysisItem, data: OracleResult): string {
  const m = (item.metric || '').toLowerCase();
  const hasStars = data.repoStars != null && (m.includes('star') || m.includes('火') || m.includes('影响力') || m.includes('flow') || m.includes('influence'));
  const hasForks = data.repoForks != null && (m.includes('fork') || m.includes('水') || m.includes('流动') || m.includes('flow'));
  if (hasStars && hasForks) return `Stars ${data.repoStars!.toLocaleString()} & Forks ${data.repoForks!.toLocaleString()}`;
  if (hasStars) return `Stars ${data.repoStars!.toLocaleString()}`;
  if (hasForks) return `Forks ${data.repoForks!.toLocaleString()}`;
  if (/生辰|natal|repository age|创建|诞生/i.test(item.metric || '') && data.repoCreatedAt)
    return `created_at ${formatNatalDate(data.repoCreatedAt)}`;
  return item.metric || '—';
}

function getInterpretationLabel(item: AnalysisItem): string {
  const r = (item.reason || '').slice(0, 80);
  const m = (item.metric || '').toLowerCase();
  if (m.includes('金木') || /金木相战|architecture.*flexibility/i.test(m + r)) return '金木相战';
  if (m.includes('水火') || /水火既济|flow.*influence/i.test(m + r)) return '水火既济';
  if (m.includes('火多土') || /火多土焦|community.*documentation/i.test(m + r)) return '火多土焦';
  if (m.includes('土多金') || /土多金埋/.test(r)) return '土多金埋';
  if (m.includes('命格') || m.includes('destiny')) return '命格与后天因果';
  const el = item.element || '—';
  return `${el}性显`;
}

function CausalChain({
  item,
  data,
  reasonHighlight,
}: {
  item: AnalysisItem;
  data: OracleResult;
  reasonHighlight: React.ReactNode;
}) {
  const dataSource = getDataSourceLabel(item, data);
  const interpretation = getInterpretationLabel(item);
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-white/50">
        <span className="font-mono text-white/40">{dataSource}</span>
        <ArrowRight className="h-3 w-3 shrink-0 text-white/30" aria-hidden />
        <span className="rounded px-1.5 py-0.5 bg-amber-500/15 text-amber-200/90" title="命理结论">
          {interpretation}
        </span>
      </div>
      <p className="text-sm text-white/50 leading-relaxed">{reasonHighlight}</p>
    </div>
  );
}

// --- 五行生克关系图（相生绿、相克红）---
const WUXING_ORDER = ['金', '水', '木', '火', '土'] as const;
const SHENG: [string, string][] = [['金', '水'], ['水', '木'], ['木', '火'], ['火', '土'], ['土', '金']];
const KE: [string, string][] = [['金', '木'], ['木', '土'], ['土', '水'], ['水', '火'], ['火', '金']];

function extractElementPairs(analysis: AnalysisItem[]): Set<string> {
  const pairs = new Set<string>();
  const text = analysis.map((a) => `${a.metric} ${a.reason} ${a.element}`).join(' ');
  const two = /金木|木金|水火|火水|火土|土火|土金|金土|木土|土木|水木|木水|金水|水金|火金|金火/g;
  let match;
  while ((match = two.exec(text)) !== null) {
    const [a, b] = [match[0][0], match[0][1]];
    pairs.add(a < b ? `${a}${b}` : `${b}${a}`);
  }
  if (/金木相战|金木/.test(text)) pairs.add('金木');
  if (/水火既济|水火/.test(text)) pairs.add('水火');
  if (/火多土焦|火土|土焦/.test(text)) pairs.add('火土');
  if (/土多金埋|土金/.test(text)) pairs.add('土金');
  return pairs;
}

function WuxingShengKeDiagram({ elements, analysis }: { elements: OracleResult['elements']; analysis: AnalysisItem[] }) {
  const r = 52;
  const cx = 70;
  const cy = 70;
  const positions: Record<string, { x: number; y: number }> = {};
  WUXING_ORDER.forEach((name, i) => {
    const angle = (90 - i * 72) * (Math.PI / 180);
    positions[name] = { x: cx + r * Math.cos(angle), y: cy - r * Math.sin(angle) };
  });
  const highlightPairs = extractElementPairs(analysis);
  const strokeWidth = 1.2;
  const strokeWidthHighlight = 2.5;

  const line = (a: string, b: string, color: string, isHighlight: boolean) => {
    const p1 = positions[a];
    const p2 = positions[b];
    if (!p1 || !p2) return null;
    return (
      <line
        key={`${a}-${b}`}
        x1={p1.x}
        y1={p1.y}
        x2={p2.x}
        y2={p2.y}
        stroke={color}
        strokeWidth={isHighlight ? strokeWidthHighlight : strokeWidth}
        strokeOpacity={isHighlight ? 1 : 0.6}
        className="transition-all duration-300"
      />
    );
  };

  return (
    <svg viewBox="0 0 140 140" className="mx-auto w-full max-w-[200px] text-[10px]" aria-label="五行生克关系图">
      {/* 相生：绿 */}
      {SHENG.map(([a, b]) => {
        const key = a < b ? `${a}${b}` : `${b}${a}`;
        return line(a, b, '#10B981', highlightPairs.has(key));
      })}
      {/* 相克：红 */}
      {KE.map(([a, b]) => {
        const key = a < b ? `${a}${b}` : `${b}${a}`;
        return line(a, b, '#EF4444', highlightPairs.has(key));
      })}
      {/* 节点 */}
      {WUXING_ORDER.map((name) => {
        const p = positions[name];
        if (!p) return null;
        const colors: Record<string, string> = { 金: '#E5E7EB', 木: '#10B981', 水: '#3B82F6', 火: '#EF4444', 土: '#B45309' };
        return (
          <g key={name}>
            <circle cx={p.x} cy={p.y} r={14} fill="#0f172a" stroke={colors[name] || '#fff'} strokeWidth={1.5} />
            <text x={p.x} y={p.y + 1} textAnchor="middle" fill={colors[name]} fontWeight="600">
              {name}
            </text>
          </g>
        );
      })}
      <text x={70} y={132} textAnchor="middle" fill="rgba(255,255,255,0.4)" fontSize="9">
        绿相生 · 红相克
      </text>
    </svg>
  );
}

// --- 命理关键词高亮：仅保留四个核心失衡结论，减少视觉干扰 ---
const KEYWORD_CONFIG: { pattern: RegExp; key: string; borderClass: string; bgClass: string; tooltip: string }[] = [
  { pattern: /金木相战/g, key: '金木相战', borderClass: 'border-amber-400/50', bgClass: 'bg-amber-500/10', tooltip: '架构(金)与灵活性(木)相克' },
  { pattern: /水火既济/g, key: '水火既济', borderClass: 'border-cyan-400/50', bgClass: 'bg-cyan-500/10', tooltip: '流动(水)与影响力(火)相济' },
  { pattern: /火多土焦/g, key: '火多土焦', borderClass: 'border-orange-400/50', bgClass: 'bg-orange-500/10', tooltip: '热度(火)透支文档(土)根基' },
  { pattern: /土多金埋/g, key: '土多金埋', borderClass: 'border-amber-600/40', bgClass: 'bg-amber-900/15', tooltip: '包袱(土)过重、重构(金)乏力' },
];

function highlightKeywords(text: string): React.ReactNode {
  if (!text || typeof text !== 'string') return text;
  const parts: { str: string; config?: (typeof KEYWORD_CONFIG)[0] }[] = [];
  let lastEnd = 0;
  const matches: { index: number; length: number; config: (typeof KEYWORD_CONFIG)[0] }[] = [];
  KEYWORD_CONFIG.forEach((config) => {
    const re = new RegExp(config.pattern.source, 'g');
    let m;
    while ((m = re.exec(text)) !== null) {
      let overlap = false;
      for (const { index, length } of matches) {
        if (m!.index < index + length && m!.index + (m![0].length || 0) > index) overlap = true;
      }
      if (!overlap) matches.push({ index: m.index, length: m[0].length, config });
    }
  });
  matches.sort((a, b) => a.index - b.index || b.length - a.length);
  const merged: { start: number; end: number; config: (typeof KEYWORD_CONFIG)[0] }[] = [];
  for (const m of matches) {
    const end = m.index + m.length;
    if (merged.some((x) => m.index < x.end && end > x.start)) continue;
    merged.push({ start: m.index, end, config: m.config });
  }
  const nodes: React.ReactNode[] = [];
  let i = 0;
  for (const { start, end, config } of merged) {
    if (start > lastEnd) nodes.push(<span key={`t-${i++}`}>{text.slice(lastEnd, start)}</span>);
    nodes.push(
      <span
        key={`k-${i++}`}
        className={`rounded border px-0.5 ${config.borderClass} ${config.bgClass}`}
        title={config.tooltip}
      >
        {text.slice(start, end)}
      </span>
    );
    lastEnd = end;
  }
  if (lastEnd < text.length) nodes.push(<span key={`t-${i++}`}>{text.slice(lastEnd)}</span>);
  return nodes.length ? <>{nodes}</> : text;
}

// --- 五行标准色（与卦象、数据一致）---
const ELEMENT_STANDARD: Record<keyof OracleResult['elements'], number> = {
  metal: 0xe5e7eb,   // 金 银白
  wood: 0x10b981,    // 木 翠绿
  water: 0x3b82f6,   // 水 深蓝
  fire: 0xef4444,    // 火 赤红
  earth: 0xb45309,   // 土 焦褐
};

/** 加权平均混合五行颜色，并提高饱和度，避免混成灰色 */
function blendElementColors(elements: OracleResult['elements']): THREE.Color {
  const { fire, water, metal, earth, wood } = elements;
  const sum = fire + water + metal + earth + wood || 1;
  const wF = fire / sum;
  const wW = water / sum;
  const wM = metal / sum;
  const wE = earth / sum;
  const wWo = wood / sum;
  const c = (hex: number) => ({
    r: ((hex >> 16) & 0xff) / 255,
    g: ((hex >> 8) & 0xff) / 255,
    b: (hex & 0xff) / 255,
  });
  const r = wF * c(ELEMENT_STANDARD.fire).r + wW * c(ELEMENT_STANDARD.water).r + wM * c(ELEMENT_STANDARD.metal).r + wE * c(ELEMENT_STANDARD.earth).r + wWo * c(ELEMENT_STANDARD.wood).r;
  const g = wF * c(ELEMENT_STANDARD.fire).g + wW * c(ELEMENT_STANDARD.water).g + wM * c(ELEMENT_STANDARD.metal).g + wE * c(ELEMENT_STANDARD.earth).g + wWo * c(ELEMENT_STANDARD.wood).g;
  const b = wF * c(ELEMENT_STANDARD.fire).b + wW * c(ELEMENT_STANDARD.water).b + wM * c(ELEMENT_STANDARD.metal).b + wE * c(ELEMENT_STANDARD.earth).b + wWo * c(ELEMENT_STANDARD.wood).b;
  const color = new THREE.Color();
  color.setRGB(Math.min(1, r), Math.min(1, g), Math.min(1, b));
  const hsl = { h: 0, s: 0, l: 0 };
  color.getHSL(hsl);
  hsl.s = Math.min(1, Math.max(0.5, hsl.s * 1.8));
  hsl.l = Math.min(0.92, Math.max(0.2, hsl.l));
  color.setHSL(hsl.h, hsl.s, hsl.l);
  return color;
}

/** 发光色与基础色同步：使用同一套五行加权混合，保证球体反射综合能量场 */
function blendEmissiveColor(elements: OracleResult['elements']): THREE.Color {
  return blendElementColors(elements).clone();
}

// --- 赛博能量结晶：球体由粒子构成 + 神圣几何线框 ---
function CyberCrystal({
  data,
  isCalculating,
  size = 'compact',
}: {
  data: OracleResult | null;
  isCalculating: boolean;
  size?: 'full' | 'compact';
}) {
  const groupRef = useRef<THREE.Group>(null!);
  const wireRef = useRef<THREE.LineSegments>(null!);
  const baseRadius = size === 'full' ? 1.5 : 0.88;

  const particleCount = size === 'full' ? 1400 : 900;
  const particleColor = useMemo(() => {
    if (isCalculating) return new THREE.Color('#ffffff');
    if (!data) return new THREE.Color(0x64748b);
    return blendElementColors(data.elements);
  }, [data, isCalculating]);

  const particlesGeometry = useMemo(() => {
    const positions = new Float32Array(particleCount * 3);
    for (let i = 0; i < particleCount; i++) {
      const phi = Math.acos(-1 + (2 * i) / particleCount + 1 / particleCount);
      const theta = Math.sqrt(particleCount * Math.PI) * phi;
      const x = baseRadius * Math.cos(theta) * Math.sin(phi);
      const y = baseRadius * Math.sin(theta) * Math.sin(phi);
      const z = baseRadius * Math.cos(phi);
      positions[i * 3] = x;
      positions[i * 3 + 1] = y;
      positions[i * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    return geo;
  }, [baseRadius, particleCount]);

  const wireframeGeometry = useMemo(() => {
    const ico = new THREE.IcosahedronGeometry(baseRadius * 1.02, 0);
    return new THREE.EdgesGeometry(ico);
  }, [baseRadius]);

  useFrame((state) => {
    const t = state.clock.elapsedTime;
    if (!groupRef.current) return;
    const rotSpeed = isCalculating ? 0.008 : data ? 0.003 * (1 - (data.elements?.earth ?? 0.2) * 0.5) : 0.002;
    groupRef.current.rotation.y += rotSpeed;
    groupRef.current.rotation.x = Math.sin(t * 0.12) * 0.06;
    const breath = data?.elements?.wood != null
      ? 1 + (0.03 + data.elements.wood * 0.04) * Math.sin(t * 1.3)
      : 1 + 0.03 * Math.sin(t * 1.5);
    groupRef.current.scale.setScalar(breath);
    if (wireRef.current) {
      wireRef.current.rotation.y -= rotSpeed * 0.7;
    }
  });

  const floatIntensity = isCalculating ? (size === 'full' ? 2 : 1.2) : size === 'full' ? 1 : 0.5;

  return (
    <Float speed={isCalculating ? 4 : 1} rotationIntensity={0.3} floatIntensity={floatIntensity}>
      <group ref={groupRef}>
        <points geometry={particlesGeometry}>
          <pointsMaterial
            size={size === 'full' ? 0.032 : 0.026}
            color={particleColor}
            transparent
            opacity={0.92}
            sizeAttenuation
            depthWrite={false}
          />
        </points>
        <lineSegments ref={wireRef} geometry={wireframeGeometry}>
          <lineBasicMaterial color="#94a3b8" />
        </lineSegments>
      </group>
    </Float>
  );
}

function Scene({
  data,
  isCalculating,
  size = 'compact',
}: {
  data: OracleResult | null;
  isCalculating: boolean;
  size?: 'full' | 'compact';
}) {
  const isCompact = size === 'compact';
  return (
    <>
      <Environment preset="night" environmentIntensity={0.5} environmentRotation={[0, 0, 0]} />
      <ambientLight intensity={isCompact ? 0.45 : 0.35} />
      <pointLight position={[4, 5, 6]} intensity={isCompact ? 1.7 : 2} color="#ffffff" />
      <pointLight position={[-3, -2, 4]} intensity={0.5} color="#aab8ff" />
      <pointLight position={[0, -6, -2]} intensity={isCompact ? 0.6 : 0.8} color="#3344aa" />
      <CyberCrystal data={data} isCalculating={isCalculating} size={size} />
      <Stars
        radius={isCompact ? 50 : 100}
        depth={isCompact ? 30 : 50}
        count={isCompact ? 800 : 3000}
        factor={isCompact ? 3 : 4}
        saturation={0}
        fade
        speed={0.3}
      />
      <OrbitControls enableZoom={false} enablePan={false} autoRotate autoRotateSpeed={isCompact ? 0.35 : 0.5} />
    </>
  );
}

// --- 输入页：玻璃卡片 ---
const GlassCard = ({
  children,
  className = '',
  noAnimate,
}: {
  children: React.ReactNode;
  className?: string;
  noAnimate?: boolean;
}) => (
  <motion.div
    initial={noAnimate ? false : { opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    exit={{ opacity: 0, y: -20 }}
    transition={{ duration: 0.4, ease: 'easeOut' }}
    className={`backdrop-blur-xl bg-black/60 border border-white/10 shadow-[0_8px_32px_0_rgba(0,0,0,0.37)] ${className}`}
  >
    {children}
  </motion.div>
);

// --- 左侧：态势感知面板（仅结果页） ---
const StatBar = ({ label, value, color }: { label: string; value: number; color: string }) => (
  <div className="flex flex-col gap-1 mb-2">
    <div className="flex justify-between text-[10px] tracking-widest text-white/50">
      <span>{label}</span>
      <span className="font-mono">{Math.round(value * 100)}%</span>
    </div>
    <div className="h-1 w-full bg-white/10 overflow-hidden">
      <motion.div
        initial={{ width: 0 }}
        animate={{ width: `${value * 100}%` }}
        transition={{ duration: 0.8, delay: 0.2 }}
        className="h-full"
        style={{ backgroundColor: color }}
      />
    </div>
  </div>
);

/** 解析 bazi 字符串为年/月/日/时四柱（Bauhaus 排列用） */
function parseBaziPillars(bazi: string): { label: string; value: string }[] {
  if (!bazi || !bazi.trim()) return [];
  const parts = bazi.trim().split(/\s+/);
  const labels = ['年柱', '月柱', '日柱', '时柱'];
  return labels.map((label, i) => ({ label, value: parts[i] || '—' }));
}

/** Cyber Bazi Dashboard：四柱 + 命格（仓库结果时始终显示，无数据则占位） */
function CyberBaziDashboard({
  bazi,
  destiny_type,
  isRepoResult,
}: {
  bazi?: string;
  destiny_type?: string;
  isRepoResult?: boolean;
}) {
  const pillars = parseBaziPillars(bazi || '');
  const hasContent = (bazi?.trim() || destiny_type?.trim());
  if (!isRepoResult && !hasContent) return null;
  return (
    <div className="mb-4 border border-white/10 bg-white/[0.03] p-3">
      <div className="text-[10px] text-yellow-400/80 tracking-widest mb-3">CYBER BAZI DASHBOARD</div>
      <div className="grid grid-cols-2 gap-2 mb-2">
        {(pillars.length ? pillars : [{ label: '年柱', value: '' }, { label: '月柱', value: '' }, { label: '日柱', value: '' }, { label: '时柱', value: '' }]).map(({ label, value }) => (
          <div key={label} className="border-l-2 border-white/20 pl-2 py-1">
            <div className="text-[9px] text-white/40 uppercase">{label}</div>
            <div className="font-mono text-xs text-white/80 tracking-wide">{value || '—'}</div>
          </div>
        ))}
      </div>
      <div className="text-[10px] text-white/50 pt-2 border-t border-white/10">
        <span className="text-white/40">命格</span>
        <span className="font-mono text-amber-400/90 ml-2">{destiny_type?.trim() || '—'}</span>
      </div>
      {isRepoResult && !hasContent && (
        <div className="text-[9px] text-white/30 mt-2">重新占卜可获取完整命盘（四柱·命格）</div>
      )}
    </div>
  );
}

function LeftDashboard({
  data,
  showResult,
  isCalculating,
}: {
  data: OracleResult | null;
  showResult: boolean;
  isCalculating: boolean;
}) {
  return (
    <div className="flex flex-col h-full min-h-0 border-r border-white/10 bg-[#050505]/95">
      {/* 3D 核心 - 固定高度不参与滚动 */}
      <div className="relative w-full h-[220px] min-h-[220px] flex-shrink-0">
        <Canvas camera={{ position: [0, 0, 2.6], fov: 50 }} dpr={[1, 2]}>
          <color attach="background" args={['#050505']} />
          <Scene data={data} isCalculating={isCalculating} size="compact" />
        </Canvas>
      </div>

      {/* 可滚动内容区 */}
      <div className="flex-1 min-h-0 overflow-y-auto dossier-scroll">
      {showResult && data ? (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.5 }}
          className="flex flex-col p-6 pb-8"
        >
          <div className="text-[10px] text-yellow-400/80 tracking-widest mb-2">HEXAGRAM / 卦象</div>
          <h1
            className="text-5xl md:text-6xl font-extralight tracking-tighter text-yellow-400 mb-4 animate-hexagram-glow"
            style={{ textShadow: '0 0 24px rgba(250, 204, 21, 0.5)' }}
          >
            {data.hexagram}
          </h1>
          {(data.repoStars != null || data.repoLanguage || data.repoCreatedAt) && (
            <div className="space-y-2 mb-4">
              <div className="flex items-center gap-3 text-[10px] text-white/40">
                {data.repoStars != null && (
                  <span className="font-mono text-green-400/80">{data.repoStars.toLocaleString()} stars</span>
                )}
                {data.repoLanguage && (
                  <span className="font-mono text-green-400/80">{data.repoLanguage}</span>
                )}
              </div>
              <div className="text-[10px] text-white/40">
                <span className="text-yellow-400/70 tracking-widest">Repository Natal Date / 生辰</span>
                <div className="font-mono mt-0.5 tracking-wide">
                  {data.repoCreatedAt ? (
                    <span className="text-amber-400/95">{formatNatalDate(data.repoCreatedAt)}</span>
                  ) : (
                    <span className="text-white/30">— 重新占卜以获取（来自 GitHub created_at）</span>
                  )}
                </div>
              </div>
            </div>
          )}
          <CyberBaziDashboard
            bazi={data.bazi}
            destiny_type={data.destiny_type}
            isRepoResult={data.repoStars != null || data.repoLanguage != null}
          />
          <div>
            <div className="text-[10px] text-yellow-400/80 tracking-widest mb-3">五行能量</div>
            {(() => {
              const e = data.elements;
              const sum = e.metal + e.wood + e.water + e.fire + e.earth || 1;
              return (
                <>
                  <StatBar label="金" value={e.metal / sum} color={ELEMENT_COLORS.metal} />
                  <StatBar label="木" value={e.wood / sum} color={ELEMENT_COLORS.wood} />
                  <StatBar label="水" value={e.water / sum} color={ELEMENT_COLORS.water} />
                  <StatBar label="火" value={e.fire / sum} color={ELEMENT_COLORS.fire} />
                  <StatBar label="土" value={e.earth / sum} color={ELEMENT_COLORS.earth} />
                </>
              );
            })()}
          </div>
        </motion.div>
      ) : (
        <div className="flex items-center justify-center p-6">
          <p className="text-[10px] text-white/30 text-center tracking-widest">
            输入并执行后<br />卦象将呈现于此
          </p>
        </div>
      )}
      </div>
    </div>
  );
}

// --- 右侧：流动的深度报告 (Dossier) ---
const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.06, delayChildren: 0.1 },
  },
  exit: { opacity: 0 },
};

const itemVariants = {
  hidden: { opacity: 0, x: 16 },
  visible: { opacity: 1, x: 0 },
};

function DossierContent({ data }: { data: OracleResult }) {
  const rawAnalysis = data.analysis ?? [];
  const hasNatal = hasNatalAnalysis(rawAnalysis);
  let analysis =
    data.repoCreatedAt && !hasNatal
      ? [buildNatalAnalysisFallback(data.repoCreatedAt), ...rawAnalysis]
      : rawAnalysis;
  if (!hasElementInAnalysis(analysis, '土')) {
    analysis = [...analysis, buildEarthAnalysisFallback()];
  }
  return (
    <motion.div
      className="max-w-3xl mx-auto px-8 py-10 pb-24"
      variants={containerVariants}
      initial="hidden"
      animate="visible"
    >
      {/* 判词 */}
      <section className="mb-12">
        <div className="flex items-center gap-3 text-[10px] text-yellow-400/80 tracking-[0.2em] mb-4">
          <span className="w-6 h-px bg-yellow-400/30" />
          <Sparkles size={10} className="text-yellow-400/60" />
          JUDGMENT / 判词
        </div>
        <h2 className="text-xl md:text-2xl font-extralight leading-relaxed text-white/90 italic">
          「{highlightKeywords(data.judgment)}」
        </h2>
      </section>

      {/* 系统状态：GitHub 硬核指标（因果因子） */}
      {(data.repoPushedAt != null || data.repoOpenIssues != null || data.repoSize != null || data.repoLicense != null || data.repoSubscribersCount != null) && (
        <section className="mb-10">
          <div className="flex items-center gap-3 text-[10px] text-cyan-400/80 tracking-[0.2em] mb-3">
            <span className="w-6 h-px bg-cyan-400/30" />
            SYSTEM STATE / 系统状态
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 text-xs">
            {data.repoPushedAt != null && (
              <div className="rounded bg-slate-800/60 border border-slate-600/40 px-3 py-2">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">余温 pushed_at</span>
                <span className="text-white/90 font-mono">{formatNatalDate(data.repoPushedAt)}</span>
              </div>
            )}
            {data.repoOpenIssues != null && (
              <div className="rounded bg-slate-800/60 border border-slate-600/40 px-3 py-2">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">业障 open_issues</span>
                <span className="text-white/90 font-mono">{data.repoOpenIssues.toLocaleString()}</span>
              </div>
            )}
            {data.repoSubscribersCount != null && (
              <div className="rounded bg-slate-800/60 border border-slate-600/40 px-3 py-2">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">气场 watchers</span>
                <span className="text-white/90 font-mono">{data.repoSubscribersCount.toLocaleString()}</span>
              </div>
            )}
            {data.repoLicense != null && (
              <div className="rounded bg-slate-800/60 border border-slate-600/40 px-3 py-2">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">法度 license</span>
                <span className="text-white/90 font-mono">{data.repoLicense}</span>
              </div>
            )}
            {data.repoSize != null && (
              <div className="rounded bg-slate-800/60 border border-slate-600/40 px-3 py-2">
                <span className="text-slate-400 block text-[10px] uppercase tracking-wider">肉身 size</span>
                <span className="text-white/90 font-mono">{(data.repoSize / 1024).toFixed(1)} MB</span>
              </div>
            )}
          </div>
        </section>
      )}

      {/* 流年与建议 - 紧凑 */}
      <section className="mb-12 grid gap-8 md:grid-cols-2">
        <div>
          <div className="text-[10px] text-yellow-400/80 tracking-widest mb-2">流年运势</div>
          <p className="text-sm text-white/60 leading-relaxed">{highlightKeywords(data.forecast)}</p>
        </div>
        <div>
          <div className="text-[10px] text-yellow-400/80 tracking-widest mb-2">相生相克建议</div>
          <p className="text-sm text-white/60 leading-relaxed">{highlightKeywords(data.advice)}</p>
        </div>
      </section>

      {/* 因果拆解 - 因果链 + 生克图 + 关键词高亮 */}
      <section>
        <div className="flex items-center gap-3 text-[10px] text-yellow-400/80 tracking-[0.2em] mb-4">
          <span className="w-6 h-px bg-yellow-400/30" />
          CAUSAL ANALYSIS / 因果拆解
        </div>
        {/* 能量生克关系图：相生绿、相克红，与当前解析相关的连线加粗 */}
        {analysis.length > 0 && (
          <div className="mb-8 flex flex-col items-center">
            <WuxingShengKeDiagram elements={data.elements} analysis={analysis} />
          </div>
        )}
        {analysis.length > 0 ? (
          <motion.ul className="space-y-5" variants={containerVariants}>
            {analysis.map((item, index) => {
              const isNatalItem = /生辰|Repository Natal Date|仓库年龄|Repository Age|创建时间/i.test(item.metric || '') || /生辰|仓库年龄|创建于|诞生于/.test(item.reason || '');
              const displayMetric =
                isNatalItem && data.repoCreatedAt
                  ? `生辰：${formatNatalDate(data.repoCreatedAt)}（Repository Natal Date）`
                  : item.metric;
              return (
                <motion.li
                  key={`${item.metric}-${index}`}
                  variants={itemVariants}
                  className="bg-white/5 border-l-4 border-white/20 p-4 transition-colors hover:bg-white/[0.07]"
                >
                  <div className="flex items-center justify-between gap-3 mb-2">
                    <span className="text-xs text-white/70 truncate">
                      {displayMetric}
                    </span>
                    <span className="text-[10px] text-white/40 shrink-0">
                      {item.element}
                    </span>
                  </div>
                  <CausalChain
                    item={item}
                    data={data}
                    reasonHighlight={highlightKeywords(item.reason || '')}
                  />
                  {item.logic_chain && (
                    <div className="mt-2 pt-2 border-t border-white/5">
                      <p className="text-[11px] text-white/40 leading-relaxed">{highlightKeywords(item.logic_chain)}</p>
                    </div>
                  )}
                </motion.li>
              );
            })}
          </motion.ul>
        ) : (
          <p className="text-sm text-white/30">暂无因果拆解数据</p>
        )}
      </section>
    </motion.div>
  );
}

// --- Main App ---
export default function App() {
  const [productInfo, setProductInfo] = useState('');
  const [data, setData] = useState<OracleResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [showResult, setShowResult] = useState(false);
  const [loadingMessage, setLoadingMessage] = useState(0);
  const requestingRef = useRef(false);

  const isGitHubInput = /^https?:\/\/(www\.)?github\.com\/[^/?#]+\/[^/?#]+/.test(productInfo.trim());
  const loadingMessages = [
    '正在通过 API 窥探仓库因果...',
    '正在解析代码提交频率的五行属性...',
    'DeepSeek 正在演算其流年运势...',
  ];

  useEffect(() => {
    if (!loading) return;
    const id = setInterval(() => setLoadingMessage((i) => (i + 1) % 3), 2500);
    return () => clearInterval(id);
  }, [loading]);

  const startDivination = async () => {
    const trimmed = productInfo.trim();
    if (!trimmed) return alert('请输入 GitHub 仓库地址');
    if (!isGitHubInput) return alert('仅支持 GitHub 仓库地址占卜，请输入有效的 URL，如 https://github.com/owner/repo');
    if (requestingRef.current) return;
    requestingRef.current = true;
    setLoading(true);
    setShowResult(false);
    const loadingStart = Date.now();
    const minLoadingMs = 1800;
    try {
      const body = { repoUrl: trimmed };
      const response = await fetch(`${API_BASE}/api/oracle`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.details || result.error || `请求失败 ${response.status}`);
      if (result.error) throw new Error(result.details || result.error);

      const elements = result.elements || {};
      const safe: OracleResult = {
        elements: {
          metal: toNum(elements.metal),
          wood: toNum(elements.wood),
          water: toNum(elements.water),
          fire: toNum(elements.fire),
          earth: toNum(elements.earth),
        },
        hexagram: result.hexagram || result.卦象 || '—',
        judgment: result.judgment || result.批语 || '',
        forecast: result.forecast || result.流年 || '',
        advice: result.advice || result.建议 || '',
      };
      if (result.repoStars != null) safe.repoStars = result.repoStars;
      if (result.repoForks != null) safe.repoForks = result.repoForks;
      if (result.repoLanguage) safe.repoLanguage = result.repoLanguage;
      if (result.repoCreatedAt) safe.repoCreatedAt = result.repoCreatedAt;
      if (result.repoPushedAt) safe.repoPushedAt = result.repoPushedAt;
      if (result.repoOpenIssues != null) safe.repoOpenIssues = result.repoOpenIssues;
      if (result.repoSize != null) safe.repoSize = result.repoSize;
      if (result.repoLicense) safe.repoLicense = result.repoLicense;
      if (result.repoSubscribersCount != null) safe.repoSubscribersCount = result.repoSubscribersCount;
      if (result.lifecycle) safe.lifecycle = result.lifecycle;
      if (result.repoCreatedAt) safe.repoCreatedAt = result.repoCreatedAt;
      if (result.bazi) safe.bazi = result.bazi;
      if (result.destiny_type) safe.destiny_type = result.destiny_type;
      if (result.innate_elements && result.innate_elements.metal != null) {
        safe.innate_elements = {
          metal: toNum(result.innate_elements.metal),
          wood: toNum(result.innate_elements.wood),
          water: toNum(result.innate_elements.water),
          fire: toNum(result.innate_elements.fire),
          earth: toNum(result.innate_elements.earth),
        };
      }
      if (result.acquired_elements && result.acquired_elements.metal != null) {
        safe.acquired_elements = {
          metal: toNum(result.acquired_elements.metal),
          wood: toNum(result.acquired_elements.wood),
          water: toNum(result.acquired_elements.water),
          fire: toNum(result.acquired_elements.fire),
          earth: toNum(result.acquired_elements.earth),
        };
      }
      if (Array.isArray(result.analysis)) safe.analysis = result.analysis;
      const elapsed = Date.now() - loadingStart;
      if (elapsed < minLoadingMs) {
        await new Promise((r) => setTimeout(r, minLoadingMs - elapsed));
      }
      setData(safe);
      setShowResult(true);
    } catch (error: unknown) {
      console.error('演算失败:', error);
      alert('演算失败：' + (error instanceof Error ? error.message : String(error)));
    } finally {
      setLoading(false);
      requestingRef.current = false;
    }
  };

  const reset = () => {
    setShowResult(false);
    setProductInfo('');
  };

  return (
    <div className="relative w-full h-screen bg-[#050505] text-white font-mono overflow-hidden">
      <AnimatePresence mode="wait">
        {/* 输入页 / 加载态：全屏 3D 背景 + 居中卡片 或 全屏加载遮罩 */}
        {!showResult && (
          <div key="input-view" className="absolute inset-0 flex flex-col">
            <div className="absolute inset-0 z-0">
              <Canvas camera={{ position: [0, 0, 6] }} dpr={[1, 2]}>
                <color attach="background" args={['#050505']} />
                <Scene data={null} isCalculating={loading} size="full" />
              </Canvas>
            </div>
            <div className="absolute inset-0 z-10 flex items-center justify-center p-6 pointer-events-none">
              <div className="w-full max-w-lg pointer-events-auto">
                {!loading && (
                  <GlassCard noAnimate className="p-8">
                    <div className="mb-6 border-b border-white/10 pb-4">
                      <h2 className="text-sm tracking-widest text-white/60 mb-2">输入</h2>
                      <p className="text-xs text-white/40">
                        仅支持通过 GitHub 仓库地址占卜，粘贴仓库 URL 即可。
                      </p>
                    </div>
                    <div className="relative mb-6">
                      <input
                        type="url"
                        className={`w-full bg-black/20 border p-4 text-sm text-white placeholder-white/20 focus:outline-none transition-colors font-mono pr-10 ${
                          isGitHubInput
                            ? 'border-green-500/60 bg-green-950/20 focus:border-green-400/80'
                            : 'border-white/10 focus:border-white/40'
                        }`}
                        placeholder="https://github.com/owner/repo"
                        value={productInfo}
                        onChange={(e) => setProductInfo(e.target.value)}
                        autoFocus
                      />
                      {isGitHubInput && (
                        <span
                          className="absolute top-1/2 right-3 -translate-y-1/2 text-green-400/90"
                          title="已识别为 GitHub 仓库"
                        >
                          <Github size={18} />
                        </span>
                      )}
                    </div>
                    <button
                      onClick={startDivination}
                      className="w-full group relative overflow-hidden bg-white text-black py-4 px-6 text-xs font-bold tracking-widest hover:bg-gray-200 transition-colors flex items-center justify-center gap-2"
                    >
                      开始占卜 <ArrowRight size={14} />
                    </button>
                  </GlassCard>
                )}
              </div>
            </div>
            {loading && (
              <motion.div
                key="loading"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-black/80 backdrop-blur-sm pointer-events-auto"
              >
                <div className="w-64 h-1 bg-white/10 mb-8 overflow-hidden">
                  <motion.div
                    className="h-full bg-white"
                    animate={{ x: ['-100%', '100%'] }}
                    transition={{ repeat: Infinity, duration: 1, ease: 'linear' }}
                  />
                </div>
                <h2 className="text-xl tracking-[0.2em] font-light animate-pulse">
                  {loadingMessages[loadingMessage]}
                </h2>
                <div className="mt-4 font-mono text-xs text-white/40">
                  <p>[系统] 映射五行...</p>
                  <p>[内核] 解析卦象...</p>
                </div>
              </motion.div>
            )}
          </div>
        )}

        {/* 卦象结果页：非对称双栏 4/12 + 8/12 */}
        {showResult && data && (
          <div key="result-view" className="absolute inset-0 flex flex-col bg-[#050505] z-10">
            <main className="flex-1 grid grid-cols-12 min-h-0 w-full">
              <aside className="col-span-4 flex flex-col min-h-0 border-r border-white/10 bg-[#050505]">
                <LeftDashboard data={data} showResult={true} isCalculating={false} />
                <div className="flex-shrink-0 p-4 border-t border-white/10">
                  <button
                    onClick={reset}
                    className="w-full py-3 border border-white/20 text-[10px] tracking-widest hover:bg-white hover:text-black transition-colors"
                  >
                    重新占卜
                  </button>
                </div>
              </aside>
              <aside className="col-span-8 h-full overflow-y-auto dossier-scroll min-h-0 bg-[#050505]">
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ duration: 0.4 }}
                  className="min-h-full"
                >
                  <DossierContent data={data} />
                </motion.div>
              </aside>
            </main>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
}
