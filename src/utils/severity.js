/**
 * 工单 severity 的**归一化映射** —— 让同一个字段只说一种语言。
 *
 * ## 为什么需要这一层
 *
 * 此前模板里是**裸拼**的（`TicketsView.vue`）：
 *
 * ```html
 * <span class="alert-tag" :class="'severity-' + t.severity">{{ ... }}</span>
 * ```
 *
 * 而 `css/styles.css` 只定义了 4 条 `.alert-tag.severity-*` 规则
 * （`critical` / `warning` / `info` / `high`）。**`.alert-tag` 基类里既没有
 * `background` 也没有 `color`** —— 所以任何没有对应规则的值并不是"被设计成中性"，
 * 而是**一点样式都没有**：实测 `P1` 那格是 `background: rgba(0,0,0,0)`（全透明）
 * + 继承来的近黑文字，看起来就是一段普通文本。
 *
 * 于是同一列出现三种样子：`high` 是红底徽标、`medium` 是黑字、`P1` 是黑字。
 *
 * ## 两个都要着手的成因
 *
 * 1. **缺档位**：建单表单自己就提供 `critical/high/medium/low` 四档，而 `medium`/`low`
 *    **没有 CSS** —— 从表单正常选 medium 建出来的工单，本来就会显示得和 HIGH 不一样。
 *    不是历史脏数据，是当时仍在产生。
 * 2. **异构词表**：`P1` 是 ServiceNow 的 priority 写法，原样存进了 `severity` 列
 *    （后端该列是自由文本）。代码里没有任何地方产出它。
 *
 * ## 判据：归一化放在展现层，不写回数据
 *
 * `severity` 存的是"源系统当时说的是什么"，是有据可查的记录。把它改写成平台四档
 * 会让这条信息**永久丢失**（以后想按原样回读就没了），还要动存量数据。
 * 归一化是「**怎么显示**」的问题，不是「**存什么**」的问题。
 *
 * ## 大小写也要在这里收口
 *
 * 本仓 legacy（`js/app.js`，如 `:1993`）一律 `.toLowerCase()` 后再拼类名，
 * 而 Vue 这边此前**没有**。所以一条大写的 `HIGH` 会让 `severity-HIGH` 匹配不上
 * `severity-high` —— 又是同一个"静默退化成黑字"。归一化把这条一并堵掉。
 */

/** 平台自己的四档。建单表单的选项就是这四个，工单页上正常只该出现这四种。 */
export const TIERS = ['critical', 'high', 'medium', 'low']

/**
 * 异构词表 → 四档。
 *
 * `p0`–`p4` 是 ServiceNow 的 priority 写法。**表集中在这里** ——
 * 以后再遇到别的来源（`sev1`、`blocker`…）只加这一处，不去改模板。
 *
 * 注意 `p4` 映射到 `low` 而不是 `medium`：priority 数字越大越不紧急，
 * 把 `p4` 和 `p3` 一起塞进 medium 等于把"最低"说成了"中等"。
 */
const TIER_OF = {
  critical: 'critical',
  p0: 'critical',
  p1: 'critical',
  high: 'high',
  p2: 'high',
  medium: 'medium',
  p3: 'medium',
  low: 'low',
  p4: 'low',
}

/**
 * 认得、但**不属于平台四档**的既有值：`warning` / `info` 是**告警域**的写法
 * （`.severity-warning`、`.severity-info` 在 `styles.css` 里一直有）。
 *
 * 为什么原样透出、不折叠进四档：
 *
 * - 折叠会**改变现有外观**。`warning` 今天命中 `.severity-warning`（琥珀），
 *   若把它折叠成 `medium` 还只是换个名字；折叠成别的档就会**换颜色**，
 *   而 `info` 今天命中 `.severity-info`（蓝），折进 `low` 会变成绿——
 *   那是我这边引入的新回归，不是修 bug。
 * - 它们本来就不是"没认出来"，而是**另一套有名字的档位**。把认得的说成
 *   `unknown`，与把 `P1` 说成 `MEDIUM` 是同一种错误：都在撒谎。
 *
 * 工单表实际数据里没有这两个值（实测只有 high / medium / P1 / 空）——
 * 这条纯属防守，防的是"以后有人从告警侧塞一个 warning 进来"。
 */
const PASSTHROUGH = ['warning', 'info']

/** 归一化入口：trim + 转小写。非字符串（null / 数字 / 对象）一律当空处理。 */
function normalize(value) {
  if (value === null || value === undefined) return ''
  return String(value).trim().toLowerCase()
}

/**
 * 归到某一档；**认不出来时返回 `'unknown'`**，不是一个假装认识的默认档。
 *
 * 刻意不用"兜底到 medium"这种做法：那会让一条 `P9` 显示成 `MEDIUM`，
 * 把一个"我们不知道"说成了一个具体的严重程度。
 *
 * 返回值可能是**四档之一**、`warning`/`info`（见 `PASSTHROUGH`）、`'unknown'`、
 * 或 `''`（空值）。三种非四档的返回值都不是"兜底"，各有各的明确含义。
 */
export function severityTier(value) {
  const key = normalize(value)
  if (!key) return ''
  if (TIER_OF[key]) return TIER_OF[key]
  if (PASSTHROUGH.includes(key)) return key
  return 'unknown'
}

/**
 * 展示文案。
 *
 * - 认得的 → 统一的档位名（`CRITICAL` / `HIGH` / …）
 * - **认不得的 → 原样返回原值**（大写），不写 `UNKNOWN`
 *
 * 后面这条是刻意的：工单是分诊工具，`P9` 这种值对使用者仍是有用的线索，
 * 抹成 `UNKNOWN` 等于把线索删了。未知的只是"该配什么颜色"，不是"这是什么"。
 *
 * 空值返回 `''` —— 由调用点的 `v-else` 显示 `-`，本模块不管占位符。
 */
export function severityLabel(value) {
  const tier = severityTier(value)
  if (!tier) return ''
  if (tier === 'unknown') return normalize(value).toUpperCase()
  return tier.toUpperCase()
}

/**
 * CSS 类名。调用点用法：`class="alert-tag" :class="severityClass(t.severity)"`。
 *
 * `unknown` 有一条**自己的规则**（`.severity-unknown`，中性灰），不再落到
 * `.alert-tag` 基类上 —— 那正是这次要消灭的隐式兜底：没规则就等于没样式，
 * 而"没样式"在页面上看起来像"忘了做"。
 */
export function severityClass(value) {
  const tier = severityTier(value)
  if (!tier) return ''
  return `severity-${tier}`
}
