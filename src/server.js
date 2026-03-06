import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import axios from 'axios';

// 项目根 = server.js 所在目录的上一级，这样无论从哪执行都能读到 .env
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, '..');
const envPath = path.join(projectRoot, '.env');
const envLocalPath = path.join(projectRoot, '.env.local');
dotenv.config({ path: envPath });
dotenv.config({ path: envLocalPath, override: true });

// 去掉换行、空格、BOM 等，避免 key 无效
const rawKey = process.env.DEEPSEEK_API_KEY || '';
const DEEPSEEK_API_KEY = rawKey.replace(/^\uFEFF/, '').replace(/\r?\n$/, '').trim();
if (rawKey !== DEEPSEEK_API_KEY) {
  console.log('[env] 已去除 key 中的不可见字符/换行，原长度:', rawKey.length, '→ 现长度:', DEEPSEEK_API_KEY.length);
}
console.log('[env] 项目根:', projectRoot);
console.log('[env] 尝试读取:', envPath, '→', envLocalPath);
console.log('[env] DEEPSEEK_API_KEY 读到:', DEEPSEEK_API_KEY ? `${DEEPSEEK_API_KEY.slice(0, 4)}...${DEEPSEEK_API_KEY.slice(-4)} (${DEEPSEEK_API_KEY.length} 字符)` : '未读到');

const app = express();
app.use(cors());
app.use(express.json());

const PORT = 3001;
const GITHUB_TOKEN = (process.env.GITHUB_TOKEN || '').replace(/^\uFEFF/, '').trim();

function num(v, def = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : def;
}
function str(...args) {
  for (const a of args) if (a != null && String(a).trim()) return String(a).trim();
  return '';
}

/** 把 URL/输入转成固定数字，用于 DeepSeek 的 seed，保证同一输入得到确定性结果 */
function getSeedFromUrl(url) {
  const clean = String(url || '').trim().toLowerCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash << 5) - hash + clean.charCodeAt(i);
    hash |= 0;
  }
  return Math.abs(hash);
}

/**
 * 根据仓库 created_at 计算项目年龄与命理「生命周期阶段」，决定深度解读方向。
 * @param {string} createdAt - ISO 日期字符串
 * @returns {{ ageYears: number, stage: string, hexagram: string, focus: string, warning: string } | null}
 */
function getLifecycleStage(createdAt) {
  if (!createdAt || typeof createdAt !== 'string') return null;
  const created = new Date(createdAt.trim());
  if (Number.isNaN(created.getTime())) return null;
  const now = new Date();
  const ageMs = now - created;
  const ageYears = ageMs / (365.25 * 24 * 60 * 60 * 1000);
  if (ageYears < 0) return null;
  let stage, hexagram, focus, warning;
  if (ageYears < 0.5) {
    stage = '萌芽期';
    hexagram = '震卦';
    focus = '关注「火」的爆发力与初生动能';
    warning = '此时「金」（规范、架构）不宜过重，否则易扼杀创意与试错空间';
  } else if (ageYears < 1) {
    stage = '萌芽期（向壮大过渡）';
    hexagram = '震卦';
    focus = '仍以「火」的爆发力为主，可渐看「水」「木」是否跟上';
    warning = '金（规范）仍不宜过重';
  } else if (ageYears < 3) {
    stage = '壮大期';
    hexagram = '乾卦';
    focus = '关注「水」（兼容性、扩展）与「木」（生态、依赖、社区）';
    warning = '若「火」太旺而无「水」制衡，容易烧尽潜力、过早定型';
  } else if (ageYears < 5) {
    stage = '壮大期（向宿命过渡）';
    hexagram = '乾卦';
    focus = '水、木仍重要，可开始观察「土」「金」是否足以支撑长期';
    warning = '火过旺无水则易透支；土金不足则难承续';
  } else {
    stage = '宿命期';
    hexagram = '坤卦';
    focus = '关注「土」（稳定性、维护成本）与「金」（遗留重构、架构债）';
    warning = '分析是否陷入「土多金埋」的迟滞感——文档与历史包袱过重而重构乏力';
  }
  return { ageYears, stage, hexagram, focus, warning };
}

/** 内存缓存：同一输入直接返回上次结果，重启清空 */
const fortuneCache = {};

/** 根据 GitHub 仓库 URL 拉取仓库元信息 */
async function getRepoMeta(repoUrl) {
  let url;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error('无效的 GitHub 地址');
  }
  if (!/github\.com$/i.test(url.hostname)) throw new Error('仅支持 GitHub 仓库地址');
  const pathParts = url.pathname.split('/').filter(Boolean);
  let [owner, repo] = pathParts;
  if (!owner || !repo) throw new Error('无法解析仓库，需形如：https://github.com/owner/repo');
  repo = repo.replace(/\.git$/i, '');

  const headers = { Accept: 'application/vnd.github.v3+json' };
  if (GITHUB_TOKEN) headers.Authorization = `Bearer ${GITHUB_TOKEN}`;

  let repoRes;
  let langRes;
  let readmeRes = null;
  try {
    [repoRes, langRes, readmeRes] = await Promise.allSettled([
      axios.get(`https://api.github.com/repos/${owner}/${repo}`, { headers, timeout: 15000 }),
      axios.get(`https://api.github.com/repos/${owner}/${repo}/languages`, { headers, timeout: 15000 }),
      axios.get(`https://api.github.com/repos/${owner}/${repo}/readme`, { headers: { ...headers, Accept: 'application/vnd.github.raw' }, timeout: 10000 })
    ]);
  } catch (err) {
    if (err.response) {
      if (err.response.status === 404) throw new Error('仓库不存在或为私有，请检查地址');
      if (err.response.status === 403) throw new Error('GitHub 请求被限流，请稍后重试或配置 .env 中的 GITHUB_TOKEN');
    }
    throw new Error('获取仓库信息失败：' + (err.message || '网络错误'));
  }

  if (repoRes.status !== 'fulfilled') {
    const err = repoRes.reason;
    if (err?.response?.status === 404) throw new Error('仓库不存在或为私有，请检查地址');
    if (err?.response?.status === 403) throw new Error('GitHub 请求被限流，请稍后重试或配置 .env 中的 GITHUB_TOKEN');
    throw new Error('获取仓库信息失败：' + (err?.message || '网络错误'));
  }
  const r = repoRes.value.data;
  const langData = langRes.status === 'fulfilled' ? (langRes.value.data || {}) : {};
  const languages = Object.keys(langData).join(', ') || '未知';
  let readmeLength = null;
  if (readmeRes?.status === 'fulfilled' && readmeRes.value?.data != null) {
    readmeLength = typeof readmeRes.value.data === 'string' ? readmeRes.value.data.length : 0;
  }
  const createdAt = r.created_at ?? r.createdAt ?? null;
  if (!createdAt) {
    console.warn('[getRepoMeta] 未从 GitHub 响应中读到 created_at，keys:', Object.keys(r).filter(k => k.toLowerCase().includes('date') || k.toLowerCase().includes('creat')));
  } else {
    console.log('[getRepoMeta] 生辰 createdAt:', createdAt);
  }
  const licenseSpdx = r.license?.spdx_id || r.license?.key || null;
  const licenseName = r.license?.name || (licenseSpdx ? licenseSpdx : null);
  return {
    name: r.name,
    fullName: r.full_name,
    stars: r.stargazers_count,
    forks: r.forks_count,
    openIssues: r.open_issues_count,
    description: r.description || '',
    languages,
    updatedAt: r.updated_at,
    createdAt,
    readmeLength,
    pushedAt: r.pushed_at ?? null,
    size: r.size != null ? r.size : null,
    license: licenseName || licenseSpdx,
    licenseSpdx: licenseSpdx,
    subscribersCount: r.watchers_count ?? r.subscribers_count ?? null
  };
}

// 根路径和健康检查
const healthPayload = { ok: true, message: '赛博后端已启动', keyLoaded: !!DEEPSEEK_API_KEY };
app.get('/', (req, res) => res.json(healthPayload));
app.get('/api/health', (req, res) => res.json(healthPayload));

// 调试：仅测试 GitHub 拉取是否成功。浏览器访问 /api/debug-github?url=https://github.com/facebook/react
app.get('/api/debug-github', async (req, res) => {
  const url = req.query.url;
  if (!url) return res.status(400).json({ error: '请传参 url，如 ?url=https://github.com/facebook/react' });
  try {
    const meta = await getRepoMeta(url);
    res.json({ ok: true, meta });
  } catch (e) {
    res.status(400).json({ ok: false, error: e.message });
  }
});

// 判断是否为 GitHub 仓库地址（支持 www、末尾 .git、斜杠等）
function isGitHubRepoUrl(str) {
  if (!str || typeof str !== 'string') return false;
  return /https?:\/\/(www\.)?github\.com\/[^/?#]+\/[^/?#]+/.test(str.trim());
}

// 从任意字符串中提取首个 GitHub 仓库 URL
function extractGitHubUrl(str) {
  const trimmed = str.trim();
  const m = trimmed.match(/https?:\/\/(www\.)?github\.com\/[^/?#]+\/[^/?#]+/);
  return m ? m[0] : null;
}

// 赛博算命 API 路由：仅支持 GitHub 仓库地址占卜
app.post('/api/oracle', async (req, res) => {
  try {
    const productInfo = typeof req.body?.productInfo === 'string' ? req.body.productInfo.trim() : '';
    let repoUrl = typeof req.body?.repoUrl === 'string' ? req.body.repoUrl.trim() : '';

    if (!repoUrl && isGitHubRepoUrl(productInfo)) {
      repoUrl = extractGitHubUrl(productInfo);
    }
    repoUrl = extractGitHubUrl(repoUrl) || repoUrl || null;

    if (!repoUrl || !isGitHubRepoUrl(repoUrl)) {
      return res.status(400).json({ error: '仅支持通过 GitHub 仓库地址占卜', details: '请输入有效的仓库 URL，如 https://github.com/owner/repo' });
    }

    const cacheKey = repoUrl.trim().toLowerCase();

    if (fortuneCache[cacheKey]) {
      console.log(`♻️ 命中缓存: ${cacheKey.slice(0, 50)}...`);
      const cached = fortuneCache[cacheKey];
      if (repoUrl && !cached.repoCreatedAt) {
        try {
          const meta = await getRepoMeta(repoUrl);
          if (meta.createdAt) {
            const enriched = { ...cached, repoCreatedAt: meta.createdAt };
            return res.json(enriched);
          }
        } catch (e) {
          console.warn('缓存命中但补全生辰失败:', e.message);
        }
      }
      return res.json(cached);
    }

    const systemPrompt = `
你是一位精通东方命理与软件工程的赛博风水大师。请采用「先天命格 + 后天修为」双层五行模型，并执行**链式因果演算**。

一、输入与排盘
- 用户会提供 birthDate（created_at）、location、以及以下「因果因子」原始数据，你必须组合多项数据做推导，禁止单一映射。
- 因果因子与命理含义（仅作语义参考，禁止直接说「X 是火」）：
  - pushed_at（最后更新时间）：项目的「余温」。久未更新则火性熄灭、易入「墓库」；近期有 push 则后天火旺，可与生辰组合得出「枯木逢春」等结论。
  - open_issues_count：项目的「业障」。Issues 多且 Stars 高 → 名不副实、因果缠身，可推出「火炎土焦」等象（社区热度在烧毁底层稳定性）。
  - subscribers_count（Watchers）：项目的「气场」。围观多则金性与火性易显（关注度与规范感）。
  - license（许可证）：项目的「法度」。MIT 偏木性随缘开放，GPL 偏金性严苛法则，可与其他指标组合。
  - size（仓库容量 KB）：项目的「肉身」。体积大则土性重；若 size 大而 Stars 不足，易为「土多金埋」。
- 请先根据 birthDate 做干支排盘得四柱与先天命格（innate_elements），再根据上述因果因子的**组合逻辑**推演后天修为（acquired_elements）。最终 elements = 0.4*先天 + 0.6*后天（归一化）。

二、链式因果规则（强制）
1. **禁止单一映射**：严禁直接说「Stars 是火」「Forks 是水」等。必须写出「因为 A（数据）+ B（数据），所以 C（命理结论），进而 D（现实影响）」的链条。
2. **必须逻辑组合**：示例——「虽然创建于 2020 年（老牌土性），但 pushed_at 显示最近 24 小时内有 Push（后天火旺），说明此项目正在『枯木逢春』，老树发新芽。」示例——「拥有 2k Stars（大火）但 open_issues_count 超过 200（土流失），此为『火炎土焦』之象，代表社区热度正在烧毁项目的底层稳定性。」
3. **analysis 每条必须含 logic_chain**：从【原始数据】到【命理结论】的推导过程，用一句话写清「数据 A + 数据 B → 命理象 → 现实含义」。

三、JSON 输出结构（必须严格包含）
{
  "bazi": "甲子年 丙寅月 戊辰日 庚午时",
  "destiny_type": "剑锋金命",
  "innate_elements": { "metal": 0.6, "wood": 0.1, "water": 0.1, "fire": 0.1, "earth": 0.1 },
  "acquired_elements": { "metal": 0.3, "wood": 0.2, "water": 0.2, "fire": 0.2, "earth": 0.1 },
  "elements": { "metal": 0.44, "wood": 0.16, "water": 0.16, "fire": 0.16, "earth": 0.1 },
  "hexagram": "卦象名",
  "judgment": "判词",
  "analysis": [
    { "metric": "...", "element": "金|木|水|火|土", "reason": "现实影响与建议", "logic_chain": "【原始数据】如 Stars N + pushed_at 某日 → 命理象（如火旺/墓库）→ 现实含义" }
  ],
  "forecast": "流年运势",
  "advice": "建议"
}

说明：analysis 中每一项都必须包含 logic_chain 字段，描述「因何数据→得何象→应何果」。metric、element、reason 照常；logic_chain 为一句话的推导链。

四、失衡点与生命周期
- 仍须根据数据判断金木相战、水火既济、火多土焦、土多金埋等，且每条都写 logic_chain。
- 生命周期阶段（created_at 决定）：<6月 萌芽期/震卦；1–3年 壮大期/乾卦；>5年 宿命期/坤卦。判词与 analysis 须与阶段匹配。
`.trim();

    const location = typeof req.body?.location === 'string' ? req.body.location.trim() : '';

    let userContent = '';
    let meta = null;

    if (repoUrl) {
      console.log(`🔮 收到 GitHub 地址，正在抓取仓库: ${repoUrl}`);
      try {
        meta = await getRepoMeta(repoUrl);
      } catch (repoErr) {
        console.error('❌ getRepoMeta 失败:', repoErr.message);
        return res.status(400).json({ error: 'GitHub 仓库获取失败', details: repoErr.message });
      }
      const desc = (meta.description || '无').slice(0, 200);
      const birthDate = meta.createdAt || '';
      const birthPlace = location || 'GitHub';
      const readmeInfo = meta.readmeLength != null ? `README 字符数：${meta.readmeLength}（土性/文档完备度）` : 'README 未获取到';
      const lifecycle = getLifecycleStage(birthDate);
      const lifecycleStr = lifecycle
        ? `【生命周期】年龄约 ${lifecycle.ageYears.toFixed(2)} 年 → ${lifecycle.stage}（${lifecycle.hexagram}）。${lifecycle.focus}；${lifecycle.warning}`
        : '（未解析到生辰）';
      const causalFactors = [
        `pushed_at（余温）：${meta.pushedAt ?? '未知'}`,
        `open_issues_count（业障）：${meta.openIssues ?? '未知'}`,
        `subscribers_count/Watchers（气场）：${meta.subscribersCount ?? '未知'}`,
        `license（法度）：${meta.license ?? '未知'}`,
        `size（肉身，KB）：${meta.size ?? '未知'}`
      ].join('；');
      userContent = `GitHub 仓库：${meta.fullName || meta.name}。语言：${meta.languages}。Stars ${meta.stars}，Forks ${meta.forks}。描述：${desc}。${readmeInfo}。仓库生辰 birthDate（created_at）：${birthDate}。出生地 location：${birthPlace}。【因果因子】${causalFactors}。${lifecycleStr} 请按 system 执行链式因果演算（禁止单一映射），输出 bazi、destiny_type、innate_elements、acquired_elements、elements、hexagram、judgment、analysis（每条必须含 logic_chain：原始数据→命理象→现实含义）、forecast、advice。`;
      console.log(`✅ 仓库信息已拉取，userContent 长度: ${userContent.length}`);
    } else {
      return res.status(400).json({ error: '仅支持通过 GitHub 仓库地址占卜', details: '请提供有效的 GitHub 仓库 URL' });
    }

    if (!userContent) {
      return res.status(400).json({ error: '输入内容为空', details: '请填写产品描述或有效的 GitHub 仓库地址' });
    }

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: userContent }
    ];

    console.log(`📤 正在请求 DeepSeek（30s 超时）...`);
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);

    let response;
    try {
      response = await fetch('https://api.deepseek.com/chat/completions', {
        signal: controller.signal,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${DEEPSEEK_API_KEY}`
        },
        body: JSON.stringify({
          model: 'deepseek-chat',
          messages,
          temperature: 0,
          seed: getSeedFromUrl(cacheKey),
          response_format: { type: 'json_object' }
        })
      });
    } catch (fetchErr) {
      clearTimeout(timeoutId);
      if (fetchErr.name === 'AbortError') throw new Error('DeepSeek 请求超时（30 秒），请稍后重试');
      throw fetchErr;
    }
    clearTimeout(timeoutId);

    const data = await response.json();
    console.log('📥 DeepSeek 返回:', response.ok ? '成功' : '失败', response.status);

    if (!response.ok) {
      const errMsg = data.error?.message || data.error?.code || data.message || `HTTP ${response.status}`;
      console.error('DeepSeek API 错误:', errMsg);
      throw new Error(errMsg);
    }
    if (!data.choices || !data.choices[0]) {
      throw new Error(data.error?.message || data.error?.code || 'DeepSeek 无响应');
    }

    let raw = data.choices[0].message.content.trim();
    // 兼容模型返回 ```json ... ``` 的情况
    const jsonMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (jsonMatch) raw = jsonMatch[1].trim();
    let result;
    try {
      result = JSON.parse(raw);
    } catch (e) {
      console.error('DeepSeek 返回非 JSON:', raw.slice(0, 200));
      throw new Error('模型返回格式异常，请重试');
    }

    // 先天 40% + 后天 60% 加权，归一化后总和约 2.0
    const innate = result.innate_elements || {};
    const acquired = result.acquired_elements || {};
    const hasDual = result.innate_elements && result.acquired_elements &&
      (typeof innate.metal === 'number' || innate.metal != null) &&
      (typeof acquired.metal === 'number' || acquired.metal != null);
    const rawElements = result.elements || {};
    const keys = [ 'metal', 'wood', 'water', 'fire', 'earth' ];
    const blend = (key) => {
      if (!hasDual) return num(rawElements[key], 0.2);
      return 0.4 * num(innate[key], 0.2) + 0.6 * num(acquired[key], 0.2);
    };
    const blended = keys.reduce((o, k) => ({ ...o, [k]: blend(k) }), {});
    const sum = keys.reduce((s, k) => s + blended[k], 0) || 1;
    const scale = sum > 0 ? 2 / sum : 1;
    const elementsBlended = keys.reduce((o, k) => ({
      ...o,
      [k]: Math.max(0, Math.min(1, blended[k] * scale))
    }), {});
    const normalized = {
      elements: hasDual ? elementsBlended : {
        metal: num(rawElements.metal, 0.2),
        wood: num(rawElements.wood, 0.2),
        water: num(rawElements.water, 0.2),
        fire: num(rawElements.fire, 0.2),
        earth: num(rawElements.earth, 0.2)
      },
      hexagram: str(result.hexagram, result.卦象, '乾为天'),
      judgment: str(result.judgment, result.批语, ''),
      forecast: str(result.forecast, result.流年, ''),
      advice: str(result.advice, result.建议, ''),
      analysis: Array.isArray(result.analysis) ? result.analysis : [],
      bazi: str(result.bazi, result.四柱, ''),
      destiny_type: str(result.destiny_type, result.命格, result.纳音, ''),
      innate_elements: hasDual ? {
        metal: num(innate.metal, 0.2),
        wood: num(innate.wood, 0.2),
        water: num(innate.water, 0.2),
        fire: num(innate.fire, 0.2),
        earth: num(innate.earth, 0.2)
      } : undefined,
      acquired_elements: hasDual ? {
        metal: num(acquired.metal, 0.2),
        wood: num(acquired.wood, 0.2),
        water: num(acquired.water, 0.2),
        fire: num(acquired.fire, 0.2),
        earth: num(acquired.earth, 0.2)
      } : undefined
    };
    if (meta) {
      normalized.repoStars = meta.stars;
      normalized.repoForks = meta.forks;
      normalized.repoLanguage = (meta.languages || '').split(',')[0].trim() || meta.languages || '';
      normalized.repoCreatedAt = meta.createdAt || undefined;
      normalized.repoPushedAt = meta.pushedAt || undefined;
      normalized.repoOpenIssues = meta.openIssues ?? undefined;
      normalized.repoSize = meta.size ?? undefined;
      normalized.repoLicense = meta.license || undefined;
      normalized.repoSubscribersCount = meta.subscribersCount ?? undefined;
      const lifecycle = getLifecycleStage(meta.createdAt);
      if (lifecycle) {
        normalized.lifecycle = {
          stage: lifecycle.stage,
          hexagram: lifecycle.hexagram,
          ageYears: Math.round(lifecycle.ageYears * 100) / 100,
          focus: lifecycle.focus,
          warning: lifecycle.warning
        };
      }
      if (!meta.createdAt) console.warn('[oracle] meta 无 createdAt，无法写入生辰');
      else console.log('[oracle] 已写入 repoCreatedAt:', meta.createdAt);
    }

    fortuneCache[cacheKey] = normalized;
    console.log('✅ 返回卦象:', normalized.hexagram, 'bazi:', !!normalized.bazi, 'innate:', !!normalized.innate_elements);
    res.json(normalized);
  } catch (error) {
    console.error('❌ 后端演算失败:', error);
    const msg = error.response?.status === 404
      ? '仓库不存在或无权访问'
      : (error.message || String(error));
    res.status(500).json({ error: '演算失败', details: msg });
  }
});

app.listen(PORT, () => {
  console.log(`✅ 赛博后端法阵已在 http://localhost:${PORT} 启动`);
});
