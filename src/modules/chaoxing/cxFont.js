/* =========================================================================
 * 超星字体混淆：查表 / 视觉转写，共用只读文本接口。
 * 不重写宿主 DOM，不移除字体 class；只在发送题目时读取还原后的文本。
 * ======================================================================= */
const CxFont = (() => {
  const HAN = /\p{Script=Han}/u;
  const MAX_FONT_BYTES = 8 * 1024 * 1024;
  const MAX_CHARS = 2000;
  const VISION_CACHE_VERSION = 1;
  const VISION_CACHE_PREFIX = 'skj-cx-font-vision-v1:';
  let fontSequence = 0;

  const plainText = el => String(el?.innerText ?? el?.textContent ?? '');
  const familyName = value => String(value || '').trim().replace(/^['"]|['"]$/g, '').toLowerCase();
  const families = value => String(value || '').split(',').map(familyName).filter(Boolean);
  const secretParent = node => node.parentElement?.closest?.('.font-cxsecret');
  const hasHan = text => HAN.test(text);

  function checkCancelled(cancelled) {
    if (cancelled()) throw new Error('字体识别已取消');
  }

  function textNodes(root) {
    const nodes = [];
    const visit = node => {
      if (node.nodeType === 3) { nodes.push(node); return; }
      if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/i.test(node.nodeName || '')) return;
      if (node.nodeType === 1) {
        const computed = node.ownerDocument?.defaultView?.getComputedStyle(node);
        if (computed?.display === 'none' || computed?.visibility === 'hidden') return;
      }
      for (const child of Array.from(node.childNodes || [])) visit(child);
    };
    visit(root);
    return nodes;
  }

  function collect(roots) {
    const seen = new Set(), records = [];
    for (const root of roots) {
      for (const node of textNodes(root)) {
        const original = node.nodeValue || '';
        if (!seen.has(node) && hasHan(original) && secretParent(node)) {
          seen.add(node);
          records.push({ node, original });
        }
      }
    }
    return records;
  }

  /** 只使用题目所属 Document 的内联字体，不请求未知外链、不猜测多字体归属。 */
  function fontFaces(doc) {
    const faces = new Map();
    for (const style of Array.from(doc.querySelectorAll('style'))) {
      const css = style.textContent || '';
      for (const match of css.matchAll(/@font-face\s*\{([^}]+)\}/gi)) {
        const family = match[1].match(/font-family\s*:\s*([^;]+)/i);
        const data = match[1].match(/url\(\s*(['"]?)(data:[^,)]+;base64,[A-Za-z0-9+/=\s]+)\1\s*\)/i);
        if (!family || !data) continue;
        const name = familyName(family[1]);
        const base64 = data[2].slice(data[2].indexOf(',') + 1).replace(/\s/g, '');
        const previous = faces.get(name);
        if (previous && previous.base64 !== base64) {
          throw new Error('同名字体存在多份字形数据，无法可靠还原');
        }
        faces.set(name, { name, base64, marked: css.includes('font-cxsecret'), doc, chars: new Set() });
      }
    }
    return faces;
  }

  function fontFor(record, faces) {
    const doc = record.node.ownerDocument;
    const computed = doc.defaultView?.getComputedStyle(record.node.parentElement)?.fontFamily;
    const names = families(computed);
    // CSS 的第一个字体必须是可解析的字体；不能误用后面的普通 fallback。
    if (names.length && faces.has(names[0])) return faces.get(names[0]);
    if (!names.length) {
      const marked = Array.from(faces.values()).filter(face => face.marked);
      if (marked.length === 1) return marked[0];
    }
    throw new Error('未找到混淆文字对应的内联 Base64 字体（外链或不明确字体暂不支持）');
  }

  function fontBytes(face) {
    if (!face.base64 || face.base64.length > Math.ceil(MAX_FONT_BYTES / 3) * 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(face.base64)) throw new Error('字体数据为空、过大或格式无效');
    const decode = face.doc.defaultView?.atob || globalThis.atob;
    if (typeof decode !== 'function') throw new Error('浏览器不支持 Base64 字体解码');
    const raw = decode.call(face.doc.defaultView, face.base64);
    if (!raw.length || raw.length > MAX_FONT_BYTES) throw new Error('字体数据大小无效');
    return Uint8Array.from(raw, ch => ch.charCodeAt(0));
  }

  function tableMap(face) {
    const font = CX_FONT_LIB.Typr.parse(fontBytes(face))[0];
    if (!font?.cmap) throw new Error('无法解析混淆字体');
    const map = new Map();
    for (const ch of face.chars) {
      const glyph = CX_FONT_LIB.Typr.U.codeToGlyph(font, ch.codePointAt(0));
      // 不在该字体中的字由系统字体显示，其 Unicode 原本就是真实文字。
      if (!glyph) { map.set(ch, ch); continue; }
      const path = CX_FONT_LIB.Typr.U.glyphToPath(font, glyph);
      if (!path?.cmds?.length || !path?.crds?.length) throw new Error('存在无法解析的汉字字形');
      const hash = CX_FONT_LIB.md5(JSON.stringify(path)).slice(24);
      const cp = CX_FONT_TABLE[hash];
      if (!Number.isInteger(cp) || cp < 0x3400 || cp > 0x10ffff || !hasHan(String.fromCodePoint(cp))) {
        throw new Error('现有字形表未命中全部字符；请手动切换图片视觉策略或人工处理');
      }
      map.set(ch, String.fromCodePoint(cp));
    }
    return map;
  }

  function visionCacheStorage(doc) {
    try {
      return doc?.defaultView?.sessionStorage || globalThis.sessionStorage || null;
    } catch (e) {
      return null;
    }
  }

  function isDecodedHan(value) {
    return typeof value === 'string' && Array.from(value).length === 1 && hasHan(value);
  }

  function visionCacheKey(face, visionConfig) {
    try {
      const signature = JSON.stringify({
        font: face.base64,
        baseUrl: visionConfig.openaiBaseUrl,
        model: visionConfig.openaiModel,
        temperature: visionConfig.openaiTemperature,
        apiKey: visionConfig.openaiApiKey
      });
      const hash = CX_FONT_LIB.md5(signature);
      return `${VISION_CACHE_PREFIX}${hash}`;
    } catch (e) {
      return '';
    }
  }

  /** 会话级只读结果缓存：不写入图片、题目、API Key 或 DOM 文本。 */
  function readVisionCache(face, visionConfig) {
    const storage = visionCacheStorage(face.doc), key = visionCacheKey(face, visionConfig);
    if (!storage || !key) return new Map();
    try {
      const raw = storage.getItem(key);
      if (!raw) return new Map();
      const payload = JSON.parse(raw);
      if (!payload || payload.version !== VISION_CACHE_VERSION || !payload.map ||
          typeof payload.map !== 'object' || Array.isArray(payload.map)) return new Map();
      const map = new Map();
      for (const [source, value] of Object.entries(payload.map)) {
        if (Array.from(source).length === 1 && hasHan(source) && isDecodedHan(value)) map.set(source, value);
      }
      return map;
    } catch (e) {
      return new Map();
    }
  }

  function writeVisionCache(face, visionConfig, map) {
    const storage = visionCacheStorage(face.doc), key = visionCacheKey(face, visionConfig);
    if (!storage || !key || !map.size) return;
    try {
      const payload = { version: VISION_CACHE_VERSION, map: {} };
      for (const [source, value] of map) {
        if (Array.from(source).length === 1 && hasHan(source) && isDecodedHan(value)) {
          payload.map[source] = value;
        }
      }
      storage.setItem(key, JSON.stringify(payload));
    } catch (e) {
      // sessionStorage 可能被禁用或已满；缓存失败不影响本次识别。
    }
  }

  async function visionMap(face, config, cancelled) {
    const doc = face.doc, win = doc.defaultView;
    // 上传之前验证配置；不会把独立模式的空参数偷偷换成主 API。
    const visionConfig = resolveCxVisionConfig(config);
    const chars = Array.from(face.chars);
    const map = readVisionCache(face, visionConfig);
    const missing = chars.filter(ch => !map.has(ch));
    if (!missing.length) {
      checkCancelled(cancelled);
      return map;
    }

    const FontFaceClass = win?.FontFace || globalThis.FontFace;
    if (!FontFaceClass || !doc.fonts?.add || !doc.fonts?.delete) throw new Error('浏览器不支持识图所需的字体加载接口');
    const family = `skj-cx-vision-${++fontSequence}`;
    const font = new FontFaceClass(family, fontBytes(face).buffer);
    let timer;
    try {
      await Promise.race([
        font.load(),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('识图字体加载超时')), 15000); })
      ]);
      clearTimeout(timer);
      checkCancelled(cancelled);
      doc.fonts.add(font);
      for (let start = 0; start < missing.length; start += 40) {
        checkCancelled(cancelled);
        const chunk = missing.slice(start, start + 40);
        const ids = chunk.map((_, i) => `g${i + 1}`);
        const canvas = doc.createElement('canvas');
        const columns = Math.min(8, chunk.length);
        canvas.width = columns * 144;
        canvas.height = Math.ceil(chunk.length / columns) * 164;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('无法创建字形图片');
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        chunk.forEach((ch, i) => {
          const x = (i % columns) * 144 + 72;
          const y = Math.floor(i / columns) * 164;
          ctx.fillStyle = '#222222';
          ctx.font = '20px sans-serif';
          ctx.fillText(ids[i], x, y + 26);
          ctx.font = `96px "${family}", sans-serif`;
          ctx.fillText(ch, x, y + 132);
        });
        checkCancelled(cancelled);
        const result = await requestCxGlyphRecognition(canvas.toDataURL('image/png'), ids, config);
        checkCancelled(cancelled);
        chunk.forEach((ch, i) => {
          const value = result.get(ids[i]);
          if (typeof value !== 'string' || Array.from(value).length !== 1 || !hasHan(value)) {
            throw new Error('识图结果缺失或不是单个汉字');
          }
          map.set(ch, value);
        });
        // 图片仅包含编号和单字，不上传页面、账号、课程链接或表单。
        canvas.width = canvas.height = 0;
      }
      writeVisionCache(face, visionConfig, map);
      return map;
    } finally {
      clearTimeout(timer);
      doc.fonts.delete(font);
    }
  }

  function makeReader(roots, records, maps, facesByDoc, cancelled) {
    const byNode = new Map(records.map(record => [record.node, record]));
    const styles = new Map(Array.from(facesByDoc.keys(), doc => [doc,
      Array.from(doc.querySelectorAll('style'), el => el.textContent || '').join('\n')]));
    const urls = new Map(Array.from(facesByDoc.keys(), doc => [doc, doc.URL]));
    const assertCurrent = () => {
      checkCancelled(cancelled);
      if (roots.some(root => root.isConnected === false)) throw new Error('题目已离开页面，停止使用字体识别结果');
      for (const [doc, before] of styles) {
        const current = Array.from(doc.querySelectorAll('style'), el => el.textContent || '').join('\n');
        if (current !== before || doc.URL !== urls.get(doc)) throw new Error('题目字体或页面已变化，请重新识别');
      }
      const current = collect(roots);
      if (current.length !== records.length || current.some(({ node, original }) => {
        const record = byNode.get(node);
        return !record || record.original !== original || fontFor(record, facesByDoc.get(node.ownerDocument)) !== record.face;
      })) throw new Error('混淆文字已变化，请重新识别');
    };
    const readText = el => {
      if (!el) return '';
      assertCurrent();
      if (textNodes(el).some(node => hasHan(node.nodeValue || '') && secretParent(node) && !byNode.has(node))) {
        throw new Error('出现未识别的混淆文字，请重新采集题目');
      }
      if (!records.some(record => el === record.node.parentElement || el.contains?.(record.node))) return plainText(el);
      const walk = node => {
        if (node.nodeType === 3) {
          const record = byNode.get(node);
          return record ? Array.from(record.original, ch => maps.get(record.face).get(ch) ?? ch).join('') : (node.nodeValue || '');
        }
        if (/^(SCRIPT|STYLE|NOSCRIPT|TEXTAREA|INPUT)$/i.test(node.nodeName || '')) return '';
        if (node.nodeName === 'BR') return '\n';
        const computed = node.ownerDocument?.defaultView?.getComputedStyle(node);
        if (computed?.display === 'none' || computed?.visibility === 'hidden') return '';
        const value = Array.from(node.childNodes || [], walk).join('');
        return /^(block|flex|grid|list-item|table-row)$/.test(computed?.display || '') ? `\n${value}\n` : value;
      };
      return walk(el);
    };
    return { readText, assertCurrent };
  }

  /**
   * Interface: prepare(questionRoots, configSnapshot, {cancelled}) -> reader.
   * 两个策略只负责生成同一份字符映射；失败抛错，不允许带乱码继续请求/提交。
   * reader.assertCurrent 在网络往返后再次校验；不改 DOM，因此可随时换策略重试。
   */
  async function prepare(roots, config, { cancelled = () => false } = {}) {
    roots = Array.from(roots);
    checkCancelled(cancelled);
    const records = collect(roots);
    const facesByDoc = new Map(), maps = new Map();
    for (const record of records) {
      const doc = record.node.ownerDocument;
      if (!facesByDoc.has(doc)) facesByDoc.set(doc, fontFaces(doc));
      record.face = fontFor(record, facesByDoc.get(doc));
      for (const ch of record.original) if (hasHan(ch)) record.face.chars.add(ch);
    }
    const faces = new Set(records.map(record => record.face));
    const characters = Array.from(faces).reduce((sum, face) => sum + face.chars.size, 0);
    if (characters > MAX_CHARS) throw new Error('本页混淆字符过多，请分批或人工处理');
    const strategy = config.cxFontStrategy || 'table';
    if (!['table', 'vision'].includes(strategy)) throw new Error('未知的字体混淆处理策略');
    // 在异步识图开始前快照原始文字、样式和文档，晚到结果不能套用到新页面。
    const reader = makeReader(roots, records, maps, facesByDoc, cancelled);
    for (const face of faces) {
      reader.assertCurrent();
      maps.set(face, strategy === 'table' ? tableMap(face) : await visionMap(face, config, () => {
        reader.assertCurrent();
        return false;
      }));
    }
    reader.assertCurrent();
    return { ...reader, strategy, characters };
  }
  return Object.freeze({ prepare });
})();
