window.__ModuleLoader__.load({
  id: "dsh-motion",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;

    // ══════════════════════════════════════════════════════════════════════════
    //  dsh-motion —— DSH Web UI 弹窗动效
    //
    //  两类弹窗，两套做法：
    //
    //  ① 远距弹窗（设置窗口 / shell 通用确认弹窗）
    //     弹窗离触发点远，观感要「浮出」：纯位移浮出，不淡入淡出。
    //     纯 CSS：这些弹窗挂载即播放动画，不需要任何 JS 监听。
    //     选择器用 :where() 把特异性压到 0 —— 任何自带动效的第三方弹窗都能盖过我们。
    //     运动规格照抄用户 fish-term 项目（鸿蒙 bindSheet(CENTER) 的复刻）。
    //
    //  ② 近距弹窗（输入框的模型选择器）
    //     贴着触发点，观感要「从按钮里长出来」：
    //       · 材质：**与 wallpaper 插件同源同配方**（同一组 --we-* 变量、同一条
    //         backdrop-filter、同一个高光/阴影），不自己发明观感 —— 见 ⑥
    //       · 动效：真弹簧采样成 CSS `linear()` 缓动，由合成器逐帧求值（见 ①）
    //
    //  ⚠ 性能红线（AGENTS.md §5：上一版 dsh-motion 因全局 MutationObserver +
    //     TreeWalker 全页扫描被移除）：
    //       · 观察器**只盯 document.body 的 childList**（不开 subtree）——
    //         实测模型弹窗是直接 portal 到 body 的，所以完全不需要子树扫描
    //       · 默认材质档是 blur，不做任何逐帧 SVG 滤镜；位移图只在「实验档」才生成
    //       · 不做任何轮询、不做全页 getComputedStyle
    //
    //  ⚠ 包含块红线（AGENTS.md §4.3）：backdrop-filter / filter / transform 会让元素
    //     成为 position:fixed 后代的包含块。实测模型弹窗的直接父节点就是 body，
    //     且子菜单是独立 portal ⇒ 不存在把浮层关进盒子的风险。
    //     远距弹窗只动 dialog 自身，绝不给 overlay/root 加 transform/opacity。
    // ══════════════════════════════════════════════════════════════════════════

    const STYLE_ID = "dsh-motion-style";
    const SVG_ID = "dsh-motion-filters";
    const ATTR_ON = "data-dshm";
    const ATTR_FAR = "data-dshm-far";
    const ATTR_MARK = "data-dshm-glass";
    const ATTR_ANIM = "data-dshm-anim";   // 仅「远距浮出动画进行中」这一小段时间挂上
    const SHADE_ATTR = "data-dshm-shade"; // 近距弹窗的「阴影代理」元素
    // 悬浮预览卡（会话/工作区行的官方 HoverCard）：换行时做「连贯气泡」的 carry 标记，
    // 见 isHoverPreviewCard() / hoverCarryGeo() 的长注释。
    const CARRY_ATTR = "data-dshm-carry";
    const ATTR_DBG = "data-dshm-debug";   // 诊断高亮总开关（挂 <html>，r20）
    const CFG_KEY = "dsh.motion.v1";
    const VERSION = "r56";   // 设置页第一行会显示，用户可直接读给我

    // ── 「近距弹窗」的识别口径（第七轮：从「只有模型选择器」推广到全部）──────────
    // 用户要求：「找到更多像是模型选择器弹窗这样的弹窗，都加上统一的动效和质感 …
    //            不只是单击出现的弹窗，只要是符合类似的交互逻辑的，靠近点击
    //            （左键、右键、鼠标悬浮等）位置的小弹窗都加上同样的效果」
    //
    // 第七轮普查（probes/motion-popup-survey.mjs / survey2.mjs / popup-ancestry.mjs）实测出的
    // **各族浮层的真实 DOM 契约**（都记在这里，别再靠猜）：
    //   ① 模型选择器      `div[role=menu]._7KE1Ra_menu` 248×88  position:fixed  父亲=body
    //                     aria-controls → `button._7KE1Ra_trigger`（语义锚点，唯一一个带它的）
    //   ② 官方共享 Menu   `div[role=menu]._list_1nxmc_8._portal_1nxmc_44`  position:fixed 父亲=body
    //                     来源已定位：`dsh-web-frontend` 里的 Menu 原语 —
    //                     `.list`/`.submenu` 都带 `role="menu"`，`.portal` 时 createPortal 到 body。
    //                     使用者：工作区选择（218×537）、模式座席（332×572）、设置窗内下拉（218×128）。
    //                     **没有** aria-controls —— 只能靠指针/aria-expanded 定位锚点。
    //   ③ 命令面板/斜杠   `div._3e4SsG_menu`（**无 role**、877×328、position:absolute）
    //                    内层 `div[role=listbox]._3e4SsG_viewport`（static）。
    //                     所以「表面」要比 role 节点**往上提一层** —— 见 surfaceOf()。
    //   ④ 悬浮提示        `span[role=tooltip]._bubble_1nw3t_1` 88×26  position:fixed，
    //                     材质是深色实心（--dsw-specific-tooltip-bg），与菜单**不是**同一杯玻璃。
    //   ⑤ 设置窗          `div[role=dialog].VOzbGW_panel` 800×800 —— 远距档，这里**必须排除**。
    //   官方右键上下文菜单：会话区/左栏/输入框三处都实测**没有**（见 survey2 的 R: 场景全为空）；
    //   第三方的 role=menu 菜单会自然被这条口径收进来（better-sidebar 的菜单源码注释就写着
    //   `div[role="menu"] div[role="menu"]`）。
    //
    // 第八轮补全（probes/motion-structure-dump.mjs + motion-health.mjs 实测）—— 用户点名的三族：
    //   ⑥ 会话顶部「13 subagents」  `div.ZKlsPq_menu` 336×N **role="tree"** position:fixed
    //   ⑦ 会话顶部「8 background jobs」`ul.QsffPG_menu` 336×N **无 role**   position:absolute
    //   ⑧ 会话列表行的悬浮小窗      `div._card_1b2ny_13._copyable_1b2ny_25` role=button
    //                              position:fixed，**背景是硬编码不透明 `rgb(44,44,46)`**
    //   ⑥⑦⑧ 三族的共同点：**背景吃了 `--dsw-specific-menu` 的色，但 computed `backdrop-filter` = none**
    //   —— 因为 `dsh-glass-patch` 只给 `:is([role=menu],[role=listbox],[role=tooltip],[role=alertdialog],
    //   [data-trigger-menu])` 加毛玻璃，`role=tree` / 无 role / `role=button` 全都不在名单里。
    //   这就是用户报的「背景没有模糊」。⇒ 第八轮起：**打标时若表面自己没有毛玻璃，就补上同一档配方**
    //   （见 markMaterialGap / `[data-dshm-nobf]` 规则），材质仍从同一个 `--dsp-*` / `--we-*` 派生。
    const NEAR_SEL = '[role="menu"],[role="listbox"],[role="tooltip"],[role="tree"],'
      + '[class*="menu" i],[class*="popover" i],[class*="popup" i],[class*="dropdown" i],'
      + '[class*="opPanel"],[id*="preset-panel"]';
    // r21 之前是 '[class*="_menu"],[class*="_popover"],[class*="_dropdown"]'（下划线前缀）。
    // 2026-09-15 普查（/tmp/popup-audit.txt，45 个 bundle）：连字符命名（dsh-rewind-popover、
    // .dsh-ig-pill-menu）、无分隔命名（nUhMVa_opPanel = 插件市场 Tasks 面板、Jh0q7G_selectPopup、
    // better-sidebar selectionPopup）、id 命名（tavern-session-preset-panel = 酒馆预设选择）全都漏网。
    // 它们共同的病：背景吃 --dsw-alias-bg-layer-1/2/3，而设置对话框把这三个 token 重定义成
    // 近乎透明的玻璃色薄膜（layer-1 = 玻璃色 × α×0.9 ≈ 14%）⇒ 对话框里的子浮窗纯透明、无 bf、无动效。
    // 修法不是逐个点名，而是把识别口径从「下划线命名」放宽到「不分大小写子串」+ 预设面板 id，
    // 误伤由 consider() 里的三道闸门兜住（role=dialog 自身 / 自己非定位 / dsh-pet 与 tlui- 画布）。
    // `[class*="_menu"]` 会把 `cubgiG_menuAnchor` / `uV2eYG_overlayAnchor` 这类**锚点占位元素**也匹配进来
    // —— 它们尺寸正常（154×28）却根本不是浮层。按名字挡掉。
    const ANCHOR_NAME = /Anchor|_anchor/;
    const KIND_TIP = "tip", KIND_MENU = "menu";
    // 悬浮提示的时长不能跟菜单一样：菜单是「点开留着看」，提示是「手一过就出现、手一移就走」，
    // 438ms 的过冲弹簧会显得又慢又黏。同一条弹簧解析式，只是 response 短、不过冲。
    const TIP_RESPONSE = 150, TIP_ZETA = 1.0;
    // 指针锚点的时间窗：太久以前的点击与这块新冒出来的浮层无关，宁可退回 aria/焦点。
    const PTR_FRESH_MS = 2500;

    const DEFAULTS = {
      on: true,           // 总开关
      far: true,          // 远距弹窗浮出
      glass: true,        // 近距弹窗（菜单/列表/命令面板）
      tips: true,         // 悬浮提示（role=tooltip）—— 快速档，见 TIP_RESPONSE
      unifySolid: true,   // 不透明底的浮层（如会话行悬浮卡 #2C2C2E）也换成菜单那杯玻璃底色
      spring: true,       // 弹簧入场（关掉则用短促淡入）
      exit: true,         // 消失动效（卸载瞬间克隆播反向，见 ④b）
      debug: false,       // 诊断高亮（设置页开关）：红框=已打标浮层，绿框=正在被收窄；默认关
      // ── 镜面白（泛白）总量：0.5 = wallpaper 原配方的一半（当前默认）──
      //   它归 glass-patch 的 `--dsp-sheen` 消费；这里留着是为了在设置页给一个滑杆
      //   （否则用户只能手敲 CSS 变量）。0 = 全去掉；1 = wallpaper 原配方；>1 更亮。
      //   用户 2026-09-15 先要求「去掉泛白」（当时设 0），随后改口径
      //   「加回来，但是参数减半」⇒ 0.5。
      sheen: 0.5,
      // 斜杠菜单「专属基色层」已在第十七轮**整体删除**：用户口径是「统一 = 同源，
      // 不接受另加一层自算的底色」，而实测证明删掉之后斜杠菜单 / 模型选择器 /
      // 对话输入框四字段（bg/bgi/bf/box-shadow）逐字段相同（probes/glass-round34.mjs）。
      // 所以这里不再有 menuFloor 开关，跨插件的 data-dsp-menufloor 属性也一并撤掉。
      tokens: true,       // 补齐 --ds-transition-duration-normal / --ds-ease-out 等空 token
      // ── 材质 ──
      // ── 材质：默认什么都不写 ──
      //   inherit = 完全不碰材质，交给 wallpaper + dsh-glass-patch（它们本来就是一整套、
      //             并且是**从 wallpaper 设置派生**的）。这样模型弹窗与其它所有菜单/浮层
      //             逐像素同源 —— 这才是真正的「统一」。
      //   window  = 照抄 wallpaper「设置窗口」那一杯玻璃（1.3.x 变量：--we-surface-tint-* /
      //             --we-settings-window-alpha / --we-settings-window-blur，见 WL_* 注释）；
      //             ⚠ 玻璃颜色若是深色，小弹窗会变成深色半透明，见 stats().mat 说明。
      //   refract = 实验：SVG 位移折射 + 色散（会掉帧）。
      mat: "inherit",
      alphaGain: 1,       // 仅 window 档：玻璃不透明度倍率（1 = 完全跟随 --we-settings-window-alpha）
      // ── 入场：直接采用 Apple SwiftUI 弹簧的**同一组参数** ──
      //   spring(response:dampingFraction:)  ω = 2π/response，ζ = dampingFraction
      //   时长不再手填，由弹簧的稳定时间算出（手填一个和弹簧不匹配的时长 = 曲线被截断/拉平）。
      // ⚠ 几何：iOS 26 的菜单**不是 uniform scale**。逐帧提取 Apple WWDC25 官方演示（§docs/
      //   ios26-liquid-glass-motion-research.md）看到的是：从触发控件位置生出一个 ~30px 的
      //   近圆气泡 → 长大 → 中途把形状松弛成圆角矩形，**圆角独立插值**，而**文字从不被缩放**。
      //   所以这里用 clip-path: inset(... round ...) 做真实 rect morph；scale 只留作附加手感。
      // ⚠ 用户 2026-09-13 追加要求：弹窗要「从按钮里出来（有位移）」+「有扭曲」。
      //   纯 clip morph 只有「展开」没有「位移」，也没有液体形变 —— 这里补上两者。
      from: 0.90,         // 起始缩放（配合 warp 做非等比，就是「扭曲」）
      warp: 0.26,         // 扭曲强度 0–0.5：横向比纵向多压 (1-warp)，长出时是各向异性形变 = 液体感
      lift: 18,           // 起始位移 px，方向朝触发按钮（贴边锚点 ⇒ 从里面升起来）
      bubble: 34,         // 起始气泡直径 px（以锚点为中心的小圆）
      // ⚠ 2026-09-13 用户第二次否掉观感：「还是没有 iOS 那般 q 弹，需要强化」。
      //   过冲量 = exp(-πζ/√(1-ζ²))：ζ=1.0 → 0%（第一版，物理正确但当当的没弹性）、
      //   ζ=0.58 → 10.7%（现值）、ζ=0.5 → 16.3%。iOS `.bouncy` 的 bounce=0.3 ⇒ ζ=0.7 ≈ 4.6%。
      //   ⚠ 但要诚实记一笔：§docs/ios26-liquid-glass-motion-research.md §3 的逐帧证据里
      //     **看不到 classic squash-and-stretch 的反向挤压**（iOS 是「圆→扁」的单向形变）。
      //     所以「q 弹」是用户要的手感、不是 iOS 的实际规格 —— 因此它必须是可调的：
      //     ζ 滑杆 0.5–1.0，随时能退回物理正确的 0 过冲。
      //   ζ<1 的过冲落在哪：`transform: scale()` 会**超过 1**（弹一下再收回来）——这就是「q 弹」；
      //   而 `clip-path` 的过冲只会伸到盒子外，**视觉上什么都没有**，反而会在欠冲段把阴影
      //   一闪一闪地露出来 ⇒ clip 单独用**截顶到 1** 的曲线（见 springCurve 的 clampAt1）。
      response: 280,      // ms（Apple `spring(response:)`；`.smooth/.snappy/.bouncy` 预设都是 0.5s）
      // ── q 弹程度：两个字段必须成对，见 syncSpring() ──
      //   overshoot = 过冲百分比（**用户直接调的那一个**），damping = Apple 的 dampingFraction。
      //   二者是同一个自由度的两种说法：O = exp(-πζ/√(1-ζ²))。用百分比当旋钮更好用
      //   —— 「0% = 物理正确但没弹性、10.7% = 默认、25% = 很蹦」比 ζ 的 0.58 直观得多。
      //   ⚠ 2026-09-13 用户点名要求「过冲参数要可调整」⇒ 把 ζ 滑杆换成过冲(%)滑杆，
      //     范围 0–25%（原来 ζ 0.5–1.0 只能到 16%）。set({damping}) 仍兼容（自动反解）。
      overshoot: 10.69,   // %（与下面的 damping 0.58 严格对应）
      damping: 0.58,      // dampingFraction。0.58 + response 280 ⇒ 过冲 10.7%、实际时长 438ms
                          //（WWDC25 逐帧量到的 iOS 26 菜单入场总时长就是 430–500ms）。
      // 系统开了「减少动效」时，本插件的**全部几何**（位移/扭曲/缩放/弹簧/气泡）都会让路，
      // 只剩 120ms 淡入 —— 这是有意为之的无障碍降级。但它有个副作用：材质照常变，
      // 几何一动不动，看起来就像「参数改了没反应」。所以给一个显式覆盖开关。
      forceMotion: false,
      // ── 并行动画预算（2026-10-21 性能优化）──────────────────────────────
      //  用户报「动效很容易卡顿」，要求限制并行动画数量。这里对**真正跑 clip morph +
      //  阴影代理**的那一档设硬上限（full 档每帧都要重采样 backdrop-filter，成本随
      //  「同时在播 × 面积」上涨）。超预算的浮层**不排队**（排队 = 晚入场 = 看得见
      //  的位置跳动），改播 only-opacity 的 cheap 档：同帧出现、合成器动画、
      //  零 backdrop 重采样；材质完全不变。cf. .probe/motion-jank-baseline.mjs
      maxAnim: 5,
      maxExit: 3,         // 消失动效（深克隆 + 合成层）并发上限；超出直接消失
      // ── 流式/高负载自适应降级（2026-10-21 第二轮）────────────────────────
      //  用户报「会话内容更新时（agent 正在思考/执行、消息刷新）弹窗动效明显卡顿」。
      //  流式期间应用层 React commit / 布局 / 绘制会持续占用主线程，而 clip-path morph
      //  是**非合成器**动画（每帧重画裁剪区域），一遇长任务就停顿；阴影代理/退出克隆还会
      //  再叠一层复制与绘制。这里在检测到压力时自动降级为合成器友好的 cheap（只 opacity）
      //  并跳过代理/克隆；压力消失自动恢复液态形变。不改变材质。
      busyGuard: true,
      // ── 仅实验档（refract）有效 ──
      disp: 1.15,         // 折射强度倍率
      blur: 0.6,          // ⚠ 必须极小：模糊会先把可被位移的高频细节抹平
      sat: 1.8,
      tint: 0.46,
      aberration: 2,      // 色散强度
      glassMode: "lens"   // 实验档内部：aberration = 三通道色散；lens = 2 原语精简
    };

    let cfg = Object.assign({}, DEFAULTS);
    try { Object.assign(cfg, JSON.parse(localStorage.getItem(CFG_KEY) || "{}")); } catch (e) { }
    // 兼容旧配置：老版本只存了 damping，没有 overshoot
    if (!isFinite(cfg.overshoot)) cfg.overshoot = +overshootForZeta(cfg.damping).toFixed(2);
    function saveCfg() { try { localStorage.setItem(CFG_KEY, JSON.stringify(cfg)); } catch (e) { } }

    const num = (v, d) => (typeof v === "number" && isFinite(v) ? v : d);
    const clamp01 = (v) => Math.max(0, Math.min(1, v));

    // ──────────────────────────────────────────────────────────────────────────
    //  ① 真弹簧 → CSS `linear()` 缓动
    //
    //     阻尼谐振子：u(t) = e^(-ζωt)·( cos(ω_d t) + (ζω/ω_d)·sin(ω_d t) )，u(0)=1、u(∞)=0
    //     进度 e(t) = 1 - u(t)：e(0)=0、随着 u 穿负而 e>1（这就是过冲）。
    //
    //     ⚠ 为什么不再用「采样成 26 个关键帧 + linear 计时」：
    //       那种写法把曲线切成 26 段直线，每段约 15ms，速度在段界处是**不连续**的
    //       —— 60Hz 下勉强看不出，120Hz 或帧间隔抖动时就是可见的「台阶感」。
    //       `linear()` 是**一个**缓动函数，由浏览器（合成器）按帧求值，
    //       任意刷新率下都是连续曲线，且只占用一条 animation 声明。
    // ──────────────────────────────────────────────────────────────────────────
    function springCurve(responseMs, zeta, N, clampAt1) {
      const sp = springSampler(responseMs, zeta);
      // clampAt1：给 clip-path 用的「截顶」版本 —— 过冲与欠冲都压到 1。
      // 理由见 DEFAULTS 注释：clip 的过冲没有视觉意义，而欠冲会让被裁掉的外阴影一闪一闪。
      // ⚠ r50：必须是**单调不减**（cumulative max）。旧版只做 min(1,v)：弹簧峰后回落到 <1 时
      //   裁剪盒会重新缩回 ~0.5px（面板已铺满又缩一下、四个角跟着回缩再复原），用户报的
      //   「四个角的问题」就是它。单调化后 clip 一旦到 1 就永久保持，角不再抖。
      let monoClip = 0;
      const f = clampAt1
        ? ((v) => { monoClip = Math.max(monoClip, Math.min(1, v)); return monoClip; })
        : ((v) => v);
      const pts = [];
      for (let i = 0; i <= N; i++) pts.push(i === 0 ? 0 : i === N ? 1 : +f(sp.x((i / N) * sp.settle)).toFixed(4));
      return { easing: "linear(" + pts.join(",") + ")", durationMs: Math.round(sp.settle * 1000), overshootPct: Math.round((sp.peak - 1) * 10000) / 100, zeta: sp.zeta };
    }

    // 弹簧采样器：`springCurve`（面板的两条动画）与 `shadeKeyframes`（阴影代理的复合曲线）
    // **必须**共用同一个解析式 —— 两条路径算出不同的弹簧，代理就会与面板脱节（第五轮的真实故障）。
    function springSampler(responseMs, zeta) {
      const response = Math.max(0.08, num(responseMs, 350) / 1000);
      const z = Math.max(0.35, Math.min(1.2, num(zeta, 0.85)));
      const omega = (2 * Math.PI) / response;
      const wd = omega * Math.sqrt(Math.max(1e-9, 1 - z * z));
      const x = (t) => 1 - Math.exp(-z * omega * t) * (Math.cos(wd * t) + (z * omega / wd) * Math.sin(wd * t));
      // 稳定时间 = **最后一次**偏离 1 超过 0.2% 之后（不是第一次接近 1）
      let last = response, peak = 0;
      for (let t = 0; t < 8; t += 0.002) { const v = x(t); if (v > peak) peak = v; if (Math.abs(v - 1) >= 0.002) last = t; }
      return { x, settle: last + 0.002, zeta: z, peak };
    }

    // ── 阴影代理的关键帧：把「transform × clip」的**乘积**烘成逐帧值（第六轮）──
    //   为什么不能用一条缓动：可见轮廓 = M(t)(C(t))，其中
    //     · M(t) = 面板的 transform（原始弹簧，含过冲）
    //     · C(t) = 裁剪盒（截顶弹簧，从气泡长到整盒）
    //   代理的盒子取面板盒 B，要渲染成同一轮廓就要 P(t)(B) = M(t)(C(t))，即
    //     K(t) = S(t)·k(t)、t_vec(t) = d(t) + S(t)·(C(t) − A) + A·K(t)
    //   这两条都是**两个弹簧的乘积**，而且 t_vec 可以「起点 0 → 中间鼓起来 → 终点 0」——
    //   任何单条缓动都表达不了（缓动只做 from→to 的线性映射，from=to=0 就恒为 0）。
    //   实测：喂原始弹簧 → 代理最大外溢 **30.6px**；改喂拟合的复合缓动仍有最坏 10px（极端档）。
    //   所以这里直接按解析式烘 N+1 个关键帧、段间 linear —— 逐帧值就是真值本身，误差只剩
    //   弦长误差（N=32 / 438ms 时 <0.5px，落在一团模糊阴影里完全不可见）。
    function shadeKeyframes(g) {
      // ⚠ 弹簧参数必须来自 `g`（打标时定格的），不能现读 cfg：悬浮提示用的是**另一条**
      //   短弹簧（TIP_RESPONSE），代理若照菜单那条算，相位一对不上就又出圈。
      const sp = springSampler(g.resp, g.zeta);
      const eT = (t) => sp.x(t);                    // 面板 transform 的进度（含过冲）
      // ⚠ r50：与 springCurve(clampAt1) 完全同源 —— 单调不减；否则代理轮廓会在动画尾部抖一下
      let ecMono = 0;
      const eC = (t) => { const v = Math.min(1, sp.x(t)); if (v > ecMono) ecMono = v; return ecMono; };  // clip 的进度（单调，防尾部回缩）
      const sx = (t) => g.sx0 + (1 - g.sx0) * eT(t);
      const sy = (t) => g.sy0 + (1 - g.sy0) * eT(t);
      const kx = (t) => g.k0x + (1 - g.k0x) * eC(t);
      const ky = (t) => g.k0y + (1 - g.k0y) * eC(t);
      const cx = (t) => g.bx * (1 - eC(t)), cy = (t) => g.by * (1 - eC(t));
      const N = 32, kf = [];
      for (let i = 0; i <= N; i++) {
        const t = (i / N) * sp.settle;
        const KX = sx(t) * kx(t), KY = sy(t) * ky(t);
        const TX = g.dx * (1 - eT(t)) + sx(t) * (cx(t) - g.ax) + g.ax * KX;
        const TY = g.dy * (1 - eT(t)) + sy(t) * (cy(t) - g.ay) + g.ay * KY;
        // ⚠ 2026-10-21：**不再逐帧插值 border-radius**。半径每帧变 ⇒ 代理每帧都要重画
        //   圆角路径（非合成器属性），32 帧 × 每个浮层；而代理画的是**一团模糊外阴影**，
        //   半径差几像素完全不可见（transform 的 scale 本来就会把静态圆角一起缩放）。
        //   只烘焙 transform 后，这条 WAAPI 全程走合成器。
        kf.push({
          offset: +(i / N).toFixed(5),
          transform: "translate3d(" + TX.toFixed(2) + "px," + TY.toFixed(2) + "px,0) scale("
            + KX.toFixed(5) + "," + KY.toFixed(5) + ")"
        });
      }
      kf[N] = { offset: 1, transform: "none" };
      return { keyframes: kf, durationMs: Math.round(sp.settle * 1000) };
    }

    // ── 过冲(%) ⇄ dampingFraction 的互解 ────────────────────────────────────────
    //   O = exp(-πζ/√(1-ζ²))、反解 ζ = -ln(O)/√(π² + ln²O)。
    //   两个方向都只依赖这一个自由度，所以 `overshoot` 与 `damping` 必须**成对**维护：
    //   用户给哪个就用哪个当输入，另一个现算 —— 绝不允许两个字段各自漂移。
    //   否则「滑杆显示 10.7% 而实际跑的是别的 ζ」这种鬼故事就会出现。
    function overshootForZeta(z) {
      const zz = Math.max(0, Math.min(1, num(z, 0.58)));
      if (zz >= 1) return 0;
      const d = Math.sqrt(Math.max(1e-12, 1 - zz * zz));
      return Math.exp(-Math.PI * zz / d) * 100;
    }
    function zetaForOvershoot(o) {
      const p = Math.max(0, Math.min(40, num(o, 10.69)));
      if (p <= 0.01) return 1;                       // 0% ⇒ 临界阻尼
      const L = Math.log(p / 100);
      return -L / Math.sqrt(Math.PI * Math.PI + L * L);
    }
    // patch 里显式给了哪一边就以哪一边为准；两边都给（「恢复默认」）则原样采纳，不反解。
    function syncSpring(patch) {
      if (!patch) return;
      const hasO = "overshoot" in patch, hasD = "damping" in patch;
      if (hasO && !hasD) cfg.damping = +zetaForOvershoot(cfg.overshoot).toFixed(4);
      else if (hasD && !hasO) cfg.overshoot = +overshootForZeta(cfg.damping).toFixed(2);
      if (!isFinite(cfg.overshoot)) cfg.overshoot = +overshootForZeta(cfg.damping).toFixed(2);
      if (!isFinite(cfg.damping)) cfg.damping = +zetaForOvershoot(cfg.overshoot).toFixed(4);
    }

    // 一个浮层这一代用的弹簧：菜单/列表走用户那组；悬浮提示走短档（见 TIP_RESPONSE）。
    // ⚠ 面板的 CSS 关键帧、代理的烘焙关键帧、stats 三处都必须从这里取，不能各读各的。
    function springPair(kind) {
      return kind === KIND_TIP
        ? { resp: TIP_RESPONSE, zeta: TIP_ZETA }
        : { resp: cfg.response, zeta: cfg.damping };
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ①b 阴影代理：把「外阴影」从被 clip 的面板搬到旁边一个不裁切的兄弟元素上
    //
    //     问题（用户 2026-09-13 报）：`clip-path` 会把元素**自己的外阴影一起裁掉**，
    //     而入场期间裁剪盒始终 ≤ 面板盒 ⇒ 阴影在整个入场过程里都是不可见的，
    //     直到动画结束 clip 被撤掉才「啪」地出现。用户的原话：「弹窗完全出现之后才会
    //     给后面的背景加上阴影，表示窗口上下级关系的阴影不是实时渲染的」。
    //
    //     做法：mark() 时算好「面板盒 → 起始气泡盒」的仿射变换，动画一开始就把外阴影
    //     复制到一个 `position:fixed`、与面板同盒同 z-index、DOM 上紧挨在面板前面的
    //     兄弟元素上，让它按同一条弹簧曲线从气泡长成整块 —— 阴影因此是**实时**的。
    //     面板自己的阴影全程被 clip 裁着（不可见），动画一结束代理即撤、阴影由面板接管
    //     （两者同值同盒，交接那一帧看不出差别）。
    //
    //     ⚠ 只复制**外层**阴影层（丢掉 `inset` 层）：代理是透明盒子，inset 阴影会在
    //       面板半透明玻璃底下透出来 = 平白多一道内描边。
    //     ⚠ 代理只做 `transform`（合成器动画），不逐帧改 left/top/width/height
    //       —— 后者每帧都要重排。
    // ──────────────────────────────────────────────────────────────────────────
    const shadeInfo = new WeakMap();   // 面板 → { r, tx, ty, kx, ky, origin, shadow }
    const shades = new WeakMap();      // 面板 → 代理元素
    let shadesAlive = 0;

    function splitShadow(s) {
      const out = []; let d = 0, cur = "";
      for (const ch of s) { if (ch === "(") d++; else if (ch === ")") d--; if (ch === "," && d === 0) { out.push(cur); cur = ""; } else cur += ch; }
      out.push(cur);
      return out.map((x) => x.trim()).filter(Boolean);
    }
    // ⚠ `inset` 在 Chrome 的**计算值**里是被规范化到**末尾**的：
    //   `rgba(255,255,255,.22) 0px 1px 0px 0px inset` —— 不能只判开头（第一版就栽在这，
    //   结果把两圈内高光也画到了代理上，会从半透明面板底下透出来）。
    const outerShadow = (s) => (!s || s === "none") ? "" : splitShadow(s).filter((l) => !/\binset\b/i.test(l)).join(", ");

    // 撤代理：`deferred` 时延后一帧。动画结束那一帧面板自己的阴影随 clip 一起回来，
    // 延后一帧 ⇒ 中间不会出现「两个都没有」的空帧（两者同值同盒，重叠也看不出来）。
    function removeShade(el, deferred) {
      const p = shades.get(el);
      if (!p) return;
      shades.delete(el);
      if (shadesAlive > 0) shadesAlive--;
      const kill = () => { try { p.remove(); } catch (e) { } };
      if (deferred) { try { requestAnimationFrame(kill); return; } catch (e) { } }
      kill();
    }

    function makeShade(el) {
      if (shades.get(el)) return;
      const g = shadeInfo.get(el);
      if (!g || !g.shadow || !g.r.width || !g.r.height || !el.parentNode) return;
      let p = null;
      try {
        p = document.createElement("div");
        p.setAttribute(SHADE_ATTR, "");
        const st = p.style;
        // ⚠⚠ 第八轮修：定位方案与坐标系必须跟面板**完全一致**。
        //   原来一律 `position:fixed` + 视口坐标，前提是「面板的包含块就是视口」。
        //   命令面板 `_3e4SsG_menu` 是 `position:absolute` 挂在 composer 子树里，而它的祖先
        //   `uV2eYG_card` 带 `backdrop-filter` ⇒ **包含块 = 那张卡片**（不是视口）。
        //   实测后果：代理落到 +497px / +994px 之外，`right=1885 > 1600` —— 用户报的
        //   「阴影没有实时计算」+「web 端宽度超出范围」都是这一处。
        //   修法两步：① 抄面板自己的 position 值（兄弟节点 ⇒ 包含块自然相同）；
        //             ② 先用视口坐标写一遍，量出实际落点再补偿一次（对任何包含块都成立）。
        const csP = getComputedStyle(el).position;
        st.position = (csP === "absolute" || csP === "sticky") ? csP : "fixed";
        st.left = g.r.left.toFixed(2) + "px";
        st.top = g.r.top.toFixed(2) + "px";
        st.width = g.r.width.toFixed(2) + "px";
        st.height = g.r.height.toFixed(2) + "px";
        st.borderRadius = g.r1;                 // 固定终值圆角（r24 起 WAAPI 只烘 transform，不再逐帧插值半径）
        st.boxShadow = g.shadow;
        st.pointerEvents = "none";
        st.transformOrigin = g.origin;
        // 起止几何不再走「行内变量 + CSS 关键帧」：WAAPI 关键帧自带每一帧的值（见 shadeKeyframes）。
        const cs = getComputedStyle(el);
        if (cs.zIndex && cs.zIndex !== "auto") st.zIndex = cs.zIndex;
        // 与面板同 z-index、DOM 上紧挨其前 ⇒ 绘制层级与「面板自带外阴影」完全一致
        el.parentNode.insertBefore(p, el);
        // ② 一次补偿：代理与面板此时都未被 transform 影响（面板的动画由 animationstart 触发，
        //    而这一帧的 transform 在 `backwards` 起点上还没跑）——
        //    实际落点差 = 屏幕坐标差，直接加回去即可，对任何包含块 / 滚动位置都成立。
        try {
          const pr = p.getBoundingClientRect(), er = el.getBoundingClientRect();
          const dx = g.r.left - pr.left, dy = g.r.top - pr.top;
          if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
            st.left = (parseFloat(st.left) + dx).toFixed(2) + "px";
            st.top = (parseFloat(st.top) + dy).toFixed(2) + "px";
          }
          void er;
        } catch (e) { }
        // ⚠ 代理的动画走 **Web Animations API**（逐帧烘焙），不是一条 CSS 缓动 ——
        //   原因见 shadeKeyframes：可见轮廓是两个弹簧的**乘积**，没有哪条缓动能表达它。
        //   WAAPI 比 `linear()` 老得多（2015 vs 2023），不支持的第二条路本来也不存在。
        //   ⚠ 相位必须对齐：代理是在面板的 animationstart 里才建的，天然晚了一个事件循环；
        //     不补偿就会「面板已经走到 t，代理还停在 t−Δ」——快速段上这是几个像素的错位。
        //     读面板那条 clip 动画的 currentTime，用负 delay 把两条时间轴钉在一起。
        const SE = shadeKeyframes(g);
        let lag = 0;
        try {
          const list = el.getAnimations ? el.getAnimations() : [];
          for (let i = 0; i < list.length; i++) {
            if (list[i].animationName === "dshm-glass-clip" && typeof list[i].currentTime === "number") { lag = list[i].currentTime; break; }
          }
        } catch (e) { }
        if (typeof p.animate === "function") {
          try { p.animate(SE.keyframes, { duration: SE.durationMs, easing: "linear", fill: "backwards", delay: -lag }); }
          catch (e) { }
        }
        shades.set(el, p);
        shadesAlive++;
      } catch (e) { if (p) { try { p.remove(); } catch (e2) { } } }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ② 实验档：SDF 位移图（圆角矩形 → 朝中心的径向收缩 → RGBA 位移场）
    //
    //     ⚠ 默认**不启用**。实测它在真机（浏览器所在的那台鸿蒙 PC）上入场期间
    //       会掉帧：位移图 + 三次 feDisplacementMap + 色彩矩阵每帧都要重跑，
    //       且弹窗一出现就要同步跑一次 canvas 生成，正好卡在动画第一帧上。
    //       用户 2026-09-13 判定「太差」，改为默认走 wallpaper 同源材质。
    // ──────────────────────────────────────────────────────────────────────────
    function buildMap(W, H, radius) {
      const q = Math.max(1, Math.round(Math.max(W, H) / 128)); // 降采样：位移图本身是平滑场
      const mw = Math.max(8, Math.ceil(W / q));
      const mh = Math.max(8, Math.ceil(H / q));
      const r = Math.max(1, Math.min(radius / q, Math.min(mw, mh) / 2 - 0.5));

      const c = document.createElement("canvas");
      c.width = mw; c.height = mh;
      const cx = c.getContext("2d");
      const img = cx.createImageData(mw, mh);
      const raw = new Float32Array(mw * mh * 2);

      // 透镜模型（对齐 shuding/liquid-glass + rdev/liquid-glass-react 的公开实现）：
      // 「朝中心的径向收缩」——每个像素从更靠中心的位置采样，越靠边收得越多 ⇒ 边缘放大。
      // 过渡用 smoothstep 铺到很宽的一条带上（不是窄带里的 t²），这是像不像透镜的关键。
      const hw = mw / 2, hh = mh / 2;
      const band = Math.max(3, Math.min(hw, hh) * 0.30);
      const sdf = (x, y) => {
        const qx = Math.abs(x) - (hw - r), qy = Math.abs(y) - (hh - r);
        return Math.min(Math.max(qx, qy), 0) + Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) - r;
      };
      let maxAbs = 1e-6, k = 0;
      for (let y = 0; y < mh; y++) {
        for (let x = 0; x < mw; x++) {
          const ix = x + 0.5 - hw, iy = y + 0.5 - hh;
          let t = 1 + sdf(ix, iy) / band;
          t = t < 0 ? 0 : (t > 1 ? 1 : t);
          t = t * t * (3 - 2 * t);                  // smoothstep
          const dx = -ix * t, dy = -iy * t;         // 朝中心收缩
          if (Math.abs(dx) > maxAbs) maxAbs = Math.abs(dx);
          if (Math.abs(dy) > maxAbs) maxAbs = Math.abs(dy);
          raw[k++] = dx; raw[k++] = dy;
        }
      }
      let j = 0;
      for (let i = 0; i < img.data.length; i += 4) {
        img.data[i] = (raw[j++] / maxAbs) * 127.5 + 127.5;      // R = 横向位移
        const g = (raw[j++] / maxAbs) * 127.5 + 127.5;          // G = 纵向位移
        img.data[i + 1] = g;
        img.data[i + 2] = g;                                    // B 同 G：对齐 yChannelSelector="B"
        img.data[i + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      return { url: c.toDataURL(), mw: mw, mh: mh };
    }

    const SVGNS = "http://www.w3.org/2000/svg";
    const svgN = (n, attrs) => {
      const e = document.createElementNS(SVGNS, n);
      if (attrs) for (const k in attrs) if (attrs[k] !== undefined) e.setAttribute(k, String(attrs[k]));
      return e;
    };
    const CH = ["R", "G", "B"];

    const filterIds = new Map();
    let filterSeq = 0, svgEl = null, defsEl = null;

    function ensureSvg() {
      if (svgEl && svgEl.isConnected) return svgEl;
      svgEl = document.createElementNS(SVGNS, "svg");
      svgEl.id = SVG_ID;
      svgEl.setAttribute("aria-hidden", "true");
      svgEl.setAttribute("style", "position:absolute;width:0;height:0;overflow:hidden;pointer-events:none");
      defsEl = document.createElementNS(SVGNS, "defs");
      svgEl.appendChild(defsEl);
      document.body.appendChild(svgEl);
      return svgEl;
    }

    function ensureFilter(W, H, radius) {
      const key = Math.round(W) + "x" + Math.round(H) + "r" + Math.round(radius)
        + ":" + cfg.glassMode + ":" + (cfg.glassMode === "aberration" ? cfg.aberration : 0);
      const hit = filterIds.get(key);
      if (hit) return hit;
      ensureSvg();
      const map = buildMap(W, H, radius);
      const id = "dshm-f" + (++filterSeq);
      const f = document.createElementNS(SVGNS, "filter");
      f.setAttribute("id", id);
      f.setAttribute("x", "0"); f.setAttribute("y", "0");
      f.setAttribute("width", "100%"); f.setAttribute("height", "100%");
      f.setAttribute("color-interpolation-filters", "sRGB");
      const S0 = Math.max(4, Math.min(18, Math.min(W, H) * 0.17)) * cfg.disp;
      const AB = Math.max(0, cfg.aberration);
      const rec = { id: id, key: key, w: W, h: H, base: S0, disp: +S0.toFixed(2), map: map.mw + "x" + map.mh, nodes: [], el: f };
      const push = (n, a) => { const e = svgN(n, a); f.appendChild(e); return e; };

      if (cfg.glassMode === "aberration") {
        // 色散滤镜图（照抄 rdev/liquid-glass-react 的公开实现）：
        // ① 从位移图推导边缘掩膜 ② 三次 feDisplacementMap 做 R/G/B 分离
        // ③ feBlend screen 合回 ④ 中心用未位移原图 + 反相掩膜
        push("feImage", { href: map.url, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none", result: "MAP" });
        push("feColorMatrix", { in: "MAP", type: "matrix", result: "EDGE_I",
          values: "0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0.33 0.33 0.33 0 0 0 0 0 1 0" });
        const ctf = push("feComponentTransfer", { in: "EDGE_I", result: "EDGE_MASK" });
        ctf.appendChild(svgN("feFuncA", { type: "discrete", tableValues: "0 " + (AB * 0.05).toFixed(3) + " 1" }));
        push("feOffset", { in: "SourceGraphic", dx: 0, dy: 0, result: "CENTER" });
        const scales = [S0, S0 * (1 - AB * 0.05), S0 * (1 - AB * 0.10)];
        for (let ci = 0; ci < 3; ci++) {
          const dn = "D" + CH[ci];
          const dmn = push("feDisplacementMap", { in: "SourceGraphic", in2: "MAP", xChannelSelector: "R", yChannelSelector: "B",
            scale: scales[ci].toFixed(2), result: dn });
          rec.nodes.push({ node: dmn, k: ci === 0 ? 1 : (1 - AB * (ci === 1 ? 0.05 : 0.10)) });
          const m = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0];
          m[ci * 5 + ci] = 1;
          push("feColorMatrix", { in: dn, type: "matrix", values: m.join(" "), result: CH[ci] + "C" });
        }
        push("feBlend", { in: "GC", in2: "BC", mode: "screen", result: "GBC" });
        push("feBlend", { in: "RC", in2: "GBC", mode: "screen", result: "RGBC" });
        push("feGaussianBlur", { in: "RGBC", stdDeviation: Math.max(0.15, 0.45 - AB * 0.1).toFixed(2), result: "AB" });
        push("feComposite", { in: "AB", in2: "EDGE_MASK", operator: "in", result: "EDGE_AB" });
        const inv = push("feComponentTransfer", { in: "EDGE_MASK", result: "INV" });
        inv.appendChild(svgN("feFuncA", { type: "table", tableValues: "1 0" }));
        push("feComposite", { in: "CENTER", in2: "INV", operator: "in", result: "CLEAN" });
        push("feComposite", { in: "EDGE_AB", in2: "CLEAN", operator: "over" });
      } else {
        // 精简档（2 个原语）：位移图 → 位移。顺序不能反，SVG 滤镜按原语顺序求值。
        push("feImage", { href: map.url, x: 0, y: 0, width: W, height: H, preserveAspectRatio: "none", result: "MAP" });
        const dmn = push("feDisplacementMap", { in: "SourceGraphic", in2: "MAP",
          xChannelSelector: "R", yChannelSelector: "B", scale: S0.toFixed(2) });
        rec.nodes.push({ node: dmn, k: 1 });
      }

      defsEl.appendChild(f);
      filterIds.set(key, rec);
      return rec;
    }

    // 切换滤镜模式必须整批重建：滤镜图结构不同，改属性救不回来
    function purgeFilters() {
      for (const rec of filterIds.values()) { try { rec.el.remove(); } catch (e) { } }
      filterIds.clear();
    }

    // 改了「折射强度」要同步已缓存的滤镜，否则滑块只对新尺寸生效
    function refreshFilters() {
      for (const rec of filterIds.values()) {
        const s = rec.base * cfg.disp;
        for (const n of rec.nodes) { try { n.node.setAttribute("scale", (s * n.k).toFixed(2)); } catch (e) { } }
        rec.disp = +s.toFixed(2);
      }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ③ 目标识别（第七轮：通用化）
    // ──────────────────────────────────────────────────────────────────────────

    // 指针轨迹：最后被按下/右键/悬浮到的元素。这是**唯一**一条对所有各族都成立的锚点线索
    // —— 官方共享 Menu（②）既不写 aria-controls 也不写 aria-owns，但它的锚点
    // 就是「用户刚点的那个按钮」，这正好是用户说的「靠近点击位置」。
    const ptr = { x: 0, y: 0, el: null, at: -1e9 };

    // 从指针落点向上找「可当锚点」的那个元素（拿 button 的矩形，而不是里面那个 span 的）。
    const ANCHORISH = 'button,a,[role="button"],[role="menuitem"],[role="option"],[role="tab"],summary,input,textarea,select';
    function nearestAnchor(el) {
      for (let n = el, i = 0; n && n.nodeType === 1 && i < 4; n = n.parentElement, i++) {
        try { if (n.matches(ANCHORISH)) return n; } catch (e) { }
      }
      return el && el.nodeType === 1 ? el : null;
    }

    function kindOf(el) {
      const r = (el.getAttribute("role") || "").toLowerCase();
      if (r === "tooltip") return KIND_TIP;
      if (r === "menu" || r === "listbox" || r === "tree") return KIND_MENU;
      return null;
    }

    // 这个节点是「靠 role 认定的」还是「靠类名认定的」？
    // 类名认定必须**额外**要求一个锚点（指针 2.5s 内 / aria 展开 / 语义链接），否则
    // 页面上任何叫 `*_menu*` 的静态容器都会被误标 —— 这是这一层唯一的保险。
    function byRole(el) {
      const r = (el.getAttribute("role") || "").toLowerCase();
      return r === "menu" || r === "listbox" || r === "tooltip" || r === "tree";
    }

    // 「像一块浮层表面」：必须自己有可见的底 / 毛玻璃 / 阴影。
    // 挡掉 `cubgiG_menuAnchor`（锚点占位）、透明包装层之类。
    function looksLikeSurface(el) {
      let cs = null; try { cs = getComputedStyle(el); } catch (e) { return false; }
      const bg = cs.backgroundColor || "";
      const alpha = (() => {
        const m = /rgba?\(([^)]+)\)/.exec(bg);
        if (!m) return bg === "transparent" ? 0 : 1;
        const p = m[1].split(/[,\s/]+/).filter(Boolean);
        return p.length >= 4 ? parseFloat(p[3]) : 1;
      })();
      return alpha > 0.02 || cs.backdropFilter !== "none" || cs.boxShadow !== "none" || cs.backgroundImage !== "none";
    }

    // 角色节点 → **表面元素**（承载背景/圆角/阴影/裁切的那一层）。
    // 只有命令面板需要往上提（role=listbox 在内层 viewport 上）；模型菜单与共享 Menu
    // 自己就是表面。上提的边界由 data-slot / role / 子节点数三重兜住 —— 再多提一层
    // 就会提进 composer 的 card 里（实测祖先链：`_3e4SsG_menu` → `[data-slot=conversation.input.overlay]`
    // → `uV2eYG_overlayAnchor` → `uV2eYG_card`，第 1 层就带 data-slot，正好停住）。
    function surfaceOf(el) {
      let best = el;
      for (let p = el.parentElement, i = 0; p && i < 3; p = p.parentElement, i++) {
        if (p === document.body || p === document.documentElement) break;
        if (p.hasAttribute("data-slot") || p.getAttribute("role")) break;
        if (p.childElementCount > 2) break;
        let cs = null; try { cs = getComputedStyle(p); } catch (e) { break; }
        if (cs.backgroundColor !== "rgba(0, 0, 0, 0)" || cs.backdropFilter !== "none" || cs.boxShadow !== "none") best = p;
      }
      return best;
    }

    // 语义锚点：aria-controls / aria-owns / aria-labelledby 指回来的那个元素（模型选择器走这条）
    function ownerFor(el) {
      if (!el.id) return null;
      for (const a of ["aria-controls", "aria-owns", "aria-labelledby"]) {
        try { const o = document.querySelector("[" + a + "=" + CSS.escape(el.id) + "]"); if (o) return o; } catch (e) { }
      }
      return null;
    }

    // 锚点优先级：① 语义链接 → ② 页面上「展开着」的 aria-haspopup 触发器（取离浮层最近的那个）
    //              → ③ 指针最后触碰的元素 → ④ 焦点元素
    // ⚠ ① 必须排在 ②③ 之前：模型选择器的既有断言（motion-morph-verify / overshoot-verify …）
    //   全都基于「锚点 = `button._7KE1Ra_trigger` 的矩形」，换源就会让那些冻结帧数值漂移。
    function anchorEl(el) {
      const o = ownerFor(el);
      if (o && o !== el) return o;
      const r = el.getBoundingClientRect();
      let best = null, bd = Infinity;
      try {
        const ex = document.querySelectorAll('[aria-haspopup][aria-expanded="true"]');
        for (let i = 0; i < ex.length; i++) {
          const b = ex[i].getBoundingClientRect();
          if (b.width < 1 || b.height < 1) continue;
          // ── r22 邻接闸门：锚点必须与浮层**同轴相邻或重叠** ──────────────────
          //  实测（/tmp/r22b.mjs）酒馆预设面板的锚点被判成了**左下角的 Settings 按钮**
          //  （x10–270 / y948，面板在 x629–883 / y272–447）：全页只有这一个
          //  `[aria-haspopup][aria-expanded=true]`，中心距 1225 < 1400 的距离闸门就放行了
          //  ⇒ origin 算成「面板左下角」、位移朝下 —— 用户看到的「动效出现的位置不对」。
          //  浮动定位的物理事实是：触发器与面板**必然共享一条边或一列**（贴边/对齐）。
          //  完全不相交的一对就不是一对；这条闸门比距离阈值稳得多（距离要多少才够，
          //  在 800px 对话框和 1600px 页面上根本不是同一个数）。
          const hOv = Math.min(b.right, r.right) - Math.max(b.left, r.left);
          const vOv = Math.min(b.bottom, r.bottom) - Math.max(b.top, r.top);
          // 三条放行路径（任一即可）：① 水平投影重叠 ② 垂直投影重叠
          // ③ 对角相近（两轴间隙都 ≤ 24px —— 提示/卡片挂在按钮右下角那种）
          if (!(hOv > 0 || vOv > 0 || (hOv > -24 && vOv > -24))) continue;
          const d = Math.abs(b.left + b.width / 2 - (r.left + r.width / 2)) + Math.abs(b.top + b.height / 2 - (r.top + r.height / 2));
          if (d < bd) { bd = d; best = ex[i]; }
        }
      } catch (e) { }
      if (best && bd < 1400) return best;
      if (ptr.el && ptr.el.isConnected && (performance.now() - ptr.at) < PTR_FRESH_MS) {
        const a = nearestAnchor(ptr.el);
        if (a && a !== el && !el.contains(a)) return a;
      }
      const ae = document.activeElement;
      if (ae && ae !== el && ae !== document.body && ae.getBoundingClientRect) return ae;
      return null;
    }

    // 是不是「块状浮层」而不是遮罩/整页容器
    function isFloating(el) {
      let n = el;
      for (let i = 0; n && i < 4; n = n.parentElement, i++) {
        let cs = null; try { cs = getComputedStyle(n); } catch (e) { return false; }
        if (cs.position === "fixed" || cs.position === "absolute") return true;
      }
      return false;
    }

    // 元素是不是「还没排好版」—— 官方有菜单是 `visibility:hidden;top:0;left:0` 先挂载、
    // 量完尺寸再摆位（`Oe.menu` + `data-dockkit-tab-menu`）。这种必须先等一帧再打标，
    // 否则会把 0×0 的矩形当成面板盒、把气泡算到角落里去。
    function notReady(el) {
      if (!el.isConnected) return true;
      let cs = null; try { cs = getComputedStyle(el); } catch (e) { return true; }
      if (cs.visibility === "hidden" || cs.display === "none") return true;
      const r = el.getBoundingClientRect();
      return r.width < 8 || r.height < 8;
    }

    // 面板自己用行内 transform 定位/居中时**不能**接管 transform
    // （我们的关键帧会把那个 transform 覆盖掉 ⇒ 浮层瞬移到 (0,0)）。
    // 命中就退到「只淡入」档：观感仍统一，几何让给框架。
    function usesInlineTransform(el) {
      const t = el.style && el.style.transform;
      return !!t && t !== "none";
    }

    // ── r56：玻璃弹窗（dialog）内部的**独立浮层**也要被接管（2026-10-26）────────────
    //   用户原话（PUA 风味下拉）：「修改过后的材质和动效都没有被统一，应当是 dsh-motion 与
    //   wallpaper 统一的玻璃材质与液体动效才对」。
    //   根因：pua 的原生 <dialog>（createPortal 到 body + showModal）被形状路径打上
    //   data-dshm-glass（它自己走近距液态入场）；而 consider() / isTarget() 的
    //   「最近打标祖先 ⇒ 不重复动画」早退，把 dialog 里**独立弹出**的 host Menu 也当成
    //   嵌套层跳过了 ⇒ 下拉既没有 438ms 液态入场，还会被 glass-patch 的内层复位当成
    //   「内层」刷透明。判据：只有最近一层打标祖先**不是**玻璃弹窗（dialog /
    //   role=dialog / aria-modal=true）时才跳过；真正的嵌套浮层（菜单里的子菜单、
    //   悬浮卡里的菜单）仍按原口径跳过。
    function isGlassDialog(el) {
      if (!el || el.nodeType !== 1) return false;
      try {
        if (el.tagName === "DIALOG") return true;
        const role = el.getAttribute("role");
        if (role === "dialog" || role === "alertdialog") return true;
        if (el.getAttribute("aria-modal") === "true") return true;
        return !!(el.matches && el.matches("dialog"));
      } catch (e) { return false; }
    }
    // 最近一层打标祖先是不是「玻璃弹窗」（glass dialog 内部的内联浮层专用判据）
    function insideMarkedDialog(el) {
      try {
        const a = el && el.parentElement ? el.parentElement.closest("[" + ATTR_MARK + "]") : null;
        return !!(a && isGlassDialog(a));
      } catch (e) { return false; }
    }
    function popupGlassAncestor(el) {
      let p = el && el.nodeType === 1 ? el.parentElement : null;
      let guard = 0;
      while (p && guard++ < 8) {
        let a = null;
        try { a = p.closest("[" + ATTR_MARK + "]"); } catch (e) { a = null; }
        if (!a) return null;
        if (!isGlassDialog(a)) return a;
        p = a.parentElement;           // 玻璃弹窗只是容器：继续看它上面还有没有真浮层祖先
      }
      return null;
    }

    // ⚠ 这里**不再**重复校验 `NEAR_SEL`：传进来的是 `consider()` 提上来的**表面元素**，
    //   而命令面板的表面（`_3e4SsG_menu`）**自己没有 role** —— 再校一次就会把它丢掉。
    //   语义判定已在 `consider()` 用 `kindOf()` 做过。
    function isTarget(el, clsMatched) {
      if (!el || el.nodeType !== 1) return false;
      if (el.hasAttribute(SHADE_ATTR)) return false;              // 自己的阴影代理
      if (el.hasAttribute("data-dshm-exit") || el.hasAttribute("data-dshm-ghost")) return false;        // ④b 自己的消失克隆（不打标，否则播完又生、无限级联）
      if (el.classList && el.classList.contains("dshm-pv")) return false; // 设置页预览
      if (el.hasAttribute(ATTR_MARK)) return false;               // 已打标
      let anc = null; try { anc = popupGlassAncestor(el); } catch (e) { anc = null; }
      if (anc) return false;                                      // 祖先已是浮层 ⇒ 不重复动画（玻璃弹窗内部的内联菜单除外，见 popupGlassAncestor）
      const cn = typeof el.className === "string" ? el.className : "";
      if (ANCHOR_NAME.test(cn)) return false;                     // 锚点占位元素，不是浮层
      if (!isFloating(el)) return false;
      // r19：role 认定的浮层跳过「像个表面」闸门 —— 原生透明底 + 无 bf/bgi/shadow 的
      // role=menu/listbox/tree/tooltip 即使用户看着是「纯透明」，它仍然是浮层：
      // 放行后 markMaterialGap/❷ 收敛才会接手给它玻璃 + clamp。类名/形状两条路径
      // 的闸门保留（那是唯一的误伤保险），只对 byRole 放行。
      if (!byRole(el) && !looksLikeSurface(el)) return false;
      // ⚠ 尺寸闸门：挡掉全屏遮罩 / 整页容器。视口 85% 以上的一律不是「小弹窗」。
      let r = null; try { r = el.getBoundingClientRect(); } catch (e) { return false; }
      if (r.width > innerWidth * 0.85 && r.height > innerHeight * 0.85) return false;
      // ⚠ 类名 / 形状认定的必须**真的靠近一个锚点**（这是用户给的定义，也是唯一的误伤保险）。
      if (clsMatched && !anchorEl(el)) return false;
      return true;
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ④ 打标 / 还原
    //     ⚠ 材质（背景/描边/阴影）走**样式表**而不是行内样式：
    //       行内样式会压过 wallpaper 与 dsh-glass-patch 的规则，而明暗两套的
    //       默认玻璃色不同（#ffffff / #0d1524），只能靠级联选。行内只留
    //       与几何有关的 transform-origin / --dshm-lift。
    // ──────────────────────────────────────────────────────────────────────────
    const snapshots = new WeakMap();
    let markedCount = 0, skipped = 0;
    let carryCount = 0, carrySkipped = 0;   // r27：悬浮预览卡换行的「连贯气泡」次数（见 hoverCarryGeo）
    let tipSwapCount = 0, tipFirstCount = 0; // r28：上下文洞察 hovertip 跨格「连贯气泡」次数（见 tipCarryGeo）

    // ── 并行动画预算（2026-10-21 性能优化）──────────────────────────────────
    //  真机「卡顿」的放大器：一次交互里同时跑多个 clip-path rect morph。每个 morph
    //  每帧都要对 backdrop-filter 重新采样（裁剪盒变 ⇒ 采样区域变），成本随
    //  「同时播放数 × 面积」线性上涨。这里给 full 档（morph + 阴影代理）一个硬上限；
    //  超预算不排队，直接降级（见 mark() 与 buildCss() 末尾的 cheap 档）。
    const animActive = new Set();
    let animPeak = 0, animSkipped = 0;
    const animStartAt = new WeakMap();
    const animTimers = new Map();
    let animDurMs = 438;               // buildCss() 每次重算时同步（与面板动画同一条弹簧）

    // ── 流式/主线程压力检测（2026-10-21 第二轮）──────────────────────────────
    //  两个信号：① LongTask（浏览器 >=50ms 的任务；流式 commit 的典型形态）
    //            ② 元素节点新增速率（流式 markdown 重渲染持续插入元素）+ characterData 计数
    //  任一命中就认为「现在忙」，窗口 900ms（一次长任务之后通常还有连续的绘制/布局排队）。
    let lastLongAt = -1e9, lastLongMs = 0;
    const longTs = [];
    try {
      if (typeof PerformanceObserver === "function") {
        new PerformanceObserver((list) => {
          const es = list.getEntries();
          for (let i = 0; i < es.length; i++) if (es[i].duration >= 80) {
            lastLongAt = performance.now(); lastLongMs = es[i].duration;
            longTs.push({ t: lastLongAt, d: es[i].duration });
            if (longTs.length > 32) longTs.shift();
          }
        }).observe({ entryTypes: ["longtask"] });
      }
    } catch (e) { }
    // ⚠ 慢信号（longtask）单独用不够：**打开一个弹窗自己就有 ~52ms 的 React 挂载任务**
    //   ⇒ 单次 50ms 会把后面 900ms 的弹窗全部误降级（实测 idle 也 42/42 cheap）。
    //   所以：① 长任务要「≥150ms 单次」或「1.2s 内 ≥3 个 ≥80ms」；
    //         ② 真正的流式信号是 characterData 速率（token 更新；开弹窗不产生）
    //            与元素新增速率（markdown 重渲染）。
    let winStart = 0, winEl = 0, winChar = 0, elRate = 0, charRate = 0, longN = 0;
    let busyDegraded = 0, busyExitSkips = 0;

    // ── 主线程帧节奏饱和检测（r31，2026-10-21 第三轮）──────────────────────────
    //  用户反馈（本轮）：「正在运行的会话里消息不停加载滚动时，所有动画都非常卡顿」。
    //  实测根因（headless Chromium 138 + 真流式，探针 `.probe/repro-r31-stream2.mjs`）：
    //  0.2.1-rc.2 的流式渲染是「千刀万剐型」——React 把一帧 100ms+ 的渲染/布局拆成
    //  多个 20–40ms 的任务，于是：
    //    · LongTask API 抓不到（r25 的 ≥300/600ms 门永远不亮）；
    //    · DOM 更新被批成 ~8 次/秒（charRate 7/s ≪ 阈值 25/s，elRate 1/s ≪ 180/s）；
    //  ⇒ **r25 的 busyGuard 在真机上从未触发**，流式期间新开的浮层照样播满成本
    //    clip-path rect morph（paint 属性，每帧主线程重画），与应用的 commit 抢线程。
    //  实测：流式 15s 内主线程占 69%（Script 49%），p95 帧 66ms、43 帧 >50ms；
    //  长会话更差（p50 帧 116ms、单帧 max 1.1s）；同一时刻 motion-off 只有 p95 33ms。
    //  这里直接量用户真正感知的东西：**帧间隔**。它与 DOM 更新形态无关，
    //  成本 = 每帧 1 次写环形缓冲 + 每 30 帧排序 60 个数（微秒级，不碰 DOM）。
    //  判据（2026-10-21 实测）：idle/滚动 p50 16.7 / p95 16.7；
    //  流式 p50 16.7–116.7、p95 50–283；切会话冷启动有单帧 100–150ms 尖刺
    //  ⇒ 必须「持续」才判饱和：连续 2 个评估窗口命中（≈1s）才置位，置位后保持
    //  1200ms（动画 160–438ms，保证整段进场都走 cheap），之后自动回摆。
    //  只降级**动画形态**（opacity 合成器动画），不改几何、不写布局，回归风险低。
    let satAt = -1e9, satP50 = 0, satP95 = 0, satSlow = 0, satHits = 0, satMiss = 0;
    const satGaps = new Float32Array(64);
    const satTimes = new Float64Array(64);
    let satN = 0, satHead = 0, satEvalAt = 0, satLast = -1, satRaf = 0, satLoopOn = false;
    function satNow() {
      if (!cfg.on || !cfg.busyGuard) return false;
      return performance.now() - satAt < 1200;
    }
    function satEval() {
      // ⚠ 取「最近 1000ms 内的帧间隔」，不是「最近 60 帧」：低帧率下 60 帧会横跨好几秒，
      //   旧快帧会把当前的慢帧稀释掉 —— 首版实测 p50 116ms 却没置位，就是栽在这。
      const now = performance.now();
      const a = [];
      const rec = []; // 最近 ~400ms（用于快速释放）
      for (let i = 0; i < satN; i++) {
        const idx = (satHead - 1 - i + 64) % 64;
        const age = now - satTimes[idx];
        if (age > 1200) break;
        a.push(satGaps[idx]);
        if (age <= 420) rec.push(satGaps[idx]);
      }
      // 快速释放：最近 400ms 连续健康（每帧 <45ms）⇒ 两次评估（≈500ms）后清掉饱和，
      // 不等 1.2s 窗口自然排空（否则流式刚结束那一秒多的弹层会白白降级、还拖测试）。
      // 释放时同时清空环，防止残留的旧慢帧把下一拍立刻重新判成 bad（抖动）。
      if (rec.length >= 2 && rec.every((g) => g < 45)) {
        if (++satMiss >= 2) { satAt = -1e9; satMiss = 0; satHits = 0; satN = 0; satHead = 0; return; }
      } else satMiss = 0;
      // 极端负载下（实测 4x CPU 节流，帧间隔 116–183ms）1.2s 窗口里只剩 4–6 个样本，
      // 旧阈值 <6 会直接不评估 ⇒ sat 反复释放、菜单会漏降级。降到 4。
      if (a.length < 4) return;
      // 慢帧占比：12000–14000ms 实测是「双峰」形态（大多数 16.7ms + 每秒 5–8 个 100–133ms
      // 的停顿），中位数看起来正常，但动画肉眼可见地一卡一卡 ⇒ 必须按占比判。
      let slow = 0;
      for (let i = 0; i < a.length; i++) if (a[i] > 50) slow++;
      satSlow = slow / a.length;
      a.sort((x, y) => x - y);
      satP50 = a[Math.floor(a.length * 0.5)];
      satP95 = a[Math.min(a.length - 1, Math.floor(a.length * 0.95))];
      // 判据（实测标定）：中位帧 >36ms（持续低于 28fps）或 1.2s 内 >22% 的帧 >50ms（明显卡顿），
      // 或「长尾 + 少量慢帧」（p95>66 且慢帧 >10%）—— 覆盖双峰卡顿形态。
      const bad = satP50 > 36 || satSlow > 0.22 || (satP95 > 66 && satSlow > 0.1);
      if (bad) { if (++satHits >= 2) { satAt = now; satHits = 0; } }
      else satHits = 0;
    }
    function satFrame(t) {
      if (!satLoopOn) return;
      satRaf = requestAnimationFrame(satFrame);
      if (satLast > 0) {
        satGaps[satHead] = t - satLast;
        satTimes[satHead] = t;
        satHead = (satHead + 1) % 64;
        if (satN < 64) satN++;
      }
      satLast = t;
      // 每 250ms 评估一次（不是每 8 帧）：低帧率下按帧评估会把「连续 2 次」拖到 2s 以上，
      // 用户点开浮层时饱和还没被确认 —— 实测首版就是这样漏掉 6–14s 的整段卡顿。
      if (t - satEvalAt >= 250) { satEvalAt = t; satEval(); }
    }
    function satStart() {
      if (satLoopOn) return;
      satLoopOn = true; satLast = -1; satN = 0; satHead = 0; satEvalAt = 0; satMiss = 0;
      try { satRaf = requestAnimationFrame(satFrame); } catch (e) { }
    }
    function satStop() {
      satLoopOn = false;
      try { cancelAnimationFrame(satRaf); } catch (e) { }
    }
    // ⚠ 文本更新有两条路径：characterData（直接改 nodeValue）与「Text 节点被替换/追加」
    //   （React 的 markdown 重渲染、textContent= 都是这一类）⇒ 两条都算流式信号。
    function noteMutations(elN, txtN) {
      const now = performance.now();
      if (!winStart || now - winStart > 1000) { winStart = now; winEl = 0; winChar = 0; }
      winEl += elN; winChar += txtN;
      const w = Math.max(0.25, (now - winStart) / 1000);
      elRate = winEl / w; charRate = winChar / w;
    }
    function busyNow() {
      if (!cfg.busyGuard) return false;
      const now = performance.now();
      while (longTs.length && now - longTs[0].t > 1500) longTs.shift();
      longN = longTs.length;
      // r31：帧节奏饱和 —— 0.2.1-rc.2 的流式是「千刀万剐型」，长任务/DOM 速率信号都抓不到。
      if (satNow()) return true;
      // 长任务门控（不要误伤「刚打开会话」）：一次 ≥400ms（切会话/冷启动级冻结），
      // 或 1.5s 内 ≥2 个 ≥300ms（持续重渲染）。单个 80–300ms 的 commit/会话打开不算 ——
      // 打开一个弹窗自己就 ~52ms，误判会让正常使用里第二个弹窗直接掉档。
      let heavy = 0;
      for (let i = 0; i < longTs.length; i++) {
        if (longTs[i].d >= 600) return true;
        if (longTs[i].d >= 300) heavy++;
      }
      if (heavy >= 2) return true;
      // 阈值实测（2026-10-21）：idle 时本工作区仍有插件周期性插 60 个节点/秒
      //（elRate 基线 ~60），所以元素速率阈值必须显著高于它；流式 markdown 重渲染通常
      // 数百/秒。characterData 是最干净的流式信号：idle 0–4/s，流式 20–60/s。
      if (charRate > 25) return true;
      if (elRate > 180) return true;
      return false;
    }
    function animCap() { return Math.max(1, Math.min(32, Math.round(num(cfg.maxAnim, 5)))); }
    function animAcquire(el) {
      if (animActive.size >= animCap()) return false;
      animActive.add(el);
      if (animActive.size > animPeak) animPeak = animActive.size;
      animStartAt.set(el, performance.now());
      // 兜底释放：animationend 被中断（元素被移除/display:none）时不能把名额漏掉。
      const t = setTimeout(() => animRelease(el), animDurMs + 500);
      animTimers.set(el, t);
      return true;
    }
    function animRelease(el) {
      if (!animActive.has(el)) return;
      animActive.delete(el);
      const t = animTimers.get(el);
      if (t) { try { clearTimeout(t); } catch (e) { } animTimers.delete(el); }
      animStartAt.delete(el);
    }
    // clamp 保护窗（2026-10-21 审查修）：不只 full 档 —— cheap（160ms veil）/ slide（280ms）/
    //  nomorph（fade）也都是「入场动画进行中」，期间写 max-width/translate 一样会中途重排
    //  ⇒ 用户看到「弹窗先出现、再跳一下」。按档位给保护窗，窗口内 tryClamp 只推迟不写。
    const clampHold = new WeakMap();
    function animBusy(el) {
      if (animActive.has(el)) return true;
      const t = clampHold.get(el);
      return !!t && performance.now() < t;
    }
    function animRemain(el) {
      const now = performance.now();
      const t0 = animStartAt.get(el);
      const a = t0 ? Math.max(0, animDurMs - (now - t0)) : 0;
      const h = clampHold.get(el) || 0;
      return Math.max(a, h > now ? h - now : 0);
    }

    const TOUCHED = ["background-color", "background-image", "backdrop-filter", "-webkit-backdrop-filter",
      "box-shadow", "transform-origin", "--dshm-lift", "--dshm-from",
      "--dshm-ci-top", "--dshm-ci-left", "--dshm-ci-right", "--dshm-ci-bottom", "--dshm-ci-r0", "--dshm-r1", "max-width"];
    const SHORT = {
      "background-color": "bg", "background-image": "bgi", "backdrop-filter": "bf",
      "-webkit-backdrop-filter": "wbf", "box-shadow": "sh", "transform-origin": "to",
      "--dshm-lift": "lift", "--dshm-from": "from",
      "--dshm-ci-top": "cit", "--dshm-ci-left": "cil", "--dshm-ci-right": "cir",
      "--dshm-ci-bottom": "cib", "--dshm-ci-r0": "cir0", "--dshm-r1": "r1", "max-width": "mw",
      "--dshm-dx": "dx", "--dshm-dy": "dy", "--dshm-sx": "sx", "--dshm-sy": "sy"
    };

    function snap(el) {
      const o = {};
      for (const k of TOUCHED) { o[SHORT[k]] = el.style.getPropertyValue(k); o[SHORT[k] + "P"] = el.style.getPropertyPriority(k); }
      snapshots.set(el, o);
    }

    function unmark(el) {
      el.removeAttribute(ATTR_MARK);
      el.removeAttribute("data-dshm-nomorph");
      el.removeAttribute("data-dshm-geo");
      try { delete el.__dshmPending; } catch (e) { }
      try { delete el.__dshmClamped; } catch (e) { }
      try { if (clamp0.has(el)) { const o = clamp0.get(el); if (o) el.style.setProperty("max-width", o); else el.style.removeProperty("max-width"); clamp0.delete(el); } } catch (e) { }
      try { if (shift0.has(el)) { const o = shift0.get(el); if (o) el.style.setProperty("translate", o); else el.style.removeProperty("translate"); shift0.delete(el); } } catch (e) { }
      // r19：unmark 必须同时归还 translate 位移 —— 旧代码只还了 max-width，
      // 元素在「被平移进视口」的状态下卸载/还原会把 translate 遗留成行内样式。
      try { if (el.__dshmRoots) { for (let i = 0; i < el.__dshmRoots.length; i++) norootOff(el.__dshmRoots[i]); delete el.__dshmRoots; } } catch (e) { }
      el.removeAttribute("data-dshm-kind");
      el.removeAttribute("data-dshm-slide");   // r20 斜杠滑入标记，还原时一并去掉
      el.removeAttribute("data-dshm-clamped"); // r20 诊断标记（绿框），还原时去掉
      el.removeAttribute("data-dshm-nobf");
      el.removeAttribute("data-dshm-solid");
      el.removeAttribute("data-dshm-cheap");
      el.removeAttribute("data-dshm-noanim");
      el.removeAttribute("data-dshm-noclip");
      el.removeAttribute(CARRY_ATTR);
      // r28：hovertip 的「滑移过渡」只在对齐落位之后才打开（见 armTipGlide），还原时收掉。
      el.removeAttribute(TIPGLIDE_ATTR);
      try { if (el.__dshmTipGlide) { clearTimeout(el.__dshmTipGlide); delete el.__dshmTipGlide; } } catch (e) { }
      clampHold.delete(el);
      animRelease(el);
      removeShade(el);
      shadeInfo.delete(el);
      const s = snapshots.get(el);
      for (const k of TOUCHED) {
        const kk = SHORT[k];
        const v = s ? s[kk] : "";
        const p = s ? s[kk + "P"] : "";
        if (v) el.style.setProperty(k, v, p); else el.style.removeProperty(k);
      }
      snapshots.delete(el);
      if (markedCount > 0) markedCount--;
    }

    // ── 材质补齐（第八轮）──────────────────────────────────────────────────────
    // 判据只两条，挂在属性上让样式表接手（**不写行内**，否则会压过 glass-patch）：
    //   `data-dshm-nobf`  底是半透明的、但没有毛玻璃  ⇒ 补上菜单那一档 backdrop-filter
    //   `data-dshm-solid` 底是**完全不透明**的        ⇒ 换成菜单那杯玻璃的底色 + 毛玻璃
    // 实测来源见 probes/motion-health.mjs：`role=tree` / 无 role / `role=button` 的三族
    // 都吃了 `--dsw-specific-menu` 的色却 `backdrop-filter: none`（glass-patch 的 role 名单之外）。
    // ⚠⚠ 必须同时认 `rgb()/rgba()` 与 `color(srgb r g b / a)` 两种序列化 ——
    //   第一版只写 `rgba?()`，而 Chrome 把小弹窗的底色序列化成
    //   `color(srgb 0.620392 0.632941 0.656471 / 0.83)` ⇒ 正则不匹配就当成「不透明」，
    //   于是模型选择器 / 命令面板也被打上 `data-dshm-solid`（会把它们的底色换掉）。
    //   实测就是这么被抓出来的（probes/motion-round8-verify.mjs 的 `solid=` 读数）。
    function alphaOf(bg) {
      if (!bg || bg === "transparent") return 0;
      let m = /^rgba?\(([^)]+)\)$/.exec(bg);
      if (m) { const p = m[1].split(/[,\s/]+/).filter(Boolean); return p.length >= 4 ? parseFloat(p[3]) : 1; }
      m = /^color\(([^)]+)\)$/.exec(bg);
      if (m) {
        const p = m[1].split(/[\s/]+/).filter(Boolean);   // [srgb, r, g, b, (a)]
        return p.length >= 5 ? parseFloat(p[4]) : 1;
      }
      return 1;
    }
    function markMaterialGap(el, csOf) {
      if (cfg.mat !== "inherit") return;      // window / refract 档自己会写材质，别叠加
      let cs = null; try { cs = csOf ? csOf() : getComputedStyle(el); } catch (e) { return; }
      const bf = cs.backdropFilter || "none";
      const a = alphaOf(cs.backgroundColor);
      if (bf === "none" && a > 0.02 && a < 0.99) el.setAttribute("data-dshm-nobf", "");
      else if (a >= 0.99 && cs.backgroundImage === "none" && cfg.unifySolid) el.setAttribute("data-dshm-solid", "");
    }


    // ── ④b 消失动效（第十三轮：用户「返回的动效也需要做，而不应该是直接消失」）──
    //   难点：DSH 浮层关闭 = React 同步卸载 DOM，没有「隐藏态」可播动画
    //   （probes/glass-round13b.mjs EXIT-TRACE：属性/样式零过渡、直接 REMOVED）。
    //   做法：卸载瞬间 deep-clone 一份（类名都在 ⇒ 玻璃照旧），按打标时定格的几何
    //   播一段反向 WAAPI（近距 = morph 收回气泡，远距 = 下沉淡出），播完即删。
    //   克隆去 id + 去打标属性 + pointer-events:none ⇒ 不干扰事件与取证口径。
    //   护栏：① reduce-motion 下跳过 ② 同一批卸载 >2 个视为 teardown（切会话等）跳过
    //   ③ 大祖先（>30 节点）整体卸载视为 teardown 跳过。
    const exitInfo = new WeakMap();   // 打标面板 → 定格几何（卸载后量不到，只能当时记）
    const farInfo = new WeakMap();    // role=dialog → 最后一次见到的 rect（入场是纯 CSS，不管）
    let exitCount = 0, overflowFixed = 0;
    // 退出动效预算（2026-10-21）：克隆整棵子树是同步成本，克隆后 210ms 又是一个合成层。
    // 并发上限 + 大子树直接跳过，否则「连续关闭很多浮层」会把主线程反噬。
    let exitActiveN = 0, exitSkipped = 0, exitPeak = 0;
    function exitCap() { return Math.max(1, Math.min(16, Math.round(num(cfg.maxExit, 3)))); }
    function exitAcquire() {
      if (exitActiveN >= exitCap()) return false;
      exitActiveN++;
      if (exitActiveN > exitPeak) exitPeak = exitActiveN;
      return true;
    }
    function exitRelease() { if (exitActiveN > 0) exitActiveN--; }
    function reduceOn() {
      try { return !cfg.forceMotion && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; }
    }
    function trackFar(el) {
      try {
        if (!cfg.on || !cfg.exit || !cfg.far) return;
        const cs = getComputedStyle(el);
        if (cs.position !== "fixed" && cs.position !== "absolute") return;
        const r = el.getBoundingClientRect();
        if (r.width < 100 || r.height < 100) return;
        if (r.width > window.innerWidth * 0.9 && r.height > window.innerHeight * 0.9) return;
        farInfo.set(el, { x: r.left, y: r.top, w: r.width, h: r.height, far: true,
          z: (cs.zIndex && cs.zIndex !== "auto") ? cs.zIndex : "" });
      } catch (e) { }
    }
    function exitClone(el, info, ctx) {
      if (!cfg.on || !cfg.exit || reduceOn()) return;
      if (!el || !info || !info.w || !info.h) return;
      const subtree = el.getElementsByTagName ? el.getElementsByTagName("*").length : 0;
      // 流式/高负载：不深克隆、不播退场（克隆 + 插入 + WAAPI 是 210ms 的额外合成层）。
      if (busyNow()) { busyExitSkips++; exitSkipped++; return; }
      if (subtree > 120 || !exitAcquire()) { exitSkipped++; return; }
      let c = null;
      // ⚠⚠ 第十四轮：克隆**优先放回原位**（同一个父、同一个后继节点）。
      //   用户报「收起来的瞬间材质会变化」的真因就在这里 —— 放到 body 后，
      //   backdrop 的采样上下文变了（祖先的 backdrop root / 裁剪盒完全不同），
      //   同一个 class、同一份 CSS 也会渲染出两种材质。原位插入 ⇒ 上下文逐字相同
      //   ⇒ 材质**按构造不变**，不依赖任何几何/材质复刻。
      //   失败（父已断开 / 后继已不在）才退回 body + 视口几何。
      let inPlace = false;
      try {
        c = el.cloneNode(true);
        // ⚠⚠⚠ 第十八轮（**真机取证后的更正，第十七轮的结论是错的**）：
        //   `ATTR_MARK` 这个名字就是 `data-dshm-glass` —— 它既是「已打标」的标记，
        //   **又是 motion 所有材质规则的选择器**（`html[data-dshm] [data-dshm-glass]{background-color:…}`）。
        //   第十七轮我以为「保留全部属性」就够，结果唯一被我继续剥掉的正是这一个；
        //   用户在真机上的取证（probes/live/r17-forensics.json）里鬼影的属性表是：
        //     class / data-trigger-menu / style / data-dshm-box / data-dshm-kind /
        //     data-dshm-geo / data-dshm-exit / aria-hidden      ← **没有 data-dshm-glass**
        //   于是鬼影掉回下一档规则（dsh-glass-patch 的同源配方），底色从
        //   `color(srgb .051 .082 .141 / .1767)`（窗口玻璃）跳成 `rgba(255,255,255,0.07)`
        //   （输入框 token）—— 这就是用户看到的「收回瞬间变成泛白的玻璃」。
        //   安全性：isTarget / collectExit **都在第一行就跳过 data-dshm-exit / data-dshm-ghost**，
        //   所以留着 data-dshm-glass 也不会被重新打标（第十七轮把这两处跳过前置过）。
        //   ⇒ 现在克隆是原件的**逐属性副本**，材质按构造逐字段相同。
        c.removeAttribute("id");
        // r27b：鬼影不能继承 carry（carry 规则是 !important 且特异性高于 ghost 的 animation:none，
        //   会让退场鬼影重播 180ms 滑移，干扰 WAAPI 退场）。
        try { c.removeAttribute(CARRY_ATTR); } catch (e) { }
        c.setAttribute("data-dshm-exit", "");
        c.setAttribute("aria-hidden", "true");
        // 整个幽灵子树盖 **data-dshm-ghost**（不是 data-dshm-exit）：否则 considerTree 会把
        // 克隆**内部**的 [role=listbox]/[role=menu] 重新打标 + 播一遍入场动画，幽灵就自己动起来。
        // ⚠ 为什么后代用另一个属性：data-dshm-exit 上挂了 will-change:transform,clip-path，
        //   刷到整棵子树（实测 138 个元素）= 138 个合成层，纯属自残。只有**根**需要那个提示。
        try {
          const all = c.querySelectorAll ? c.querySelectorAll("*") : [];
          for (let i = 0; i < all.length; i++) { all[i].setAttribute("data-dshm-ghost", ""); all[i].removeAttribute("id"); }
        } catch (e) { }
        const st = c.style;
        st.pointerEvents = "none";
        if (info.ox) st.transformOrigin = info.ox + " " + info.oy;
        try {
          if (ctx && ctx.parent && ctx.parent.isConnected) {
            if (ctx.next && ctx.next.isConnected && ctx.next.parentNode === ctx.parent) ctx.parent.insertBefore(c, ctx.next);
            else ctx.parent.appendChild(c);
            inPlace = true;
          }
        } catch (e) { inPlace = false; }
        if (!inPlace) {
          // 兜底：视口几何（box-sizing 必须显式，否则 padding/border 会把盒子撑宽 —— 实测 +8px）
          st.boxSizing = "border-box";
          st.position = "fixed";
          st.left = info.x.toFixed(1) + "px";
          st.top = info.y.toFixed(1) + "px";
          st.width = (info.ow || info.w).toFixed(1) + "px";
          st.height = (info.oh || info.h).toFixed(1) + "px";
          st.margin = "0";
          if (info.z) st.zIndex = info.z;
          document.body.appendChild(c);
        }
      } catch (e) { try { c && c.remove(); } catch (e2) { } exitRelease(); return; }
      try {
        let kf = null, dur = 200;
        if (info.far) {
          dur = 180;
          kf = [{ transform: "none", opacity: 1 }, { transform: "translate3d(0,26px,0)", opacity: 0 }];
        } else if (info.slide && !info.nomorph && info.bubble) {
          // r20 斜杠退场：远距同款下沉（进场是上滑，退场镜像下沉，与 far 进出配对）。
          // nomorph（行内 transform 定位）或无气泡时仍走淡出，避免 WAAPI 覆盖作者定位。
          dur = 180;
          kf = [{ transform: "none", opacity: 1 }, { transform: "translate3d(0,26px,0)", opacity: 0 }];
        } else if (info.nomorph || !info.bubble) {
          dur = 140;
          kf = [{ opacity: 1 }, { opacity: 0 }];
        } else {
          const b = info.bubble;
          const ri = Math.max(0, info.w - b.left - b.w), bt = Math.max(0, info.h - b.top - b.h);
          // ⚠⚠ 第十七轮：死区从 0.7 收到 0.12。
          //  用户第三次报「出现和消失动效不一致 / 消失瞬间材质变化」。实测（round32 的 keyframes dump）：
          //  旧的 offset 0.7 在 210ms 上 = 前 147ms 完全静止（transform:none / opacity:1），
          //  最后 63ms 一口气 snap 完 ⇒ 观感就是「停一下突然消失」，与入场那条 438ms 弹簧
          //  （linear(0, 0.0193 2.08%, …)，起手即动、前重）完全不是一回事。
          //  入场弹簧在 t≈2% 就已走 1.9%、t≈12.5% 走 44% ⇒ 镜像它应该是「立刻开始收」。
          //  0.12 保留一点点「先定住再收」的手感（对应入场 clip 从气泡开始的那一小段），
          //  其余 88% 的时长都在动。
          kf = [
            { clipPath: "inset(0 0 0 0 round " + info.r1 + ")", transform: "none", opacity: 1, offset: 0 },
            { clipPath: "inset(0 0 0 0 round " + info.r1 + ")", transform: "none", opacity: 1, offset: 0.12 },
            { clipPath: "inset(" + b.top.toFixed(1) + "px " + ri.toFixed(1) + "px " + bt.toFixed(1) + "px " + b.left.toFixed(1) + "px round " + b.r0.toFixed(1) + "px)",
              transform: "translate3d(" + info.dx + "px," + info.dy + "px,0) scale(" + info.sx + "," + info.sy + ")", opacity: 0, offset: 1 }
          ];
          dur = info.tip ? 150 : 210;
        }
        // ⚠ r29：effect 级 easing 必须是 linear。WAAPI 的关键帧 offset 落在**缓动后进度**空间，
        //   原来把 ease-in 放在 effect 级 ⇒ offset 0.12 实际被拉长到 ~29% 时长才走完，鬼影先
        //   定住 ~60ms 再 snap，与注释「其余 88% 的时长都在动」相反（审计清单 M2）。
        //   改为逐段缓动：死区段 linear（offset 0.12 = 12% 时长），收束段保留原 ease-in；
        //   两关键帧分支（far/slide/nomorph）行为与旧版一致（同样是一条 ease-in 段）。
        for (let ki = 0; ki < kf.length - 1; ki++) {
          kf[ki] = Object.assign({}, kf[ki], {
            easing: ki === kf.length - 2 ? "cubic-bezier(.42,0,1,1)" : "linear"
          });
        }
        const a = c.animate(kf, { duration: dur, easing: "linear", fill: "forwards" });
        exitCount++;
        let exitDone = false;
        const kill = () => { if (exitDone) return; exitDone = true; exitRelease(); try { c.remove(); } catch (e) { } };
        if (a && a.finished) a.finished.then(kill, kill);
        setTimeout(kill, dur + 400);
        // r28：把鬼影句柄交回去 —— onMutations 会把它挂到 tipSwap 上，若紧接着新气泡出现
        //   （上下文洞察 hovertip 跨格），tipCarryGeo() 立刻取消它并从它的当前位置接手。
        return c;
      } catch (e) { try { c.remove(); } catch (e2) { } exitRelease(); }
    }
    // 溢出收窄（第十三/十四轮）：任何**浮层小窗**都不许越过视口边缘。
    //   触发一次记一次数（stats().overflowFixed）。两个来源：
    //     ① 打标路径（mark → clampOverflow）：官方菜单/提示
    //     ② 指针路径（mouseover 去抖 90ms 后扫 TIP_SEL）：第三方小窗（实测
    //        dsh-file-drop 的 .dsh-paperclip-tip、dsh-ocg-tip 既无 role=tooltip、
    //        也不吃官方 _bubble 的 max-width，宽度完全由自己的 CSS 决定 ⇒ 只能这样兜）
    //   只改 max-width（最小侵入），原值记在 WeakMap 里，不再溢出就还原。
    //   ⚠ 必须在**定位完成之后**再量：浮动库是先挂载再摆位，所以打标路径做
    //     rAF 三次复核（0/80/240ms），指针路径另算一次。
    const clamp0 = new WeakMap();
    const shift0 = new WeakMap();   // 位移兜底：原 translate 属性值（'' = 本来没有；r19 起走 translate 通道）
    const TIP_SEL = '[role="tooltip"],[class*="-tip"],[class*="_tip"],[class*="tooltip"],[class*="Tooltip"]';
    function tryClamp(el) {
      // r31：关掉动效后可能还有 clampOverflow 排下的 rAF/80/240ms 复核；
      // 关态直接不写几何（否则会给已还原的元素重新挂 data-dshm-clamped / 改行内样式）。
      if (!cfg.on) return;
      if (!el || !el.isConnected) return;
      // 幽灵不参与（马上要被删）。⚠ r19 起**已打标的不跳过**：
      // round13–r18 这里连 ATTR_MARK 一起跳过，而 mark() 又是在打标**之后**才调
      // clampOverflow ⇒ 所有已打标浮层的收窄复核全部落空（实测 marked=true、
      // right=1760 越界、overflowFixed=0，probes/glass-round49.mjs）。
      // 旧跳过理由是「transform 归弹簧动画」—— r19 位移已换到独立 translate 通道，
      // 与动画叠加生效，不再打架。
      try { if (el.hasAttribute && (el.hasAttribute("data-dshm-exit") || el.hasAttribute("data-dshm-ghost"))) return; } catch (e) { }
      // 入场动画进行中**不写几何**：改 max-width/translate 会在动画中途触发重排 ⇒
      // 用户看到「弹窗先出现、再跳一下」。等这一代动画结束再复核一次（指针路径的提示
      // 只有一次 90ms 扫描，不减这一次延迟复核就会漏收窄）。
      if (animBusy(el)) {
        if (!el.__dshmClampWait) {
          el.__dshmClampWait = 1;
          const wait = animRemain(el) + 60;
          try {
            setTimeout(() => {
              try { delete el.__dshmClampWait; } catch (e) { }
              try { tryClamp(el); } catch (e) { }
            }, wait);
          } catch (e) { }
        }
        return;
      }
      const iw = window.innerWidth, ih = window.innerHeight;
      const rectOf = () => { try { return el.getBoundingClientRect(); } catch (e) { return null; } };
      const tiny = (r) => !r || r.width < 8 || r.height < 8;
      const over = (r) => r.right > iw - 4 || r.left < 4 || r.width > iw - 16
        || r.bottom > ih - 8 || r.top < 8;
      // ── 收敛式两段决策（r19b）：每次调用都先暂撤已有修正、基于自然盒决策 ──
      //   旧写法按「当前盒（含上次修正）」决策：max-width 与 translate 在连续复核间
      //   互相踩（限了又还、移了又撤），落到 maxw=239px + 仍越界 139px 的非收敛态。
      //   新写法是幂等的：同几何下重复调用收敛到同一 (cap, shift)，不再震荡。
      //   计数只在**真正写入不同值**时 +1（旧写法每次命中都 +1，fx 虚胖 11/次）。
      let r = rectOf();
      if (tiny(r)) return;
      const hasFix = clamp0.has(el) || shift0.has(el);
      if (!over(r) && !hasFix) return;   // 纯读快路径：界内且无修正，零写入
      // 计数语义：每个浮层从「未修正→已修正」只记一次（旧写法每次复核命中都 +1，
      // 同一浮层一生能刷出十几次，遥测虚胖）。moved 后换档不重记，近似但稳定。
      let wrote = false;
      const count = () => { if (!hasFix && !wrote) { wrote = true; overflowFixed++; } };
      // 暂撤：还 max-width 原值、去 translate，量自然盒
      // （map 条目先留着：自然盒进界则删（值已还），越界则继续用原值做基准）
      try {
        if (clamp0.has(el)) { const o = clamp0.get(el); if (o) el.style.setProperty("max-width", o); else el.style.removeProperty("max-width"); }
        if (shift0.has(el)) { const o = shift0.get(el); if (o) el.style.setProperty("translate", o); else el.style.removeProperty("translate"); }
      } catch (e) { }
      const n = rectOf() || r;   // 自然盒（暂撤失败就退回当前盒，不抛）
      if (tiny(n)) return;
      // 自然盒进界 ⇒ 修正永久归还
      if (!over(n)) {
        try {
          if (clamp0.has(el)) clamp0.delete(el);
          if (shift0.has(el)) shift0.delete(el);
          el.removeAttribute("data-dshm-clamped");
        } catch (e) { }
        return;   // 暂撤时已经写回原值，无需再写
      }
      // 自然盒越界 ⇒ 先算限宽
      let cap = 0;
      if (n.right > iw - 4) cap = Math.max(120, Math.floor(iw - n.left - 12));
      else if (n.left < 4) cap = Math.max(120, iw - 16);
      else if (n.width > iw - 16) cap = iw - 16;
      try {
        if (cap > 0 && cap < n.width) {
          if (!clamp0.has(el)) clamp0.set(el, el.style.getPropertyValue("max-width") || "");
          const want = cap + "px", cur = el.style.getPropertyValue("max-width");
          if (cur !== want) { el.style.setProperty("max-width", want); count(); }
        } else if (clamp0.has(el)) {
          const o = clamp0.get(el);
          const cur = el.style.getPropertyValue("max-width");
          if (o) { if (cur !== o) { el.style.setProperty("max-width", o); count(); } }
          else if (cur) { el.style.removeProperty("max-width"); count(); }
          clamp0.delete(el);
        }
      } catch (e) { }
      // ── 位移兜底（round17 建、r19 换道）：限宽对**不可断行**的内容无效
      //   （.lc-tip max-content / .dsh-ocg-tip nowrap），仍然出界就整体平移进来。
      //   r19 把通道从 `transform` 换成独立的 CSS `translate` 属性：
      //   浮动库/弹簧动画写的是 `transform`，两者会**叠加生效**互不覆盖 ——
      //   这正是「加号/文件/上下文 hover 预览位置仍然不对」的根因之一：
      //   那些小窗由定位库拿 transform 摆位，旧代码见 owns 就直接放弃位移。
      //   translate 与 transform 叠加（先 translate 后 transform），8px 边距，
      //   垂直方向同样兜住。原值记 shift0，进界即还。
      try {
        const r2 = rectOf() || n;
        let dx = 0, dy = 0;
        if (r2.right > iw - 8) dx = (iw - 8) - r2.right;
        if (r2.left + dx < 8) dx = 8 - r2.left;
        if (r2.bottom > ih - 8) dy = (ih - 8) - r2.bottom;
        if (r2.top + dy < 8) dy = 8 - r2.top;
        if ((dx || dy)) {
          if (!shift0.has(el)) shift0.set(el, el.style.getPropertyValue("translate") || "");
          const px = Math.abs(dx) > 4000 ? 4000 * Math.sign(dx) : dx;
          const py = Math.abs(dy) > 4000 ? 4000 * Math.sign(dy) : dy;
          const want = px.toFixed(1) + "px " + py.toFixed(1) + "px", cur = el.style.getPropertyValue("translate");
          if (cur !== want) { el.style.setProperty("translate", want); count(); }
        } else if (shift0.has(el)) {
          const o = shift0.get(el), cur = el.style.getPropertyValue("translate");
          if (o) { if (cur !== o) { el.style.setProperty("translate", o); count(); } }
          else if (cur) { el.style.removeProperty("translate"); count(); }
          shift0.delete(el);
        }
      } catch (e) { }
      // r20 诊断标记：修正生效中就挂绿框候选（CSS 看 ⓾，需设置页打开高亮开关）。
      // 放最后统一同步一次 ⇒ 上面任何分支的增删在这里收敛，不会漏。
      try {
        if (clamp0.has(el) || shift0.has(el)) el.setAttribute("data-dshm-clamped", "");
        else el.removeAttribute("data-dshm-clamped");
      } catch (e) { }
    }
    function clampOverflow(el) {
      if (el.__dshmClamped) return;
      el.__dshmClamped = 1;
      const kick = () => { try { tryClamp(el); } catch (e) { } };
      const busy = busyNow();
      try { requestAnimationFrame(kick); } catch (e) { }
      // 忙时不要每 80/240ms 强制一次布局：流式期间布局树本来就是脏的，每次 rect 读取都可能
      // 触发整页重排，正好砸在动画帧上。忙时只保留「动画结束后一次」的复核。
      if (!busy) {
        try { setTimeout(kick, 80); } catch (e) { }
        try { setTimeout(kick, 240); } catch (e) { }
      }
      // r19 第四踢：入场弹簧最长 438ms，此时几何已落定，用稳定盒重算一次，
      // 收掉前三踢在动画中场量到的 transient 位移。开销：每个浮层一生多一次 rect 读取。
      try { setTimeout(kick, busy ? 700 : 600); } catch (e) { }
    }

    // ── 祖先的 Backdrop Root（第九轮：用户报「斜杠菜单背景没有模糊效果」）──────────
    //   CSS Filter Effects：**带 `backdrop-filter` 的元素会成为它后代的 Backdrop Root**，
    //   后代自己的 `backdrop-filter` 只能采到「该 root 内部画过的内容」，采不到页面。
    //   实测（probes/motion-slash-blur-diag.mjs，黑白条纹垫底 + 把面板底色打透明）：
    //     · 命令面板（祖先 `uV2eYG_card` 带 backdrop-filter）：开/关面板自己的 bf
    //       **只差 MAE 0.8**，区域里是原封不动的条纹（sd 120）⇒ **毛玻璃完全空转**；
    //       把**祖先**的 bf 关掉 ⇒ **MAE 113**、条纹变平坦（sd 23.7）⇒ 这时才真正在模糊。
    //     · 对照 · 模型选择器（挂 body 下，无 backdrop root）：开/关 bf **MAE 17.0**（sd 25.2→36.2）⇒ 正常。
    //   解法：临时把祖先的 `backdrop-filter` **搬到它的 `::before` 伪元素上** ——
    //   伪元素不是任何元素的**祖先**，所以「玻璃照旧、root 消失」，后代重新采得到页面。
    //   ⚠ 同一招在本工作区已有先例（AGENTS §4.3：左栏要放毛玻璃只能放 ::before，
    //     否则会把设置弹窗关进左栏盒子）。
    //   ⚠ 引用计数：多个浮层可能共用一个祖先，最后一个撤走时才还原。
    const rootRefs = new Map();
    function norootOn(anc, bfIn) {
      const n = (rootRefs.get(anc) || 0) + 1;
      rootRefs.set(anc, n);
      if (n > 1) return;
      try {
        const bf = bfIn || getComputedStyle(anc).backdropFilter;
        if (!bf || bf === "none") { rootRefs.delete(anc); return; }
        anc.style.setProperty("--dshm-anc-bf", bf);
        anc.setAttribute("data-dshm-noroot", "");
      } catch (e) { rootRefs.delete(anc); }
    }
    function norootOff(anc) {
      const n = (rootRefs.get(anc) || 0) - 1;
      if (n > 0) { rootRefs.set(anc, n); return; }
      rootRefs.delete(anc);
      try { anc.removeAttribute("data-dshm-noroot"); anc.style.removeProperty("--dshm-anc-bf"); } catch (e) { }
    }
    // 给这个浮层解开到 body 之间**所有** backdrop root（通常只有一层，最多扫 32 层）
    // ⚠ r22：上限 8 → 32。实测（/tmp/r22b.mjs）设置对话框里的浮层够不到自己的
    //   祖先 backdrop root：酒馆预设面板的祖先链上**唯一**带 bf 的是 `VOzbGW_panel`，
    //   它正好在第 **9** 层 —— 旧上限 `i < 8` 差一层摸不到 ⇒ 对话框仍是 Backdrop Root
    //   ⇒ 面板自己的 backdrop-filter 只能采样对话框**内部**（面板底下是空的）
    //   ⇒ 这就是用户报的「弹窗背景没有模糊效果」。
    //   32 仍是有限值（防退化结构上的超长链），而正常浮层到 body 只有 4–12 层。
    // ⚠ 2026-10-21：这是**每个浮层最大的同步样式读取**（最多 32 层 × getComputedStyle）。
    //   同一入口（父节点相同）连续开合的浮层，祖先链在 1s 内不可能变 ⇒ 缓存整条链。
    //   缓存命中时连 bf 值都复用（不再 getComputedStyle），只补引用计数。
    const rootChain = new WeakMap();   // 浮层父节点 → { list:[{el,bf}], ts }
    let rootCacheHit = 0;
    function unrootAncestors(el) {
      const start = el.parentElement;
      const now = performance.now();
      const hit = start && rootChain.get(start);
      if (hit && now - hit.ts < 1000) {
        const list = [];
        for (let i = 0; i < hit.list.length; i++) {
          const p = hit.list[i].el;
          if (p && p.isConnected) { norootOn(p, hit.list[i].bf); list.push(p); }
        }
        if (list.length) { el.__dshmRoots = list; rootCacheHit++; }
        return;
      }
      const list = [], chain = [];
      try {
        for (let p = el.parentElement, i = 0; p && p !== document.body && p !== document.documentElement && i < 32; p = p.parentElement, i++) {
          const bf = getComputedStyle(p).backdropFilter;
          if (bf && bf !== "none") { norootOn(p, bf); list.push(p); chain.push({ el: p, bf: bf }); }
        }
      } catch (e) { }
      if (start) rootChain.set(start, { list: chain, ts: now });
      if (list.length) el.__dshmRoots = list;
    }

    // `retry` 只用于「先挂载、后摆位」的浮层（见 notReady）：等一帧再量，最多重试 3 次。
    // `defer` 只用于**观察器路径**：把整次打标推迟一帧 —— ⚠ rAF 回调在「更新渲染」阶段、
    //   首次绘制**之前**执行，所以观感上没有多出一帧未动画的画面；换来的是能等到
    //   同一个 commit 里后填的内容落定。实测必需：命令面板 `_3e4SsG_menu` 插入时高 120，
    //   内容填完是 328 —— 打标太早会把起始气泡、裁剪盒、阴影代理全按 120 算
    //   （第七轮就是这样，用户报「斜杠菜单的阴影没有实时计算」）。
    function mark(el, kind, retry, defer, noRecheck) {
      if (!cfg.on || !cfg.glass) return;
      if (defer && !el.__dshmPending) {
        try {
          el.__dshmPending = 1;
          requestAnimationFrame(() => { try { delete el.__dshmPending; } catch (e) { } mark(el, kind, retry, false, noRecheck); });
          return;
        } catch (e) { }
      }
      if (kind === KIND_TIP && !cfg.tips) return;
      if (el.hasAttribute(ATTR_MARK)) return;
      // 布局还没落定 ⇒ 一帧后再来。**不要**在这里失败退出：官方有菜单是先
      // `visibility:hidden;top:0;left:0` 挂上去、量完再摆位的。
      if (notReady(el)) {
        const n = (retry || 0) + 1;
        if (n <= 3) { try { requestAnimationFrame(() => mark(el, kind, n)); } catch (e) { } }
        else skipped++;
        return;
      }
      const W = el.offsetWidth || el.getBoundingClientRect().width;
      const H = el.offsetHeight || el.getBoundingClientRect().height;
      if (W < 8 || H < 8) { skipped++; return; }
      // r28：先把 hovertip 的挂载期 left/top 过渡取消掉 —— W/H 的读取已经触发过一次样式计算，
      //   过渡若已被创建就在这一刻；取消后下面量到的才是**落位后的真实几何**（carry 起点依赖它）。
      let isTipEl = false;
      try { isTipEl = isHoverTip(el); } catch (e) { isTipEl = false; }
      if (isTipEl) cancelTipMoveTransitions(el);
      // r27：悬浮预览卡（会话行/工作区行 HoverCard）换行 =「连贯气泡」：
      //   同一批 Mutation（删旧卡 + 加新卡）里，新卡从旧卡的位置/尺寸起步，用纯 transform
      //   的短滑移（180ms）长大到位（不重播 clip morph、不建阴影代理）；旧卡不播鬼影退场。
      //   首次出现 / 最终离开仍走完整液态 morph + 鬼影（与 navbar 预览一致）。
      let carry = null;
      if (isTipEl) {
        // r28：跨格连贯气泡（旧 hovertip 的鬼影已被 tipCarryGeo 收掉）
        try { carry = tipCarryGeo(el); } catch (e) { carry = null; }
      } else if (isHoverPreviewCard(el)) {
        try { carry = hoverCarryGeo(el); } catch (e) { carry = null; }
      }
      const t0 = performance.now();
      try {
        snap(el);
        // 本代打标只读**一次** computedStyle：markMaterialGap / 圆角 / z-index / 阴影
        // 四处共用（r23 是各读一次，属于单次点开 52ms 长任务里我们自己那块同步成本）。
        let _cs = null;
        const csOf = () => (_cs || (_cs = getComputedStyle(el)));
        // ── 材质补齐（第八轮）：表面自己**没有**毛玻璃时，补上与菜单同一档的配方 ──
        //   实测（probes/motion-health.mjs）：子代理 `role=tree` / 后台任务 `ul` / 会话行悬浮卡
        //   都吃了 `--dsw-specific-menu` 的底色，但 computed `backdrop-filter` = none
        //   ⇒ 看起来是「半透明但不毛玻璃」。原因不在我们，是 `dsh-glass-patch` 的 role 名单里
        //   没有 `tree` / 无 role 的元素。补丁放在**样式表**里（不是行内），且只引用同一批
        //   `--dsp-*` / `--we-*` token ⇒ 与模型选择器逐字段同源。
        //   ⚠ 只在「本该有玻璃」的条件下补：自身有背景（半透明）时才需要；
        //     完全不透明的（如会话行悬浮卡 `rgb(44,44,46)`）加了也看不见，交给背景规则去统一。
        markMaterialGap(el, csOf);
        // ⚠ 必须**在**标记之后、动画开始之前做：只对「自己本来就有毛玻璃」的浮层做，
        //   否则会把祖先的玻璃白白搬走却没人补回来（`data-dshm-nobf` 的补丁写在样式表里，
        //   它也会被 backdrop root 限制，同样需要解锁）。
        // r56：浮层若直接挂在「玻璃弹窗」里，**不要**把弹窗的 backdrop-filter 搬到 ::before ——
        //   弹窗就是它的玻璃底/背景根，搬走 = 弹窗自己变成半透明裸板（实测 PUA 弹窗整块透出下层内容）。
        //   菜单自己的 backdrop-filter 采样弹窗内部即可（视觉上仍是弹窗玻璃上的那杯）。
        if (cfg.mat === "inherit" && !insideMarkedDialog(el)) unrootAncestors(el);
        if (cfg.mat === "refract") {
          const cs0 = getComputedStyle(el);
          const radius = parseFloat(cs0.borderTopLeftRadius) || 20;
          const fil = ensureFilter(W, H, radius);
          // 滤镜顺序照抄参考实现：位移在前，其后只做极轻的柔和与提亮。
          const stack = "url(#" + fil.id + ") blur(" + cfg.blur + "px) contrast(1.18) brightness(1.05) saturate(" + cfg.sat + ")";
          el.style.setProperty("backdrop-filter", stack, "important");
          el.style.setProperty("-webkit-backdrop-filter", stack, "important");
          el.style.setProperty("background-color", "rgb(var(--dshm-glass-tint) / " + cfg.tint.toFixed(2) + ")", "important");
          el.style.setProperty("box-shadow", "0 12px 34px rgb(0 0 0 / .30)", "important");
        }
        // 起始裁剪盒 = 以锚点为中心的一个小圆（rect morph 的起点）；顺带算展开原点
        const ae = anchorEl(el);
        const a = (ae && ae.getBoundingClientRect) ? ae.getBoundingClientRect() : null;
        const r = el.getBoundingClientRect();
        let bubble = null;
        let ox = "50%", oy = "50%", lift = "0px";
        const rr4 = radius4(el, 20);
        const rr = rr4[0];
        let D = Math.max(0, +cfg.bubble || 0);
        if (a && a.width > 0 && r.width > 0) {
          ox = Math.max(0, Math.min(100, ((a.left + a.width / 2 - r.left) / r.width) * 100)).toFixed(1) + "%";
          // ⚠ 方向别写反：锚点在菜单「下方」时，离按钮最近的边是菜单的**下边缘**(100%)。
          oy = (a.top >= r.bottom - 1) ? "100%" : (a.bottom <= r.top + 1 ? "0%" : "50%");
          lift = (a.top >= r.bottom - 1) ? "8px" : (a.bottom <= r.top + 1 ? "-8px" : "0px");
          // ── r49：首帧尺寸 = 触发按钮实际尺寸（动态量取，不写死）──────────────
          //   旧档首帧 = 「以锚点为中心、直径 cfg.bubble(34px) 的小圆」+ 非均匀 scale(.666,.9)，
          //   与按钮尺寸无关。用户要求弹窗首帧就与按钮同大小：
          //   ① 元素先沿锚点方向平移 dy0，使「首帧可见盒」正好落在按钮位置；
          //   ② 起始裁剪盒 = 按钮矩形在元素本地坐标系的投影（与元素盒求交，inset 保证非负）；
          //   ③ tf 起始只做位移、不再缩放 —— 否则 clip 需要超出元素盒才能凑出按钮尺寸，
          //      物理上裁不出来（这是「唯一改动」的必要连带：起点尺寸由 clip 表达，scale 归 1）。
          //   其余全部保持原档：同一条 clip+tf 双动画、同一个弹簧 438ms、材质/鬼影/预算不变。
          let btnStart = null;
          try {
            const isTipKind = (kind || KIND_MENU) === KIND_TIP;
            const noCustomGeo = el.hasAttribute("data-trigger-menu") || usesInlineTransform(el);
            if (!isTipKind && !noCustomGeo && a.width > 8 && a.height > 8 && r.width > 8 && r.height > 8) {
              const dy0 = (a.top >= r.bottom - 1)
                ? Math.max(0, a.bottom - r.bottom)
                : (a.bottom <= r.top + 1 ? -Math.max(0, r.top - a.top) : 0);
              // 按钮在「元素平移 dy0 后」的本地坐标
              const lx = a.left - r.left;
              const ly = a.top - r.top - dy0;
              const x0 = Math.max(0, Math.min(r.width, lx));
              const y0 = Math.max(0, Math.min(r.height, ly));
              const x1 = Math.max(0, Math.min(r.width, lx + a.width));
              const y1 = Math.max(0, Math.min(r.height, ly + a.height));
              const bw = x1 - x0, bh = y1 - y0;
              if (bw > 16 && bh > 8) {
                const ar4 = radius4(ae, 14);
                const cap = Math.min(bw, bh) / 2;
                btnStart = { dy: dy0, left: x0, top: y0, right: r.width - x1, bottom: r.height - y1, w: bw, h: bh, r0: ar4.map((n) => Math.min(n, cap)) };
              }
            }
          } catch (e) { btnStart = null; }
          if (btnStart) {
            // clip 起点 = 按钮矩形；tf 起点 = 平移 dy（scale 归 1）
            bubble = { left: btnStart.left, top: btnStart.top, w: btnStart.w, h: btnStart.h, r0: Math.min.apply(null, btnStart.r0) };
            D = Math.max(D, Math.min(btnStart.w, btnStart.h));
            el.style.setProperty("--dshm-ci-top", btnStart.top.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-left", btnStart.left.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-right", btnStart.right.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-bottom", btnStart.bottom.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-r0", radius4Str(btnStart.r0));
            el.style.setProperty("--dshm-r1", radius4Str(rr4));
          } else if (D > 0) {
            D = Math.min(D, r.width, r.height);
            const cx = a.left + a.width / 2 - r.left, cy = a.top + a.height / 2 - r.top;
            const left = Math.max(0, Math.min(r.width - D, cx - D / 2));
            const top = Math.max(0, Math.min(r.height - D, cy - D / 2));
            bubble = { left, top, w: D, h: D, r0: D / 2 };
            el.style.setProperty("--dshm-ci-top", top.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-left", left.toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-right", (r.width - left - D).toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-bottom", (r.height - top - D).toFixed(1) + "px");
            el.style.setProperty("--dshm-ci-r0", radius4Str([D / 2, D / 2, D / 2, D / 2]));
            el.style.setProperty("--dshm-r1", radius4Str(rr4));
          }
          // btnStart 需在下方 transform 分支使用：挂到闭包变量
          el.__dshmBtnStart = btnStart || null;
        }
        // ⚠ 无锚点时 bubble 为 null（D 是配置值，不是实际气泡）：旧代码只判 D<=0，
        //   于是这类浮层 CSS 同时声明 clip+tf，但 --dshm-ci-* 从未写入 ⇒ clip 是无效
        //   声明（白跑一条），视觉上只剩 tf。r24 修法：打 data-dshm-noclip —— CSS 只发
        //   tf，并且**照常占动画预算**（审查 G2：它仍是 bf 元素上的 transform 动画）。
        if (D <= 0) el.setAttribute("data-dshm-nomorph", "");
        else if (!bubble) el.setAttribute("data-dshm-noclip", "");
        // 面板自己拿行内 transform 定位（居中/浮动库）⇒ 我们的关键帧会把它覆盖掉，
        // 浮层会瞬移到 (0,0)。这条**只影响几何**：退到「淡入 + 微缩放」档，材质照旧。
        if (usesInlineTransform(el)) el.setAttribute("data-dshm-nomorph", "");
        el.setAttribute("data-dshm-kind", kind || KIND_MENU);
        // ── ⓶d 斜杠滑入（用户 2026-09-14 点名改成设置窗同款上下滑入）──────────
        //   判定：kind 不是 tip + 带 data-trigger-menu + 自己无 role ⇒ 命令面板/
        //   斜杠一族的外壳（role 在内层 viewport 上）。有 role 的（模型菜单等）
        //   继续走弹簧。CSS 看 ⓶d，退场看 exitClone 的 slide 分支，阴影代理跳过。
        const slide = (kind || KIND_MENU) !== KIND_TIP
          && el.hasAttribute("data-trigger-menu") && !el.getAttribute("role");
        if (slide) el.setAttribute("data-dshm-slide", "");
        el.style.setProperty("transform-origin", ox + " " + oy);
        el.style.setProperty("--dshm-lift", lift);
        // 位移（朝锚点）+ 扭曲（各向异性缩放）。锚点在菜单下方 ⇒ 从下往上浮出来。
        const L = Math.max(0, +cfg.lift || 0);
        const down = a && a.width > 0 && a.top >= r.bottom - 1;
        const up = a && a.width > 0 && a.bottom <= r.top + 1;
        const bs = el.__dshmBtnStart;
        const dy = bs ? bs.dy : (down ? L : (up ? -L : 0));
        const dx = bs ? 0 : ((a && !down && !up) ? (a.left + a.width / 2 >= r.left + r.width / 2 ? L : -L) : 0);
        const f = Math.max(0.3, Math.min(1.05, +cfg.from || 1));
        const w = Math.max(0, Math.min(0.5, +cfg.warp || 0));
        // r49：按钮尺寸档 tf 起点不缩放（尺寸由 clip 起点表达），只保留位移
        const sx0 = bs ? 1 : f * (1 - w), sy0 = bs ? 1 : f;
        el.style.setProperty("--dshm-dx", dx + "px");
        el.style.setProperty("--dshm-dy", dy + "px");
        el.style.setProperty("--dshm-sx", sx0.toFixed(4));
        el.style.setProperty("--dshm-sy", sy0.toFixed(4));
        try { delete el.__dshmBtnStart; } catch (e) { }
        // 排障用：把 mark() 当时量到的盒子尺寸挂出来（第八轮加，为了查「代理盒子过期」）
        el.setAttribute("data-dshm-box", Math.round(W) + "x" + Math.round(H) + "@" + Math.round(r.width) + "x" + Math.round(r.height));
        // 记下 mark() 当时量到的几何：断言/排障时用它复算期望值，
        // 否则事后重读 getBoundingClientRect 会因重新布局而算出一致的假差异。
        if (a && a.width > 0) el.setAttribute("data-dshm-geo", [a.top, a.bottom, r.top, r.bottom].map(v => Math.round(v)).join(","));
        // r54：凝胶按压 —— 经典弹簧入场时，让触发按钮先「按扁一下再回弹」。
        //   用户 2026-10-25：「把凝胶按压的效果增加到原有的经典弹簧动效上」。
        if (!carry && !slide) { try { gelPress(ae, kind); } catch (e) { } }
        // ── 并行动画预算（2026-10-21）────────────────────────────────────
        //  只有「真的会跑 clip morph」的才占预算；slide（纯位移）/ nomorph（淡入）
        //  本来就是合成器动画，不占。超预算 ⇒ cheap（只 opacity）；视口外/后台 ⇒ none。
        //  ⚠ 不排队：排队会让弹窗晚入场，位置跳动比少一点形变更明显。
        let animMode = "default";
        // 流式/高负载：直接降级 cheap（只 opacity，合成器友好），不占动画预算、不建代理。
        const busy = busyNow();
        // ⚠ nomorph（行内 transform 定位）只播 dshm-glass-fade，不占名额 —— 旧条件漏了它，
        //   会把名额白占掉（审查 G1）。
        if (carry) {
          // 换行连贯气泡：只跑 transform 滑移（合成器），不占 clip morph 预算、不建代理。
          animMode = "carry";
        } else if ((bubble || el.hasAttribute("data-dshm-noclip")) && !slide && !el.hasAttribute("data-dshm-nomorph") && cfg.spring && !reduceOn()) {
          const inView = document.visibilityState !== "hidden"
            && r.right > -32 && r.bottom > -32 && r.left < innerWidth + 32 && r.top < innerHeight + 32;
          animMode = !inView ? "none" : (busy ? "cheap" : (animAcquire(el) ? "full" : "cheap"));
          if (busy) busyDegraded++;
        } else if (busy && !slide && !el.hasAttribute("data-dshm-nomorph")) {
          // nomorph/noclip 在忙时也退到纯淡入（fade 仍是非合成器的 opacity+scale）
          animMode = "cheap";
        }
        if (animMode === "cheap") {
          el.setAttribute("data-dshm-cheap", ""); el.removeAttribute("data-dshm-noanim"); animSkipped++;
        } else if (animMode === "none") {
          el.setAttribute("data-dshm-noanim", ""); el.removeAttribute("data-dshm-cheap");
        } else if (animMode === "carry") {
          el.removeAttribute("data-dshm-cheap"); el.removeAttribute("data-dshm-noanim");
        } else {
          el.removeAttribute("data-dshm-cheap"); el.removeAttribute("data-dshm-noanim");
        }
        // clamp 保护窗：按这一代实际会跑的入场动画给时长；none 档没有动画 ⇒ 不保护
        //（溢出的浮层立刻收窄）。
        if (animMode === "full") clampHold.set(el, performance.now() + animDurMs + 40);
        else if (animMode === "cheap" || animMode === "carry") clampHold.set(el, performance.now() + 200);
        else if (animMode === "none") clampHold.delete(el);
        // reduce-motion 下 CSS 只发 120ms veil（forceMotion 关）⇒ 保护窗别按 438ms 算，
        // 否则溢出收窄会白等 ~420ms（独立验证实测 539–553ms）。
        else clampHold.set(el, performance.now() + (slide ? 320 : (reduceOn() ? 120 + 40 : (cfg.spring ? animDurMs + 40 : 160))));
        el.setAttribute(ATTR_MARK, "");
        markedCount++;
        // ④b 定格：卸载后量不到 rect，只能当时记（重打标会覆盖，天然最新）
        try {
          exitInfo.set(el, {
            x: r.left, y: r.top, w: r.width, h: r.height,
            bubble: bubble ? { left: bubble.left, top: bubble.top, w: bubble.w, h: bubble.h, r0: bubble.r0 } : null,
            r1: rr.toFixed(1) + "px", ox: ox, oy: oy, dx: dx, dy: dy,
            sx: sx0.toFixed(4), sy: sy0.toFixed(4),
            ow: el.offsetWidth || 0, oh: el.offsetHeight || 0,
            tip: (el.getAttribute("data-dshm-kind") || "") === KIND_TIP,
            slide: el.hasAttribute("data-dshm-slide"),   // r20：斜杠滑入退场用
            nomorph: el.hasAttribute("data-dshm-nomorph"),
            z: (() => { try { const z = csOf().zIndex; return (z && z !== "auto") ? z : ""; } catch (e) { return ""; } })()
          });
        } catch (e) { }
        try { clampOverflow(el); } catch (e) { }
        // ── 阴影代理的几何：mark 时元素**还没有** [data-dshm-glass] ⇒ r 是未变换的布局盒
        //    （这正是代理要的坐标系；等动画跑起来再量就会被 transform 带上位移/缩放）。
        //    推导：面板渲染出的可见轮廓 = M(t)(C(t))，M = 面板的 transform（过冲弹簧），
        //    C(t) = 裁剪盒（截顶弹簧驱动，从气泡长到整盒）。代理的盒子取面板盒 B，要让它
        //    渲染成同一轮廓，就得让 P(t)(B) = M(t)(C(t))：
        //      K(t) = S(t)·k(t)                     （k = C 相对 B 的缩放，随 clip 进度变）
        //      t_vec(t) = d(t) + S(t)·(C.left(t) − A) + A·K(t)
        //    ⚠ 最后那一项 `A·K(t)` 是**原点自身的缩放位移**，漏掉它代理起步就会偏出去十几像素
        //      （第六轮实测：左偏最多 22px、上偏最多 30px）。下面 tx/ty 是它的 t=0 取值。
        shadeInfo.delete(el);
        // r20：滑入（斜杠）不建阴影代理 —— 代理是按 morph 烘焙的，配给滑入会影子脱节。
        // r25：忙时也不建 —— 代理是额外合成层 + 逐帧 WAAPI，正是流式下的放大器。
        if (bubble && cfg.spring && el.parentNode && !slide && !busy && !carry) {
          const sh = outerShadow((csOf().boxShadow) || "");
          if (sh) {
            const ax = (parseFloat(ox) / 100) * r.width, ay = (parseFloat(oy) / 100) * r.height;
            const k0x = Math.max(1e-4, bubble.w / r.width), k0y = Math.max(1e-4, bubble.h / r.height);
            const kx = Math.max(1e-4, sx0 * k0x), ky = Math.max(1e-4, sy0 * k0y);
            // 悬浮预览卡走提示级配速（⓶c）：阴影代理按同一对参数烘，否则影子比面板慢半拍。
            const pair = (((el.getAttribute("role") || "").toLowerCase() === "button" && el.parentNode === document.body) ? springPair(KIND_TIP) : springPair(kind));
            shadeInfo.set(el, {
              r: { left: r.left, top: r.top, width: r.width, height: r.height },
              tx: dx + sx0 * (bubble.left - ax) + ax * kx, ty: dy + sy0 * (bubble.top - ay) + ay * ky,
              kx, ky, origin: ox + " " + oy, r1: rr.toFixed(1) + "px",
              // 打标时定格的弹簧参数（代理的复合曲线按它烘，见 shadeKeyframes）
              resp: pair.resp, zeta: pair.zeta,
              // 复合曲线要用的原始几何（shadeKeyframes 用）
              k0x, k0y, sx0, sy0, ax, ay, bx: bubble.left, by: bubble.top, dx, dy,
              // 起始圆角：渲染出来的圆角 = 声明值 × 该轴缩放 ⇒ 反解出「渲染成 r0 圆」的声明值
              //（再按盒子上限截断）。这样气泡阶段是一团圆，而不是一个带尖角的方疙瘩。
              rh: Math.min(bubble.r0 / kx, r.width / 2), rv: Math.min(bubble.r0 / ky, r.height / 2),
              shadow: sh
            });
          }
        }
        // ── r27：连贯气泡的实际几何覆盖 ──────────────────────────────────────
        //   exitInfo 已在上面按**自己**的锚点几何定格（最终离开时仍从自己位置缩回去），
        //   这里只改入场动画读的四个变量：新卡从旧卡的中心/尺寸起步，滑到自己的位置。
        if (carry) {
          el.style.setProperty("--dshm-dx", carry.dx.toFixed(2) + "px");
          el.style.setProperty("--dshm-dy", carry.dy.toFixed(2) + "px");
          el.style.setProperty("--dshm-sx", "1");
          el.style.setProperty("--dshm-sy", "1");
          el.setAttribute(CARRY_ATTR, "");
          carryCount++;
          if (isTipEl) {
            tipSwapCount++;
            // 新气泡必须**一出现就是满不透明**，否则宿主的 `.lc-tip{opacity:0}` +
            // `transition:opacity .2s` 会让它从 0 淡入 —— 旧气泡（鬼影）是满不透明的，
            // 一淡入就破功（用户要的是连贯气泡，不是「消失 + 淡入」）。
            // 直接取消这条 CSS 过渡（cancel 后计算值立刻回到行内 opacity:1）。
            const killFade = () => {
              try {
                el.getAnimations().forEach((a) => {
                  try { if (a.transitionProperty === "opacity") a.cancel(); } catch (e) { }
                });
              } catch (e) { }
            };
            killFade();
            // 过渡有可能在我们打标之后的下一帧才开始（元素刚插入时的样式计算时机），再来一次。
            try { requestAnimationFrame(killFade); } catch (e) { }
            // 落位后（carry 140ms 跑完 + 一点余量）再打开「换格滑移」过渡。
            armTipGlide(el, 180);
          }
        } else if (isTipEl) {
          tipFirstCount++;   // 首次出现：完整液态入场（不 carry）
          // 入场播完（204ms）再打开换格滑移过渡：入场那一帧的 0,0→真实位置 必须瞬跳。
          armTipGlide(el, 280);
        } else if (isHoverPreviewCard(el)) {
          carrySkipped++;   // 首次出现：完整液态入场（不 carry）
        }
        // ── 尺寸复核（第八轮）────────────────────────────────────────────────
        // 实测：命令面板是「先插一个 877×120 的空壳、下一帧才填进 14 条命令变成 877×328」，
        // 而 mark() 恰好在空壳那一帧跑 ⇒ 起始气泡被钳在 120 高、**阴影代理只有 120 高**
        // （用户报的「斜杠菜单的阴影没有实时计算」就是它）。
        // 这里在一次 rAF 后复核尺寸：变了就**重打一次标**（unmark → mark），把气泡、裁剪盒、
        // 代理全部按新尺寸重算。只做一次、且在 400ms 内，避免震荡；重打发生在入场约 1 帧处，
        // 动画重启肉眼看不出来。
        if (!noRecheck) {
          const W0 = W, H0 = H;
          try {
            requestAnimationFrame(() => {
              try {
                if (!el.isConnected || !el.hasAttribute(ATTR_MARK)) return;
                if (el.offsetWidth === W0 && el.offsetHeight === H0) return;
                if (performance.now() - t0 > 400) return;
                unmark(el);
                mark(el, kind, 0, false, true);
              } catch (e) { }
            });
          } catch (e) { }
        }
      } catch (e) { skipped++; }
    }

    function unmarkAll() {
      const list = document.querySelectorAll("[" + ATTR_MARK + "]");
      for (let i = 0; i < list.length; i++) unmark(list[i]);
      // r31：指针路径（TIP_SEL 第三方小窗）收窄过的节点没有 ATTR_MARK，unmarkAll 带不到；
      // 关动效时也把它们还回去，别在全页留 data-dshm-clamped / 行内 max-width·translate。
      const left = document.querySelectorAll("[data-dshm-clamped]");
      for (let i = 0; i < left.length; i++) {
        const el = left[i];
        try {
          if (clamp0.has(el)) { const o = clamp0.get(el); if (o) el.style.setProperty("max-width", o); else el.style.removeProperty("max-width"); clamp0.delete(el); }
          if (shift0.has(el)) { const o = shift0.get(el); if (o) el.style.setProperty("translate", o); else el.style.removeProperty("translate"); shift0.delete(el); }
        } catch (e) { }
        try { el.removeAttribute("data-dshm-clamped"); } catch (e) { }
      }
    }

    // 把一个语义浮层节点（role=menu/listbox/tooltip）收到它的**表面元素**上再打标。
    function consider(node, defer) {
      if (!node || node.nodeType !== 1 || !node.matches || !node.matches(NEAR_SEL)) return;
      // 预筛（2026-10-21）：scan()/观察器对**每个候选**调这里，而 surfaceOf() 的祖先链
      // getComputedStyle 会随候选数放大（材质审计实测单浮层 12 次 gCS、其中 6 次在无关
      // 候选上）。已打标 / 幽灵 / 已在打标浮层内部的节点直接出局 —— isTarget() 稍后同样
      // 会拒，这里只是把最便宜的属性判据提前，整条样式读取全省。
      try {
        if (node.hasAttribute(ATTR_MARK) || node.hasAttribute("data-dshm-exit") || node.hasAttribute("data-dshm-ghost")) return;
        if (popupGlassAncestor(node)) return;
      } catch (e) { }
      const byR = byRole(node);
      const cn = typeof node.className === "string" ? node.className : "";
      // r21：放宽到不分大小写的子串（cover 连字符/无分隔命名）+ 酒馆预设面板的 id。
      // tip 刻意不进这条：hover 提示走 TIP_SEL + 指针路径，菜单配速（438ms）会让提示又慢又黏。
      const byC = !byR && /(menu|popover|popup|dropdown|opPanel)/i.test(cn);
      const byId = !byR && !byC && /preset-panel/i.test(node.id || "");
      if (!byR && !byC && !byId) return;
      // r21 三道闸门（放宽命名必然带来更多候选，在这里挡）：
      //   ① 第三方常驻挂件不是弹窗：dsh-pet 整族、tldraw 画布（tlui-）一律不碰；
      //   ② 对话框/模态自己不是近距弹窗（远距路径拥有它们），role=dialog 与 aria-modal 不进这条；
      //   ③ 类名/id 认定的必须**自己**就是定位元素（absolute/fixed）：对话框里的静态内容
      //      （菜单项/卡片行/选择框）类名也可能含 menu/popup，但它们自己是 static ——
      //      只有自己脱离文档流的才是浮层。role 路径不受此限（行为不变）。
      if (!byR) {
        if (/dsh-pet/i.test(cn) || /tlui-/i.test(cn)) return;
        if (node.getAttribute("role") === "dialog" || node.getAttribute("aria-modal") === "true") return;
      }
      const s = surfaceOf(node);
      if (s !== node && s.hasAttribute(ATTR_MARK)) return;
      if (!byR) {
        if (s.getAttribute && (s.getAttribute("role") === "dialog" || s.getAttribute("aria-modal") === "true")) return;
        let sp = null; try { sp = getComputedStyle(s).position; } catch (e) { return; }
        if (sp !== "absolute" && sp !== "fixed") return;
      }
      // 类名认定在**表面**上再判一次：命令面板的 role=listbox 在内层，表面外壳只靠类名。
      const clsMatched = !byRole(s);
      const kind = byRole(s) ? (kindOf(s) || KIND_MENU) : KIND_MENU;
      if (isTarget(s, clsMatched)) mark(s, kind, 0, defer);
    }

    // ── 第二条识别路径：**形状识别**（第八轮）────────────────────────────────────
    //   实测有三族既没有可用的 role、类名也不含 menu/popover：
    //     子代理面板 `div.ZKlsPq_menu`（role=tree，这条其实被 role 收掉了）
    //     后台任务   `ul.QsffPG_menu`（无 role，靠类名）
    //     会话行悬浮卡 `div._card_1b2ny_13`（role=button，类名只有 `_card`）
    //   但它们的**部署方式**是稳定的：`createPortal` 到 body 的浮层。
    //   ⇒ 判据 = 「挂在 body 下（≤2 跳）+ 脱离文档流 + 小 + 有表面 + 有锚点」，
    //     不依赖任何类名/role，所以升级后依然有效。
    //   ⚠ 这个判据**必须**带锚点闸门 + 负名单，否则会误伤壁纸拉绳、拖拽层这类 body 级挂件。
    const NEG_NAME = /toast|mask|overlay|scrim|drop|drag|rope|media|layer|backdrop|anchor|resize|handle/i;
    function bodyLevel(el) {
      const p1 = el.parentElement;
      if (!p1) return false;
      if (p1 === document.body) return true;
      return !!(p1.parentElement && p1.parentElement === document.body);
    }
    function shapePopup(el) {
      if (!el || el.nodeType !== 1) return false;
      if (!bodyLevel(el)) return false;
      const cn = typeof el.className === "string" ? el.className : "";
      if (NEG_NAME.test(cn)) return false;
      if (el.hasAttribute("data-slot") || el.getAttribute("role") === "presentation") return false;
      // ⚠ 2026-09-25（dsh 0.1.7 起）：官方把设置窗等远距对话框从「左栏子树」改挂到
      //   **body 级 portal**（`body > [role=presentation] > [role=dialog]`），
      //   于是它们第一次通过了 bodyLevel() 的形状路径闸门，被误判成近距弹窗：
      //   打上 data-dshm-glass + kind=menu，438ms 的液态 clip/tf 关键帧压过
      //   远距档 `[role=presentation] > [role=dialog]` 的 dshm-far-in
      //   —— 用户看到「设置页浮出变成了小弹窗的液态动效」。
      //   对话框/模态永远归远距档，形状路径这一条必须排除（near 的 consider() 早已排除）。
      if (el.getAttribute("role") === "dialog" || el.getAttribute("aria-modal") === "true") return false;
      const cs = (() => { try { return getComputedStyle(el); } catch (e) { return null; } })();
      if (!cs) return false;
      if (cs.pointerEvents === "none" && cs.boxShadow === "none") return false;
      return true;
    }
    // ── 悬浮预览卡（官方 HoverCard）：出现/消失 = 液态，换行 = 「连贯气泡」（r27）───────
    //   用户 2026-10-21（第二轮澄清）：「navbar 的动效是：出现消失由 dsh-motion 接管，有液态
    //   动效；只是在不同的 bar 间切换时，不是 dsh-motion 的消失动画 —— 不会上一个缩小消失、
    //   下一个出现，而是连贯的气泡。会话预览小窗也要这样」。
    //
    //   实测契约（.probe/hover-anim-check.mjs / probe-mutation-order.mjs）：
    //     · 会话行 hover 800ms 后出现 `body > div._card_*[role=button]`（内含
    //       `[class*="hoverContent"]`），本插件按「body 直系 role=button」收进 HOVERQ 提示档。
    //     · 换行时 MutationObserver 收到**同一批**「1 个删（旧卡）+ 1 个加（新卡）」：
    //       旧卡会被 ④b 克隆成 210ms 鬼影播「缩小消失」，新卡再播「从行锚点长出」的 204ms
    //       clip morph ⇒ 用户看到的「上一个缩小消失、下一个出现 / 动画重叠」。
    //   ⇒ r27：
    //     · 换行（同批删旧+加新）：旧卡**不播**鬼影；新卡在 mark() 里用旧卡矩形的中心/尺寸
    //       做起始（translate+scale），只跑 `dshm-glass-tf` 一条 180ms 纯合成器滑移
    //       （不跑 clip、不占预算、不建阴影代理）⇒ 一个气泡从旧行连贯地滑到新行。
    //     · 首次出现（没有旧卡）：完整液态动效（HOVERQ 提示档 clip+tf + 材质 + 代理）。
    //     · 最终离开（只有删、没有加）：完整液态退场（鬼影缩小回去）。
    //   ⚠ 判据必须稳（CSS module 哈希会随构建变）：body 直系 + fixed + 内容含
    //     hoverContent/hoverTitle/hoverStatus；`role` 可有可无（官方只在 copyText 存在时给
    //     role=button，空标题行没有），但不认 `_card_xxx` 这类哈希类名。
    function isHoverPreviewCard(el) {
      try {
        if (!el || el.nodeType !== 1) return false;
        if (el.parentElement !== document.body) return false;          // 官方 HoverCard 的卡挂 body 直系
        const role = (el.getAttribute("role") || "").toLowerCase();
        if (role && role !== "button") return false;                   // 导航 rail 的 role=tooltip 预览不属于这一族
        let cs = null; try { cs = getComputedStyle(el); } catch (e) { return false; }
        if (cs.position !== "fixed") return false;
        return !!(el.querySelector && el.querySelector('[class*="hoverContent"],[class*="hoverTitle"],[class*="hoverStatus"]'));
      } catch (e) { return false; }
    }
    // 已从 DOM 摘下的旧卡（MutationRecord.removedNodes）—— 此时 getComputedStyle/父节点都不可用，
    // 只能靠类名 + 内容标记认（querySelector 在游离节点上仍可用）。
    function isHoverPreviewRemoval(el) {
      try {
        if (!el || el.nodeType !== 1) return false;
        if (!/_(card|hoverCard)_/i.test((el.className || "").toString()) && !el.querySelector) return false;
        return !!(el.querySelector && el.querySelector('[class*="hoverContent"],[class*="hoverTitle"],[class*="hoverStatus"]'));
      } catch (e) { return false; }
    }
    // ── 上下文洞察 hovertip（dsh-context）：同一页所有 `[data-lc-tip]` 共用**一个**气泡元素 ──
    //   用户 2026-10-21（第三轮）：「上下文洞察这一栏，在不同的小格间切换的效果也应该变成
    //   我们刚刚修改的这样」（活跃度热力图 / 用量柱状列 / 技能列表都是同一个 hovertip）。
    //   实测契约（.probe/verify-hovertip-baseline.mjs / probe-hovertip-realpath.mjs）：
    //     · 气泡 = `body > div.lc-tip.lc-hovertip#lc-hovertip-bubble[role=tooltip]`，
    //       位置写**行内 left/top（px）**，内容与位置由 React 直接改 —— 与官方 navbar 预览
    //       「同一元素、内容即换、位置滑过去」结构一致，但它**没有** `top` 过渡 ⇒ 瞬跳。
    //     · 小格之间只有 3px 间隙，指针慢速跨过时宿主先 mouseout（relatedTarget 落到间隙
    //       = 非 tip）再 mouseover 下一格 ⇒ 气泡被**卸掉再挂成新元素**：旧气泡播 150ms
    //       缩小鬼影、新气泡再播 204ms 液态入场 ⇒ 用户看到的是「两个动画重叠」，不是连贯气泡。
    //   ⇒ r28 两条路径合起来 = 连贯气泡：
    //     · 同一元素（快速跨越、没触发卸载）：样式表里给 left/top 加 .14s 过渡（同 navbar）。
    //     · 卸载再挂（慢速跨 3px 间隙）：旧气泡的鬼影**先挂着**（tipSwap），新气泡 mark()
    //       时 tipCarryGeo() 立刻取消鬼影、从它当前位置起步，只跑 `dshm-glass-tf` 纯平移
    //       .14s（复用 r27 的 carry 档）—— 视觉上就是一个气泡从旧格滑到新格。
    //     · 首次出现 / 最终离开仍走完整液态（tip 档 clip+tf / 鬼影缩小），与其它浮层一致。
    //   ⚠ 判据用宿主**稳定**的 id / 普通 CSS 类（`lc-*` 不是 CSS module 哈希），不认哈希类名。
    function isHoverTip(el) {
      try {
        if (!el || el.nodeType !== 1) return false;
        if (el.parentElement !== document.body) return false;      // host 用 createPortal 到 body
        if ((el.getAttribute("role") || "").toLowerCase() !== "tooltip") return false;
        if (el.id === "lc-hovertip-bubble") return true;
        return /(^|\s)lc-hovertip(\s|$)/.test((el.className || "").toString());
      } catch (e) { return false; }
    }
    // 已从 DOM 摘下的旧气泡：parentElement 已经没了，只能靠 role + id/类名认。
    function isHoverTipRemoval(el) {
      try {
        if (!el || el.nodeType !== 1) return false;
        if ((el.getAttribute("role") || "").toLowerCase() !== "tooltip") return false;
        if (el.id === "lc-hovertip-bubble") return true;
        return /(^|\s)lc-hovertip(\s|$)/.test((el.className || "").toString());
      } catch (e) { return false; }
    }
    // 跨格 carry 的上下文：onMutations 收掉旧气泡时写入（含鬼影句柄），
    // 新气泡 mark() 里 tipCarryGeo() 消费一次。只认「刚刚」（≤140ms）的旧气泡 ——
    // 更慢的跨格（用户干脆停在 3px 间隙上）鬼影早就缩小完了，硬做 carry 会从远处弹回来。
    const TIP_SWAP_MS = 140;
    const TIPGLIDE_ATTR = "data-dshm-tipglide";
    let tipSwap = null;
    // 宿主挂载 hovertip 时先渲染 `left:0;top:0;visibility:hidden`，同一帧的 layout effect 再切到
    // 真实位置。浏览器会把这次变化当成一次 left/top 过渡 ⇒ 气泡会从视口左上角「飞」过来，
    // 而且 carry 的起点会量到过渡中的坐标（实测 carry 位移从期望的 (0,-23) 变成 (371,367)）。
    // ⇒ 打标时先取消 left/top 过渡（cancel 后计算值立刻回到行内终值）。
    function cancelTipMoveTransitions(el) {
      try {
        el.getAnimations().forEach((a) => {
          try { const p = a.transitionProperty; if (p === "left" || p === "top") a.cancel(); } catch (e) { }
        });
      } catch (e) { }
    }
    // 「滑移过渡」不是一挂上就该有的：挂载那一帧的 0,0→真实位置 变化必须是**瞬跳**
    // （否则就是从左上角飞过来）。等这次入场/carry 落位之后才打 TIPGLIDE_ATTR，
    // 样式表里的 left/top 过渡只认这个属性 ⇒ 只有「已落位的气泡换格」才会滑。
    function armTipGlide(el, delay) {
      try {
        if (el.__dshmTipGlide) return;
        el.__dshmTipGlide = setTimeout(() => {
          try { delete el.__dshmTipGlide; } catch (e) { }
          try { if (el.isConnected && el.hasAttribute(ATTR_MARK)) el.setAttribute(TIPGLIDE_ATTR, ""); } catch (e) { }
        }, delay);
      } catch (e) { }
    }
    function releaseTipGhost(s) {
      try {
        const g = s && s.ghost;
        if (!g) return;
        // 先取消 WAAPI（finished 的 kill() 会归还退场预算并自己 remove），再兜底 remove。
        try { g.getAnimations().forEach((a) => { try { a.cancel(); } catch (e) { } }); } catch (e) { }
        try { g.remove(); } catch (e) { }
      } catch (e) { }
    }
    function tipCarryGeo(el) {
      const s = tipSwap;
      if (!s) return null;
      tipSwap = null;
      let pr = null;
      const dt = performance.now() - s.ts;
      try {
        if (dt <= TIP_SWAP_MS) {
          // 优先用鬼影**当前**矩形：鬼影前 12% 时长（150ms×0.12≈18ms）是静止的，
          // 普通跨格（1–2 帧）取消时它和旧气泡逐像素一致 ⇒ 接缝看不出来。
          if (s.ghost && s.ghost.isConnected) {
            const g = s.ghost.getBoundingClientRect();
            if (g && g.width > 8 && g.height > 8) pr = { x: g.left, y: g.top, w: g.width, h: g.height };
          }
          // 鬼影没建/已被收掉（busy 降级、预算不足）：很短窗口内仍认 mark() 时的定格矩形。
          if (!pr && dt <= 80 && s.info && s.info.w > 8 && s.info.h > 8) {
            pr = { x: s.info.x, y: s.info.y, w: s.info.w, h: s.info.h };
          }
        }
      } catch (e) { }
      releaseTipGhost(s);
      if (!pr) return null;
      let r = null; try { r = el.getBoundingClientRect(); } catch (e) { return null; }
      if (!r || !(r.width > 8) || !(r.height > 8)) return null;
      // 只平移（与 r27 会话预览卡一致：缩放会把字号压扁，用户说「抽出不得体」）。
      return {
        dx: (pr.x + pr.w / 2) - (r.left + r.width / 2),
        dy: (pr.y + pr.h / 2) - (r.top + r.height / 2),
      };
    }
    // 换行 carry 的上下文：onMutations 预扫「同批 1 删 + 1 加」时写入 prevRect，
    // 新卡 mark() 里 hoverCarryGeo() 消费一次就清空（一次换行只给一张新卡用）。
    let navSwap = null;
    function hoverCarryGeo(el) {
      const s = navSwap;
      if (!s || !s.prevRect) return null;
      if (performance.now() - s.ts > 300) { s.prevRect = null; return null; }   // 过期矩形不许用
      const pr = s.prevRect;
      s.prevRect = null;
      let r = null; try { r = el.getBoundingClientRect(); } catch (e) { return null; }
      if (!r || !(r.width > 8) || !(r.height > 8)) return null;
      // 只做平移：官方 navbar 的换行是同一个卡让 top 滑过去（内容即换、**不缩放**）。
      // 之前按旧卡尺寸做 scaleY 会把文字短暂压扁/拉长（用户「抽出不得体」的一部分），
      // 且高度差大的卡会有明显「延伸感」；改为纯平移后和 navbar 语义一致。
      return {
        dx: (pr.x + pr.w / 2) - (r.left + r.width / 2),
        dy: (pr.y + pr.h / 2) - (r.top + r.height / 2),
      };
    }
    // 一个新增子树里可能有浮层（命令面板就是「外壳 + 内层 role=listbox」一起插进来的）
    function considerTree(n) {
      if (!n || n.nodeType !== 1) return;
      // 远距 dialog 只记 rect（入场是纯 CSS，不管；卸载时给消失动效用）
      try {
        if (n.matches && n.matches('[role="dialog"]')) trackFar(n);
        else if (n.querySelectorAll) {
          const dl = n.querySelectorAll('[role="dialog"]');
          for (let i = 0; i < dl.length && i < 4; i++) trackFar(dl[i]);
        }
      } catch (e) { }
      if (n.matches && n.matches(NEAR_SEL)) consider(n, true);
      else if (shapePopup(n) && isTarget(n, true)) mark(n, KIND_MENU, 0, true);  // 形状路径：节点自己就是浮层
      else if (n.parentElement === document.body) {
        // portal 根节点：浮层常常是它的**直接子元素**（`QsffPG_root > ul.QsffPG_menu`）
        for (let i = 0; i < n.children.length; i++) {
          const c = n.children[i];
          if (!c.matches || c.matches(NEAR_SEL)) continue;
          if (shapePopup(c) && isTarget(c, true)) mark(c, KIND_MENU, 0, true);
        }
      }
      if (!n.firstElementChild || !n.querySelectorAll) return;
      const list = n.querySelectorAll(NEAR_SEL);
      for (let i = 0; i < list.length; i++) consider(list[i], true);
    }

    function scan() {
      if (!cfg.on || !document.body) return;
      const list = document.querySelectorAll(NEAR_SEL);
      for (let i = 0; i < list.length; i++) consider(list[i], false);   // scan 保持同步（取证口径依赖它）
    }

    // 卸载批里收「待播消失」的面板：直接被删的打标浮层 / dialog，或小祖先里顺带
    // 被删的（>30 节点的大祖先整体卸载 = 切会话级 teardown，一律跳过不播）。
    function collectExit(n, out, ctx) {
      if (!n || n.nodeType !== 1) return;
      try { if (n.hasAttribute && (n.hasAttribute("data-dshm-exit") || n.hasAttribute("data-dshm-ghost"))) return; } catch (e) { }
      try {
        const has = (e) => { for (let i = 0; i < out.length; i++) if (out[i][0] === e) return true; return false; };
        if (n.hasAttribute && n.hasAttribute(ATTR_MARK)) {
          const info = exitInfo.get(n);
          if (info && !has(n) && (info.tip ? cfg.tips : cfg.glass)) out.push([n, info, ctx]);
          return;
        }
        if (n.getAttribute && n.getAttribute("role") === "dialog") {
          const fi = farInfo.get(n);
          if (fi && !has(n)) out.push([n, fi, ctx]);
          return;
        }
        if (!n.querySelectorAll) return;
        const size = n.getElementsByTagName ? n.getElementsByTagName("*").length : 0;
        if (size > 30) return;
        const l = n.querySelectorAll("[" + ATTR_MARK + "]");
        for (let i = 0; i < l.length; i++) {
          const info = exitInfo.get(l[i]);
          if (info && !has(l[i]) && (info.tip ? cfg.tips : cfg.glass)) out.push([l[i], info, ctx]);
        }
        const dl = n.querySelectorAll('[role="dialog"]');
        for (let i = 0; i < dl.length; i++) { const fi = farInfo.get(dl[i]); if (fi && !has(dl[i])) out.push([dl[i], fi, ctx]); }
      } catch (e) { }
    }

    // 摘掉一棵子树里所有被打过标的浮层（含它们各自的阴影代理）
    function releaseTree(n) {
      if (!n || n.nodeType !== 1) return;
      if (n.hasAttribute && n.hasAttribute(ATTR_MARK)) {
        try { unmark(n); } catch (e) { }
      }
      if (n.querySelectorAll) {
        const l = n.querySelectorAll("[" + ATTR_MARK + "]");
        for (let i = 0; i < l.length; i++) { try { unmark(l[i]); } catch (e) { } }
      }
      // ⚠ 代理是面板的**兄弟**节点：面板被 React 卸载时它不会跟着走 ⇒ 必须显式收掉。
      //   子树被整体移除时，代理可能正好在子树**外**（紧挨面板前面），所以要顺着
      //   shadeInfo 里记过的那批面板一起收 —— 这里直接用 `[data-dshm-shade]` 全页兜底代价太大，
      //   改为：被移除子树里的面板在 unmark() 里已经把自己的代理收掉了。
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ④e 图片放大动效（r30）：原图预览（ImageLightbox）的开/关 FLIP
    //     用户要求：「点击输入框内图片时放大带动画，符合 dsh-motion 整体设计」。
    //     覆盖范围：**输入框草稿图** 与 **对话内消息图** —— 宿主里两者共用同一个
    //     ImageLightbox（portal 到 body 的 `[role=dialog][aria-modal=true]`），
    //     所以只做一个模块，两个入口自动都生效。
    //
    //     为什么用 WAAPI 而不是 CSS keyframes：
    //       · 起点是「被点的那张缩略图的实时矩形」—— 每次都不一样，CSS 算不出来
    //         ⇒ 必须 FLIP（First-Last-Invert-Play），用 animate() 写起点 transform。
    //       · 宿主组件没暴露生命周期钩子，检测「灯箱挂上来了」只能靠 MutationObserver
    //         （mount() 里已有，顺手复用，不新开观察器）。
    //       · 关闭也不能等 DOM 卸载：捕获阶段拦 close 按钮 / Escape，播完退场再放行，
    //         用 zoomBypass 标记防重入。
    //
    //     参数沿用既有规范（AGENTS.md §1）：280ms + cubic-bezier(.32,.72,0,1)
    //       = 远距弹窗进场同规格；遮罩淡化 224ms（0.8×）；退场 218ms（0.78×）。
    //       只动 transform/opacity（合成器层），无 layout/paint。
    //       reduce-motion 时整段跳过（与其它族一致）。
    // ──────────────────────────────────────────────────────────────────────────
    const ZOOM_ATTR = "data-dshm-zoom";
    const ZOOM_MS = 280;
    const ZOOM_EASE = "cubic-bezier(.32,.72,0,1)";
    let zoomSrc = null;              // 最近一次点击图片的视口矩形（FLIP 起点，仅短时有效）
    let zoomSrcFor = null;           // r32：**本次灯箱**的 FLIP 起点（打开时锁定，退场不再看「8 秒内」）
                                     //   用户 2026-10-22：「关闭也应该有收回动画」——旧逻辑退场只认
                                     //   8s 内点过的图，看图超过 8 秒再关就退化成原地淡出 ⇒ 补锁。
    let zoomDlg = null;              // 当前已接管的灯箱元素
    let zoomAnim = null;             // 正在播的 WAAPI 动画句柄（重入时先 cancel）
    let zoomExitTimer = null;        // 退场兜底定时器
    let zoomExiting = false;         // 退场进行中（防连点重复触发）
    let zoomBypass = false;          // 退场后重放 click 时的一次性放行标志
    let zoomOpens = 0, zoomExits = 0;

    // 记下「用户想放大的那张图」的矩形。只认会话内容区 / 输入框里的缩略图。
    function pickZoomSrc(target) {
      if (!cfg.on) return;
      try {
        let img = null;
        if (target && target.closest) {
          img = target.closest("img");
          if (!img) {
            const btn = target.closest("button, [role=button]");
            if (btn) img = btn.querySelector("img");
          }
        }
        if (!img || img.closest("[" + ZOOM_ATTR + "]")) return;
        // 作用域白名单：会话消息区 / composer（输入框草稿图所在）。其它图片（头像、
        // 壁纸、插件页插图）点开后不该有「从原位置长出」的观感。
        const host = img.closest('[data-slot^="conversation"], [class*="_conversation"], [class*="_centerCol"], [data-composer-card]');
        if (!host) return;
        const r = img.getBoundingClientRect();
        if (r.width < 16 || r.height < 16) return;
        zoomSrc = { x: r.left, y: r.top, w: r.width, h: r.height, at: performance.now() };
      } catch (e) { }
    }

    // 灯箱判定：宿主用 CSS-module 哈希类名（_backdrop_19zw2_2 等），不能写死后缀，
    // 用前缀匹配；结构判据 = 有 stage / image 子元素（避免误吞别的 aria-modal 对话框）。
    function isZoomDialog(el) {
      try {
        return !!el && el.nodeType === 1 && el.matches
          && el.matches('[role="dialog"][aria-modal="true"]')
          && !!(el.querySelector && el.querySelector('[class*="_stage_"], [class*="_image_"]'));
      } catch (e) { return false; }
    }

    function zoomImgOf(dlg) {
      try { return dlg.querySelector('[class*="_image_"]') || dlg.querySelector("img"); } catch (e) { return null; }
    }

    function zoomMaskOf(dlg) {
      try { return dlg.querySelector('[class*="_mask_"]'); } catch (e) { return null; }
    }

    // 入场：从缩略图矩形 FLIP 到终框；没有源矩形时退化为「轻微放大 + 淡入」。
    function zoomPlayOpen(dlg) {
      if (!cfg.on || reduceOn()) { try { dlg.setAttribute(ZOOM_ATTR, ""); } catch (e) { } return; }
      const img = zoomImgOf(dlg);
      if (!img) { try { dlg.setAttribute(ZOOM_ATTR, ""); } catch (e) { } return; }
      let kf;
      const r = img.getBoundingClientRect();
      const src = (zoomSrc && performance.now() - zoomSrc.at < 1200) ? zoomSrc : null;
      // r32：锁存本次灯箱的 FLIP 起点 —— 退场时不管看了多久都回缩到这张缩略图。
      zoomSrcFor = (src && r.width > 24 && r.height > 24) ? src : null;
      if (src && r.width > 24 && r.height > 24) {
        const dx = src.x - r.left;
        const dy = src.y - r.top;
        // 起点缩放 = 缩略图 / 终框。上限 1.24：从极小缩略图拉大会糊成一片，且原图
        // 还没解码完时更明显；超过就按 1.24 起（观感仍是从原位置长出）。
        let sx = src.w / r.width, sy = src.h / r.height;
        if (sx > 1.24) sx = 1.24;
        if (sy > 1.24) sy = 1.24;
        if (sx < 0.05) sx = 0.05;
        if (sy < 0.05) sy = 0.05;
        try { img.style.transformOrigin = "0 0"; } catch (e) { }
        kf = [
          { transform: "translate3d(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px,0) scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")", opacity: 0.9 },
          { transform: "translate3d(0px,0px,0) scale(1,1)", opacity: 1 }
        ];
      } else {
        try { img.style.transformOrigin = "50% 50%"; } catch (e) { }
        kf = [{ transform: "scale(.92)", opacity: 0 }, { transform: "scale(1)", opacity: 1 }];
      }
      try { if (zoomAnim) zoomAnim.cancel(); } catch (e) { }
      try {
        zoomAnim = img.animate(kf, { duration: ZOOM_MS, easing: ZOOM_EASE, fill: "backwards" });
      } catch (e) { zoomAnim = null; }
      const mask = zoomMaskOf(dlg);
      if (mask) {
        try { mask.animate([{ opacity: 0 }, { opacity: 1 }], { duration: Math.round(ZOOM_MS * 0.8), easing: ZOOM_EASE, fill: "backwards" }); } catch (e) { }
      }
      zoomOpens++;
      try { dlg.setAttribute(ZOOM_ATTR, ""); } catch (e) { }
    }

    // 退场：反向回缩到缩略图矩形（或淡出+缩小），播完再真的执行关闭动作。
    //  ⚠ `fill:"forwards"` 必须留着：动画结束后元素要保持「缩回源位置」的姿态，
    //    直到 click 重放真正卸载它；否则最后一帧会跳回全尺寸。
    function zoomPlayClose(dlg, done) {
      if (zoomExiting) return;
      zoomExiting = true;
      let finished = false;
      const finish = () => {
        if (finished) return;
        finished = true;
        if (zoomExitTimer) { try { clearTimeout(zoomExitTimer); } catch (e) { } zoomExitTimer = null; }
        zoomExits++;
        zoomExiting = false;
        try { done(); } catch (e) { }
      };
      const img = zoomImgOf(dlg);
      if (!img || reduceOn()) { finish(); return; }
      // r32：优先用「打开时锁存的 FLIP 起点」；旧逻辑只在点击后 8s 内有效，看图超过
      // 8 秒再关就退化成原地淡出（用户反馈「关闭没有收回动画」的主因）。
      const src = zoomSrcFor || ((zoomSrc && performance.now() - zoomSrc.at < 8000) ? zoomSrc : null);
      let kf;
      const r = img.getBoundingClientRect();
      if (src && r.width > 24 && r.height > 24) {
        const dx = src.x - r.left, dy = src.y - r.top;
        let sx = src.w / r.width, sy = src.h / r.height;
        if (sx > 1.24) sx = 1.24;
        if (sy > 1.24) sy = 1.24;
        try { img.style.transformOrigin = "0 0"; } catch (e) { }
        kf = [
          { transform: "translate3d(0px,0px,0) scale(1,1)", opacity: 1 },
          { transform: "translate3d(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px,0) scale(" + sx.toFixed(4) + "," + sy.toFixed(4) + ")", opacity: 0.55 }
        ];
      } else {
        try { img.style.transformOrigin = "50% 50%"; } catch (e) { }
        // 没有源矩形（键盘打开 / 源图太小 / 从别的入口打开）时也要有明确的「收回」观感：
        // r30 这里只缩到 .94 再淡出，肉眼几乎等于直接消失 —— 用户说「关闭也该有收回动画」
        // 的另一半原因。改成先缩到 .78 再淡出。
        kf = [
          { transform: "scale(1)", opacity: 1, offset: 0 },
          { transform: "scale(.78)", opacity: 0, offset: 1 }
        ];
      }
      const mask = zoomMaskOf(dlg);
      if (mask) {
        try { mask.animate([{ opacity: 1 }, { opacity: 0 }], { duration: Math.round(ZOOM_MS * 0.78), easing: "ease-in", fill: "forwards" }); } catch (e) { }
      }
      try {
        if (zoomAnim) zoomAnim.cancel();
        zoomAnim = img.animate(kf, { duration: Math.round(ZOOM_MS * 0.78), easing: ZOOM_EASE, fill: "forwards" });
        zoomAnim.finished.then(finish, finish);   // cancel 时 finished reject，两边都收
      } catch (e) { finish(); return; }
      // 兜底：标签页切后台时 WAAPI finished 可能延后，别把关闭按钮点死
      zoomExitTimer = setTimeout(finish, Math.round(ZOOM_MS) + 140);
    }

    function zoomRealClose(dlg, trigger) {
      zoomBypass = true;
      try { if (trigger) trigger.click(); } catch (e) { }
      zoomDlg = null;
      zoomSrcFor = null;
      try { if (dlg) dlg.removeAttribute(ZOOM_ATTR); } catch (e) { }
    }

    // 捕获阶段监听：早于 React 根容器的冒泡处理，能拦下「关闭」改成「先播退场」。
    function onZoomClick(e) {
      if (zoomBypass) { zoomBypass = false; return; }
      if (!cfg.on) return;
      const dlg = zoomDlg;
      if (!dlg || !document.contains(dlg)) return;
      const t = e.target;
      if (!t || t.nodeType !== 1) return;
      let btn = null;
      try { btn = t.closest('[class*="_close_"]'); } catch (err) { }
      if (!btn || !dlg.contains(btn)) return;
      e.preventDefault();
      e.stopPropagation();
      // ⚠ 必须 stopImmediatePropagation：宿主把 Escape / close 的监听挂在**同一节点**
      //   （window keydown / document click）上，stopPropagation 挡不住同节点后续监听
      //   ⇒ 会绕过我们的退场、立刻卸载灯箱（r30 首轮实测 C1 失败就是这个）。
      e.stopImmediatePropagation();
      zoomPlayClose(dlg, () => zoomRealClose(dlg, btn));
    }

    function onZoomKey(e) {
      if (zoomBypass) { zoomBypass = false; return; }
      if (!cfg.on || e.key !== "Escape") return;
      const dlg = zoomDlg;
      if (!dlg || !document.contains(dlg)) return;
      let btn = null;
      try { btn = dlg.querySelector('[class*="_close_"]'); } catch (err) { }
      if (!btn) return;            // 没找到关闭按钮就不接管，交给宿主原生逻辑
      e.preventDefault();
      e.stopPropagation();
      // ⚠ 必须 stopImmediatePropagation：宿主把 Escape / close 的监听挂在**同一节点**
      //   （window keydown / document click）上，stopPropagation 挡不住同节点后续监听
      //   ⇒ 会绕过我们的退场、立刻卸载灯箱（r30 首轮实测 C1 失败就是这个）。
      e.stopImmediatePropagation();
      zoomPlayClose(dlg, () => zoomRealClose(dlg, btn));
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ④f 通用微动效（r32）：设置弹窗页签切换 / 右侧栏面板展开·收起（P1）
    //     用户 2026-10-22 m01292：「动效 p1 也要做」= 上一轮审计列出的 P1：
    //       · 设置弹窗 nav 切换 ⇒ `.VOzbGW_options` 内容原地替换（kid 恒 1），宿主零动画；
    //       · 右侧栏 P3OORG_panel 展开/收起 ⇒ 容器宽度直接跳变（panel 无 width/transform 过渡）；
    //       · composer 附件缩略图 hover ⇒ 只有 cursor 反馈（纯 CSS，走 buildCss 那条）。
    //     规范：交互反馈档 = 180~220ms + cubic-bezier(.2,.8,.2,1)（不是 438ms 弹簧档）——
    //     页签切换/侧栏开合是「操作反馈」不是「浮层入场」，用长弹簧会显得拖沓。
    //     只动 transform/opacity/width；reduce-motion 时全部跳过。
    //     ⚠ 选择器不写死 CSS-module 哈希：设置窗用 role+data-shortcut-modal 锚定，
    //       右侧栏用 tabCell 反查 panel，都能扛版本升级。
    // ──────────────────────────────────────────────────────────────────────────
    const UI_EASE = "cubic-bezier(.2,.8,.2,1)";
    const UI_TAB_MS = 190;
    const UI_PANEL_MS = 200;
    const UI_CONTENT_MS = 180;
    let uiTabs = 0, uiPanels = 0;
    let uiPanelAnim = null;
    let uiCenterAnim = null;
    // r38：右栏开合的「代」与待办意图。用户快速二次点击时，旧动画的 finish 会 replay 第二次点击，
    // 导致「收起 → 凸现 → 再收起」（2026-10-22 用户复现）。用代际作废旧回调 + 同向忽略 / 反向排队。
    let uiRsbGen = 0;
    let uiRsbIntent = null;   // true=正在展开, false=正在收起
    let uiRsbPending = null;  // { open, tg } 动画结束后要做的反向操作

    // r40：右栏开合的事件流水（用户单次点击仍「收起后又凸现」⇒ 需要真机证据）。
    // 控制台 `window.__dshMotion.dbgRsb()` 直接读；环形 120 条，超了丢最旧。
    let uiRsbLog = [];
    let uiRsbLastReplayAt = 0;
    let uiRsbClosedAt = 0;    // r44：最近一次收起动画 finish 的时刻（区分「宿主瞬态回开」与「真的展开」）
    let uiRsbCoverOn = false; // r44：视觉盖是否生效（html 级属性 + 行内双保险）
    function radius4(el, fallback) {
  try {
    const cs = getComputedStyle(el);
    const v = (k) => { const n = parseFloat(cs[k]); return (isFinite(n) && n > 0) ? n : (fallback || 0); };
    return [v("borderTopLeftRadius"), v("borderTopRightRadius"), v("borderBottomRightRadius"), v("borderBottomLeftRadius")];
  } catch (e) { return [fallback || 0, fallback || 0, fallback || 0, fallback || 0]; }
}
function radius4Str(a) { return a.map((n) => (Math.round(n * 10) / 10) + "px").join(" "); }
function rsbLog(ev, extra) {
      try {
        const row = { t: Math.round(performance.now()), ev };
        if (extra) for (const k in extra) row[k] = extra[k];
        try {
          const c = document.querySelector('[class*="rightbarCol"]');
          const pnl = document.querySelector('[data-sidebar-right-panel]');
          row.col = c ? Math.round(c.getBoundingClientRect().width) : null;
          row.open = pnl ? pnl.hasAttribute('data-sidebar-right-open') : null;
        } catch (e) { }
        uiRsbLog.push(row);
        if (uiRsbLog.length > 120) uiRsbLog.shift();
      } catch (e) { }
    }
    let rsbBypass = false;
    // r46：真机取证 —— 收起完成后 1.6s 内，记录中心列/面板的尺寸与属性变化。
    // 目的：区分「宿主把面板重新画出来（尺寸/属性变化）」与「纯合成层闪烁（DOM 无变化）」。
    function watchAfterClose() {
      const o = rsbColOf();
      const col = o && o.col ? o.col : null;
      const panel = (o && o.panel) || document.querySelector('[data-sidebar-right-panel]');
      if (!col && !panel) return;
      const t0 = performance.now();
      const rec = [];
      const tag = (n) => (n === col ? "col" : n === panel ? "panel" : "other");
      let ro = null, mo = null;
      try {
        ro = new ResizeObserver((ents) => {
          for (const e of ents) rec.push({ t: Math.round(performance.now() - t0), ev: "resize", who: tag(e.target), w: Math.round(e.contentRect.width), h: Math.round(e.contentRect.height) });
        });
        if (col) ro.observe(col);
        if (panel) ro.observe(panel);
      } catch (e) { }
      try {
        mo = new MutationObserver((ms) => {
          for (const mu of ms) rec.push({ t: Math.round(performance.now() - t0), ev: "mut", who: tag(mu.target), attr: mu.attributeName });
        });
        const opt = { attributes: true, attributeFilter: ["style", "class"] };
        if (col) mo.observe(col, opt);
        if (panel) mo.observe(panel, { attributes: true, attributeFilter: ["style", "class", "data-sidebar-right-open", "hidden"] });
      } catch (e) { }
      setTimeout(() => {
        try { ro && ro.disconnect(); } catch (e) { }
        try { mo && mo.disconnect(); } catch (e) { }
        try {
          const o2 = rsbColOf();
          const curW = o2 && o2.col ? Math.round(o2.col.getBoundingClientRect().width) : -1;
          const coverNow = document.documentElement.hasAttribute("data-dshm-rsb-cover");
          console.info("[dsh-motion] rsb-post-close " + JSON.stringify({ colW: curW, cover: coverNow, n: rec.length, rec: rec.slice(0, 60) }));
        } catch (e) { }
      }, 1600);
    }

    function findSettingsDialog() {
      try {
        return document.querySelector('[role="dialog"][aria-modal="true"][data-shortcut-modal="settings"]')
          || document.querySelector('[data-shortcut-modal="settings"]');
      } catch (e) { return null; }
    }

    // 设置弹窗：点 nav cell 之后宿主同步换掉 options 内容，下一帧给 options 播入场。
    function playPaneIn() {
      if (!cfg.on || reduceOn()) return false;
      const dlg = findSettingsDialog();
      if (!dlg) return false;
      let opts = null;
      try { opts = dlg.querySelector('[class*="_options"]'); } catch (e) { }
      if (!opts) return false;
      try {
        opts.animate([{ opacity: 0, transform: "translateY(6px)" }, { opacity: 1, transform: "translateY(0px)" }],
          { duration: UI_TAB_MS, easing: UI_EASE, fill: "backwards" });
      } catch (e) { return false; }
      uiTabs++;
      return true;
    }

    function isSettingsTabClick(target) {
      try {
        if (!target || target.nodeType !== 1 || !target.closest) return false;
        const cell = target.closest('button[class*="_navCell"]');
        if (!cell) return false;
        const dlg = findSettingsDialog();
        return !!(dlg && dlg.contains(cell));
      } catch (e) { return false; }
    }

    // 右侧栏容器：真正决定布局的是 `rightbarCol`（宽 0 = 收起 / 420 = 展开），
    // 里面的 `P3OORG_panel` 恒为 420 宽、被父列裁剪。用 `_tabCell_` 反查 panel 再上溯到列，
    // 不写死哈希前缀；几何校验（右半屏、高 >300）避免误认左栏/其它面板。
    // ⚠ 别拿 `_panel` 当归一化目标：`closest('[class*="_panel"]')` 会先命中 `_panelBody`，
    //   动画到它身上 = 内容被压扁、外层列宽不动（r32 第一版实拍：面板宽度恒 420、中心列
    //   在动画结束后才跳变）。必须动画 `rightbarCol`。
    function rsbColOf() {
      try {
        const vw = (window.innerWidth || 1500);
        // ① 展开态：从 tab 内容反查（`_tabCell_` 一定在）
        const cells = document.querySelectorAll('[class*="_tabCell_"]');
        for (let i = 0; i < cells.length; i++) {
          const p = cells[i].closest('[class*="_panel"]');
          if (!p) continue;
          const col = p.closest('[class*="rightbarCol"]');
          if (!col) continue;
          const r = col.getBoundingClientRect();
          if (r.height > 300 && r.left > vw * 0.4) return { col: col, panel: p };
        }
        // ② 收起态：宿主可能按需挂载右侧栏内容（`_tabCell_` 不在 DOM）⇒ 直接按容器类名找，
        //    几何筛「贴右半屏、高 >300」，避免误认左栏/其它 column。
        const cols = document.querySelectorAll('[class*="rightbarCol"]');
        for (let i = 0; i < cols.length; i++) {
          const col = cols[i];
          const r = col.getBoundingClientRect();
          if (!(r.height > 300) || r.left < vw * 0.4) continue;
          return { col: col, panel: col.querySelector('[class*="_panel"]') || col };
        }
        return null;
      } catch (e) { return null; }
    }

    // 材质根：glass-patch 的「收起态抹底」规则打在 [data-sidebar-right-panel] 上（= P3OORG_panel），
    // 不是 _panelBody ⇒ 动画期间要在这个元素上挂豁免属性，否则展开的 220ms 是透明面板。
    function uiRsbRoot(o) {
      try {
        if (!o) return null;
        if (o.col && o.col.querySelector) {
          const r = o.col.querySelector('[data-sidebar-right-panel]');
          if (r) return r;
        }
        if (o.panel && o.panel.closest) {
          const r = o.panel.closest('[data-sidebar-right-panel]');
          if (r) return r;
        }
        return o.panel || o.col || null;
      } catch (e) { return o && (o.panel || o.col) || null; }
    }

    // 目标宽度 = 内部 panel 的固有宽度（收起时宿主把列宽设 0，但 panel 仍 420）。
    function rsbTargetWidth(o) {
      // 只认「右侧栏展开宽」区间；收起态容器里量到的 DOM 宽可能是别的残值（实测 675），不能用。
      try {
        const r = o.panel.getBoundingClientRect();
        if (r.width >= 380 && r.width <= 460) return Math.round(r.width);
      } catch (e) { }
      return 420;
    }

    // 中心列：与右栏同处一个 flex 行，宿主收/展时会同步改它的宽度（1220 ↔ 800）。
    // r34：用户报「收起来异常」—— 之前只动画右栏列宽，中心列停着不动 220ms 再跳变，
    // 视觉上就是右侧先空出一块、然后整页突然变宽。r34 起两边同一条曲线一起走。
    function rsbCenterOf() {
      try {
        const vw = (window.innerWidth || 1500);
        const cols = document.querySelectorAll('[class*="centerCol"]');
        for (let i = 0; i < cols.length; i++) {
          const r = cols[i].getBoundingClientRect();
          if (r.height > 300 && r.width > 300 && r.left < vw * 0.6) return cols[i];
        }
        return null;
      } catch (e) { return null; }
    }

    // ── 右侧栏开合（r36 重设计；用户 m03206「侧栏动画还有很大的问题，需要完全重新设计」）
    // 旧 r34 实现逐帧实测（.probe/recon-r38-rsb.mjs）的两个根因：
    //   开：拦住 click 先播「空列展开」，宿主此时还没展开 ⇒ 前 200ms 右栏是空列（entries=0），
    //       播完重放 click 内容才整块挂载（t≈340ms 才看到内容）= 两段式；
    //   关：播完才把 click 交给宿主，内容先停住、边界后一步走完。
    // 新做法（一段连续运动，会话右边界 ≡ 侧栏左边界，同帧同曲线）：
    //   · 实测布局：右栏是**右缘固定**的列（展开时 x=1080 宽 420），中心列宽度从它自己的
    //     左缘 280 起算 ⇒ 两条可视边界其实是同一条线 = 280 + centerWidth。
    //   · 开 = 宿主先行 + 侧栏从右缘滑入：宿主 click 后立刻用行内 width 冻住中心列（旧宽），
    //     同时给右栏 `translateX(w)`（此时它还在视口外，不可见）；next frame 起两段同曲线
    //     动画：center width cw→cw-w、col transform translateX(w)→0。
    //     两段位移按同一缓动推进 ⇒ 侧栏左缘 1500-420p 与中心列右缘 1500-420p 逐帧重合，
    //     不会出现空列/错位；内容在宿主 commit 时就已挂载（不是动画结束才出现）。
    //   · 关 = 动画先行：center cw→cw+w、col translateX(0)→w；播完再重放宿主 click
    //     （那时侧栏已在视口外，列宽 420→0 不可见，无跳变）。
    //   · 规范（design-motion-principles）：默认不动 layout 属性，但「推送式布局」要移动边界
    //     只能用中心列宽度驱动；只此一条、只 200ms、动画期挂 contain: layout paint 限制重排
    //     范围、结束立刻还原。内容不加 scale / 不额外淡入（它是随边界滑入的，再加会重复）。
    //   · reduce-motion 直接跳过（交还宿主），不进动画路径。
    function uiRsbFreezeCenter(center, cw) {
      try {
        center.style.width = cw + "px";
        center.style.overflow = "hidden";
        center.style.contain = "layout paint";
      } catch (e) { }
    }

    function uiRsbCleanup(center, col) {
      try {
        if (center) { center.style.width = ""; center.style.overflow = ""; center.style.contain = ""; }
      } catch (e) { }
      try {
        if (col) { col.style.transform = ""; col.style.willChange = ""; }
      } catch (e) { }
      try {
        const root = document.querySelector('[data-sidebar-right-panel]');
        if (root) root.removeAttribute("data-dshm-rsb-anim");
      } catch (e) { }
    }

    // r44：视觉盖从「行内 visibility」升级为「html 级属性 + 样式表 !important + 行内」三保险。
    // 真机 r43 仍能看到闪回：宿主在 React 重渲染时会整体改写面板的 style（实测写成
    // `width:420px; --dsh-sidebar-width:420px;`），行内 visibility 可能被覆盖/丢失，且面板若被
    // React 重挂则行内值不跟着新节点走；html 属性不归 React 管，任何时刻的新面板节点都会被压住。
    function setRsbCover() {
      uiRsbCoverOn = true;
      try { document.documentElement.setAttribute("data-dshm-rsb-cover", ""); } catch (e) { }
      try { const c = rsbColOf(); if (c && c.col) c.col.style.visibility = "hidden"; } catch (e) { }
      try { const r = document.querySelector('[data-sidebar-right-panel]'); if (r) r.style.visibility = "hidden"; } catch (e) { }
      rsbLog("cover-set");
    }
    function clearRsbCover(why) {
      if (!uiRsbCoverOn) return;
      uiRsbCoverOn = false;
      rsbLog("cover-clear", { why: why || "" });
      try { document.documentElement.removeAttribute("data-dshm-rsb-cover"); } catch (e) { }
      try { const c = rsbColOf(); if (c && c.col) c.col.style.visibility = ""; } catch (e) { }
      try { const r = document.querySelector('[data-sidebar-right-panel]'); if (r) r.style.visibility = ""; } catch (e) { }
    }

    // 交还宿主：必须延后一拍再派发 click —— 在 capture 处理器里同步点同一个按钮，
    // 宿主 React 不响应这种嵌套派发（r36 实测：col 恒 0 / 内容不挂载）。
    function uiRsbHandOff(tg) {
      // r43/r44：交还宿主时（含 reduce-motion / 找不到列）必须摘掉视觉盖，否则展开后面板是 hidden。
      clearRsbCover("handoff");
      try {
        setTimeout(() => {
          rsbBypass = true;
          try { tg.el.click(); } catch (e) { }
        }, 0);
      } catch (e) { }
    }

    // 重放宿主点击：不信任捕获时存下的按钮节点（React 可能在动画期间重渲染替换它，
    // 点在游离节点上不会触发宿主 = 用户 2026-10-22 报的「收起闪一下又凸现」）。
    function uiRsbToggleNow(tg) {
      try {
        const wantClose = !!(tg && tg.close);
        const re = wantClose ? /收起右侧边栏/ : /打开右侧边栏/;
        let el = null;
        try {
          const all = document.querySelectorAll('button[aria-label]');
          for (let i = 0; i < all.length; i++) {
            const b = all[i];
            if (re.test(b.getAttribute('aria-label') || '')) { el = b; break; }
          }
        } catch (e) { }
        if (!el && tg && tg.el && tg.el.isConnected) el = tg.el;
        if (!el) return false;
        if (!wantClose) clearRsbCover("replay-open");
        rsbBypass = true;
        uiRsbLastReplayAt = performance.now();
        rsbLog("replay", { close: wantClose, aria: el.getAttribute("aria-label") || "" });
        // r41：若点到游离节点，click 不会冒泡到 document，rsbBypass 会永久卡住 ⇒ 400ms 兜底复位，
        // 否则之后用户的一次真实点击会被放行给宿主（看起来像「又动了一次」）。
        try { setTimeout(() => { rsbBypass = false; }, 400); } catch (e) { }
        try { el.click(); return true; } catch (e) { return false; }
      } catch (e) { return false; }
    }

    function uiRsbWaitCommit(col, cb, fail) {
      let tries = 0;
      const tick = () => {
        let ok = false;
        try { ok = col.getBoundingClientRect().width > 8; } catch (e) { }
        tries += 1;
        if (ok) { try { cb(); } catch (e) { } return; }
        if (tries > 12) { try { fail ? fail() : cb(); } catch (e) { } return; }
        try { requestAnimationFrame(tick); } catch (e) { }
      };
      try { requestAnimationFrame(tick); } catch (e) { try { cb(); } catch (e2) { } }
    }

    // open=true 展开，false 收起；返回是否接管（false = 已直接交还宿主）。
    function uiRsbRun(open, tg) {
      rsbLog("run", { open });
      const o = rsbColOf();
      if (!o || !o.col || !o.col.isConnected) { rsbLog("run-no-col"); uiRsbHandOff(tg); return false; }
      if (!cfg.on || reduceOn()) { uiRsbHandOff(tg); return false; }
      const col = o.col;
      const center = rsbCenterOf();
      if (!center) { uiRsbHandOff(tg); return false; }
      // 动画进行中又点：同向 → 忽略（否则旧 finish 的 replay 会造成第二次 toggle = 收回两次）；
      // 反向 → 排队，等当前动画落地后再跑（不打断，避免中间态鬼影）。
      // r39：意图要保留到宿主状态真正落地（cleanupNow）为止。r38 只覆盖「动画进行中」，
      // 而 finish() 之后、宿主 commit 之前（约 1–4 帧，低帧率更久）这段窗口里再点一次，
      // 会起第二个 run → 第二次 replay 宿主 click → 关了又开 = 用户录屏里 00:03 的凸现。
      if (uiRsbIntent !== null) {
        rsbLog("run-busy", { intent: uiRsbIntent });
        if (uiRsbIntent === open) return true;
        uiRsbPending = { open, tg };
        return true;
      }
      // r39：几何已在目标态 = 重复点击 / 上一发已收效，直接忽略；否则会做「反向几何动画」
      // （关态下 fromC=1220 → 1640 的荒诞中间帧 = 用户录屏 00:03 的凸现）。
      // 注意用列宽而不是 data-sidebar-right-open：属性是 React commit 后的状态，可能与几何差一帧。
      try {
        const cur = Math.round(col.getBoundingClientRect().width);
        if (open && cur > 100) { rsbLog("run-already-open", { cur }); return true; }
        if (!open && cur <= 8) { rsbLog("run-already-closed", { cur }); return true; }
      } catch (e) { }
      const gen = ++uiRsbGen;
      uiRsbIntent = open;
      uiRsbPending = null;
      // r43/r44：展开前必须摘掉视觉盖（收起结束后面板一直压着），否则展开后面板是 hidden。
      if (open) clearRsbCover("run-open");
      let w = 420;
      try { w = rsbTargetWidth(o) || 420; } catch (e) { }
      let cw = 0;
      try { cw = Math.round(center.getBoundingClientRect().width); } catch (e) { }
      if (!cw) { uiRsbHandOff(tg); return false; }
      let finished = false;
      // 收尾必须等宿主状态真的落地再清行内值 —— 否则「动画归 0 → 立刻清行内 width → 宿主还是展开态」
      // 会闪回一次 420/800 再被宿主收起 = 用户 2026-10-22 报的「收回两次 / 闪一下又凸现」（r37 修）。
      let toC = 0;
      const drainPending = () => {
        const q = uiRsbPending;
        uiRsbPending = null;
        if (!q) return;
        try { requestAnimationFrame(() => { try { uiRsbRun(q.open, q.tg); } catch (e) { } }); } catch (e) { }
      };
      const cleanupNow = () => {
        rsbLog("cleanup");
        uiRsbIntent = null;
        try { if (uiPanelAnim) uiPanelAnim.cancel(); } catch (e) { }
        try { if (uiCenterAnim) uiCenterAnim.cancel(); } catch (e) { }
        uiPanelAnim = null;
        uiCenterAnim = null;
        try { uiRsbCleanup(center, col); } catch (e) { }
        drainPending();
      };
      const waitHostClosed = (cb) => {
        let tries = 0;
        let retried = 0;
        let calm = 0;   // r42：几何连续安静帧数
        const tick = () => {
          let closed = false;
          let wideGeo = false;
          try {
            const r = document.querySelector('[data-sidebar-right-panel]');
            closed = !r || !r.hasAttribute('data-sidebar-right-open');
            wideGeo = col.getBoundingClientRect().width > 8;
          } catch (e) { }
          tries += 1;
          if (tries % 4 === 0) rsbLog("wait", { tries, closed, wide: wideGeo });
          // r42：属性摘掉 ≠ 面板已从画面上消失。宿主可能「先摘态、后落宽度」（或经 CSS 过渡），
          // 这中间我们一清 translateX(420) 面板就整块回来 = 用户录屏 frame 124–130 的凸现。
          // 必须等「属性已摘 + 列宽真的 ≤8 连续 2 帧」才算落地，行内 translateX 期间一直压着面板。
          if (closed && !wideGeo) {
            calm += 1;
            if (calm >= 2) { try { cb(); } catch (e) { } return; }
          } else {
            calm = 0;
          }
          if (closed && wideGeo) { try { col.style.transform = "translateX(" + w + "px)"; } catch (e) { } }
          // 补点（r40 收紧）：必须「几何仍明显展开（col 宽 > 200）」且距上次 replay > 250ms 才补 ——
          // 否则宿主 commit 慢时，第一次 replay 其实已生效，第二次 click 又把面板打开 = 单次点击也整块凸现。
          let wide = true;
          try { wide = col.getBoundingClientRect().width > 200; } catch (e) { }
          if (tries % 8 === 0 && retried < 2 && wide && performance.now() - uiRsbLastReplayAt > 250) {
            retried += 1;
            rsbLog("retry-replay", { tries });
            uiRsbToggleNow(tg);
          }
          if (tries > 40) { rsbLog("wait-timeout", { tries, closed, wide: wideGeo }); try { cb(); } catch (e) { } return; }
          try { requestAnimationFrame(tick); } catch (e) { try { cb(); } catch (e2) { } }
        };
        try { requestAnimationFrame(tick); } catch (e) { try { cb(); } catch (e2) { } }
      };
      // r41：关完之后再挂 ~900ms 看护。用户单次点击仍偶发「收起后又整块凸现」，
      // 在没抓到真机根因前先做自愈：只要面板又出现（列宽 >100）就立刻压回去（行内 translateX(w)）
      // 并重放一次关闭 click，把它按住；`gen` 变化（用户又展开）立即退出，不干扰新操作。
      const armCloseWatch = () => {
        if (gen !== uiRsbGen) return;
        let calm = 0;
        let fixed = 0;
        const t0 = performance.now();
        const stopWatch = () => { try { const r = document.querySelector('[data-sidebar-right-panel]'); if (r && gen === uiRsbGen) r.removeAttribute("data-dshm-rsb-anim"); } catch (e) { } };
        try { const r0 = document.querySelector('[data-sidebar-right-panel]'); if (r0) r0.setAttribute("data-dshm-rsb-anim", ""); } catch (e) { }
        const tick = () => {
          if (gen !== uiRsbGen) { stopWatch(); return; }
          // r44：宿主两段提交会「瞬态回开」——attr 先被重新加上、隔一两帧又摘掉。r43 在这里直接摘盖，
          // 面板就整块画出来了（真机的「闪一下又凸现」）。所以：刚收起 <650ms 内的回开一律当作宿主瞬态，
          // 不摘盖、压回并补一次关闭 click；>650ms 才认为是别的入口真的展开（此时必须摘盖，否则打不开）。
          try {
            const r2 = document.querySelector('[data-sidebar-right-panel]');
            if (r2 && r2.hasAttribute("data-sidebar-right-open")) {
              const since = performance.now() - uiRsbClosedAt;
              if (since < 650) {
                rsbLog("glitch-reopen", { since: Math.round(since) });
                try { console.warn("[dsh-motion] rsb-glitch-reopen since=" + Math.round(since) + " log=" + JSON.stringify(uiRsbLog.slice(-24))); } catch (e) { }
                try { col.style.transform = "translateX(" + w + "px)"; } catch (e) { }
                if (!fixed) { fixed += 1; try { uiRsbToggleNow(tg); } catch (e) { } }
                calm = 0;
              } else {
                clearRsbCover("external-open");
                stopWatch();
                return;
              }
            }
          } catch (e) { }
          let cw2 = 0;
          try { cw2 = col.getBoundingClientRect().width; } catch (e) { }
          if (cw2 > 100) {
            rsbLog("rebound-detected", { cw: Math.round(cw2) });
            try { col.style.transform = "translateX(" + w + "px)"; col.style.willChange = "transform"; } catch (e) { }
            if (!fixed) { fixed += 1; try { uiRsbToggleNow(tg); } catch (e) { } }
            calm = 0;
          } else {
            calm += 1;
          }
          const el = performance.now() - t0;
          if ((el > 900 && calm > 6) || el > 2400) {
            stopWatch();
            if (gen === uiRsbGen) { try { col.style.transform = ""; col.style.willChange = ""; } catch (e) { } }
            return;
          }
          try { requestAnimationFrame(tick); } catch (e) { stopWatch(); }
        };
        try { requestAnimationFrame(tick); } catch (e) { stopWatch(); }
      };
      const finish = () => {
        // 旧代（被打断/被同向重复点击取代）的回调一律作废：否则它会 replay 第二次宿主点击，
        // 造成「收起 → 凸现 → 再收起」。
        if (finished || gen !== uiRsbGen) return;
        finished = true;
        rsbLog("finish", { open: open });
        uiPanels++;
        // 动画终点先落成行内值：后面 cancel 动画时不会回弹到宿主旧态（收起尤其关键）。
        try {
          center.style.width = toC + "px";
          center.style.overflow = "hidden";
          center.style.contain = "layout paint";
        } catch (e) { }
        try { col.style.transform = "translateX(" + (open ? 0 : w) + "px)"; } catch (e) { }
        // r43/r44：视觉盖 —— 宿主收起是「先摘状态、后落宽度」的两段提交，中间任何一帧都可能把面板画回来。
        // 动画已经结束（面板在视口外），把面板压住直到下次展开；r44 起用 html 属性承载，React
        // 重渲染/重挂面板也压得住（r43 只有行内值，真机仍能看到闪回）。
        if (!open) {
          setRsbCover();
          uiRsbClosedAt = performance.now();
          // r46：再挂 1.6s 收尾取证（尺寸/属性变化），见 watchAfterClose。
          try { watchAfterClose(); } catch (e) { }
          // r45：真机取证 —— 每次收起自动把本次开合流水打到 console，
          // 不需要用户在「闪烁的一瞬间」抓任何东西；事后从 console 直接复制即可。
          try { console.info("[dsh-motion] rsb-close-trace " + JSON.stringify(uiRsbLog.slice(-24))); } catch (e) { }
          try {
            setTimeout(() => {
              try {
                if (gen !== uiRsbGen) return;
                const r0 = document.querySelector('[data-sidebar-right-panel]');
                if (col.getBoundingClientRect().width <= 8 && (!r0 || !r0.hasAttribute("data-sidebar-right-open"))) clearRsbCover("auto");
              } catch (e) { }
            }, 6000);
          } catch (e) { }
        }
        const done = () => { try { requestAnimationFrame(cleanupNow); } catch (e) { cleanupNow(); } };
        if (open) {
          // 开：宿主在 click 时就已 commit，行内终值 = 宿主终值，直接清。
          done();
          return;
        }
        // 关：先重放 click 让宿主落到收敛态（列宽 0 / center 1220），再清行内值 —— 两者相同，无跳变。
        const doneClosed = () => {
          try { requestAnimationFrame(() => { cleanupNow(); armCloseWatch(); }); } catch (e) { cleanupNow(); }
        };
        try {
          setTimeout(() => {
            // 宿主可能已经因为别的路径收态（重复 click / 用户连点），此时不要再点一次。
            let already = false;
            try {
              const r = document.querySelector('[data-sidebar-right-panel]');
              already = !r || !r.hasAttribute('data-sidebar-right-open');
            } catch (e) { }
            rsbLog("post-anim", { already: already, before: true });
            if (!already) uiRsbToggleNow(tg);
            waitHostClosed(doneClosed);
          }, 0);
        } catch (e) { done(); }
      };
      const start = () => {
        try {
          const fromC = open ? cw : Math.round(center.getBoundingClientRect().width);
          toC = Math.round(fromC + (open ? -w : w));
          if (open) uiRsbFreezeCenter(center, fromC);
          uiCenterAnim = center.animate([{ width: fromC + "px" }, { width: toC + "px" }],
            { duration: UI_PANEL_MS, easing: UI_EASE, fill: "forwards" });
          uiPanelAnim = col.animate([{ transform: "translateX(" + (open ? w : 0) + "px)" }, { transform: "translateX(" + (open ? 0 : w) + "px)" }],
            { duration: UI_PANEL_MS, easing: UI_EASE, fill: "forwards" });
          uiPanelAnim.finished.then(finish, finish);
        } catch (e) { finish(); }
      };
      try { const root0 = document.querySelector('[data-sidebar-right-panel]'); if (root0) root0.setAttribute("data-dshm-rsb-anim", ""); } catch (e) { }
      if (open) {
        // 宿主先行（内容立刻挂载）：先把中心列冻回旧宽、把侧栏挪到视口外（都不可见），
        // 再延迟一帧重放宿主 click —— 不能在 capture 处理器里同步 click 同一个按钮
        // （实测宿主 React 不响应这种嵌套派发），必须等本轮事件派发结束。
        uiRsbFreezeCenter(center, cw);
        try { col.style.transform = "translateX(" + w + "px)"; col.style.willChange = "transform"; } catch (e) { }
        try {
          setTimeout(() => {
            uiRsbToggleNow(tg);
            uiRsbWaitCommit(col, start, () => {
              // 宿主没打开 = click 被吞：清掉冻结值、交还宿主重试（宁可没动画，也不要空列动画）
              try { uiRsbCleanup(center, col); } catch (e) { }
              uiRsbHandOff(tg);
            });
          }, 0);
        } catch (e) { start(); }
      } else {
        try { col.style.willChange = "transform"; } catch (e) { }
        start();
      }
      try { setTimeout(finish, UI_PANEL_MS + 420); } catch (e) { }
      return true;
    }

    function rsbToggleOf(target) {
      try {
        if (!target || target.nodeType !== 1 || !target.closest) return null;
        const b = target.closest('button[aria-label]');
        if (!b) return null;
        const l = b.getAttribute("aria-label") || "";
        if (/收起右侧边栏/.test(l)) return { el: b, close: true };
        if (/打开右侧边栏/.test(l)) return { el: b, close: false };
        return null;
      } catch (e) { return null; }
    }

    // 统一入口：设置页签（不拦宿主，下一帧补入场）；右侧栏「展开」拦下来先播（宿主内容先行 +
    // 两列同曲线 200ms），**「收起」不接管**（r47 用户决定删掉右栏收回动效，交还宿主原生收起）。
    // 收起曾是所有「闪一下又凸现」的来源（宿主两段提交 + 我们的 translateX/视觉盖），
    // 与其继续打补丁，不如不接管：宿主自己有多快就多快，不存在委态错位。
    function onUiClick(e) {
      if (rsbBypass) { rsbBypass = false; return; }
      if (!cfg.on) return;
      const t = e.target;
      if (isSettingsTabClick(t)) {
        try { requestAnimationFrame(() => { try { playPaneIn(); } catch (err) { } }); } catch (err) { }
        return;
      }
      const tg = rsbToggleOf(t);
      if (!tg) return;
      // r47：右栏「收起」完全交还宿主 —— 不 preventDefault、不播动画、不盖、不重放。
      // 同时清掉可能残留的盖/排队（其它入口展开时用过盖），避免收起后右栏打不开。
      if (tg.close) {
        try { clearRsbCover("native-close"); } catch (e) { }
        try { uiRsbIntent = null; uiRsbPending = null; } catch (e) { }
        return;
      }
      try { const r = document.querySelector('[data-sidebar-right-panel]'); if (r) r.style.visibility = ""; } catch (e) { }
      const o = rsbColOf();
      if (!o) return;                  // 找不到右侧栏 ⇒ 不拦，交给宿主
      let cur = 0;
      try { cur = o.col.getBoundingClientRect().width; } catch (e) { }
      if (tg.close ? cur < 100 : cur > 100) return;   // 状态与按钮语义不一致就不插手
      e.preventDefault();
      e.stopPropagation();
      e.stopImmediatePropagation();
      uiRsbRun(true, tg);
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ⑤ 观察器
    //     ⚠ 第七轮把它从「只看 body 直系」放宽成 `subtree:true`：命令面板
    //       （`_3e4SsG_menu`）**不是** portal，它挂在 composer 的
    //       `[data-slot=conversation.input.overlay]` 里，只看 body 直系会完全漏掉。
    //       放宽的代价由 considerTree 控制：先 `matches()` 快速否定，只有「新增的确实是一棵
    //       有子元素的树」时才 `querySelectorAll`。流式输出新增的绝大多数是文本节点（nodeType 3，
    //       第一行就跳过）。实测代价见 probes/motion-observer-cost.mjs。
    // ──────────────────────────────────────────────────────────────────────────
    let observer = null;
    // 诊断计时：`subtree:true` 是第七轮放宽的（原来只看 body 直系）。本工作区的老账里
    // **旧版 dsh-motion 就是因为「全局 MutationObserver 扫描的固定开销」被删掉的**，
    // 所以这次必须能量出实际成本 —— 见 probes/motion-observer-cost.mjs 与 stats().obs。
    const obs = { recs: 0, nodes: 0, ms: 0 };
    function onMutations(records) {
      if (!cfg.on) return;                       // 关掉时一行活都不干（观察器本身不动）
      const t0 = performance.now();
      obs.recs += records.length;
      navSwap = null;   // r27：每批先重置（新卡的 mark 是 rAF 延迟执行，消费发生在本批返回之后）
      // ── r27：先扫整批 —— 悬浮预览卡换行 = 同一批「删旧卡 + 加新卡」 ─────────────
      //   旧卡：不播鬼影退场（用户要的「不是上一个缩小消失」）；
      //   新卡：mark() 里用旧卡矩形做 carry 起点（一个气泡从旧行滑到新行）。
      //   ⚠ 必须整批预扫：records 顺序里「加」可能排在「删」之前，逐条处理会漏。
      let navAdded = null, navRemoved = [];
      try {
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          for (let j = 0; j < rec.addedNodes.length; j++) {
            const nd = rec.addedNodes[j];
            if (nd.nodeType === 1 && isHoverPreviewCard(nd)) navAdded = nd;
          }
          for (let j = 0; j < rec.removedNodes.length; j++) {
            const nd = rec.removedNodes[j];
            if (nd.nodeType === 1 && isHoverPreviewRemoval(nd)) navRemoved.push(nd);
          }
        }
      } catch (e) { }
      try {
        if (navAdded && navRemoved.length === 1) {
          const info = exitInfo.get(navRemoved[0]);
          if (info && info.w > 8 && info.h > 8) {
            navSwap = { prevRect: { x: info.x, y: info.y, w: info.w, h: info.h }, skip: new WeakSet(navRemoved), ts: performance.now() };
          }
        }
      } catch (e) { }
      // ── r28：上下文洞察 hovertip 跨格 =「连贯气泡」────────────────────────────
      //   小格之间有 3px 间隙：慢速跨过时宿主会先卸掉旧气泡、再挂一个**新元素**（同一批
      //   或相邻几批 Mutation）。这里先把旧气泡的**定格几何**记进 tipSwap（鬼影句柄等
      //   ④b 建好后补挂）；新气泡 mark() 里的 tipCarryGeo() 会消费它：
      //     · 取消旧气泡的缩小鬼影（用户点名不要「上一个缩小消失」）；
      //     · 新气泡从旧气泡的当前位置起步，只跑 .14s 纯平移（复用 r27 carry 档）。
      //   ⚠ 必须在删除处理之前扫（同一批里「加」可能排在「删」前面，逐条处理会漏）。
      try {
        let tipRemoved = null;
        for (let i = 0; i < records.length; i++) {
          const rec = records[i];
          for (let j = 0; j < rec.removedNodes.length; j++) {
            const nd = rec.removedNodes[j];
            if (nd.nodeType === 1 && isHoverTipRemoval(nd)) tipRemoved = nd;
          }
        }
        if (tipRemoved) {
          const info = exitInfo.get(tipRemoved);
          if (info && info.w > 8 && info.h > 8) {
            tipSwap = { info: { x: info.x, y: info.y, w: info.w, h: info.h }, ghost: null, ts: performance.now() };
          }
        }
      } catch (e) { }
      // ── r30：图片灯箱（ImageLightbox）入场 ─────────────────────────────────────
      //   灯箱是 portal 到 body 的新节点，组件自身零动效 —— 只能在这里「发现即接管」：
      //   标记 + WAAPI FLIP 从被点缩略图的位置长出（源矩形由 pointerdown 记下）。
      //   灯箱被任何路径卸载时同步清句柄，避免下一轮拿陈旧引用播动画。
      try {
        if (zoomDlg && !document.contains(zoomDlg)) {
          zoomDlg = null;
          try { if (zoomAnim) zoomAnim.cancel(); } catch (e) { }
          zoomAnim = null;
        }
        if (!zoomDlg && cfg.on) {
          let found = null;
          for (let i = 0; i < records.length && !found; i++) {
            const add = records[i].addedNodes;
            for (let j = 0; j < add.length; j++) {
              const nd = add[j];
              if (nd.nodeType === 1 && isZoomDialog(nd)) { found = nd; break; }
            }
          }
          if (found) { zoomDlg = found; zoomPlayOpen(found); }
        }
      } catch (e) { }
      for (let i = 0; i < records.length; i++) {
        const rec = records[i];
        // 压力信号分类：元素节点 = DOM 重渲染速率；文本节点 / characterData = 流式 token。
        let addEl = 0, addTxt = 0;
        for (let j = 0; j < rec.addedNodes.length; j++) {
          const nd = rec.addedNodes[j];
          obs.nodes++;
          if (nd.nodeType === 1) addEl++; else if (nd.nodeType === 3) addTxt++;
          considerTree(nd);
        }
        if (rec.type === "characterData") addTxt++;
        if (addEl || addTxt) noteMutations(addEl, addTxt);
        const batch = [];
        // ④c 原位克隆要用 DOM 位置：MutationRecord 的 target/nextSibling 正是被删节点的锚点
        const ctx = (rec.target && rec.target.nodeType === 1) ? { parent: rec.target, next: rec.nextSibling } : null;
        for (let j = 0; j < rec.removedNodes.length; j++) {
          obs.nodes++;
          // r27：换行的旧卡直接消失（新卡会从它的位置 carry 出来），不克隆鬼影 ——
          //   否则「旧卡缩小消失 + 新卡从锚点长出」正是用户点名要消掉的重叠动画。
          if (navSwap && navSwap.skip && navSwap.skip.has(rec.removedNodes[j])) continue;
          collectExit(rec.removedNodes[j], batch, ctx);
        }
        // ④b：同批 >2 个 = teardown（切会话/整树卸载），不播消失，原样收掉
        if (batch.length && batch.length <= 2) {
          for (let k = 0; k < batch.length; k++) {
            let gh = null;
            try { gh = exitClone(batch[k][0], batch[k][1], batch[k][2]); } catch (e) { }
            // r28：hovertip 的退场鬼影先挂到 tipSwap 上 —— 紧接着出现的新气泡会立刻取消它
            //   并从它的当前位置接手；没有新气泡（真离开）时它照常播完缩小。
            try { if (gh && tipSwap && !tipSwap.ghost && isHoverTipRemoval(batch[k][0])) tipSwap.ghost = gh; } catch (e) { }
          }
        }
        for (let j = 0; j < rec.removedNodes.length; j++) { releaseTree(rec.removedNodes[j]); }
      }
      obs.ms += performance.now() - t0;
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ⑥ 样式表
    // ──────────────────────────────────────────────────────────────────────────
    //
    //  ── 材质：一字不差地照用 wallpaper 的「设置窗口液态玻璃」配方 ──────────────
    //  取值全部来自 wallpaper 自己的设置（写在 document.body.style，实时可变）：
    //    --we-glass-color      玻璃颜色（默认 亮 #ffffff / 暗 #0d1524）
    //    --we-glass-alpha      玻璃透明度 0.03–0.25
    //    --we-blur / -saturate / --we-glass-brightness   玻璃滑块
    //  这样模型选择器与设置窗口、composer、气泡是**同一杯玻璃**：用户拖 wallpaper 的
    //  滑杆，它们一起变 —— 这正是用户 2026-09-13 要的「统一起来」。
    //  下面的 --dshm-alpha-gain 是给本插件的安全旋钮（默认 1×，即完全跟随）。
    // ── NOT_COVERED（第十八轮）：motion 材质档**不许**碰 dsh-glass-patch 已经覆盖的表面 ──
    //   真机取证（probes/live/r17-forensics.json）证明：暗色主题下斜杠菜单同时命中
    //     html[data-dshm] body[data-ds-dark-theme] [data-dshm-glass]   ← (0,4,0) 且带 !important
    //     body[data-we-wallpaper] :is([role=menu],…,[data-trigger-menu],…)  ← (0,2,1) glass-patch 的同源配方
    //   前者赢 ⇒ 菜单吃的是 wallpaper「设置窗口」那杯（读 --we-glass-color，暗色 = #0d1524，
    //   且**不乘暗色 0.4**），而输入框吃的是 `--dsw-specific-input-major`
    //   （白 × α × 0.4 = rgba(255,255,255,0.07)）⇒ 「不统一」。
    //   浅色主题下两者数值偶然相同（--we-glass-color 恰好是 #ffffff），所以此前所有
    //   headless 验证（都在浅色下跑）都得出「四字段全等」的假结论。
    //   修法：给 motion 的材质规则加一条**否定名单**，把 glass-patch 覆盖的那几族排除，
    //   让「同源配方」永远赢；motion 的材质档只对**没人管**的浮层（如无 role 的后台任务
    //   ul.QsffPG_menu）继续兜底。不是删掉档位，而是把它降为 fallback。
    const NOT_COVERED = ':not([role]):not([data-trigger-menu])'
      + ':not([class*="-tip"]):not([class*="_tip"])'
      + ':not([class*="tooltip"]):not([class*="Tooltip"])';
    // ── window 档（2026-10-21 对齐 wallpaper 1.3.x 的**真**设置窗）─────────────
    //  r23 读的是 --we-glass-color / --we-glass-alpha / --we-blur —— wallpaper 1.2 时代的
    //  变量。1.3.1 里 --we-glass-color 已无任何 CSS 消费者、且只写浅色侧 ⇒ 暗色主题必然
    //  拿到浅色玻璃（代码里的 #0d1524 兜底是死兜底）。真设置窗（wallpaper
    //  client.js:3076/3118/3139）的实际配方：
    //    底色 = color-mix(可读性地板 --we-readability-base × --we-readability-floor,
    //                     color-mix(--we-surface-tint-light|dark × --we-settings-window-alpha))
    //    bf   = blur(--we-settings-window-blur) saturate(--we-saturate) brightness(--we-glass-brightness)
    //  这里逐字照抄同一张配方表；--dshm-alpha-gain 只乘「玻璃那一半」（地板那一半不乘 ——
    //  否则等于同时改可读性下限）。⚠ 该档观感**故意**与其它菜单不同源（它就是「照抄设置窗」）；
    //  要与全站统一请用默认档 inherit。
    const WL_TINT_LIGHT = "var(--we-surface-tint-light,#ffffff)";
    const WL_TINT_DARK = "var(--we-surface-tint-dark,#0d1524)";
    const WL_FLOOR = "var(--we-readability-floor,.45)";
    const WL_BASE_LIGHT = "var(--we-readability-base,var(--we-surface-tint-light,#ffffff))";
    const WL_BASE_DARK = "var(--we-readability-base,var(--we-surface-tint-dark,#0d1524))";
    const wlWinBg = (tint, base) => "color-mix(in srgb," + base + " calc(" + WL_FLOOR + " * 100%),"
      + "color-mix(in srgb," + tint + " calc(var(--we-settings-window-alpha,.20) * 100% * var(--dshm-alpha-gain,1)),transparent)"
      + " calc((1 - " + WL_FLOOR + ") * 100%))";
    const WL_BG_LIGHT = wlWinBg(WL_TINT_LIGHT, WL_BASE_LIGHT);
    const WL_BG_DARK = wlWinBg(WL_TINT_DARK, WL_BASE_DARK);
    const WL_BF = "blur(var(--we-settings-window-blur,var(--we-blur,16px))) saturate(var(--we-saturate,1.8)) brightness(var(--we-glass-brightness,1.04)) contrast(1.01)";
    const WL_SHEEN_LIGHT = "linear-gradient(180deg,rgba(255,255,255,.10) 0%,rgba(255,255,255,.03) 38%,rgba(255,255,255,.05) 100%)";
    const WL_SHEEN_DARK = "linear-gradient(180deg,rgba(255,255,255,.07) 0%,rgba(255,255,255,.02) 38%,rgba(255,255,255,.03) 100%)";
    const WL_SHADOW = "inset 0 1px 0 rgba(255,255,255,.22),inset 0 0 0 1px rgba(255,255,255,.06),0 24px 80px rgba(0,7,18,.35)";



    // ══════════════════════════════════════════════════════════════════════════
    //  ④i 凝胶按压（r54）：触发按钮「按扁 → 回弹」，配合经典弹簧入场
    //   用户 2026-10-25：「移除现有的两滴分离效果吧，把凝胶按压的效果增加到原有的
    //   经典弹簧动效上」⇒ r52/r53 的两滴分离（液态档、goo 等值线、覆盖层）整段删除，
    //   只保留按钮这一下按压反馈。
    //   · 只对「小按钮（≤480×140、宽 ≥24）触发的近距菜单」生效；提示/hover/slide/
    //     carry（连贯气泡）不按 —— 它们不是「点开一个菜单」的语义。
    //   · 时长跟弹簧 response 同一条时间线（默认 ≈300ms），与面板入场同步感更强。
    //   · reduce-motion / 流式降级（busyNow）直接跳过；连点时同一代按压不叠加。
    //   · 不碰面板几何（面板仍由 ② 的 clip+tf 弹簧负责），也不建任何额外层。
    // ══════════════════════════════════════════════════════════════════════════
    let gelPressCount = 0;

    function gelPress(ae, kind) {
      try {
        if (!ae || !ae.animate || !cfg.on || !cfg.spring) return false;
        if (kind !== KIND_MENU) return false;
        if (reduceOn() || busyNow()) return false;
        const tag = String(ae.tagName || "").toUpperCase();
        if (tag !== "BUTTON" && tag !== "A" && ae.getAttribute("role") !== "button") return false;
        const r = ae.getBoundingClientRect();
        if (r.width > 480 || r.height > 140 || r.width < 24) return false;
        if (ae.hasAttribute("data-dshm-gel")) return false;     // 连点：不叠加
        const dur = Math.round(Math.max(200, Math.min(360, springCurve(cfg.response, cfg.damping, 48).durationMs * 0.7)));
        ae.setAttribute("data-dshm-gel", "");
        const a = ae.animate([
          { transform: "scale(1,1)", offset: 0 },
          { transform: "scale(1.045,.905)", offset: 0.22 },
          { transform: "scale(.978,1.028)", offset: 0.58 },
          { transform: "scale(1,1)", offset: 1 }
        ], { duration: dur, easing: "linear" });
        const done = () => { try { ae.removeAttribute("data-dshm-gel"); } catch (e) { } };
        try { a.onfinish = done; a.oncancel = done; } catch (e) { }
        try { setTimeout(done, dur + 400); } catch (e) { }
        gelPressCount++;
        return true;
      } catch (e) { return false; }
    }

    // ── ⑨b 设置页 UI：样式（r55）────────────────────────────────────────────
    //  参考 dsh-cost-meter「显示」页的版式语言：标题 + 分段页签 + 左预览/右检查器
    //  + 底部折叠的高级设置。全部只吃 DSH 主题 token，暗色/亮色都成立。
    //  ⚠ 这套类名（dshm-set-*）只服务设置页，不匹配任何宿主元素；容器查询挂在 .dshm-set
    //    上（设置窗内容区实测 564px 宽，左右两栏 + 窄屏自动上下堆叠）。
    function settingsCss() {
      return `
.dshm-set{--dshm-set-accent:var(--dsw-alias-state-business-primary,#4d6bfe);--dshm-set-accent-soft:color-mix(in srgb,var(--dshm-set-accent) 14%,transparent);--dshm-set-line:var(--dsw-alias-border-l3,rgba(127,127,127,.22));--dshm-set-line-soft:var(--dsw-alias-border-l1,rgba(127,127,127,.14));--dshm-set-card:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-layer-2,rgba(127,127,127,.08)));--dshm-set-raise:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 78%,transparent);--dshm-set-warn:var(--dsw-alias-state-warning-primary,#f0b232);position:relative;container:dshm-set / inline-size;display:flex;flex-direction:column;color:var(--dsw-alias-label-primary,#f5f6f7);font-size:13px;line-height:1.6;padding:2px 0 8px;-webkit-font-smoothing:antialiased}
.dshm-set *{box-sizing:border-box}
.dshm-set-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;margin:0 0 10px}
.dshm-set-head-main{min-width:0}
.dshm-set-head h3{margin:0 0 4px;font-size:16px;font-weight:600;line-height:1.35;letter-spacing:.01em}
.dshm-set-head p{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary,#cfd3d6);max-width:440px}
.dshm-set-chips{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin:0 0 16px}
.dshm-set-chip{display:inline-flex;align-items:center;gap:5px;height:22px;padding:0 8px;border-radius:7px;border:1px solid var(--dshm-set-line-soft);background:var(--dshm-set-card);color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:11px;line-height:1;white-space:nowrap}
.dshm-set-chip i{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-chip-live i{background:var(--dshm-set-accent);box-shadow:0 0 0 3px var(--dshm-set-accent-soft)}
.dshm-set-chip-warn{color:var(--dshm-set-warn);border-color:color-mix(in srgb,var(--dshm-set-warn) 40%,transparent)}
.dshm-set-banner{display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin:0 0 14px;padding:10px 12px;border-radius:10px;border:1px solid color-mix(in srgb,var(--dshm-set-warn) 42%,transparent);background:color-mix(in srgb,var(--dshm-set-warn) 9%,transparent);font-size:12px;line-height:1.6}
.dshm-set-banner b{display:block;margin:0 0 2px;font-weight:600}
.dshm-set-banner p{margin:0;font-size:11px;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-banner .dshm-set-switch{flex:0 0 auto;gap:8px;justify-content:flex-end}
.dshm-set-toolbar{display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;margin:0 0 12px}
.dshm-set-tabs{display:flex;gap:3px;padding:3px;border-radius:10px;background:var(--dshm-set-card);border:1px solid var(--dshm-set-line-soft)}
.dshm-set-tabs button{appearance:none;-webkit-appearance:none;border:0;border-radius:7px;padding:0 14px;height:28px;background:transparent;color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .16s ease,color .16s ease}
.dshm-set-tabs button:hover{color:var(--dsw-alias-label-primary,#f5f6f7);background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06))}
.dshm-set-tabs button[aria-selected=true]{background:var(--dshm-set-accent-soft);color:var(--dsw-alias-label-primary,#f5f6f7);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dshm-set-accent) 46%,transparent)}
.dshm-set-check{display:inline-flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary,#cfd3d6);cursor:pointer;user-select:none}
.dshm-set-check input{width:14px;height:14px;margin:0;accent-color:var(--dshm-set-accent);cursor:pointer}
.dshm-set-main{display:grid;grid-template-columns:minmax(0,1fr) clamp(196px,36cqi,224px);gap:18px;align-items:start;margin:0 0 2px}
.dshm-set-scene{display:flex;flex-direction:column;gap:10px;min-width:0;padding:12px 12px 10px;border-radius:14px;background:var(--dshm-set-card);border:1px solid var(--dshm-set-line-soft)}
.dshm-set-scene-head{display:flex;align-items:center;justify-content:space-between;gap:10px;font-size:11px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-scene-head b{font-weight:500;font-size:11px;color:var(--dsw-alias-label-secondary,#cfd3d6);letter-spacing:.02em}
.dshm-set-scene-head span{font-variant-numeric:tabular-nums}
.dshm-set-stage{position:relative;height:252px;border-radius:10px;overflow:hidden;display:flex;align-items:center;justify-content:center;background:radial-gradient(130% 90% at 50% -10%,color-mix(in srgb,var(--dshm-set-accent) 18%,transparent),transparent 68%),radial-gradient(90% 70% at 18% 110%,color-mix(in srgb,var(--dshm-set-accent) 8%,transparent),transparent 70%),color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 34%,transparent);box-shadow:inset 0 0 0 1px var(--dshm-set-line-soft)}
.dshm-set-scene-foot{display:flex;align-items:center;gap:8px;flex-wrap:wrap}
.dshm-set-hint{margin-left:auto;text-align:right;font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-btn{display:inline-flex;align-items:center;justify-content:center;gap:5px;height:30px;padding:0 12px;border-radius:8px;border:1px solid var(--dshm-set-line);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 46%,transparent);color:var(--dsw-alias-label-primary,#f5f6f7);font:inherit;font-size:12px;line-height:1;cursor:pointer;transition:background .15s ease,border-color .15s ease}
.dshm-set-btn:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 48%,var(--dshm-set-line))}
.dshm-set-btn:active{transform:translateY(1px)}
.dshm-set-btn:disabled{opacity:.45;cursor:default;transform:none}
.dshm-set-btn-sm{height:26px;padding:0 9px;border-radius:7px;font-size:11px}
.dshm-set-near{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:flex-end;gap:12px;width:100%;height:100%;padding:12px}
.dshm-set-specimen{position:relative;display:flex;align-items:center;justify-content:center;width:264px;max-width:100%;height:104px;border-radius:10px;border:1px dashed color-mix(in srgb,var(--dshm-set-accent) 34%,transparent);cursor:pointer;transition:border-color .16s ease,background .16s ease}
.dshm-set-specimen:hover{border-color:color-mix(in srgb,var(--dshm-set-accent) 66%,transparent);background:var(--dshm-set-accent-soft)}
.dshm-set-spec-tag{position:absolute;right:0;top:-19px;padding:0 6px;border-radius:5px;background:var(--dshm-set-raise);color:var(--dshm-set-accent);font-style:normal;font-size:10px;line-height:16px;white-space:nowrap;box-shadow:0 1px 10px rgba(0,0,0,.16);pointer-events:none}
.dshm-set .dshm-pv.dshm-set-pop{position:relative;display:flex;flex-direction:column;justify-content:center;width:248px;height:88px;max-width:100%;border-radius:18px;overflow:hidden;background-color:var(--dsw-menu-surface-fill,#43454a73);background-image:linear-gradient(180deg,rgba(255,255,255,.06),transparent 46%);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));box-shadow:var(--dsw-elevation-panel,0 14px 40px rgba(0,0,0,.3)),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(20px) saturate(1.5);-webkit-backdrop-filter:blur(20px) saturate(1.5)}
.dshm-set-menu-row{display:flex;align-items:center;justify-content:space-between;gap:8px;height:44px;padding:0 14px;font-size:12px;color:var(--dsw-alias-label-primary,#f5f6f7)}
.dshm-set-menu-row+.dshm-set-menu-row{border-top:1px solid var(--dshm-set-line-soft)}
.dshm-set-menu-row>span{display:flex;align-items:center;gap:7px;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshm-set-menu-row em{flex:none;font-style:normal;font-size:10px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-menu-row svg{flex:none;color:var(--dshm-set-accent)}
.dshm-set-composer{display:flex;flex-direction:column;gap:8px;width:min(100%,310px);padding:9px 11px 8px;border-radius:20px;background:color-mix(in srgb,var(--dsw-specific-input-major,#273a5f) 74%,var(--dsw-menu-surface-fill,#43454a73));border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.22));box-shadow:0 10px 28px rgba(0,0,0,.16),inset 0 1px 0 rgba(255,255,255,.06)}
.dshm-set-composer-line{display:flex;align-items:center;min-height:22px;font-size:12px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-tertiary,#adb2b8))}
.dshm-set-composer-row{display:flex;align-items:center;gap:7px}
.dshm-set-composer-plus{display:grid;place-items:center;flex:none;width:22px;height:22px;border-radius:50%;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.2));color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:14px;line-height:1}
.dshm-set-composer-trigger{display:inline-flex;align-items:center;gap:3px;height:22px;padding:0 8px;border-radius:11px;background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.2));color:var(--dsw-alias-label-secondary,#cfd3d6);font-size:11px;white-space:nowrap}
.dshm-set-composer-trigger u{text-decoration:none;font-size:8px;opacity:.75;transform:translateY(1px)}
.dshm-set-composer-send{display:grid;place-items:center;margin-left:auto;flex:none;width:24px;height:24px;border-radius:50%;background:color-mix(in srgb,var(--dshm-set-accent) 72%,transparent);color:var(--dsw-alias-label-inverse,#fff);font-size:12px;line-height:1}
.dshm-set-far{position:relative;display:flex;align-items:center;justify-content:center;width:100%;height:100%;padding:16px;cursor:pointer}
.dshm-set-far:before{content:"";position:absolute;inset:0;background:radial-gradient(80% 70% at 50% 40%,rgba(0,0,0,.18),rgba(0,0,0,.34));opacity:.85}
.dshm-set-far-dialog{position:relative;display:flex;flex-direction:column;gap:12px;width:min(300px,100%);padding:14px 16px 15px;border-radius:16px;background-color:var(--dsw-menu-surface-fill,#43454a73);background-image:linear-gradient(180deg,rgba(255,255,255,.06),transparent 46%);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));box-shadow:var(--dsw-elevation-panel,0 24px 70px rgba(0,0,0,.4)),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(22px) saturate(1.5);-webkit-backdrop-filter:blur(22px) saturate(1.5)}
.dshm-set-far-title{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:13px;font-weight:600}
.dshm-set-far-x{font-style:normal;font-size:11px;line-height:1;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-far-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:26px;padding-top:9px;border-top:1px solid var(--dshm-set-line-soft);font-size:11px;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-far-row:first-of-type{padding-top:0;border-top:0}
.dshm-set-skel{display:inline-block;height:6px;border-radius:3px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 30%,transparent)}
.dshm-set-skel-pill{width:56px;height:22px;border-radius:11px;background:color-mix(in srgb,var(--dshm-set-accent) 46%,transparent)}
.dshm-set-far-actions{display:flex;justify-content:flex-end;gap:8px;padding-top:2px}
.dshm-set-hover{position:relative;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;width:100%;height:100%;padding:18px}
.dshm-set-hover-bubble{position:relative;display:flex;align-items:center;gap:8px;max-width:100%;padding:8px 12px;border-radius:12px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-primary,#f5f6f7);cursor:pointer;background-color:var(--dsw-menu-surface-fill,#43454a73);background-image:linear-gradient(180deg,rgba(255,255,255,.06),transparent 46%);border:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));box-shadow:var(--dsw-elevation-panel,0 12px 34px rgba(0,0,0,.32)),inset 0 1px 0 rgba(255,255,255,.08);backdrop-filter:blur(18px) saturate(1.5);-webkit-backdrop-filter:blur(18px) saturate(1.5)}
.dshm-set-hover-bubble:after{content:"";position:absolute;left:50%;bottom:-5px;width:9px;height:9px;margin-left:-4.5px;transform:rotate(45deg);background:inherit;border-right:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16));border-bottom:1px solid var(--dsw-alias-border-l3,rgba(255,255,255,.16))}
.dshm-set-hover-dot{flex:none;width:6px;height:6px;border-radius:50%;background:var(--dshm-set-accent);box-shadow:0 0 0 3px var(--dshm-set-accent-soft)}
.dshm-set-hover-bubble em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-hover-target{display:inline-flex;align-items:center;gap:8px;padding:7px 11px;border-radius:9px;border:1px dashed color-mix(in srgb,var(--dshm-set-accent) 52%,transparent);background:color-mix(in srgb,var(--dsw-menu-surface-fill,#43454a73) 62%,transparent);font-size:11px;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-hover-avatar{flex:none;width:18px;height:18px;border-radius:50%;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 28%,transparent)}
.dshm-set-heat{display:grid;grid-template-columns:repeat(13,1fr);gap:4px;width:min(100%,208px);margin-top:-2px}
.dshm-set-heat i{display:block;aspect-ratio:1;border-radius:3px;background:var(--dshm-set-accent)}
.dshm-set-hover-target em{font-style:normal;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-inspector{min-width:0;padding:2px 0 4px 16px;border-left:1px solid var(--dshm-set-line-soft);font-size:12px}
.dshm-set-insp-head{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 10px;font-size:12px;font-weight:600;color:var(--dsw-alias-label-primary,#f5f6f7)}
.dshm-set-insp-head em{font-style:normal;font-weight:400;font-size:10px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-group{display:flex;flex-direction:column;gap:9px;margin:0 0 12px}
.dshm-set-group-h{display:flex;align-items:center;justify-content:space-between;gap:8px;margin:0 0 7px;font-size:11px;font-weight:600;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-group-h em{font-style:normal;font-weight:400;font-size:10px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-divider{height:1px;margin:13px 0;background:var(--dshm-set-line-soft)}
.dshm-set-note{margin:0;font-size:11px;line-height:1.6;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-switch{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:26px;font-size:12px;line-height:1.45;color:var(--dsw-alias-label-primary,#f5f6f7);cursor:pointer;user-select:none}
.dshm-set-switch>span{flex:1;min-width:0}
.dshm-set-switch input{appearance:none;-webkit-appearance:none;position:relative;flex:none;width:34px;height:20px;margin:0;padding:0;border-radius:20px;border:1px solid var(--dsw-alias-border-l2,rgba(127,127,127,.24));background:var(--dsw-alias-bg-layer-3,rgba(127,127,127,.2));cursor:pointer;transition:background .16s ease,border-color .16s ease}
.dshm-set-switch input:before{content:"";position:absolute;top:2px;left:2px;width:14px;height:14px;border-radius:50%;background:var(--dsw-alias-label-secondary,#cfd3d6);transition:transform .16s ease,background .16s ease}
.dshm-set-switch input:checked{background:var(--dshm-set-accent);border-color:color-mix(in srgb,var(--dshm-set-accent) 80%,#fff)}
.dshm-set-switch input:checked:before{background:#fff;transform:translateX(14px)}
.dshm-set-field{display:flex;flex-direction:column;gap:4px;min-width:0}
.dshm-set-field-head{display:flex;align-items:center;justify-content:space-between;gap:8px;font-size:11px;line-height:1.4;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-field-head b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-primary,#f5f6f7)}
.dshm-set-range{appearance:none;-webkit-appearance:none;width:100%;height:18px;margin:0;background:transparent;cursor:pointer}
.dshm-set-range::-webkit-slider-runnable-track{height:4px;border-radius:2px;background:linear-gradient(to right,var(--dshm-set-accent) 0,var(--dshm-set-accent) var(--dshm-set-pct,50%),color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 24%,transparent) var(--dshm-set-pct,50%),color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 24%,transparent) 100%)}
.dshm-set-range::-webkit-slider-thumb{appearance:none;-webkit-appearance:none;width:12px;height:12px;margin-top:-4px;border-radius:50%;background:var(--dsw-alias-label-primary,#fff);border:1px solid color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 45%,transparent);box-shadow:0 1px 4px rgba(0,0,0,.35);transition:transform .12s ease}
.dshm-set-range:hover::-webkit-slider-thumb{transform:scale(1.08)}
.dshm-set-range::-moz-range-track{height:4px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 24%,transparent)}
.dshm-set-range::-moz-range-progress{height:4px;border-radius:2px;background:var(--dshm-set-accent)}
.dshm-set-range::-moz-range-thumb{width:12px;height:12px;border:0;border-radius:50%;background:var(--dsw-alias-label-primary,#fff)}
.dshm-set-selectwrap{position:relative;min-width:0}
.dshm-set-select{width:100%;height:30px;padding:0 26px 0 9px;border-radius:8px;border:1px solid var(--dshm-set-line);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 52%,transparent);color:var(--dsw-alias-label-primary,#f5f6f7);font:inherit;font-size:12px;line-height:1;cursor:pointer;appearance:none;-webkit-appearance:none}
.dshm-set-select option{background:var(--dsw-alias-bg-layer-2,#1a1d24);color:var(--dsw-alias-label-primary,#f5f6f7)}
.dshm-set-selectwrap:after{content:"";position:absolute;right:11px;top:50%;width:6px;height:6px;margin-top:-4px;border-right:1.5px solid var(--dsw-alias-label-secondary,#cfd3d6);border-bottom:1.5px solid var(--dsw-alias-label-secondary,#cfd3d6);transform:rotate(45deg);opacity:.55;pointer-events:none}
.dshm-set-presets{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.dshm-set-preset{display:flex;flex-direction:column;align-items:stretch;gap:4px;padding:5px;border-radius:9px;border:1px solid var(--dshm-set-line);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 40%,transparent);color:var(--dsw-alias-label-secondary,#cfd3d6);font:inherit;font-size:11px;line-height:1.4;cursor:pointer;transition:border-color .15s ease,background .15s ease,color .15s ease}
.dshm-set-preset:hover{background:var(--dsw-alias-interactive-bg-hover,rgba(255,255,255,.06));border-color:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 45%,var(--dshm-set-line))}
.dshm-set-preset[aria-pressed=true]{border-color:var(--dshm-set-accent);background:var(--dshm-set-accent-soft);color:var(--dsw-alias-label-primary,#f5f6f7);box-shadow:inset 0 0 0 1px color-mix(in srgb,var(--dshm-set-accent) 60%,transparent)}
.dshm-set-preset-thumb{position:relative;display:block;height:46px;border-radius:6px;overflow:hidden;background:linear-gradient(165deg,color-mix(in srgb,var(--dsw-alias-bg-layer-3,#ffffff12) 92%,transparent),color-mix(in srgb,var(--dsw-alias-bg-layer-1,#ffffff08) 92%,transparent))}
.dshm-set-preset-thumb i{position:absolute;display:block;height:4px;border-radius:2px;background:color-mix(in srgb,var(--dsw-alias-label-tertiary,#adb2b8) 30%,transparent)}
.dshm-set-preset-thumb i:nth-child(1){left:8px;right:34px;top:8px}
.dshm-set-preset-thumb i:nth-child(2){left:8px;right:18px;top:16px}
.dshm-set-preset-thumb i:nth-child(3){left:50%;bottom:5px;width:40%;height:13px;transform:translateX(-50%);border-radius:7px;background:color-mix(in srgb,var(--dshm-set-accent) 52%,transparent);box-shadow:0 2px 8px rgba(0,0,0,.18)}
.dshm-set-preset[data-p=soft] .dshm-set-preset-thumb i:nth-child(3){width:30%;height:10px;border-radius:5px}
.dshm-set-preset[data-p=bouncy] .dshm-set-preset-thumb i:nth-child(3){bottom:3px;width:46%;height:15px;border-radius:8px}
.dshm-set-preset[data-p=snappy] .dshm-set-preset-thumb i:nth-child(3){width:24%;height:9px;border-radius:5px}
.dshm-set-preset>span:last-child{display:block;text-align:center;white-space:nowrap}
.dshm-set-spec{display:flex;flex-direction:column;margin:0 0 12px;padding:2px 10px;border-radius:9px;border:1px solid var(--dshm-set-line-soft);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 38%,transparent)}
.dshm-set-spec-row{display:flex;align-items:center;justify-content:space-between;gap:10px;min-height:27px;font-size:11px;border-top:1px solid var(--dshm-set-line-soft)}
.dshm-set-spec-row:first-child{border-top:0}
.dshm-set-spec-row span{color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-spec-row b{font-weight:500;font-variant-numeric:tabular-nums;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set-geometry{margin-top:14px;padding:12px 14px 14px;border-radius:12px;border:1px solid var(--dshm-set-line-soft);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 22%,transparent)}
.dshm-set-geometry-head{display:flex;align-items:baseline;justify-content:space-between;gap:10px;flex-wrap:wrap;margin:0 0 10px}
.dshm-set-geometry-head .dshm-set-group-h{margin:0}
.dshm-set-geo-hint{font-size:10px;line-height:1.5;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-geo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:11px 16px;margin-top:12px}
.dshm-set-group-h b{font-weight:600}
.dshm-set-general{margin-top:14px;padding:0 14px;border-radius:12px;border:1px solid var(--dshm-set-line);background:color-mix(in srgb,var(--dsw-alias-bg-base,#0d1524) 26%,transparent)}
.dshm-set-general>summary{display:flex;align-items:center;gap:7px;padding:11px 0;font-size:12px;font-weight:500;color:var(--dsw-alias-label-primary,#f5f6f7);cursor:pointer;list-style:none;user-select:none}
.dshm-set-general>summary::-webkit-details-marker{display:none}
.dshm-set-general>summary:before{content:"";flex:none;width:0;height:0;border-left:5px solid currentColor;border-top:4px solid transparent;border-bottom:4px solid transparent;opacity:.6;transition:transform .16s ease}
.dshm-set-general[open]>summary:before{transform:rotate(90deg)}
.dshm-set-general>summary span{font-weight:400;font-size:11px;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-general-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:11px 18px;padding:2px 0 14px}
.dshm-set-general-grid .dshm-set-switch{min-height:24px}
.dshm-set-general-note{grid-column:1/-1;margin:-2px 0 0;font-size:10px;line-height:1.55;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-actions{display:flex;flex-wrap:wrap;gap:8px;padding:0 0 14px}
.dshm-set-refract{padding:10px 0 2px;border-top:1px solid var(--dshm-set-line-soft)}
.dshm-set-diag{padding:9px 0 11px;border-top:1px solid var(--dshm-set-line-soft);font-size:10px;line-height:1.65;color:var(--dsw-alias-label-tertiary,#adb2b8)}
.dshm-set-diag>summary{display:flex;align-items:center;gap:6px;padding:3px 0;font-size:11px;color:var(--dsw-alias-label-secondary,#cfd3d6);cursor:pointer;list-style:none;user-select:none}
.dshm-set-diag>summary::-webkit-details-marker{display:none}
.dshm-set-diag>summary:before{content:"\\203a";display:inline-block;line-height:1;transition:transform .16s ease}
.dshm-set-diag[open]>summary:before{transform:rotate(90deg)}
.dshm-set-diag p{margin:3px 0 0;word-break:break-word}
.dshm-set-diag b{font-weight:500;color:var(--dsw-alias-label-secondary,#cfd3d6)}
.dshm-set :is(button,select,input):focus-visible,.dshm-set summary:focus-visible{outline:2px solid var(--dshm-set-accent);outline-offset:2px}
@keyframes dshm-set-far-in{from{opacity:0;transform:translate3d(0,60px,0)}to{opacity:1;transform:none}}
@keyframes dshm-set-tip-in{from{opacity:0;transform:translate3d(0,6px,0) scale(.94);clip-path:inset(34% 20% 4% 20% round 12px)}to{opacity:1;transform:none;clip-path:inset(0 0 0 0 round 12px)}}
@keyframes dshm-set-veil-in{from{opacity:0}to{opacity:1}}
html[${ATTR_ON}] .dshm-set-far-dialog[data-play]{animation:dshm-set-far-in var(--dshm-set-dur,280ms) cubic-bezier(.32,.72,0,1) both}
html[${ATTR_ON}] .dshm-set-hover-bubble[data-play]{animation:dshm-set-tip-in var(--dshm-set-dur,204ms) cubic-bezier(.22,1.12,.3,1) both}
@container dshm-set (max-width:540px){
.dshm-set-inspector{padding:14px 0 0;border-left:0;border-top:1px solid var(--dshm-set-line-soft)}
.dshm-set-general-grid{grid-template-columns:minmax(0,1fr)}
.dshm-set-geo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}
}
@container dshm-set (max-width:470px){
.dshm-set-head{flex-direction:column;align-items:stretch;gap:10px}
.dshm-set-head p{max-width:none}
.dshm-set-head>.dshm-set-btn{align-self:flex-start}
.dshm-set-presets{grid-template-columns:repeat(2,minmax(0,1fr))}
.dshm-set-stage{height:236px}
}
@container dshm-set (max-width:360px){
.dshm-set-tabs button{padding:0 10px}
.dshm-set-specimen{height:104px}
.dshm-set-geo-grid{grid-template-columns:minmax(0,1fr)}
}
`;
    }

    function buildCss() {
      const matWindow = cfg.mat === "window";
      const S = springCurve(cfg.response, cfg.damping, 48);
      // ⚠ 几何 = **真实 rect morph**（clip-path inset 从锚点处的小圆长成整块面板），不是 uniform scale。
      //   依据：从 Apple WWDC25 官方演示逐帧提取 —— 文字从不被缩放、圆角独立插值（见
      //   docs/ios26-liquid-glass-motion-research.md §3）。用 clip-path 还有个额外好处：
      //   起始裁剪盒很小 ⇒ **内容天然被延迟显露**，与实测「前 230ms 读不到文字」一致，不需要额外 stagger。
      //   ⚠ 已实测（probes/motion-clip-test.mjs）：clip-path **不会**裁掉元素自身的 backdrop-filter
      //     （圆内玻璃照常、圆外是裸背景）；但**会**裁掉外阴影 —— 靠 fill-mode:backwards
      //     在动画结束后整体撤掉 clip-path，阴影随即回来。阴影「不实时」的问题由代理元素解决（见 ①b）。
      //
      // ⚠⚠ 两条动画、两条不同的缓动（2026-09-13 第四轮定稿，别合并回去）：
      //    · `dshm-glass-tf`（transform）用**带过冲**的弹簧 ⇒ scale/translate 会冲过 1 再弹回来，
      //      这就是用户要的「q 弹」。
      //    · `dshm-glass-clip`（clip-path）用**截顶到 1** 的同一条弹簧。原因：clip 的过冲伸到
      //      盒子外、视觉上什么都没有；但弹簧随后会**欠冲**（<1），那一刻裁剪盒又缩回盒内，
      //      把面板自己的外阴影一闪一闪地露出来。截顶后 clip 单调收拢到 0，不再有这种闪。
      const Sclip = springCurve(cfg.response, cfg.damping, 48, true);
      animDurMs = S.durationMs;   // 预算的兜底释放定时器与面板动画同一条弹簧
      const kf = cfg.spring
        ? "@keyframes dshm-glass-clip{"
        + "from{clip-path:inset(var(--dshm-ci-top) var(--dshm-ci-right) var(--dshm-ci-bottom) var(--dshm-ci-left) round var(--dshm-ci-r0))}"
        + "to{clip-path:inset(0 0 0 0 round var(--dshm-r1))}}"
        + "@keyframes dshm-glass-tf{"
        + "from{transform:translate3d(var(--dshm-dx,0px),var(--dshm-dy,0px),0) scale(var(--dshm-sx,1),var(--dshm-sy,1))}"
        + "to{transform:translate3d(0,0,0) scale(1,1)}}"
        + "@keyframes dshm-glass-fade{from{opacity:0;transform:scale(.96)}to{opacity:1;transform:none}}"
        // ⚠ 阴影代理**没有** CSS 关键帧了（第六轮）：它的动画是逐帧烘焙的 WAAPI 序列，
        //   因为「可见轮廓」是 transform×clip 两条曲线的乘积，一条 CSS 缓动表达不了。
        //   见 shadeKeyframes()。
        : "";   // r29：非 spring 档不再定义死代码 dshm-glass-in —— 规则改走 veil 覆盖，见下方


      let css = "";

      if (cfg.tokens) {
        // 这三个 token 在主题里是**空值** ⇒ 任何 var(--ds-ease-out) 引用都会让整条声明失效。
        css += ":root{--ds-transition-duration-normal:.2s;--ds-ease-out:cubic-bezier(.16,1,.3,1);--ds-ease-in:cubic-bezier(.4,0,1,1)}";
      }

      // ── ⓵ 远距弹窗：面板浮出（纯位移，不淡入淡出）──
      //
      // ⚠⚠ 三条血泪约束（2026-09-13 实机翻车后定稿，改之前先读完）
      //  ① 绝不给定为祖先的 overlay 加任何动画。设置窗的面板带 backdrop-filter
      //     （wallpaper 的玻璃），而它的祖先 [role="presentation"] 就是遮罩层；
      //     给祖先加 opacity/transform 动画会让它成为 **Backdrop Root**，
      //     面板的 backdrop-filter 随即采不到背景 ⇒ 整片玻璃消失。
      //  ② 用 `backwards`，不要用 `both`/`forwards`。both/forwards 让动画**永远处于
      //     「在效」状态**，transform 一直挂在元素上，包含块被永久固化。
      //  ③ 不用 `:has()`。后代匹配的 :has() 在每次 DOM 变更时都要重算，流式会话下
      //     代价极高。这里用结构选择器 [role="presentation"] > [role="dialog"]。
      // 整条包 :where() ⇒ 特异性 0 ⇒ 第三方弹窗自带动效都能盖过我们。
      // 运动规格照抄 fish-term（components/GuideOverlay.ets）：cubic-bezier(.32,.72,0,1)、
      // translateY(60px)、280ms，**没有 scale**。
      css += "@keyframes dshm-veil-in{from{opacity:0}to{opacity:1}}";
      css += "@keyframes dshm-far-in{from{transform:translateY(60px)}to{transform:none}}";
      css += ":where(html[" + ATTR_FAR + "] [role=\"presentation\"] > [role=\"dialog\"])"
        + "{animation:dshm-far-in .28s var(--dshm-ease,cubic-bezier(.32,.72,0,1)) backwards}";
      // r34：宿主也有「直挂 body 的 [role=dialog][aria-modal]」（提示词增强、确认框等，没有
      // [role=presentation] 遮罩父层），此前完全没有入场动画（硬弹）⇒ 用户说弹窗质感没被统一。
      css += ":where(html[" + ATTR_FAR + "] :is([role=\"dialog\"][aria-modal=\"true\"], dialog:modal):not([data-dshm-zoom]))"
        + "{animation:dshm-far-in .28s var(--dshm-ease,cubic-bezier(.32,.72,0,1)) backwards}";
      // ⚠ 设置面板是 800×800 + wallpaper 的 backdrop-filter + 一整个重子树，位移它会拖垮帧率。
      //   实测（6 轮 × 每次开窗，关掉侧栏 dot 动画以隔离，probes/motion-settings-perf.mjs）：
      //     完全不动画 45fps / 现状 translateY(60) 280ms 11fps / 只动 opacity 18fps
      //     / +contain:paint 21fps / +面板去模糊 24fps / 位移缩到 16px 20fps
      //   ⇒ contain:paint 是唯一「零观感代价」的有效手段：把重绘限制在 dialog 内部、不往外逃逸。
      //   ⚠ 它同时会把溢出 dialog 盒子的后代裁掉 ⇒ **只在动画进行的那 280ms 内开启**，
      //     由 animationstart / animationend 驱动 html[data-dshm-anim]（见 mount，含 420ms 兜底）。
      //   ⚠ fish-term 那边不卡不是因为它做对了什么：它的设置面板是**不透明纯色**
      //     （backgroundColor: bgSurface）+ 系统原生 bindSheet(CenterType)，由窗口合成器合成，
      //     压根不花 Web 渲染器的钱。DSH 这块是实时毛玻璃 + 重子树，能做的是**把重绘范围关小**。
      css += "html[" + ATTR_ANIM + "] :where([role=\"presentation\"] > [role=\"dialog\"]){contain:paint}";

      // ── ⓵b 设置窗的「页面外背景遮罩」：用户 2026-09-13 要求移除 ──
      //   实测（probes/motion-settings-scrim.mjs）那层遮罩**不是**设置面板自己的 box-shadow，
      //   而是 shell 画的兄弟节点 `div.VOzbGW_mask`：`background:rgba(0,0,0,.24)`
      //   + `backdrop-filter:blur(2px)`，铺满整个视口（1600×913、cover=1），只在设置窗打开时存在：
      //     [role=presentation].VOzbGW_overlay
      //       ├ div.VOzbGW_mask     ← 就是它
      //       └ div.VOzbGW_panel[role=dialog]
      //   ⚠ 面板自己那圈 `0 24px 80px rgba(0,7,18,.35)`（wallpaper 玻璃配方的一部分）**没动**。
      //   选择器：结构（presentation 浮层里带 `_mask` 的直系子节点）双重限定；
      //   任一条件失配 ⇒ 只是遮罩回来，不会误伤别的元素。
      css += "html[" + ATTR_ON + "] [role=\"presentation\"]:has(> [role=\"dialog\"] [data-slot=\"settings.section\"])"
        + " > [class*=\"_mask\"]{background-color:transparent!important;background-image:none!important;"
        + "-webkit-backdrop-filter:none!important;backdrop-filter:none!important}";

      // ── ⓶ 近距弹窗：玻璃 + 弹簧 ──
      css += "html[" + ATTR_ON + "]{--dshm-ease:cubic-bezier(.32,.72,0,1);--dshm-alpha-gain:" + (+cfg.alphaGain || 1)
        + ";--dshm-from:" + (+cfg.from || 0.86) + "}";
      css += "html[" + ATTR_ON + "]{--dshm-glass-tint:250 251 253}";
      css += "html[" + ATTR_ON + "] body[data-ds-dark-theme]{--dshm-glass-tint:22 26 34}";

      if (matWindow) {
        // 材质 = wallpaper「设置窗口」的配方原样（含高光/内描边/扩散阴影），只把选择器换成我们的标记。
        // ⚠ 2026-10-21：去掉 NOT_COVERED —— r23 的 window 档 100% 命中自己的否定名单
        //   （近距族全带 role / data-trigger-menu / *-tip），那条规则**从未生效过**，
        //   用户看到的仍是 inherit 那杯玻璃。这一档要成立就必须真的压过 glass-patch ❷
        //   （其规则无 !important，所以这里的 !important 稳赢）。
        css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "]{"
          + "background-color:" + WL_BG_LIGHT + "!important;"
          + "background-image:" + WL_SHEEN_LIGHT + "!important;"
          + "-webkit-backdrop-filter:" + WL_BF + "!important;"
          + "backdrop-filter:" + WL_BF + "!important;"
          + "box-shadow:" + WL_SHADOW + "!important}";
        css += "html[" + ATTR_ON + "] body[data-ds-dark-theme] [" + ATTR_MARK + "]{"
          + "background-color:" + WL_BG_DARK + "!important;"
          + "background-image:" + WL_SHEEN_DARK + "!important}";
      }

      css += kf;

      // ── ⓷ 材质补齐（第八轮）：让「没有毛玻璃」的浮层与模型选择器逐字段同源 ──
      //   配方照抄 `dsh-glass-patch` 给菜单那一档（**同一批 token**），所以两处永远同源：
      //     backdrop-filter: blur(var(--dsp-blur)) saturate(var(--dsp-sat)) brightness(var(--dsp-bright))
      //   取值全部带兜底（`--we-*` → 硬默认），补丁不在场时也不会退化成空声明。
      //   ⚠ 只对**已被认定为近距浮层**的元素生效（`[data-dshm-glass]`），不会外溢到别处。
      if (cfg.mat === "inherit") {
        const GLASS_BF = "blur(var(--dsp-blur,var(--we-blur,16px)))"
          + " saturate(var(--dsp-sat,var(--we-saturate,1.8)))"
          + " brightness(var(--dsp-bright,var(--we-glass-brightness,1.04)))";
        // ── ⓷b 祖先 Backdrop Root 的解锁（第九轮）────────────────────────────────
        //   把祖先的 backdrop-filter 搬到它的 ::before 上 —— 伪元素不是任何元素的**祖先**，
        //   所以「玻璃照旧、root 消失」，被它关住的后代重新采得到页面。
        //   实测见 probes/motion-slash-blur-diag.mjs：命令面板的祖先 `uV2eYG_card` 带
        //   backdrop-filter ⇒ 面板自己的毛玻璃空转（开/关 MAE 0.8、条纹原样）；
        //   把祖先的 bf 关掉后才真正模糊（MAE 113）。
        css += "html[" + ATTR_ON + "] [data-dshm-noroot]{"
          + "-webkit-backdrop-filter:none!important;backdrop-filter:none!important}";
        css += "html[" + ATTR_ON + "] [data-dshm-noroot]::before{"
          + "content:'';position:absolute;inset:0;border-radius:inherit;pointer-events:none;z-index:-1;"
          + "-webkit-backdrop-filter:var(--dshm-anc-bf)!important;backdrop-filter:var(--dshm-anc-bf)!important}";
        css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-nobf]{"
          + "-webkit-backdrop-filter:" + GLASS_BF + "!important;backdrop-filter:" + GLASS_BF + "!important}";
        if (cfg.unifySolid) {
          // 不透明底（如会话顶部子代理树 / 后台任务菜单）⇒ 换成菜单那杯玻璃：
          // 同一个底色 token + 同一条毛玻璃。不加这条「背景没有模糊」就永远修不好
          // —— 底不透明时毛玻璃再强也看不见。
          // ⚠ 2026-10-21：去掉 NOT_COVERED —— `-solid` 的用途就是给「不透明底的浮层」换玻璃，
          //   而这类浮层恰恰多是 role=button / role=tree（带 role）⇒ 旧规则带 :not([role])
          //   等于把它变成**死属性**（属性挂上了、规则永不命中）。只在标记已有该属性时生效。
          css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-solid]{"
            + "background-color:var(--dsw-specific-menu,var(--dsw-alias-bg-layer-3))!important;"
            + "background-image:none!important;"
            + "-webkit-backdrop-filter:" + GLASS_BF + "!important;backdrop-filter:" + GLASS_BF + "!important}";
          // ── r19 撤掉：body 直系 role=button 预览卡的强制透明 ──
          //   round12 按当时要求加的纯透明（用户 2026-09-14 原话），r19 用户报
          //   「点击出现的上下文小窗、对话条目悬浮预览纯透明、没有统一玻璃」——
          //   就是这一条命中的（body 直接 portal + role=button + 被形状路径打标）。
          //   现在改回统一：这类卡走 glass-patch ❷ 的 [data-dshm-glass] 收敛
          //   （composer 同款 token/渐变/bf/阴影）。入场动画（HOVERQ/TIP 配速）
          //   与 veil 不受影响。如需恢复纯透明，把下面这块加回来即可。
          //   （规则已删除，注释保留为还原指引。）
        }
      }
      // 缓动优先用 linear() 弹簧（合成器逐帧求值，任意刷新率都连续）；
      // 老引擎不认 linear() 时整条 animation 会失效，所以先给一条 cubic-bezier 版本兜底。
      //
      // ⚠ `will-change:transform` 不是可有可无的装饰：实测（headless 软光栅、4 轮 ×184 帧）
      //   没有它时入场期间会出现 5 帧 >50ms（最大 133ms）；加上之后 >50ms 归零、
      //   最大 33ms、平均帧 19.7→17.6ms —— 效果等同于「根本不播动画」。原因是
      //   backdrop-filter 元素在动画开始时才被提升为合成层，第一帧的栅格化正好砸在
      //   动画最贵的位置上。它随 [data-dshm-glass] 出现/消失，弹窗关掉即随之回收。
      //   代价：transform 会成为 fixed 后代的包含块 —— 实测被标记的弹窗内没有任何
      //   position:fixed 后代（子菜单是独立 portal），见 probes/motion-unify-verify.mjs。
      const animClip = "dshm-glass-clip " + S.durationMs + "ms ";
      const animTf = "dshm-glass-tf " + S.durationMs + "ms ";
      const both = (e1, e2) => "animation:" + animClip + e1 + " backwards," + animTf + e2 + " backwards";
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "]{transform-origin:var(--dshm-origin,50% 100%);"
        + "will-change:transform,clip-path;" + both("cubic-bezier(.32,.72,0,1)", "cubic-bezier(.22,1.12,.3,1)") + "}";
      css += "@supports (animation-timing-function:linear(0,1)){"
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "]{" + both(Sclip.easing, S.easing) + "}}";
      // ── r51：角形状统一 ──
      //   宿主全局 `corner-shape: superellipse(1.5)`（比正圆更「方」的超椭圆角，Chrome 新特性）。
      //   dsh-motion 的 clip-path 只能用圆形圆角：动画期间角是圆的，动画结束 clip 移除后
      //   角落回超椭圆 ⇒ 用户看到「四个角突变 / 像被裁过」。这里把被接管的浮层统一成
      //   `corner-shape: round`，动画期与结束后的角形状完全一致；半径仍由 border-radius 决定。
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "],"
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "]::before,"
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "]::after{corner-shape:round!important}";
      // bubble=0 或行内 transform 定位 ⇒ 没有起始裁剪盒，退回「淡入 + 轻微放大」
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-nomorph]{"
        + "animation:dshm-glass-fade " + S.durationMs + "ms linear backwards}";
      // 无锚点（bubble 为 null）：没有起始裁剪盒 ⇒ 只发 tf（缩放/位移），不发无效 clip。
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-noclip]{"
        + "animation:dshm-glass-tf " + S.durationMs + "ms cubic-bezier(.22,1.12,.3,1) backwards}";
      css += "@supports (animation-timing-function:linear(0,1)){"
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-noclip]{"
        + "animation:dshm-glass-tf " + S.durationMs + "ms " + S.easing + " backwards}}";

      // ── ⓶b 悬浮提示（role=tooltip）：同一条弹簧解析式的**短档** ──
      //   为什么不能跟菜单同一时长：菜单是「点开、留着看」，提示是「手一过就出现、手一移就走」。
      //   438ms 的过冲弹簧落在 88×26 的小气泡上又慢又黏，而且指针一移开动画还没播完。
      //   这里换成 response 150ms / ζ=1.0（无过冲，约 200ms），几何仍是同一套
      //   clip-path rect morph + 位移 + 扭曲 —— 所以是「同一个效果，按元素尺度配速」。
      //   ⚠ 必须排在基础规则与 `@supports` 之后：特异性高一层（多一个 [data-dshm-kind]），
      //     同特异性时也必须靠后者胜出。
      const tipPair = springPair(KIND_TIP);
      const Sc = springCurve(tipPair.resp, tipPair.zeta, 48);
      const ScClip = springCurve(tipPair.resp, tipPair.zeta, 48, true);
      const TIPQ = "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-kind=\"" + KIND_TIP + "\"]:not([data-dshm-nomorph])";
      if (cfg.tips) {
        const tipRule = (e1, e2) => TIPQ + "{animation:"
          + "dshm-glass-clip " + Sc.durationMs + "ms " + e1 + " backwards,"
          + "dshm-glass-tf " + Sc.durationMs + "ms " + e2 + " backwards}";
        css += tipRule("cubic-bezier(.32,.72,0,1)", "cubic-bezier(.22,1.12,.3,1)");
        css += "@supports (animation-timing-function:linear(0,1)){" + tipRule(ScClip.easing, Sc.easing) + "}";
      } else {
        // 「关掉悬浮提示」时，提示不能只是掉回 `[data-dshm-glass]` 的菜单档 —— 那就等于没关。
        css += TIPQ + "{animation:none}";
      }

      // ── ⓶c 悬浮预览卡（body 直系 role=button，如会话行 hover 卡）：提示级配速 ──
      //   用户 2026-09-14：「navbar 悬浮预览窗动效特别卡顿」。归因（probes/glass-round12b.mjs C）：
      //   开/关 motion 入场都有同一个 67ms 顿挫（官方 hover 内容挂载，非我们），而 438ms 的
      //   菜单弹簧把入场窗口 p95 拉到 ~50ms（软光栅；hover 反馈本就该 <200ms，提示档同理）。
      //   几何仍是同一套 morph，只换短弹簧（Sc 复用提示档的 response 150/ζ 1.0）。
      //   放 TIPQ 之后：与透明材质规则同选择器，不同声明互不干扰。
      const HOVERQ = "html[" + ATTR_ON + "] body > [" + ATTR_MARK + "][data-dshm-kind=\"" + KIND_MENU + "\"][role=\"button\"]:not([data-dshm-nomorph])";
      const hoverRule = (e1, e2) => HOVERQ + "{animation:"
        + "dshm-glass-clip " + Sc.durationMs + "ms " + e1 + " backwards,"
        + "dshm-glass-tf " + Sc.durationMs + "ms " + e2 + " backwards}";
      css += hoverRule("cubic-bezier(.32,.72,0,1)", "cubic-bezier(.22,1.12,.3,1)");
      css += "@supports (animation-timing-function:linear(0,1)){" + hoverRule(ScClip.easing, Sc.easing) + "}";
      css += "html[" + ATTR_ON + "] body > [" + ATTR_MARK + "][data-dshm-kind=\"" + KIND_MENU + "\"][role=\"button\"][data-dshm-nomorph]{animation:dshm-glass-fade " + Sc.durationMs + "ms linear backwards}";

      // ── ⓶d 斜杠菜单：设置窗同款上下滑入（用户 2026-09-14 点名，非液态弹入）──
      //   几何逐字照抄远距那条（translateY(60px)→none，.28s，同缓动，同 backwards）。
      //   判定在 mark()（data-dshm-slide：trigger-menu 外壳且无 role，模型菜单有 role 不受影响）。
      //   放 HOVERQ 之后：特异性（2 属性）高于基础弹簧规则，靠选择器胜出，无需 !important。
      //   幽灵同样命中本条，但 ⓸ 的 animation:none!important 在后面压住 + WAAPI 接管退场。
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-slide]:not([data-dshm-nomorph])"
        + "{animation:dshm-far-in .28s var(--dshm-ease,cubic-bezier(.32,.72,0,1)) backwards}";
      // ── ⓶d-b 菜单沉底（用户 2026-09-14：「斜杠菜单要在输入框的更底一层，不能覆盖输入框」）──
      //   背景：far-in 从 +60px 下方升起，终点底边离卡片顶只有约 11px ⇒ 入场全程扫过输入框脸上
      //   （morph 时代是原位长大，从不盖输入框）。用户要的是「从输入框后面抽出来」。
      //   做法：卡片子树里的滑入面 z-index:-1。卡片自己是 stacking context（relative + bf），
      //   菜单是它的后代（overlay 槽在卡片内，真机 forensics + headless 双重确认）⇒ 负 z 只在
      //   卡片内生效：卡片底（透明膜）下、菜单中、卡片内容（按钮/文字）上。不重叠时零视觉差；
      //   滑入/退场扫过输入框时被输入框压住 = 从后面抽出来。
      //   ⚠ 只压卡片子树这一层（body 直系的兜底幽灵不受影响，否则会沉到全页底下去）。
      //   ⚠ !important：定位库常写行内 z-index，不压住等于没写。卡片 overflow:visible 已实测，
      //   不裁菜单；elementFromPoint 实测：重叠点从 MENU 变成按钮自己的图标（菜单沉下去了），
      //   非重叠区菜单仍可命中（没被卡片底吞掉）。
      css += "html[" + ATTR_ON + "] [data-composer-card] [" + ATTR_MARK + "][data-dshm-slide]{z-index:-1!important}";

      // ── ⓶e composer 附件缩略图 hover（r32 P1，纯 CSS 无 JS）────────────────────
      //   用户 m01292「动效 p1 也要做」：composer 草稿图缩略图原来只有 cursor 反馈。
      //   只动 transform（合成器层）+ 极短时长，不碰布局；hover 抬 2px + 图内轻微放大，
      //   按下回弹 0.97。`@media (hover:hover)` 排除触屏粘滞 hover；
      //   `prefers-reduced-motion: no-preference` 时才有动效（reduce 用户要点就变，不播）。
      //   ⚠ 宿主缩略图本身没有 transform/transition，这里补的是缺省反馈，不是覆盖宿主。
      // r38：宿主 _tabCell_ 自带 transition: transform .3s，与右栏两段动画叠加会像「动两次」
      css += "html[data-dshm-rsb-anim] [class*='_tabCell_']{transition-duration:0ms!important}";
      // r44：视觉盖的样式表保险（属性在 <html> 上，React 重渲染/重挂面板都压得住）
      css += "html[data-dshm-rsb-cover] [data-sidebar-right-panel],html[data-dshm-rsb-cover] [class*='rightbarCol']{visibility:hidden!important}";
      const THUMBQ = "html[" + ATTR_ON + "] [data-composer-card] button[class*='_thumbnail']";
      css += THUMBQ + "{transition:transform .18s cubic-bezier(.2,.8,.2,1)}";
      css += THUMBQ + " img{transition:transform .22s cubic-bezier(.2,.8,.2,1)}";
      css += "@media (hover:hover) and (prefers-reduced-motion: no-preference){"
        + THUMBQ + ":hover{transform:translateY(-2px)}"
        + THUMBQ + ":hover img{transform:scale(1.05)}"
        + "}";
      css += "@media (prefers-reduced-motion: no-preference){"
        + THUMBQ + ":active{transform:scale(.97);transition-duration:.08s}"
        + "}";

      // ── ⓾ 诊断高亮（r20，用户侧判据：设置页开关，默认关）──────────────
      //   红 = 被认定为浮层（打标）；绿 = 正在被收窄（max-width/translate 生效中）。
      //   outline 不占布局、不触发重排；观察器只盯 childList，属性变化不惊动它。
      //   幽灵也带 mark ⇒ 退场那一瞬会闪一下红框，属预期（正好能看见退场）。
      css += "html[" + ATTR_DBG + "] [" + ATTR_MARK + "]{outline:2px solid rgba(255,60,60,.9)!important;outline-offset:-2px}"
        + "html[" + ATTR_DBG + "] [data-dshm-clamped]{outline:2px solid rgba(0,200,60,.95)!important;outline-offset:-2px}";

      // ── ⓸ 消失幽灵：把「出现态」逐属性搬过来（第十七轮）───────────────────────────
      //   克隆现在保留全部属性（含 data-dshm-glass / -nobf / -solid / -kind），代价是
      //   入场那条 [data-dshm-glass]{animation:…} 会**也命中幽灵**，于是幽灵在退场 WAAPI
      //   之下再叠一条 438ms 入场弹簧（CSS 动画 vs WAAPI：WAAPI 在合成顺序上赢，
      //   但 transform-origin/起点帧仍会被扰动）。
      //   ⇒ 显式点掉幽灵的 CSS 动画，顺手把合成提示**钉死成与出现态相同** ——
      //     这正是「收起瞬间材质不能变」的构造性保证：will-change 一致 ⇒ 合成层一致
      //     ⇒ backdrop-filter 采样路径一致。!important 能压过 [data-dshm-kind="tip"]
      //     那几条更高特异性的规则（important 比特异性优先）。
      css += "html[" + ATTR_ON + "] [data-dshm-exit]{animation:none!important;will-change:transform,clip-path!important;pointer-events:none!important}";

      // ── 非弹簧档（cfg.spring=false）：短促淡入，不留硬切（r29）───────────────
      //  基础/提示/hover/nomorph 规则引用的 dshm-glass-clip / -tf 只在 spring 档定义；
      //  不覆盖的话关掉「Q弹弹簧入场」= 一条无效动画 = 硬切（审计实测 getAnimations().length=0）。
      //  用纯 opacity 的 veil-in（不带 transform）：顺带避开 nomorph 档 438ms 超预算与
      //   fade 关键帧的 transform 覆盖行内定位两个老问题。
      //  ⚠ !important 压过 TIPQ/HOVERQ/slide 的高特异性规则；reduce/cheap/noanim 块更靠后，
      //    仍在 reduce 下按各自优先级覆盖本条。
      if (!cfg.spring) css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "]"
        + "{animation:dshm-veil-in .16s cubic-bezier(.2,.8,.2,1) backwards!important}";

      // ── 无障碍降级：位移与弹簧一律让路，只留极短淡入 ──
      //   ⚠⚠ 2026-09-13 用户报「扭曲参数、附加缩放效果修改无效」时**实测证实**的一环：
      //     `prefers-reduced-motion: reduce` 命中时整条几何动画被换掉（animation 列表为空），
      //     而**材质是静态 CSS、照常生效** ⇒ 现场看起来正是「材质能变、几何参数全都不动」。
      //     Windows/鸿蒙的「减少动画效果」开关就是这条媒体查询。所以：
      //       · 设置页会**实时显示**这个状态并给出覆盖开关（forceMotion）；
      //       · forceMotion 打开时**整块不发射** —— 没有别的手段能取消一条媒体查询。
      if (!cfg.forceMotion) css += "@media (prefers-reduced-motion:reduce){"
        // ⚠ r29 修：必须 !important。提示/悬浮卡/斜杠/noclip 的源规则特异性都更高
        //   （TIPQ 0,4,1；HOVERQ 0,5,2；slide 0,4,1），旧写法不带 important ⇒ 它们全部照跑
        //   弹簧/滑入（审计实测 reduce 下 tip/hover 仍 204ms clip+tf、slide 仍 280ms、noclip 仍 438ms）。
        //   !important 比特异性优先，一条即可覆盖全族，不必逐条对齐 :not()。
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "]{animation:dshm-veil-in .12s linear backwards!important}"
        // 鬼影靠 WAAPI 退场，CSS 动画必须继续为 none（否则会被上面那条 important 打开）。
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-exit]{animation:none!important}"
        + ":where(html[" + ATTR_FAR + "] [role=\"presentation\"] > [role=\"dialog\"]){animation:none!important}"
        + ":where(html[" + ATTR_FAR + "] :is([role=\"dialog\"][aria-modal=\"true\"]):not([data-dshm-zoom])){animation:none!important}}";

      // ── ⑨ 设置页里的「重播预览」──────────────────────────────────────────────
      //   为什么要它：弹簧是**前重**的 —— ζ=0.58 / response 280 时 e(t) 在 t=100ms 就走完
      //   88%（实测：t=0 起手 scale 0.666，t=100ms 已到 0.961）⇒ warp / from / lift / 气泡
      //   这几个**几何**旋钮的全部可见动作只有约 6 帧；而材质是静态 CSS，改一下就看得见。
      //   于是「拖滑杆看不出区别」≈「参数改了没反应」。预览把同一套几何就地重播，
      //   并且可 4× 慢放、拖滑杆自动重播。
      //   ⚠ 刻意用**独立的动画名** dshm-pv-*：全局 animationstart 钩子（远距 contain:paint、
      //     阴影代理）只认 dshm-far-in / dshm-glass-clip，看不见预览，零耦合。
      if (cfg.spring) {
        const pvAnim = (e1, e2) => "animation:dshm-pv-clip var(--dshm-pv-dur,438ms) " + e1
          + " backwards,dshm-pv-tf var(--dshm-pv-dur,438ms) " + e2 + " backwards;will-change:transform,clip-path";
        css += "@keyframes dshm-pv-clip{"
          + "from{clip-path:inset(var(--dshm-pv-ct,0px) var(--dshm-pv-cr,0px) var(--dshm-pv-cb,0px) var(--dshm-pv-cl,0px) round var(--dshm-pv-r0,17px))}"
          + "to{clip-path:inset(0 0 0 0 round var(--dshm-pv-r1,20px))}}"
          + "@keyframes dshm-pv-tf{"
          + "from{transform:translate3d(0,var(--dshm-pv-dy,0px),0) scale(var(--dshm-pv-sx,1),var(--dshm-pv-sy,1))}"
          + "to{transform:none}}";
        css += "html[" + ATTR_ON + "] .dshm-pv{position:relative;overflow:hidden;border-radius:20px;"
          + "background:var(--dsw-alias-bg-layer-3,color-mix(in srgb,#888888 22%,transparent));"
          + "box-shadow:inset 0 0 0 1px var(--dsw-alias-border-l2,rgba(127,127,127,.30))}";
        css += "html[" + ATTR_ON + "] .dshm-pv[data-play]{"
          + pvAnim("cubic-bezier(.32,.72,0,1)", "cubic-bezier(.22,1.12,.3,1)") + "}";
        css += "@supports (animation-timing-function:linear(0,1)){"
          + "html[" + ATTR_ON + "] .dshm-pv[data-play]{" + pvAnim(Sclip.easing, S.easing) + "}}";
        // ⚠ 预览必须**照着真机演**：reduce 命中而用户没覆盖时，真机只有一个 120ms 淡入，
        //   预览也就不许动 —— 否则「预览里很弹、实机一动不动」比没有预览更误导人。
        //   放在预览规则**之后**且特异性相同（html[data-dshm] .dshm-pv[data-play]），
        //   靠后来居上胜出；顺序反过来会被预览规则盖掉。
        if (!cfg.forceMotion) css += "@media (prefers-reduced-motion:reduce){"
          + "html[" + ATTR_ON + "] .dshm-pv[data-play]{animation:none}}";
      }

      // ── 并行动画预算的降级档（2026-10-21）──────────────────────────────
      //  放在最后：!important 才能压过前面所有 [data-dshm-glass] / 提示档 / reduce 规则。
      //  cheap = 超预算：只动 opacity（合成器），不跑 clip/tf、不建阴影代理；
      //  none  = 视口外/后台标签：直接终态，零动画。
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-cheap]"
        + "{animation:dshm-veil-in .16s linear backwards!important;will-change:opacity!important}";
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][data-dshm-noanim]"
        + "{animation:none!important;will-change:auto!important}";

      // ── 悬浮预览卡换行：连贯气泡（r27）──────────────────────────────────
      //  官方 navbar 预览是**同一元素**：换 bar 时内容即换、位置用 top 过渡滑过去，
      //  dsh-motion 只在它出现/消失时播液态。会话行每行一个独立 HoverCard 元素，做不到
      //  「同一元素」，于是换行时让新卡从旧卡的位置/尺寸起步（mark() 里写 --dshm-dx/-dy/
      //  -sx/-sy），这里只发 `dshm-glass-tf` 一条 180ms 的纯合成器位移+缩放：
      //  ⇒ 视觉上就是一个气泡从旧行连贯地滑/长到新行，没有「上一个缩小消失」。
      //  ⚠ !important：必须压过基础规则（clip+tf 两条）与 @supports 的 linear() 版本。
      //  ⚠ 材质/描边/阴影仍由 [data-dshm-glass] 的静态规则提供（进入时已打标），动画结束
      //    只摘 carry 属性、不回退任何材质。
      //  过渡时长/缓动逐字对齐官方 navbar 的 `top .14s cubic-bezier(.2,.8,.2,1)`
      //  （只平移、不缩放 —— 缩放会把文字压扁，用户说「抽出不得体」）。
      css += "html[" + ATTR_ON + "] [" + ATTR_MARK + "][" + CARRY_ATTR + "]{"
        + "animation:dshm-glass-tf .14s cubic-bezier(.2,.8,.2,1) backwards!important;"
        + "will-change:transform!important}";
      // 无障碍：系统「减少动效」且用户没强制覆盖时，换行也不做动画（瞬时到位）。
      if (!cfg.forceMotion) css += "@media (prefers-reduced-motion:reduce){"
        + "html[" + ATTR_ON + "] [" + ATTR_MARK + "][" + CARRY_ATTR + "]{animation:none!important;will-change:auto!important}}";

      // ── 同一元素的气泡移格（r28）：上下文洞察 hovertip ──────────────────────
      //  宿主 dsh-context 的悬浮提示是**全页一个元素**（body 直系 #lc-hovertip-bubble，
      //  role=tooltip，行内 left/top 由 React 直接改），结构上就等价于官方 navbar 预览
      //  （同一个元素、内容即换），但它的 CSS 只给 opacity 过渡、没有位置过渡 ⇒ 瞬跳。
      //  这里把 navbar 的原配方 `top .14s cubic-bezier(.2,.8,.2,1)` 原样挪过来（left+top），
      //  opacity 仍用它自己那条（同一组 token，不改变出现/消失的观感）。
      //  跨 3px 间隙导致的「卸载再挂」由 tipCarryGeo() 的 carry 接手（见 mark()）。
      //  ⚠ 只对**已落位**的气泡生效（[data-dshm-tipglide] 由 armTipGlide 延迟打上）：
      //    宿主挂载时先渲染 left:0/top:0 再切真实位置，若挂载期就有这条过渡，
      //    气泡会从视口左上角「飞」过来（实测过）。
      //  ⚠ 选择器用宿主稳定 id + 普通类名（lc-* 不是 CSS module 哈希）。
      const TIPGLIDE = "html[" + ATTR_ON + "] #lc-hovertip-bubble[" + TIPGLIDE_ATTR + "]"
        + ",html[" + ATTR_ON + "] .lc-hovertip[" + TIPGLIDE_ATTR + "]";
      css += TIPGLIDE + "{transition:left .14s cubic-bezier(.2,.8,.2,1),"
        + "top .14s cubic-bezier(.2,.8,.2,1),"
        + "opacity var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)}";
      // 无障碍：系统要求减少动效时位置直接到位（只留宿主自己的 opacity 过渡）。
      if (!cfg.forceMotion) css += "@media (prefers-reduced-motion:reduce){"
        + TIPGLIDE + "{transition:opacity var(--ds-transition-duration,.2s) var(--ds-ease-in-out,ease-in-out)}}";

      // ── ⑨b 设置页 UI + 预览动画（r55）──────────────────────────────────────
      //   版式参考 dsh-cost-meter「显示」页：标题→分段页签→左预览/右检查器→底部折叠。
      //   样式本身与 cfg 无关（唯一动态位是「弹簧关掉 / reduce 命中」时预览要同口径降级）。
      css += settingsCss();
      // 弹簧关掉时真机走 160ms 淡入（r29）⇒ 预览不许还在演 438ms 弹簧，否则误导。
      if (!cfg.spring) css += "html[" + ATTR_ON + "] .dshm-set-stage .dshm-pv[data-play]{animation:dshm-set-veil-in .16s cubic-bezier(.2,.8,.2,1) both!important;will-change:opacity!important}";
      // 无障碍：系统要求减少动效且用户没强制覆盖 ⇒ 预览与真机一样只做极短淡入 / 不动。
      if (!cfg.forceMotion) css += "@media (prefers-reduced-motion:reduce){"
        + "html[" + ATTR_ON + "] .dshm-set-far-dialog[data-play],"
        + "html[" + ATTR_ON + "] .dshm-set-hover-bubble[data-play]{animation:none!important}}";
      return css;
    }

    let styleEl = null;
    function applyStyle() {
      if (!styleEl) {
        styleEl = document.createElement("style");
        styleEl.id = STYLE_ID;
        styleEl.setAttribute("data-plugin-css", "dsh-motion");
        document.head.appendChild(styleEl);
      }
      styleEl.textContent = buildCss();
    }

    function syncRootFlags() {
      const h = document.documentElement;
      if (cfg.on) h.setAttribute(ATTR_ON, ""); else h.removeAttribute(ATTR_ON);
      if (cfg.on && cfg.far) h.setAttribute(ATTR_FAR, ""); else h.removeAttribute(ATTR_FAR);
      if (cfg.debug) h.setAttribute(ATTR_DBG, ""); else h.removeAttribute(ATTR_DBG);
      // ── r22 镜面白总量（去泛白）─────────────────────────────────────────────
      //  用户 2026-09-15：「统一的材质有点泛白，这是 wallpaper 对输入框的配置，
      //  我希望去掉这层泛白，全局统一的」。泛白 = wallpaper 配方里那层白色镜面
      //  （background-image 白 16%→5%→2% + 内高光白 32%/8%）—— 暗色主题下最刺眼。
      //  归 glass-patch 的 `--dsp-sheen` 统一控制（那一侧把它乘进**所有**玻璃面：
      //  输入框 / 菜单 / 任务框 / 队列 / 设置窗），这里只负责把它写到 body 内联样式，
      //  保证「用户在设置页拖滑杆 → 全站一起变」。取值 0 = 完全去掉（默认）。
      //  ⚠ 即使本插件关掉（cfg.on=false）也照写：材质归 glass-patch，关动效不该改材质。
      try { document.body.style.setProperty("--dsp-sheen", String(cfg.sheen)); } catch (e) { }
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ⑥b 现场诊断（round15，用户在没有 devtools 的情况下也能把事实读给我）
    //     由来：连续几轮「改了没效果」。要么页面在跑旧 bundle，要么我量的元素不是他看的那个；
    //     两种都需要**用户侧可读的判据**。这里只读三类事实，不写任何东西：
    //       ① 页面级横向溢出（底部可左右滑动的滚动条的真身）
    //       ② glass-patch 的注入版本（grep 它 <style> 里的版本标记）—— 判断是否旧 bundle
    //       ③ 本插件的运行计数（marked / exits / overflowFixed）
    // ──────────────────────────────────────────────────────────────────────────
    function diagReport() {
      const out = { version: VERSION };
      try {
        const de = document.documentElement;
        out.viewport = window.innerWidth + "x" + window.innerHeight;
        out.scrollWidth = de.scrollWidth;
        out.hOverflow = Math.max(0, de.scrollWidth - de.clientWidth);
        // 最右元素（无过滤，含不可见的）——真机若有横向滚动条，这里就是嫌疑
        let maxR = -1e9, maxEl = null;
        for (const el of document.querySelectorAll("*")) {
          let r = null; try { r = el.getBoundingClientRect(); } catch (e) { continue; }
          if (r.width === 0 && r.height === 0) continue;
          if (r.right > maxR) { maxR = r.right; maxEl = el; }
        }
        if (maxEl) {
          const c = getComputedStyle(maxEl);
          out.rightmost = maxEl.tagName.toLowerCase() + "." + String(maxEl.className || "").slice(0, 28)
            + " right=" + Math.round(maxR) + " over=" + Math.round(maxR - window.innerWidth)
            + " pos=" + c.position + " vis=" + c.visibility;
        }
        // 溢出候选清单（position 非 static 且越界，最多 3 条）
        const cand = [];
        for (const el of document.querySelectorAll("*")) {
          const r = el.getBoundingClientRect();
          if (r.right <= window.innerWidth + 1) continue;
          const c = getComputedStyle(el);
          if (c.visibility === "hidden") continue;
          if (r.width < 20) continue;
          cand.push(el.tagName.toLowerCase() + "." + String(el.className || "").slice(0, 22)
            + " +" + Math.round(r.right - window.innerWidth) + "px pos=" + c.position);
          if (cand.length >= 3) break;
        }
        out.overflowCandidates = cand;
      } catch (e) { }
      try {
        const st = document.querySelector('style[data-plugin-css="dsh-glass-patch"]');
        const txt = st ? st.textContent : "";
        const vm = /--dsp-version:\s*"([^"]+)"/.exec(txt);
        out.glassPatch = !st ? "未注入" : (vm ? vm[1] : "旧版(需硬刷新)");
      } catch (e) { out.glassPatch = "?"; }
      out.marked = markedCount; out.exits = exitCount; out.overflowFixed = overflowFixed;
      return out;
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ⑦ 装配
    // ──────────────────────────────────────────────────────────────────────────
    function mount() {
      if (!document.body) { const t = setTimeout(mount, 200); return () => clearTimeout(t); }
      syncRootFlags();
      applyStyle();
      if (cfg.mat === "refract") { try { ensureSvg(); } catch (e) { } }
      try {
        observer = new MutationObserver(onMutations);
        // ⚠ 必须 subtree：命令面板挂在 composer 子树里，不是 portal。见 ⑤ 的说明。
        // characterData 只用于「流式在更新」的压力信号（处理函数里只计数，不做任何扫描）。
        observer.observe(document.body, { childList: true, subtree: true, characterData: true });
      } catch (e) { }
      satStart();   // r31：帧节奏监测（见「主线程帧节奏饱和检测」）
      // 指针轨迹（锚点来源之一，见 anchorEl）。用捕获阶段 + passive，只写几个字段，不做布局。
      const onPtr = (e) => {
        try { ptr.x = e.clientX || 0; ptr.y = e.clientY || 0; ptr.el = e.target; ptr.at = performance.now(); } catch (err) { }
      };
      // 指针路径的浮层收窄（第三方小窗没有 role，观察器与打标路径都收不到）
      let tipTimer = null;
      const onTipScan = () => {
        if (!cfg.on) return;
        if (tipTimer) clearTimeout(tipTimer);
        tipTimer = setTimeout(() => {
          tipTimer = null;
          try {
            const l = document.querySelectorAll(TIP_SEL);
            // ⚠ 上限原为 12 —— 实测（round38 ⑤）用户点名的 .lc-tip / .dsh-ocg-tip 常常排在
            //   第 12 个之后，等于「根本没被修」。放宽到 300：本循环在**不需要收窄时是纯读**
            //   （getBoundingClientRect 不写样式），一次批量读只触发一次布局，代价可忽略；
            //   只有真的越界才写，而越界的通常 0–1 个。
            for (let i = 0; i < l.length && i < 300; i++) tryClamp(l[i]);
          } catch (e) { }
        }, 90);
      };
      const PTREV = ["pointerdown", "mousedown", "contextmenu", "mouseover"];
      try { for (let i = 0; i < PTREV.length; i++) document.addEventListener(PTREV[i], onPtr, { capture: true, passive: true }); } catch (e) { }
      try { document.addEventListener("mouseover", onTipScan, { capture: true, passive: true }); } catch (e) { }
      // r21 点击补扫：display:none↔block 切换的浮层（酒馆 `#tavern-session-preset-panel` 等）
      // 没有 childList 变更，观察器看不见它的打开。点开它的那次点击就是最准的时机：
      // capture 监听 document 的 click（先于 React 根容器的冒泡处理），rAF 时 React 已把
      // 翻转提交到 DOM ⇒ 扫到可见态直接打标（延迟约一帧）；300ms 再扫一次兜住异步渲染。
      // 代价：一次 querySelectorAll + 未打标候选的字符串检查，已打标的走 hasAttribute 快路径。
      let clickScanT = null;
      let lastClickScanAt = 0;
      const onClickScan = () => {
        if (!cfg.on || !cfg.glass) return;
        // 节流（2026-10-21）：连点/双击/拖拽起手会在同一批里反复触发 capture click。
        // scan() 是全页 querySelectorAll + 未打标候选的样式判定，是本插件 per-click 最大开销。
        const now = performance.now();
        if (now - lastClickScanAt < 80) return;
        lastClickScanAt = now;
        try { requestAnimationFrame(() => { try { scan(); } catch (e) { } }); } catch (e) { }
        if (clickScanT) { try { clearTimeout(clickScanT); } catch (e) { } }
        try {
          clickScanT = setTimeout(() => {
            clickScanT = null;
            try { if (cfg.on && cfg.glass) scan(); } catch (e) { }
          }, 300);
        } catch (e) { }
      };
      try { document.addEventListener("click", onClickScan, { capture: true, passive: true }); } catch (e) { }
      // r30：图片放大 —— 记录点击源矩形（FLIP 起点）+ 拦截 close/Escape 播退场。
      // 注册时机：本插件在 mount() 里注册，早于任何灯箱组件挂载 ⇒ window capture
      // 先于组件的 keydown 监听执行，Escape 才能被接管。
      try { document.addEventListener("pointerdown", (e) => { try { pickZoomSrc(e.target); } catch (err) { } }, { capture: true, passive: true }); } catch (e) { }
      try { document.addEventListener("click", onZoomClick, { capture: true, passive: false }); } catch (e) { }
      try { window.addEventListener("keydown", onZoomKey, { capture: true, passive: false }); } catch (e) { }
      // r32：P1 微动效（设置页签切换 / 右侧栏展开收起）。不拦则完全无副作用；
      // 只有「收起右侧边栏」会在捕获阶段拦下、播完收回再重放 click（与灯箱同套路）。
      try { document.addEventListener("click", onUiClick, { capture: true, passive: false }); } catch (e) { }
      // 用 CSS 动画自己的事件来界定「动画窗口」，比 MutationObserver 扫子树便宜得多。
      // 远距动画用它开 contain:paint 窗口；近距动画用它起/收阴影代理。
      // 各加一个兜底定时器防止 animationend 被中断后标志黏住。
      let animTimer = null;
      const onAnimStart = (e) => {
        if (e.animationName === "dshm-far-in") {
          document.documentElement.setAttribute(ATTR_ANIM, "");
          if (animTimer) clearTimeout(animTimer);
          animTimer = setTimeout(() => document.documentElement.removeAttribute(ATTR_ANIM), 420);
          return;
        }
        // ⚠ 代理在这里（而不是 mark() 里）建：mark() 是同步路径，可能被
        //   探针在一次 evaluate 里连续调 set(on/off) 触发；放到动画事件里
        //   既不影响那条「同步快照零差异」的取证口径，也避免在观测回调里做布局。
        if (e.animationName === "dshm-glass-clip") makeShade(e.target);
      };
      const onAnimEnd = (e) => {
        if (e.animationName === "dshm-far-in") {
          if (animTimer) { clearTimeout(animTimer); animTimer = null; }
          document.documentElement.removeAttribute(ATTR_ANIM);
          return;
        }
        if (e.animationName === "dshm-glass-clip") { animRelease(e.target); removeShade(e.target, true); }
        // 无锚点浮层（data-dshm-noclip）只跑 tf ⇒ 也必须在这里还名额，否则要等兜底
        // setTimeout(dur+500) 才释放，会白占 500ms 预算。
        else if (e.animationName === "dshm-glass-tf") {
          // ⚠ r27b：这里**不能**摘 CARRY_ATTR。摘掉的瞬间 carry 规则失效，基础
          //   `[data-dshm-glass]` 规则重新命中同一元素，clip+tf 两条液态入场动画会
          //   从头再播一遍 —— 用户报的「切换完成后弹窗四角闪烁/延伸」就是它。
          //   标记保留到 unmark（卡片卸载/设置重扫）为止；carry 动画已结束，不会重播。
          animRelease(e.target);
        }
      };
      try {
        document.addEventListener("animationstart", onAnimStart, true);
        document.addEventListener("animationend", onAnimEnd, true);
        document.addEventListener("animationcancel", onAnimEnd, true);
      } catch (e) { }
      scan();

      window.__dshMotion = {
        cfg: () => Object.assign({}, cfg),
        set: (patch) => {
          const prev = { mode: cfg.glassMode, ab: cfg.aberration, mat: cfg.mat };
          Object.assign(cfg, patch || {});
          syncSpring(patch);
          // 滤镜图里烧死了「模式」和「色散强度」⇒ 这两项一变就必须整批重建
          const needPurge = (cfg.glassMode !== prev.mode)
            || (cfg.glassMode === "aberration" && cfg.aberration !== prev.ab)
            || (cfg.mat !== prev.mat);
          if (needPurge) purgeFilters();
          // 退出实验档时把那个 0×0 的 SVG 容器也一并收掉，别在 body 上留垃圾
          if (cfg.mat !== "refract" && svgEl) {
            try { svgEl.remove(); } catch (e) { }
            svgEl = null; defsEl = null;
          }
          saveCfg(); syncRootFlags(); applyStyle(); refreshFilters();
          // 先还原再重新打标 ⇒ 所有行内值立刻生效且不会逐次漂移
          unmarkAll();
          if (cfg.on && cfg.glass) scan();
          return Object.assign({}, cfg);
        },
        on: () => window.__dshMotion.set({ on: true }),
        off: () => window.__dshMotion.set({ on: false }),
        rescan: () => { scan(); return markedCount; },
        diag: diagReport,
        // r40：右栏开合事件流水（排查「单次点击 收起后又凸现」用；用户控制台可见）
        dbgRsb: () => uiRsbLog.slice(),
        clearRsbLog: () => { uiRsbLog = []; return true; },
        stats: () => ({
          on: cfg.on, marked: markedCount, skipped: skipped,
          tips: !!cfg.tips, unifySolid: !!cfg.unifySolid,
          // r27：悬浮预览卡（会话/工作区行 HoverCard）—— 换行 carry 次数 / 首次出现次数。
          //   carry 卡也进 marked（液态材质照旧），这里单独计数方便回归断言。
          carry: { total: carryCount, first: carrySkipped },
          gel: { pressed: gelPressCount },
          // r28：上下文洞察 hovertip —— 跨格 carry（连贯气泡）次数 / 首次出现次数。
          tipSwap: { total: tipSwapCount, first: tipFirstCount },
          obs: { recs: obs.recs, nodes: obs.nodes, ms: Math.round(obs.ms * 100) / 100 },
          // 各族浮层的实时打标数（第七轮推广后，用它一眼看出「哪一族没被收到」）
          byKind: (() => {
            const o = { menu: 0, tip: 0 };
            try {
              const l = document.querySelectorAll("[" + ATTR_MARK + "]");
              for (let i = 0; i < l.length; i++) { const k = l[i].getAttribute("data-dshm-kind") || "menu"; o[k] = (o[k] || 0) + 1; }
            } catch (e) { }
            return o;
          })(),
          mat: cfg.mat, mode: cfg.glassMode, aberration: cfg.aberration,
          spring: { response: cfg.response, damping: cfg.damping, dur: springCurve(cfg.response, cfg.damping, 8).durationMs, from: cfg.from, bubble: cfg.bubble, morph: cfg.bubble > 0,
            warp: cfg.warp, overshoot: springCurve(cfg.response, cfg.damping, 64).overshootPct, overshootCfg: cfg.overshoot },
          forceMotion: !!cfg.forceMotion,
          // ⚠⚠ 这里**不能**再写一个 `spring:` 键！上面那行的 `spring` 是算出来的弹簧对象
          //   （`spring.dur` 被设置页的预览读去当动画时长）。同名键会把它整个覆盖成布尔值 ⇒
          //   `--dshm-pv-dur` 变成 `undefinedms` ⇒ 预览那条 `animation` 声明整条失效。
          //   第七轮就是这么踩的：`motion-overshoot-verify` 的 ③ 段 4 条断言当场挂掉。
          //   布尔位一律用 `*On` 后缀，别再和对象重名。
          far: cfg.far, glass: cfg.glass, tips: cfg.tips, unifySolid: cfg.unifySolid, springOn: cfg.spring,
          reduceMotion: (() => { try { return !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { return false; } })(),
          motionActive: !(() => { try { return !cfg.forceMotion && window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch (e) { return false; } })(),
          shades: shadesAlive, exits: exitCount, overflowFixed: overflowFixed, exitOn: !!cfg.exit,
          // r30：图片放大（ImageLightbox）—— 开/关各计一次，open=当前是否有灯箱被接管。
          zoom: { opens: zoomOpens, exits: zoomExits, open: !!zoomDlg, exiting: zoomExiting },
          // r32：P1 微动效计数（设置页签切换 / 右侧栏展开收起），probes/verify-r32.mjs 判据用。
          ui: { tabs: uiTabs, panels: uiPanels },
          // 并发指标（2026-10-21）：A/B 与「限制并行动画数量」的直接判据
          anim: { active: animActive.size, peak: animPeak, cap: animCap(), skipped: animSkipped, dur: animDurMs },
          // 流式/高负载降级状态（r25）：busy=当前是否在降级窗口、degraded=已降级的入场数
          busy: (() => {
            const now = busyNow();
            return {
              now: now,
              lastLongAgoMs: Math.round(performance.now() - lastLongAt),
              lastLongMs: Math.round(lastLongMs),
              longN: longN,
              elRate: Math.round(elRate),
              charRate: Math.round(charRate),
              satOn: satNow(), satP50: Math.round(satP50), satP95: Math.round(satP95), satSlow: Math.round(satSlow * 100),
              degraded: busyDegraded,
              exitSkipped: busyExitSkips,
              guard: !!cfg.busyGuard
            };
          })(),
          exitBudget: { active: exitActiveN, peak: exitPeak, cap: exitCap(), skipped: exitSkipped },
          rootCacheHit: rootCacheHit,
          filters: Array.from(filterIds.values()).map((f) => ({ key: f.key, id: f.id, map: f.map, disp: f.disp, primitives: f.nodes.length })),
          svg: !!(svgEl && svgEl.isConnected), style: !!(styleEl && styleEl.isConnected)
        })
      };

      return () => {
        try { satStop(); } catch (e) { }
        try { if (observer) observer.disconnect(); } catch (e) { }
        try { for (let i = 0; i < PTREV.length; i++) document.removeEventListener(PTREV[i], onPtr, { capture: true }); } catch (e) { }
        try { document.removeEventListener("mouseover", onTipScan, { capture: true }); } catch (e) { }
        try { document.removeEventListener("click", onClickScan, { capture: true }); } catch (e) { }
        try { if (tipTimer) clearTimeout(tipTimer); } catch (e) { }
        try { if (clickScanT) clearTimeout(clickScanT); } catch (e) { }
        ptr.el = null; ptr.at = -1e9;
        try {
          document.removeEventListener("animationstart", onAnimStart, true);
          document.removeEventListener("animationend", onAnimEnd, true);
          document.removeEventListener("animationcancel", onAnimEnd, true);
        } catch (e) { }
        try { if (animTimer) clearTimeout(animTimer); } catch (e) { }
        document.documentElement.removeAttribute(ATTR_ANIM);
        observer = null;
        unmarkAll();
        // 兜底：万一有代理因为异常路径没被 unmark 带到，这里按属性全清一遍
        try { const l = document.querySelectorAll("[" + SHADE_ATTR + "]"); for (let i = 0; i < l.length; i++) l[i].remove(); } catch (e) { }
        try { const l2 = document.querySelectorAll("[data-dshm-exit]"); for (let i = 0; i < l2.length; i++) l2[i].remove(); } catch (e) { }
        shadesAlive = 0;
        try { if (svgEl) svgEl.remove(); } catch (e) { }
        try { if (styleEl) styleEl.remove(); } catch (e) { }
        svgEl = null; defsEl = null; styleEl = null;
        filterIds.clear();
        try { delete window.__dshMotion; } catch (e) { }
        const h = document.documentElement;
        h.removeAttribute(ATTR_ON); h.removeAttribute(ATTR_FAR); h.removeAttribute(ATTR_DBG);
      };
    }

    // ──────────────────────────────────────────────────────────────────────────
    //  ⑧ 设置页签（settings.section）
    //     真机观感只能在真机上定，所以把旋钮交出去，改完立刻生效。
    // ──────────────────────────────────────────────────────────────────────────
    // ──────────────────────────────────────────────────────────────────────────
    //  ⑧ 设置页签（settings.section）
    //     r55 重做：版式参考宿主里 dsh-cost-meter「显示」页的 UI 语言 ——
    //     标题 + 分段页签 + 左实时预览 / 右「调整组件」检查器 + 底部折叠的高级设置。
    //     视觉全部走 DSH token（暗/亮主题都成立），只保留 settings.section 的注册契约。
    // ──────────────────────────────────────────────────────────────────────────
    function makeSection() {
      const React = require("react");
      const h = React.createElement;

      // 图标只画两笔：不依赖字体，也不引入外部资源。
      const IconReplay = () => h("svg", { width: 13, height: 13, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M13.2 8a5.2 5.2 0 1 1-1.52-3.68" }),
        h("path", { d: "M13.4 2.4v2.9h-2.9" }));
      const IconCheck = () => h("svg", { width: 12, height: 12, viewBox: "0 0 16 16", fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round", strokeLinejoin: "round", "aria-hidden": "true" },
        h("path", { d: "M3 8.4 6.3 11.7 13 4.6" }));

      // 预设 = 一组几何 + 弹簧参数。刻意只覆盖「手感」不覆盖材质。
      const PRESETS = [
        { key: "std", label: "标准", cfg: { bubble: 34, warp: 0.26, lift: 18, from: 0.9, response: 280, overshoot: 10.69 } },
        { key: "soft", label: "轻柔", cfg: { bubble: 22, warp: 0.16, lift: 10, from: 0.94, response: 360, overshoot: 3 } },
        { key: "bouncy", label: "弹跳", cfg: { bubble: 34, warp: 0.3, lift: 20, from: 0.88, response: 250, overshoot: 16 } },
        { key: "snappy", label: "迅捷", cfg: { bubble: 16, warp: 0.1, lift: 8, from: 0.97, response: 190, overshoot: 0 } }
      ];
      function presetHit(c, p) {
        const near = (a, b, e) => Math.abs((+a) - b) <= e;
        return near(c.bubble, p.cfg.bubble, 0.02) && near(c.warp, p.cfg.warp, 0.002) && near(c.lift, p.cfg.lift, 0.02)
          && near(c.from, p.cfg.from, 0.002) && near(c.response, p.cfg.response, 0.02) && near(c.overshoot, p.cfg.overshoot, 0.06);
      }

      // ── 设置页专用控件（都是无状态的小函数组件）──────────────────────────
      function Switch(p) {
        return h("label", { className: "dshm-set-switch", title: p.title || "" },
          h("span", null, p.label),
          h("input", { type: "checkbox", checked: !!p.checked, onChange: (e) => p.onChange(e.target.checked) }));
      }
      function Range(p) {
        const min = p.min, max = p.max;
        const v = (p.value === undefined || p.value === null || !isFinite(p.value)) ? min : +p.value;
        const pct = max === min ? 0 : Math.max(0, Math.min(100, ((v - min) / (max - min)) * 100));
        return h("div", { className: "dshm-set-field", title: p.tip || "" },
          h("div", { className: "dshm-set-field-head" }, h("span", null, p.label), h("b", null, v + (p.unit || ""))),
          h("input", {
            type: "range", className: "dshm-set-range", min: min, max: max, step: p.step, value: v,
            style: { "--dshm-set-pct": pct.toFixed(1) + "%" },
            onChange: (e) => p.onChange(parseFloat(e.target.value))
          }));
      }
      function Select(p) {
        return h("div", { className: "dshm-set-field" },
          h("div", { className: "dshm-set-field-head" }, h("span", null, p.label)),
          h("div", { className: "dshm-set-selectwrap" },
            h("select", { className: "dshm-set-select", value: p.value, onChange: (e) => p.onChange(e.target.value) },
              (p.options || []).map((o) => h("option", { key: o.value, value: o.value }, o.label)))));
      }

      return function MotionSection() {
        const [, force] = React.useState(0);
        const [tab, setTab] = React.useState("near");
        const [play, setPlay] = React.useState(0);
        const [slow, setSlow] = React.useState(false);
        const api = window.__dshMotion;
        const c = (api && api.cfg && api.cfg()) || {};
        const upd = (patch) => { if (api && api.set) { api.set(patch); force((n) => n + 1); } };
        const bump = () => setPlay((p) => p + 1);
        const st = (api && api.stats) ? api.stats() : null;
        const dg = (api && api.diag) ? api.diag() : null;
        let reduced = false;
        try { reduced = !!(window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches); } catch (e) { }

        const dur = (st && st.spring ? st.spring.dur : 438) || 438;
        const zeta = st && st.spring ? st.spring.damping : 0.58;
        const overshootPct = st && st.spring ? st.spring.overshoot : 10.69;
        const version = dg && dg.version ? dg.version : VERSION;
        const matLabel = c.mat === "refract" ? "液态折射（实验）" : c.mat === "window" ? "照抄设置窗" : "跟随后台";

        // ── 近距预览：几何与主弹窗逐参数同源（248×88 的模型选择器）──────────
        const PVW = 248, PVH = 88, PVR = 18;
        const pvBubble = Math.max(0, Math.min(c.bubble === undefined ? 34 : +c.bubble, PVW, PVH));
        const pvFrom = Math.max(0.3, Math.min(1.05, c.from === undefined ? 0.9 : +c.from));
        const pvWarp = Math.max(0, Math.min(0.5, c.warp === undefined ? 0.26 : +c.warp));
        const pvLift = Math.max(0, Math.min(60, c.lift === undefined ? 18 : +c.lift));
        const pvLeft = Math.max(0, Math.min(PVW - pvBubble, PVW / 2 - pvBubble / 2));
        const pvTop = Math.max(0, PVH - pvBubble);
        const pvVars = {
          "--dshm-pv-ct": pvTop.toFixed(1) + "px",
          "--dshm-pv-cr": (PVW - pvLeft - pvBubble).toFixed(1) + "px",
          "--dshm-pv-cb": (PVH - pvTop - pvBubble).toFixed(1) + "px",
          "--dshm-pv-cl": pvLeft.toFixed(1) + "px",
          "--dshm-pv-r0": (pvBubble / 2).toFixed(1) + "px",
          "--dshm-pv-r1": PVR + "px",
          "--dshm-pv-sx": (pvFrom * (1 - pvWarp)).toFixed(4),
          "--dshm-pv-sy": pvFrom.toFixed(4),
          "--dshm-pv-dy": pvLift + "px",
          "--dshm-pv-dur": ((slow ? 4 : 1) * dur) + "ms",
          transformOrigin: "50% 100%"
        };
        // 拖滑杆就自动重播 —— 「改了马上看得见」是这个预览存在的唯一理由。
        // 但连续拖动时每个 input 都重播会让动画一直在第 0 帧打转，看起来像「没动」；
        // 这里去抖 140ms：拖动过程中只更新参数，松手后补一次完整重播。
        const pvSig = [pvBubble, pvFrom, pvWarp, pvLift, dur, !!c.spring, slow].join("|");
        const pvTimer = React.useRef(0);
        const pvFirst = React.useRef(true);
        React.useEffect(() => {
          // 首帧由「元素挂载即跑 CSS 动画」负责，这里只处理**后续**参数变化；
          // 否则打开设置 / 切回近距页签时会在 140ms 后把刚播的动画再重启一遍。
          if (pvFirst.current) { pvFirst.current = false; return; }
          if (pvTimer.current) clearTimeout(pvTimer.current);
          pvTimer.current = setTimeout(() => { pvTimer.current = 0; setPlay((p) => p + 1); }, 140);
          return () => { if (pvTimer.current) { clearTimeout(pvTimer.current); pvTimer.current = 0; } };
        }, [pvSig]);

        const farDur = (slow ? 4 : 1) * 280;
        const tipDur = (slow ? 4 : 1) * 204;
        const TABS = [
          { key: "near", label: "近距弹窗", size: "模型选择器 · 248×88" },
          { key: "far", label: "远距弹窗", size: "设置窗 · 280ms" },
          { key: "tip", label: "悬浮提示", size: "提示气泡 · 204ms" }
        ];
        const tabMeta = TABS.find((t) => t.key === tab) || TABS[0];
        const chooseTab = (k) => { setTab(k); setPlay((p) => p + 1); };
        const resetAll = () => {
          try { localStorage.removeItem(CFG_KEY); } catch (e) { }
          if (api && api.set) api.set(Object.assign({}, DEFAULTS));
          setTab("near"); setSlow(false);
          force((n) => n + 1); setPlay((p) => p + 1);
        };

        // ── 三个预览场景 ───────────────────────────────────────────────────
        const nearScene = h("div", { className: "dshm-set-near" },
          h("div", { className: "dshm-set-specimen", title: "点击重播", onClick: bump },
            h("i", { className: "dshm-set-spec-tag" }, "点击重播"),
            h("div", { key: play, className: "dshm-pv dshm-set-pop", "data-play": "", style: pvVars },
              h("div", { className: "dshm-set-menu-row" },
                h("span", null, "DeepSeek V4"),
                h("em", null, "1M")),
              h("div", { className: "dshm-set-menu-row" },
                h("span", null, "DeepSeek R1"),
                h(IconCheck, null)))),
          h("div", { className: "dshm-set-composer" },
            h("div", { className: "dshm-set-composer-line" }, "给 DeepSeek 发送消息…"),
            h("div", { className: "dshm-set-composer-row" },
              h("span", { className: "dshm-set-composer-plus" }, "+"),
              h("span", { className: "dshm-set-composer-trigger" }, "DeepSeek V4", h("u", null, "▾")),
              h("span", { className: "dshm-set-composer-send" }, "↑"))));
        const farScene = h("div", { className: "dshm-set-far", title: "点击重播", onClick: bump },
          h("div", { key: play, className: "dshm-set-far-dialog", "data-play": "", style: { "--dshm-set-dur": farDur + "ms" } },
            h("div", { className: "dshm-set-far-title" }, h("span", null, "设置"), h("i", { className: "dshm-set-far-x" }, "✕")),
            h("div", { className: "dshm-set-far-row" }, h("span", null, "通用设置"), h("i", { className: "dshm-set-skel", style: { width: "58px" } })),
            h("div", { className: "dshm-set-far-row" }, h("span", null, "模型"), h("i", { className: "dshm-set-skel", style: { width: "42px" } })),
            h("div", { className: "dshm-set-far-actions" },
              h("i", { className: "dshm-set-skel", style: { width: "44px" } }),
              h("i", { className: "dshm-set-skel dshm-set-skel-pill" }))));
        const tipScene = h("div", { className: "dshm-set-hover" },
          h("div", { key: play, className: "dshm-set-hover-bubble", "data-play": "", title: "点击重播", onClick: bump, style: { "--dshm-set-dur": tipDur + "ms" } },
            h("span", { className: "dshm-set-hover-dot" }),
            h("span", null, "上下文洞察"),
            h("em", null, "剩余 62%")),
          h("div", { className: "dshm-set-hover-target" },
            h("span", { className: "dshm-set-hover-avatar" }),
            h("span", null, "活跃度"),
            h("em", null, "53 天")),
          h("div", { className: "dshm-set-heat", "aria-hidden": "true" },
            Array.from({ length: 52 }, (_, i) => h("i", {
              key: i, style: { opacity: (0.16 + ((i * 37) % 17) / 17 * 0.84).toFixed(2) }
            }))));

        // ── 检查器（按页签切换的上下文参数）────────────────────────────────
        const nearInspector = [
          h("div", { className: "dshm-set-group", key: "sw" },
            h(Switch, { label: "近距弹窗动效", checked: c.glass, onChange: (v) => upd({ glass: v }) }),
            h(Switch, { label: "Q 弹弹簧入场", checked: c.spring, onChange: (v) => upd({ spring: v }) })),
          h("div", { className: "dshm-set-divider", key: "d1" }),
          h(Select, {
            key: "mat", label: "玻璃材质", value: c.mat,
            options: [
              { value: "inherit", label: "跟随后台（推荐）" },
              { value: "window", label: "照抄设置窗" },
              { value: "refract", label: "实验：液态折射" }
            ],
            onChange: (v) => upd({ mat: v })
          }),
          h("div", { className: "dshm-set-note", key: "matnote", style: { marginTop: "6px" } },
            c.mat === "refract"
              ? "实验档：SVG 位移折射 + 色散，入场每帧重跑滤镜，真机会掉帧。"
              : c.mat === "window"
                ? "照抄 wallpaper「设置窗口」那杯玻璃（底色 × 透明度、模糊读设置窗变量）。"
                : "材质完全交给 wallpaper + dsh-glass-patch，与其它菜单/浮层逐像素同源。"),
          c.mat === "window" ? h(Range, {
            key: "ag", label: "玻璃不透明度 ×", value: c.alphaGain, min: 0.4, max: 3, step: 0.1, unit: "×",
            onChange: (v) => upd({ alphaGain: v }), tip: "1× = 完全跟随 wallpaper 的玻璃透明度"
          }) : null
        ];
        // 入场几何 / 预设：图标 + 6 个旋钮。满宽卡片（参考的「侧栏布局」卡片语言），
        // 这样左预览/右检查器高度对得上，不必把 6 条滑杆塞进 200px 窄列。
        const nearGeometry = h("div", { className: "dshm-set-geometry" },
          h("div", { className: "dshm-set-geometry-head" },
            h("span", { className: "dshm-set-group-h" }, h("b", null, "入场几何"), h("em", null, "ζ " + zeta + " ⇒ 时长 " + dur + "ms · 过冲 " + overshootPct + "%")),
            h("span", { className: "dshm-set-geo-hint" }, "预设一键套用，也可逐项微调")),
          h("div", { className: "dshm-set-presets" },
            PRESETS.map((p) => h("button", {
              key: p.key, type: "button", className: "dshm-set-preset", "data-p": p.key, "aria-pressed": presetHit(c, p),
              onClick: () => { upd(Object.assign({ spring: true }, p.cfg)); }
            },
              h("span", { className: "dshm-set-preset-thumb" }, h("i"), h("i"), h("i")),
              h("span", null, p.label)))),
          h("div", { className: "dshm-set-geo-grid" },
            h(Range, { label: "起始气泡", value: c.bubble, min: 0, max: 80, step: 2, unit: "px", onChange: (v) => upd({ bubble: v }), tip: "从锚点处这个小圆长成整块面板；0 = 关闭 rect morph（退回淡入）" }),
            h(Range, { label: "扭曲强度", value: c.warp, min: 0, max: 0.5, step: 0.02, onChange: (v) => upd({ warp: v }), tip: "各向异性缩放：横向比纵向多压 (1−warp)，长出时是液体形变" }),
            h(Range, { label: "起始位移", value: c.lift, min: 0, max: 40, step: 1, unit: "px", onChange: (v) => upd({ lift: v }), tip: "朝触发按钮方向的位移 —— 「从按钮里出来」的那一段" }),
            h(Range, { label: "附加缩放", value: c.from, min: 0.8, max: 1.05, step: 0.01, onChange: (v) => upd({ from: v }), tip: "缩放会把文字一起压扁；iOS 的文字从不被缩放，别压太低" }),
            h(Range, { label: "响应", value: c.response, min: 150, max: 700, step: 10, unit: "ms", onChange: (v) => upd({ response: v }), tip: "Apple spring(response:)：ω = 2π/response。越小越快，Apple 默认 500ms" }),
            h(Range, { label: "过冲（q 弹）", value: c.overshoot, min: 0, max: 25, step: 0.5, unit: "%", onChange: (v) => upd({ overshoot: v }), tip: "0% = 临界阻尼（物理正确）；10.7% ≈ 默认；25% ≈ 很蹦" })));
        // 弹簧关掉 / 总开关关掉时给出诚实提示（真机此时不播几何动画）
        const nearNote = (!c.on || !c.spring)
          ? h("div", { className: "dshm-set-geo-hint", style: { marginTop: "10px" } },
            !c.on ? "总开关已关闭：真机与预览都不再播放动效。" : "弹簧入场已关闭：真机改用 160ms 纯淡入，几何参数此时不生效。")
          : null;
        const specRow = (k, v, key) => h("div", { className: "dshm-set-spec-row", key: key }, h("span", null, k), h("b", null, v));
        const farInspector = [
          h("div", { className: "dshm-set-group", key: "sw" },
            h(Switch, { label: "远距弹窗浮出", checked: c.far, onChange: (v) => upd({ far: v }) })),
          h("div", { className: "dshm-set-spec", key: "spec" },
            specRow("时长", "280ms", 1),
            specRow("缓动", "cubic-bezier(.32,.72,0,1)", 2),
            specRow("位移", "translateY(60px)", 3),
            specRow("缩放", "无", 4)),
          h("div", { className: "dshm-set-note", key: "n" },
            "与官方设置窗同规格：从下方 60px 浮出、不缩放。这一档的价值就是「统一」，所以不提供参数。")
        ];
        const tipInspector = [
          h("div", { className: "dshm-set-group", key: "sw" },
            h(Switch, { label: "悬浮提示动效", checked: c.tips, onChange: (v) => upd({ tips: v }) })),
          h("div", { className: "dshm-set-spec", key: "spec" },
            specRow("时长", "204ms", 1),
            specRow("过冲", "0%", 2),
            specRow("弹簧", "response 150ms / ζ 1.0", 3),
            specRow("材质", "与菜单同一杯玻璃", 4)),
          h("div", { className: "dshm-set-note", key: "n" },
            "手一过就出现、手一移就走，所以用短档不过冲，不共用菜单那条 438ms 弹簧。")
        ];

        // ── 组装 ────────────────────────────────────────────────────────────
        const head = h("div", { className: "dshm-set-head" },
          h("div", { className: "dshm-set-head-main" },
            h("h3", null, "弹窗动效"),
            h("p", null, "远距弹窗从下方浮出；近距弹窗像液体一样从触发按钮长出来。拖动滑杆即时生效，左侧预览会就地重播，无需刷新。")),
          h("button", { type: "button", className: "dshm-set-btn", onClick: bump }, h(IconReplay, null), "重播预览"));

        const chips = h("div", { className: "dshm-set-chips" },
          h("span", { className: "dshm-set-chip dshm-set-chip-live" }, h("i"), "运行中 · " + version),
          h("span", { className: "dshm-set-chip" }, "玻璃 · " + matLabel),
          h("span", { className: "dshm-set-chip" }, "弹簧 " + dur + "ms · ζ " + zeta),
          st && st.busy && st.busy.now ? h("span", { className: "dshm-set-chip dshm-set-chip-warn" }, "流式降级中") : null,
          !c.on ? h("span", { className: "dshm-set-chip dshm-set-chip-warn" }, "总开关已关闭") : null);

        const banner = reduced ? h("div", { className: "dshm-set-banner" },
          h("div", null,
            h("b", null, "系统开启了「减少动效」"),
            h("p", null, c.forceMotion
              ? "已覆盖：几何动画照常播放（本机系统仍要求减少动效）。"
              : "几何参数此刻不会生效（真机只剩 120ms 淡入）；材质不受影响。")),
          h("label", { className: "dshm-set-switch" },
            h("span", null, "仍然播放"),
            h("input", { type: "checkbox", checked: !!c.forceMotion, onChange: (e) => upd({ forceMotion: e.target.checked }) }))) : null;

        const toolbar = h("div", { className: "dshm-set-toolbar" },
          h("div", { className: "dshm-set-tabs", role: "tablist" },
            TABS.map((t) => h("button", {
              key: t.key, type: "button", role: "tab", "aria-selected": tab === t.key,
              onClick: () => chooseTab(t.key)
            }, t.label))),
          h("label", { className: "dshm-set-check" },
            h("input", { type: "checkbox", checked: slow, onChange: (e) => setSlow(e.target.checked) }),
            "慢放 4×"));

        const hint = !c.on
          ? "总开关已关闭 · 预览暂停"
          : tab === "near"
            ? (c.spring
              ? (slow ? "4× 慢放 · 与真机同尺寸同参数" : "拖滑杆自动重播 · 与真机同尺寸同参数")
              : "弹簧已关闭 · 真机改用 160ms 淡入")
            : tab === "far"
              ? (slow ? "4× 慢放 · 远距档 280ms 浮出" : "远距档 280ms 浮出 · 无缩放")
              : (slow ? "4× 慢放 · 快速档 204ms" : "快速档 204ms · 无过冲");

        const scene = h("div", { className: "dshm-set-scene" },
          h("div", { className: "dshm-set-scene-head" },
            h("b", null, "实时预览"),
            h("span", null, tabMeta.size)),
          h("div", { className: "dshm-set-stage" }, tab === "near" ? nearScene : tab === "far" ? farScene : tipScene),
          h("div", { className: "dshm-set-scene-foot" },
            h("button", { type: "button", className: "dshm-set-btn dshm-set-btn-sm", onClick: bump }, h(IconReplay, null), "重播"),
            h("span", { className: "dshm-set-hint" }, hint)));

        const inspector = h("div", { className: "dshm-set-inspector" },
          h("div", { className: "dshm-set-insp-head" }, h("span", null, "调整组件"), h("em", null, tabMeta.label)),
          h(Switch, { label: "启用弹窗动效", checked: c.on, onChange: (v) => upd({ on: v }) }),
          h("div", { className: "dshm-set-note", style: { marginTop: "2px" } }, c.on ? "关闭后所有弹窗恢复官方原样。" : "已关闭：真机与预览都不再播放动效。"),
          h("div", { className: "dshm-set-divider" }),
          tab === "near" ? nearInspector : tab === "far" ? farInspector : tipInspector);

        const diagLines = dg ? [
          "版本 " + dg.version + " · glass-patch " + dg.glassPatch + " · 视口 " + dg.viewport,
          "页面横向溢出 " + dg.hOverflow + "px（scrollWidth " + dg.scrollWidth + "）· 最右元素 " + (dg.rightmost || "-"),
          "计数：已打标 " + dg.marked + " · 消失动效 " + dg.exits + " · 溢出收窄 " + dg.overflowFixed
        ] : ["插件尚未就绪（若刚装配，刷新一次页面）"];
        if (dg && dg.overflowCandidates && dg.overflowCandidates.length) diagLines.push("越界候选：" + dg.overflowCandidates.join(" ｜ "));
        const statLines = st ? [
          "材质 " + (st.mat === "refract" ? "实验折射/" + st.mode : "wallpaper 同源") + " · 已打标 " + st.marked + " 个",
          "弹簧 response " + st.spring.response + "ms / ζ " + st.spring.damping + " ⇒ 时长 " + st.spring.dur + "ms · 过冲 " + st.spring.overshoot + "%（设定 " + st.spring.overshootCfg + "%）",
          "气泡 " + st.spring.bubble + "px · 扭曲 " + st.spring.warp + " · 附加缩放 " + st.spring.from + " · 阴影代理 " + st.shades,
          st.reduceMotion ? (st.forceMotion ? "系统要求减少动效：已覆盖" : "系统要求减少动效：几何已让路") : "动效正常",
          st.busy && st.busy.guard ? ("流式降级：" + st.busy.degraded + " 次" + (st.busy.now ? "（当前降级中）" : "")) : "流式降级：已关闭"
        ] : [];

        const general = h("details", { className: "dshm-set-general" },
          h("summary", null, "通用设置", h("span", null, "· 性能、材质、无障碍与诊断")),
          h("div", { className: "dshm-set-general-grid" },
            h(Switch, { label: "流式/高负载自动降级", checked: c.busyGuard, onChange: (v) => upd({ busyGuard: v }), title: "会话内容流式更新或主线程持续长任务时，新弹窗只做纯淡入、不建代理" }),
            h(Switch, { label: "补齐缺失的动效 token", checked: c.tokens, onChange: (v) => upd({ tokens: v }) }),
            h(Switch, { label: "调试高亮浮层", checked: c.debug, onChange: (v) => upd({ debug: v }) }),
            h(Switch, { label: "不透明底浮层换玻璃", checked: c.unifySolid, onChange: (v) => upd({ unifySolid: v }) }),
            h(Range, { label: "同时入场动画上限", value: c.maxAnim, min: 1, max: 12, step: 1, unit: " 个", onChange: (v) => upd({ maxAnim: v }), tip: "超预算的浮层不排队，当场降级为纯透明度淡入" }),
            h(Range, { label: "镜面白（泛白总量）", value: c.sheen, min: 0, max: 1.5, step: 0.05, onChange: (v) => upd({ sheen: v }), tip: "0 = 去掉；0.5 = 原配方一半（默认）；1 = wallpaper 原配方" }),
            h("div", { className: "dshm-set-general-note" }, c.debug
              ? "红框 = 插件已识别为浮层；绿框 = 位置正在被修正。"
              : "调试高亮打开后用红 / 绿框判断浮层是否被识别。")),
          c.mat === "refract" ? h("div", { className: "dshm-set-refract" },
            h("div", { className: "dshm-set-group-h" }, h("span", null, "液态折射参数"), h("em", null, "实验档")),
            h("div", { className: "dshm-set-general-grid" },
              h(Range, { label: "折射强度", value: c.disp, min: 0.2, max: 2.2, step: 0.05, unit: "×", onChange: (v) => upd({ disp: v }) }),
              h(Range, { label: "边缘色散", value: c.aberration, min: 0, max: 5, step: 0.5, onChange: (v) => upd({ aberration: v }) }),
              h(Range, { label: "玻璃模糊", value: c.blur, min: 0, max: 8, step: 0.1, unit: "px", onChange: (v) => upd({ blur: v }) }),
              h(Range, { label: "玻璃饱和", value: c.sat, min: 1, max: 2.4, step: 0.1, onChange: (v) => upd({ sat: v }) }),
              h(Range, { label: "底色不透明度", value: c.tint, min: 0.2, max: 0.8, step: 0.02, onChange: (v) => upd({ tint: v }) }),
              h(Select, {
                label: "滤镜档位", value: c.glassMode,
                options: [{ value: "lens", label: "精简（2 原语）" }, { value: "aberration", label: "色散（3 通道）" }],
                onChange: (v) => upd({ glassMode: v })
              }))) : null,
          h("div", { className: "dshm-set-actions" },
            h("button", { type: "button", className: "dshm-set-btn", onClick: () => { if (api && api.rescan) api.rescan(); bump(); force((n) => n + 1); } }, "重新扫描弹窗"),
            h("button", { type: "button", className: "dshm-set-btn", onClick: resetAll }, "恢复默认")),
          h("details", { className: "dshm-set-diag" },
            h("summary", null, "运行诊断"),
            h("div", null,
              diagLines.map((line, i) => h("p", { key: "d" + i }, line)),
              statLines.map((line, i) => h("p", { key: "s" + i }, line)))));

        return h("div", { className: "dshm-set", "data-dshm-section": "motion" },
          head, chips, banner, toolbar,
          h("div", { className: "dshm-set-main" }, scene, inspector),
          tab === "near" ? nearGeometry : null,
          tab === "near" ? nearNote : null,
          general);
      };
    }

    function registerSettings(ctx) {
      let dispose = null;
      try {
        const slots = ctx.slots || (ctx.get && ctx.get("slots"));
        if (!slots || typeof slots.register !== "function") return () => { };
        // 同 id + 同 priority 重复注册会抛错 ⇒ 页面级去重
        if (window.__dshMotionSection) return () => { };
        window.__dshMotionSection = true;
        const Comp = makeSection();
        dispose = slots.inject("settings.section", () => slots.register({
          name: "settings.section",
          id: "dsh-motion",
          order: 42,
          label: () => "弹窗动效"
        }, Comp));
      } catch (e) { }
      return () => {
        window.__dshMotionSection = false;
        try { if (typeof dispose === "function") dispose(); } catch (e) { }
      };
    }

    // slots 是设置页签的硬依赖：声明后 Cordis 会等服务就绪再调用 apply
    // （实测客户端 apply 可能早于服务层，AGENTS.md §3.3）。
    exports.inject = ["slots"];

    exports.apply = function (ctx) {
      ctx.effect(() => mount(), "dsh-motion: popup motion");
      ctx.effect(() => registerSettings(ctx), "dsh-motion: settings section");
    };

    return module.exports;
  }
});
