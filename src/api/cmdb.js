/**
 * CMDB 编辑面（datasource MCP server 的 `/admin/cmdb/**`）。
 *
 * 与另外两个后端的区别值得说清：
 *
 * - **这是唯一会写数据的接口。** `sip-aiops` / `agentflow` 都是查询，
 *   所以这个模块的方法名用 `create/update/remove`，不做"看起来像查询"的命名。
 * - **后端不是 agentflow**：CMDB 的载体是 aiops-datasource-mcp-server 的实体文件，
 *   写端点挂在那个 server 上。dev proxy 把 `/api/cmdb` rewrite 成 `/admin/cmdb`。
 *
 * ## 失败时后端会说什么
 *
 * 写操作**先整份过一遍 `build_graph` 校验**，不通过就整个拒绝、文件一个字节都不动。
 * 所以 4xx 不是"网络抽风"，而是**这次编辑真的没生效**，且 `message` 里带具体原因
 * （哪个节点、哪个字段、为什么）。界面必须把它原样显示出来，不能吞成"保存失败"。
 *
 * 后端错误体形状：`{error, message, ...details}`。`createClient` 的 ApiError 会把
 * 整个 body 挂在 `err.body` 上——这里统一取 `message` 出来。
 */
import { createClient } from './http'

export const cmdbAdmin = createClient({ name: 'cmdb', timeout: 30000 })

/** 把 ApiError 变成"能直接显示给用户的一句话" */
export function describeError(err) {
  const msg = err?.body?.message || err?.message || String(err)
  if (err?.status === 404) {
    return `${msg}\n（管理端点未启用或路径不对：确认 datasource server 以 DATASOURCE_ADMIN_ENABLED=true 启动）`
  }
  return msg
}

/**
 * 表单 schema。
 *
 * ⚠️ **`docs/cmdb-entities.schema.json` 不够用**：它由 `EntityDocument` 生成，而
 * `Node.attributes` 声明成 `dict[str, Any]`，每种节点类型真正的属性模型
 * （`NODE_ATTR_MODELS`）是旁表、pydantic 在模型图上看不到。表单字段只能从
 * `attribute_models` 拿；`open_attribute_types` 里的类型则退回自由键值编辑。
 */
export const cmdbApi = {
  schema: () => cmdbAdmin.get('/schema'),
  summary: () => cmdbAdmin.get('/summary'),
  nodes: (params) => cmdbAdmin.get('/nodes', { params }),

  createNode: (node) => cmdbAdmin.post('/nodes', node),
  updateNode: (id, patch) => cmdbAdmin.put(`/nodes/${encodeURIComponent(id)}`, patch),
  /** 删节点。被边引用时后端默认拒绝（409，且列出挡路的边）——`cascade` 才连边一起删。
   *  方法名是 `del` 不是 `delete`：`createClient` 的返回值里 `delete` 是保留字。 */
  removeNode: (id, { cascade = false } = {}) =>
    cmdbAdmin.del(`/nodes/${encodeURIComponent(id)}`, {
      params: cascade ? { cascade: 'true' } : undefined,
    }),

  createEdge: (edge) => cmdbAdmin.post('/edges', edge),
  removeEdge: (id) => cmdbAdmin.del(`/edges/${encodeURIComponent(id)}`),
}
